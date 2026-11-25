// Joins the live room and moves signed versions into this browser's storage.
import './key.js';
import './published.js';
import './verify.js';
import { LivePeer } from './peer.js';

const base = new URL('../', import.meta.url); // the site's root
const LIVE = 'library-live';
const manifestKey = new URL('__live/manifest', base).href;
const blobKey = (h) => new URL(`__live/blob/${h}`, base).href;

export const CODE = /^[A-HJKMNP-Z2-9]{16}$/;
export const siteUrl = (path) => new URL(path, base).href;
export const roomCode = () => (CODE.test(globalThis.LIVE_PUBLIC_CODE ?? '') ? globalThis.LIVE_PUBLIC_CODE : null);

const OFF = 'library-live-off';
export const isOff = () => { try { return localStorage.getItem(OFF) === '1'; } catch { return false; } };
export const turnOn = () => localStorage.removeItem(OFF);

const browserStore = {
  async signed() {
    const res = await (await caches.open(LIVE)).match(manifestKey);
    const saved = res ? await res.json() : null;
    return saved && saved.seq > globalThis.PUBLISHED.at ? saved : null; // otherwise the published site is newer
  },
  async blob(h) {
    const res = await (await caches.open(LIVE)).match(blobKey(h));
    return res ? res.arrayBuffer() : null;
  },
  async has(h) {
    return !!(await (await caches.open(LIVE)).match(blobKey(h)));
  },
  // The service worker checks everything again before saving it.
  async install(signed, blobs) {
    const { active } = await navigator.serviceWorker.ready;
    await new Promise((resolve, reject) => {
      const { port1, port2 } = new MessageChannel();
      const timer = setTimeout(() => reject(new Error('Saving timed out')), 20_000);
      port1.onmessage = (e) => {
        clearTimeout(timer);
        if (e.data.ok) resolve();
        else reject(new Error(e.data.error));
      };
      active.postMessage({ t: 'install', ...signed, blobs }, [port2]);
    });
  },
};

/** Connects to everyone with this live code. Returns { peer, leave }. */
export async function connect(code, { store = browserStore, ...handlers } = {}) {
  const { joinRoom } = await import('../vendor/trystero.js');
  const peer = new LivePeer({
    store,
    check: (signed) => globalThis.LiveVerify.check(signed, globalThis.LIVE_PUBLIC_KEY),
    sha256: globalThis.LiveVerify.sha256,
    ...handlers,
  });
  const room = joinRoom({
    appId: 'two-player-game-library-live-v1',
    password: code,
    relayConfig: { warnOnRelayFailure: false },
  }, code);
  const text = room.makeAction('c');
  const data = room.makeAction('b');
  const add = (id) => peer.add(id, (m, bytes) => {
    const sent = bytes ? data.send(bytes, { target: id, metadata: m }) : text.send(m, { target: id });
    sent.catch(() => {});
  });
  text.onMessage(async (m, { peerId }) => { await add(peerId); peer.receive(peerId, m); });
  data.onMessage(async (bytes, { peerId, metadata }) => { await add(peerId); peer.receive(peerId, metadata, bytes); });
  room.onPeerJoin(({ peerId }) => add(peerId));
  room.onPeerLeave(({ peerId }) => peer.remove(peerId));
  const leave = () => room.leave().catch(() => {});
  addEventListener('pagehide', leave);
  return { peer, leave };
}

export async function registerWorker() {
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('RTCPeerConnection' in window)) {
    throw new Error('This browser or page cannot run the live version');
  }
  await navigator.serviceWorker.register(siteUrl('sw.js'), { scope: base.pathname, updateViaCache: 'none' }).catch((err) => {
    console.error(err);
    throw new Error('This browser blocked the live version. Private windows and some in-app browsers do; try a normal window');
  });
  await navigator.serviceWorker.ready;
}

/** Goes back to the published version, and stays there until turned on again. */
export async function reset() {
  localStorage.setItem(OFF, '1');
  for (const r of await navigator.serviceWorker?.getRegistrations() ?? []) if (r.scope === base.href) await r.unregister();
  for (const name of [LIVE, 'library-boot']) await caches.delete(name);
}

export const installed = () => browserStore.signed();
