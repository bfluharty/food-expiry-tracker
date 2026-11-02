import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function offlineServiceWorker(): Plugin {
  return {
    name: 'offline-service-worker',
    async writeBundle(options, bundle) {
      const assets = Object.keys(bundle).map((file) => `./${file}`);
      const publicFiles = await readdir(resolve(options.dir ?? 'dist'));
      const precache = [
        ...assets,
        ...publicFiles.filter((file) => file === 'manifest.webmanifest').map((file) => `./${file}`),
        './icons/icon.svg'
      ];
      const script = `
const CACHE = 'food-expiry-v2';
const SHELL = ${JSON.stringify(precache)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(new URL('./index.html', self.registration.scope))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
`;
      await writeFile(resolve(options.dir ?? 'dist', 'sw.js'), script);
    }
  };
}

export default defineConfig({
  base: '/food-expiry-tracker/',
  plugins: [offlineServiceWorker()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
