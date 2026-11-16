'use strict';
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { title: 'Update', body: event.data?.text() || '' }; }
  const title = String(data.title || 'Update');
  const options = { body: String(data.body || ''), icon: '/icon.png', badge: '/icon.png', tag: String(data.id || 'nq-planner-update'), data: { url: data.url || '/', id: data.id || '' }, timestamp: data.updatedAt ? Date.parse(data.updatedAt) : Date.now(), renotify: false };
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => Promise.all(clients.map(client => client.postMessage({ type: 'nq-push', ...data }))))
  ]));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const open = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (open) { await open.focus(); open.postMessage({ type: 'nq-open-push', id: event.notification.data?.id || '' }); return; }
    return self.clients.openWindow(url.href);
  }));
});
