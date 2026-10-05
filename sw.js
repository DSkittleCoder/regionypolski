// Kill switch: an earlier version of this site used a service worker with a
// cache. On GitHub Pages that could keep serving stale files after deploys
// (new HTML + old JS/CSS = broken UI). This worker clears all caches,
// unregisters itself and reloads open tabs, so the site goes back to plain
// HTTP caching. Do not re-add a caching service worker without a solid
// update strategy.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch (e) {}
      try {
        await self.registration.unregister();
      } catch (e) {}
      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((client) => client.navigate(client.url));
      } catch (e) {}
    })()
  );
});
