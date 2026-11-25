// Turns the live version on in this browser and opens it: live/, or
// live/#CODE/<game>/<room> from older invitations. live/#reset turns it off.
import { connect, installed, registerWorker, reset, roomCode, siteUrl, turnOn } from './connect.js';

const $ = (s) => document.querySelector(s);
const say = (text) => { $('#say').textContent = text; };
const code = roomCode();
const [, , game, room] = location.hash.match(/^#([A-Z0-9]{16})(?:\/([a-z0-9-]+)\/([A-Z0-9-]{8,9}))?$/) ?? [];
const target = siteUrl(game ? `${game}/#${room}` : './');

async function main() {
  if (location.hash === '#reset') {
    await reset();
    return location.replace(siteUrl('./'));
  }
  if (!code || !globalThis.LIVE_PUBLIC_KEY) throw new Error('Live versions are not set up for this site yet');
  await registerWorker();
  turnOn();
  const before = await installed();
  let left = false;
  const go = () => {
    if (left) return;
    left = true;
    say('Opening…');
    live?.leave();
    setTimeout(() => location.replace(target), 60); // let the goodbye out
  };
  let live = null;
  setTimeout(() => {
    if (left) return;
    say("Still looking. The computer sharing this may be off, or the network may block direct connections.");
    $('#saved').hidden = !before;
    $('#published').hidden = !!before;
  }, 12_000);
  live = await connect(code, {
    onInstalled: go,
    onProgress: (part, err) => say(err ? `That copy failed (${err.message}). Looking for another…` : `Downloading ${Math.round(part * 100)}%`),
    async onPeers() {
      const mine = (await installed())?.seq ?? 0;
      if (mine && [...live?.peer.peers.values() ?? []].some((p) => p.seq > 0 && p.seq <= mine)) go(); // already up to date
    },
  });
}
$('#published').onclick = () => location.replace(target);
$('#saved').onclick = () => location.replace(target);
addEventListener('hashchange', () => location.reload());
main().catch((err) => { say(err.message); $('#published').hidden = false; });
