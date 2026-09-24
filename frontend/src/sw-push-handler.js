importScripts('./ngsw-worker.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

function ackPush(ackId, kind, detail) {
  if (!ackId) return;
  fetch('/api/push/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ackId, kind, detail: detail || '' }),
  }).catch(() => {});
}

self.addEventListener('push', (event) => {
  let data;
  try { data = event.data?.json(); } catch {}
  if (!data) return;
  const ackId = data.data?.ackId;
  ackPush(ackId, 'received');
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/favicon.png',
      data: data.data,
      tag: data.data?.tag || 'default',
      requireInteraction: true,
    }).then(() => ackPush(ackId, 'shown'))
      .catch((err) => ackPush(ackId, 'error', String(err)))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  ackPush(event.notification.data?.ackId, 'click');
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

let pendingSub = null;

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function currentVapidKey() {
  try {
    const res = await fetch('/api/push/vapid-public-key', { cache: 'no-store' });
    const data = await res.json();
    return data.publicKey ? urlBase64ToUint8Array(data.publicKey) : null;
  } catch {
    return null;
  }
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    let newSubscription;
    try {
      const key = await currentVapidKey();
      // Must re-subscribe with the same VAPID key, otherwise the new
      // subscription is rejected by FCM/APNs with 403 (VAPID mismatch).
      newSubscription = await self.registration.pushManager.subscribe(
        key ? { userVisibleOnly: true, applicationServerKey: key } : { userVisibleOnly: true }
      );
    } catch {
      return;
    }
    const payload = {
      type: 'push-subscription-changed',
      oldEndpoint: event.oldSubscription?.endpoint,
      newSubscription: JSON.parse(JSON.stringify(newSubscription)),
    };
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      for (const client of clients) {
        client.postMessage(payload);
      }
    } else {
      pendingSub = payload;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'flush-pending-sub' && pendingSub) {
    event.source.postMessage({
      type: 'push-subscription-changed',
      ...pendingSub,
    });
    pendingSub = null;
  }
});
