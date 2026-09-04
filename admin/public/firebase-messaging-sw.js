// Service worker FCM — debe vivir en la raíz del hosting
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyD_SV1DrlUuVRk692asZuTDYDYnFXZRLho',
  authDomain: 'taemsa-app.firebaseapp.com',
  projectId: 'taemsa-app',
  storageBucket: 'taemsa-app.firebasestorage.app',
  messagingSenderId: '531023823804',
  appId: '1:531023823804:web:a043c7b153eb166844e1b9',
});

const messaging = firebase.messaging();

// Solo mostramos nosotros el aviso (payload data-only).
// Si el mensaje ya trae "notification", FCM lo muestra solo: no duplicar.
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) {
    return;
  }

  const title = payload.data?.title || 'TAEMSA';
  const body = payload.data?.body || '';
  self.registration.showNotification(title, {
    body,
    icon: '/avisos/icon-192.png',
    tag: payload.data?.notificationId || 'taemsa',
    renotify: true,
    data: payload.data || {},
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = '/avisos/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/avisos') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
      return undefined;
    }),
  );
});
