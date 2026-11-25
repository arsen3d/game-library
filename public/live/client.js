// On every page: follows the version running on the owner's computer. Game pages
// apply changes in place. Others, and deeper changes, reload when nothing would
// be lost, and offer a button otherwise.
import './published.js';
import { connect, installed, isOff, registerWorker, reset, roomCode, siteUrl } from './connect.js';
import { applyChanges, changes, hashes, safeToReload } from './reload.js';

const TRIED = 'library-live-tried';
const NAME = 'library-name', ID = 'library-presence-id', SHARE = 'library-share-tables';
const unnamed = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
const code = roomCode();
if (self === top && !globalThis.libraryDev && !isOff() && code && globalThis.LIVE_PUBLIC_KEY) {
  start().catch((err) => console.warn(`Live version unavailable: ${err.message}`)); // the page itself works on
}

async function start() {
  // What this page is: a live version (the worker says which) or the published one.
  let here = document.querySelector('meta[name="live-digest"]')?.content ?? globalThis.PUBLISHED.digest;
  let files = here === globalThis.PUBLISHED.digest ? globalThis.PUBLISHED.files ?? null : null; // its { path: hash }
  const first = await installed();
  if (first && !files) {
    const all = JSON.parse(first.text).files;
    if ((await globalThis.LiveVerify.digest(all)) === here) files = hashes(all);
  }
  if (sessionStorage.getItem(TRIED) === here) sessionStorage.removeItem(TRIED);
  await new Promise((r) => setTimeout(r, 400)); // let the page load first
  await registerWorker();

  const host = document.createElement('div');
  host.id = 'live-badge';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `
    <style>
      :host { position: fixed; right: 8px; bottom: 8px; z-index: 1000; display: flex; gap: 6px; align-items: center; font: 13px/1.3 system-ui, sans-serif; }
      button { font: inherit; color: #e9e6dc; background: #141b36; border: 1px solid #33406f; border-radius: 99px; padding: 5px 11px; cursor: pointer; }
      #new { background: #ffb454; border-color: #ffb454; color: #2a1800; font-weight: 600; }
      [hidden] { display: none; }
    </style>
    <button id="new" hidden>New version: reload</button>
    <button id="badge" hidden></button>`;
  const q = (s) => ui.querySelector(s);
  document.body.append(host);
  q('#new').onclick = () => location.reload();
  q('#badge').onclick = async () => {
    if (!confirm('Stop following the live version in this browser and use the published one?')) return;
    await reset();
    location.assign(siteUrl('./'));
  };

  let live = null;
  const refreshOnce = async () => {
    const now = await installed();
    const peers = live?.peer.peers.size ?? 0;
    q('#badge').hidden = !now;
    q('#badge').textContent = peers ? '● Live' : '○ Live copy';
    q('#badge').title = peers ? 'Connected to the live version' : 'Not connected. This is the last copy received.';
    if (!now) return;
    const all = JSON.parse(now.text).files;
    const latest = await globalThis.LiveVerify.digest(all);
    if (latest === here) return void (q('#new').hidden = true);
    // In place, if this page is under the worker's control and can do it.
    if (files && navigator.serviceWorker.controller) {
      const result = await applyChanges(changes(files, hashes(all)));
      if (result === 'wait') return;
      if (result === 'done') {
        here = latest;
        files = hashes(all);
        return void (q('#new').hidden = true);
      }
    }
    // One automatic try per version: if the worker isn't in charge of this page, don't loop.
    if (safeToReload() && sessionStorage.getItem(TRIED) !== latest) {
      sessionStorage.setItem(TRIED, latest);
      live?.leave();
      return location.reload();
    }
    q('#new').hidden = false;
  };
  // One at a time: applying a change takes a moment.
  let running = null;
  let again = false;
  const refresh = () => {
    if (running) { again = true; return running; }
    running = refreshOnce().catch((err) => console.error(err)).finally(() => {
      running = null;
      if (again) { again = false; refresh(); }
    });
    return running;
  };
  live = await connect(code, { onInstalled: refresh, onPeers: refresh });
  // Who is on the site: each visitor says its name (if it chose one) and where it is, and the others show it. Pages use
  // globalThis.libraryPresence and the 'librarypresence' event on window.
  const base = new URL('../', import.meta.url).pathname;
  const id = (localStorage.getItem(ID) ?? (localStorage.setItem(ID, crypto.randomUUID()), localStorage.getItem(ID)));
  const where = () => globalThis.libraryWhere?.() ?? location.pathname.slice(base.length).split('/')[0].replace(/\.html$/, '').replace(/^index$/, ''); // (the app page says which game its frame shows)
  // a game this browser made and nobody has joined is offered to the others only if its owner has said so (SHARE)
  const join = () => (localStorage.getItem(SHARE) === '1' ? globalThis.libraryShell?.openCode ?? '' : '');
  const say = () => live.peer.setPresence({ id, name: localStorage.getItem(NAME) ?? '', where: where(), join: join() });
  const tell = () => window.dispatchEvent(new Event('librarypresence'));
  globalThis.libraryPresence = {
    id,
    connected: true,
    get name() { return localStorage.getItem(NAME) ?? ''; },
    setName(name) { localStorage.setItem(NAME, unnamed(name)); say(); tell(); },
    get sharing() { return localStorage.getItem(SHARE) === '1'; },
    share(on) { localStorage.setItem(SHARE, on ? '1' : '0'); say(); tell(); },
    /** Everyone on the site as far as this browser can tell, this visitor first: { id, name, where, self }. */
    list: () => [{ id, name: localStorage.getItem(NAME) ?? '', where: where(), join: '', self: true }, ...live.peer.online().filter((p) => p.id !== id).map((p) => ({ id: p.id, name: p.name, where: p.where, join: p.join, self: false }))],
  };
  say();
  setInterval(say, 20_000);
  addEventListener('librarytable', say); // a game was made here, or somebody joined it
  live.peer.onPeers = () => { refresh(); tell(); };
  tell();
  await refresh();
  setInterval(refresh, 3000); // also notices other tabs' updates, and games that end
}
