importScripts('./ngsw-worker.js');

self.addEventListener('push', (event) => {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/favicon.png',
      data: data.data,
      silent: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(location.host) && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      clients.openWindow(url);
    })
  );
});

// iOS may invalidate push subscription after force-quit
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then((newSubscription) => {
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(clients => {
            for (const client of clients) {
              client.postMessage({
                type: 'push-subscription-changed',
                oldEndpoint: event.oldSubscription?.endpoint,
                newSubscription: JSON.parse(JSON.stringify(newSubscription)),
              });
            }
          });
      })
      .catch(() => {
        // Cannot re-subscribe — nothing we can do
      })
  );
});
