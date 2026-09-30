const CACHE_NAME = 'exrisco-static-v1.4.1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './styles-base.css',
  './styles-ui.css',
  './app.js',
  './app-config.js',
  './app-patient.js',
  './app-role-ui.js',
  './app-admin.js',
  './app-network.js',
  './app-opt-core.js',
  './app-opt-write.js',
  './app-opt-dashboard.js',
  './app-opt-import.js',
  './app-idoso.js',
  './app-main.js',
  './app-access.js',
  './app-update.js',
  './manifest.webmanifest',
  './icon.svg'
];

let shellRefreshPromise = null;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('exrisco-static-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function responseFingerprint(response) {
  const buffer = await response.clone().arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function refreshAppShell() {
  if (shellRefreshPromise) return shellRefreshPromise;

  shellRefreshPromise = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const assets = [...new Set(APP_SHELL.filter((asset) => asset !== './'))];
    let changed = false;

    for (const asset of assets) {
      try {
        const fresh = await fetch(asset, { cache: 'no-store' });
        if (!fresh.ok) continue;

        const cached = await cache.match(asset);
        const freshFingerprint = await responseFingerprint(fresh);
        const cachedFingerprint = cached ? await responseFingerprint(cached) : '';

        if (freshFingerprint !== cachedFingerprint) {
          changed = true;
          await cache.put(asset, fresh.clone());
        }
      } catch (error) {
        console.warn(`Falha ao verificar ${asset}`, error);
      }
    }

    if (changed) {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) client.postMessage({ type: 'EXRISCO_UPDATE_READY' });
    }
  })().finally(() => {
    shellRefreshPromise = null;
  });

  return shellRefreshPromise;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'CHECK_APP_SHELL') {
    event.waitUntil(refreshAppShell());
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
