// Serves the live version once one has been installed, and the published files
// until then, or when those are newer. It checks the owner's signature itself, whatever page asked it to install.
importScripts('live/key.js', 'live/verify.js', 'live/published.js');

const LIVE = 'library-live';
const BOOT = 'library-boot';
const scope = new URL(self.registration.scope);
const manifestKey = new URL('__live/manifest', scope).href;
const blobKey = (h) => new URL(`__live/blob/${h}`, scope).href;
const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', json: 'application/json', png: 'image/png', jpg: 'image/jpeg',
  webp: 'image/webp', ico: 'image/x-icon', mp3: 'audio/mpeg', woff2: 'font/woff2', wasm: 'application/wasm',
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

let current; // undefined: not read yet. null: nothing installed
async function manifest() {
  if (current === undefined) {
    const saved = await (await caches.open(LIVE)).match(manifestKey);
    current = saved ? JSON.parse((await saved.json()).text) : null;
    if (current && current.seq <= PUBLISHED.at) current = null; // published since
  }
  return current;
}

async function install({ text, sig, blobs }) {
  const next = await LiveVerify.check({ text, sig }, globalThis.LIVE_PUBLIC_KEY);
  const before = await manifest();
  if (next.seq <= Math.max(before?.seq ?? 0, PUBLISHED.at)) throw new Error('Not newer');
  const cache = await caches.open(LIVE);
  for (const { h, s } of Object.values(next.files)) {
    if (await cache.match(blobKey(h))) continue;
    const bytes = blobs.get(h);
    if (!bytes || bytes.byteLength !== s || (await LiveVerify.sha256(bytes)) !== h) throw new Error('A file did not match');
    await cache.put(blobKey(h), new Response(bytes));
  }
  await cache.put(manifestKey, new Response(JSON.stringify({ text, sig, seq: next.seq })));
  current = next;
  // Keep the previous version's files for pages that are still open.
  const keep = new Set([next, before].flatMap((m) => (m ? Object.values(m.files).map((f) => blobKey(f.h)) : [])));
  for (const req of await cache.keys()) if (req.url !== manifestKey && !keep.has(req.url)) await cache.delete(req);
}

let installing = Promise.resolve();
self.addEventListener('message', (e) => {
  if (e.data?.t !== 'install' || !e.ports[0]) return;
  const job = installing.then(() => install(e.data)); // one at a time, across tabs
  installing = job.catch(() => {});
  e.waitUntil(job.then(() => e.ports[0].postMessage({ ok: true }), (err) => e.ports[0].postMessage({ error: err.message })));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  let path;
  try { path = decodeURIComponent(url.pathname.slice(scope.pathname.length)); } catch { return; }
  if (path === 'sw.js') return;
  e.respondWith(path === 'live' || LiveVerify.isLoader(path) ? loader(e.request) : serve(e.request, path));
});

// The loader always comes from the published site, or its last copy when offline.
async function loader(request) {
  const cache = await caches.open(BOOT);
  try {
    const res = await fetch(request, { cache: 'no-cache' });
    if (res.ok && !res.redirected) await cache.put(request.url.split(/[?#]/)[0], res.clone());
    return res;
  } catch (err) {
    const saved = await cache.match(request.url.split(/[?#]/)[0]);
    if (saved) return saved;
    throw err;
  }
}

async function serve(request, path) {
  const m = await manifest();
  if (!m) return fetch(request);
  const has = (p) => Object.hasOwn(m.files, p);
  if (path && !path.endsWith('/') && !has(path) && has(`${path}/index.html`)) return Response.redirect(new URL(`${path}/`, scope).href, 302);
  const file = path === '' || path.endsWith('/') ? `${path}index.html` : path;
  if (!has(file)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  const saved = await (await caches.open(LIVE)).match(blobKey(m.files[file].h));
  if (!saved) return fetch(request); // the browser cleared part of its storage
  const type = TYPES[file.split('.').pop()] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!file.endsWith('.html')) return new Response(saved.body, { headers });
  const html = await saved.text();
  const client = html.includes('live/client.js') ? '' : `<script type="module" src="${new URL('live/client.js', scope).pathname}"></script>`;
  return new Response(`${html}\n<meta name="live-digest" content="${await LiveVerify.digest(m.files)}">${client}`, { headers });
}
