// Checks that a set of files was signed by the library's owner. Loaded both as
// a module (pages, tests) and as a classic script (the service worker).
globalThis.LiveVerify = (() => {
  const LIMITS = { files: 500, file: 5e6, total: 20e6, text: 200_000 };
  const PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
  // Part of the published loader; a live version may never replace these.
  const isLoader = (path) => path === 'sw.js' || path.startsWith('live/') || path.startsWith('vendor/');
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const sha256 = async (bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes));

  /** signed: { text, sig }. Returns the manifest, or throws. */
  async function check(signed, publicKey) {
    const { text, sig } = signed ?? {};
    if (!publicKey) throw new Error('No signing key is published');
    if (typeof text !== 'string' || text.length > LIMITS.text || typeof sig !== 'string' || sig.length > 200) throw new Error('Not a signed version');
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const bytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes, new TextEncoder().encode(text));
    if (!good) throw new Error('The signature does not match');
    const m = JSON.parse(text);
    const entries = Object.entries(m.files);
    if (m.v !== 1 || !Number.isSafeInteger(m.seq) || m.seq < 1 || entries.length > LIMITS.files) throw new Error('Bad manifest');
    let total = 0;
    for (const [path, f] of entries) {
      if (!PATH.test(path) || isLoader(path) || !/^[0-9a-f]{64}$/.test(f.h) || !Number.isSafeInteger(f.s) || f.s < 0 || f.s > LIMITS.file) throw new Error('Bad file entry');
      total += f.s;
    }
    if (total > LIMITS.total || !m.files['index.html']) throw new Error('Bad manifest');
    return m;
  }

  /** Identifies a set of files, whoever signed it and whenever. */
  const digest = (files) => sha256(new TextEncoder().encode(JSON.stringify(Object.entries(files).map(([p, f]) => [p, f.h]).sort(([a], [b]) => (a < b ? -1 : 1)))));

  return { check, sha256, digest, isLoader, LIMITS };
})();
