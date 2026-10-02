/* PeopleHub service worker: offline app shell + cache-first hashed assets (API calls are never cached) and push notifications. */
const CACHE = 'peoplehub-v2';
const SHELL = ['/', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // SPA navigations: network first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return res; }).catch(() => caches.match('/')));
    return;
  }
  // Content-hashed build assets never change, so serve them from cache once fetched.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); } return res; })));
  }
});

// Push notifications: shown by the operating system even when no PeopleHub tab is open.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'PeopleHub', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'PeopleHub';
  e.waitUntil((async () => {
    if (typeof data.unread === 'number' && self.navigator.setAppBadge) {
      try { await (data.unread ? self.navigator.setAppBadge(data.unread) : self.navigator.clearAppBadge()); } catch { /* badging unsupported */ }
    }
    // Let open tabs refresh the bell at once.
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    tabs.forEach((c) => c.postMessage({ type: 'notification', data }));
    await self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      timestamp: Date.now(),
      data: { link: data.link || '/', id: data.id },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { link = '/', id } = e.notification.data || {};
  const target = new URL(link, self.location.origin);
  if (id) target.searchParams.set('notification', id);
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      await tab.focus();
      tab.postMessage({ type: 'open', link: target.pathname + target.search });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

// The browser rotated the subscription: tell the server about the new one.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    tabs.forEach((c) => c.postMessage({ type: 'resubscribe' }));
  })());
});
