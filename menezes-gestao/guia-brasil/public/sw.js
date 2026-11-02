// Service worker: guarda a "casca" do app para abrir sem internet. Os pacotes de viagem ficam no
// armazenamento do app (estado.js), não aqui. Perguntas e fotos (POST) nunca são guardadas pelo SW.
const VERSAO = 'guia-v1';
const CASCA = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'js/app.js', 'js/nucleo.js', 'js/sensores.js', 'js/estado.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) {
    // Lista de destinos: rede primeiro, cópia guardada se offline.
    if (url.pathname.endsWith('/api/pacotes')) {
      e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(VERSAO).then((k) => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    }
    return;
  }
  // Casca: rede primeiro (pega atualização), cache se offline.
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSAO).then((k) => k.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
