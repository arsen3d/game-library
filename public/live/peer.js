// Spreads signed versions of the site between browsers. Everyone with the live
// link is equal: whoever has the newest signed version passes it on.
//
//   have { seq }   what I have (0: nothing)
//   want {}        send me your manifest   ->  manifest { text, sig }
//   get { h }      send me one file        ->  blob { h } + bytes, or none { h }
//   here { id, name, where, join }   who I am, where I am on the site, and the code of a game I made that nobody has joined (if I chose to show it), said on meeting and now and then (unsigned: for display only)
const TIMEOUT = 20_000;
const PARALLEL = 4;
const STALE = 75_000; // a visitor not heard from for this long is no longer shown
const words = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
/** What a visitor says about itself, made safe to show: a browser's id, a name of at most 24 characters, a place on the site, and a room code. */
export const presence = (m) => (typeof m?.id === 'string' && /^[a-z0-9-]{8,40}$/.test(m.id) ? { id: m.id, name: words(m.name, 24), where: /^[a-z0-9-]{0,24}$/.test(m.where ?? '') ? m.where ?? '' : '', join: /^[A-Z0-9-]{8,9}$/.test(m.join ?? '') ? m.join : '' } : null);

export class LivePeer {
  /**
   * store: { signed(), blob(hash), has(hash), install(signed, blobs) }
   *   signed() -> { text, sig, seq } or null.  install is null for the source.
   * check(signed) -> manifest, throws when it is not properly signed
   */
  constructor({ store, check, sha256, onInstalled = () => {}, onProgress = () => {}, onPeers = () => {} }) {
    Object.assign(this, { store, check, sha256, onInstalled, onProgress, onPeers });
    this.peers = new Map(); // id -> { send, seq }
    this.waiting = new Map(); // `${id} ${key}` -> { resolve, reject }
    this.busy = false;
    this.me = null; // what this visitor says about itself: { id, name, where }
  }

  async seq() { return (await this.store.signed())?.seq ?? 0; }

  async add(id, send) {
    if (this.peers.has(id)) return;
    this.peers.set(id, { send, seq: 0 });
    this.onPeers();
    send({ t: 'have', seq: await this.seq() });
    if (this.me) send({ t: 'here', ...this.me });
  }

  /** Says who this visitor is, to everyone now and to each one met later. */
  setPresence(info) {
    this.me = presence(info);
    if (this.me) for (const p of this.peers.values()) p.send({ t: 'here', ...this.me });
  }

  /** The other visitors who have said who they are, once each (a person with two tabs open is one), newest word first. */
  online(now = Date.now()) {
    const seen = new Map();
    for (const p of this.peers.values()) if (p.info && now - p.info.at < STALE && !(seen.get(p.info.id)?.at > p.info.at)) seen.set(p.info.id, p.info);
    return [...seen.values()].sort((a, b) => b.at - a.at);
  }

  remove(id) {
    this.peers.delete(id);
    for (const [key, w] of this.waiting) if (key.startsWith(`${id} `)) w.reject(new Error('Peer left'));
    this.onPeers();
  }

  /** Call when the local version changed, so others can fetch it. */
  async announce() {
    const seq = await this.seq();
    for (const p of this.peers.values()) p.send({ t: 'have', seq });
  }

  async receive(id, m, bytes) {
    const peer = this.peers.get(id);
    if (!peer || !m || typeof m !== 'object') return;
    if (m.t === 'have' && Number.isSafeInteger(m.seq)) {
      peer.seq = m.seq;
      this.onPeers();
      return this.update();
    }
    if (m.t === 'here') {
      const info = presence(m);
      if (info) { peer.info = { ...info, at: Date.now() }; this.onPeers(); }
      return;
    }
    if (m.t === 'want') {
      const s = await this.store.signed();
      return s ? peer.send({ t: 'manifest', text: s.text, sig: s.sig }) : undefined;
    }
    if (m.t === 'get' && typeof m.h === 'string' && /^[0-9a-f]{64}$/.test(m.h)) {
      const data = await this.store.blob(m.h);
      return data ? peer.send({ t: 'blob', h: m.h }, data) : peer.send({ t: 'none', h: m.h });
    }
    if (m.t === 'manifest') this.answer(id, 'manifest', m);
    if (m.t === 'blob') this.answer(id, m.h, bytes);
    if (m.t === 'none') this.answer(id, m.h, null);
  }

  answer(id, key, value) {
    this.waiting.get(`${id} ${key}`)?.resolve(value);
  }

  ask(id, key, message) {
    return new Promise((resolve, reject) => {
      const name = `${id} ${key}`;
      const done = (fn) => (v) => { clearTimeout(timer); this.waiting.delete(name); fn(v); };
      const timer = setTimeout(() => this.waiting.get(name)?.reject(new Error('Timed out')), TIMEOUT);
      this.waiting.set(name, { resolve: done(resolve), reject: done(reject) });
      const peer = this.peers.get(id);
      if (peer) peer.send(message);
      else this.waiting.get(name).reject(new Error('Peer left'));
    });
  }

  // Fetches the newest version on offer, trying each peer until one works.
  async update() {
    if (this.busy || !this.store.install) return;
    this.busy = true;
    try {
      const failed = new Set();
      for (;;) {
        const mine = await this.seq();
        const best = [...this.peers].filter(([id, p]) => p.seq > mine && !failed.has(`${id} ${p.seq}`)).sort((a, b) => b[1].seq - a[1].seq)[0];
        if (!best) return;
        const [id, peer] = best;
        const claimed = peer.seq;
        try {
          await this.fetchFrom(id, mine);
        } catch (err) {
          failed.add(`${id} ${claimed}`);
          this.onProgress(null, err);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async fetchFrom(id, mine) {
    const signed = await this.ask(id, 'manifest', { t: 'want' });
    const manifest = await this.check({ text: signed.text, sig: signed.sig });
    if (manifest.seq <= mine) throw new Error('Not newer');
    const sizes = new Map(Object.values(manifest.files).map((f) => [f.h, f.s]));
    const need = [];
    for (const h of sizes.keys()) if (!(await this.store.has(h))) need.push(h);
    const blobs = new Map();
    const queue = [...need];
    const worker = async () => {
      for (let h = queue.shift(); h; h = queue.shift()) {
        const bytes = await this.ask(id, h, { t: 'get', h });
        if (!bytes || bytes.byteLength !== sizes.get(h) || (await this.sha256(bytes)) !== h) throw new Error('A file did not match');
        blobs.set(h, bytes);
        this.onProgress(blobs.size / need.length);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    await this.store.install({ text: signed.text, sig: signed.sig }, blobs);
    this.onInstalled(manifest);
    await this.announce();
  }
}
