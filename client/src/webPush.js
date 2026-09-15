import { getToken, onMessage } from 'firebase/messaging';
import { getFirebaseMessaging, VAPID_KEY } from './firebase';

const AVISOS_SW_URL = '/avisos/firebase-messaging-sw.js';
const AVISOS_SW_SCOPE = '/avisos/';

function isStandalonePwa() {
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || window.navigator.standalone === true
  );
}

/** Desregistra el SW de la raíz que asociaba el badge a Chrome. */
async function retireRootMessagingWorker() {
  if (!('serviceWorker' in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map(async (reg) => {
      const script = reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
      const isRootMessaging =
        script.endsWith('/firebase-messaging-sw.js')
        && !script.includes('/avisos/');
      if (isRootMessaging) {
        try {
          if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
        } catch (_) {}
        await reg.unregister();
      }
    }),
  );
}

export async function registerMessagingServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Este navegador no soporta service workers.');
  }
  await retireRootMessagingWorker();
  return navigator.serviceWorker.register(AVISOS_SW_URL, { scope: AVISOS_SW_SCOPE });
}

export { isStandalonePwa };

/** Si ya hay permiso, recupera el token sin volver a pedir confirmación. */
export async function restoreWebPush() {
  if (!VAPID_KEY || !('Notification' in window)) return null;
  if (Notification.permission !== 'granted') return null;

  try {
    const registration = await registerMessagingServiceWorker();
    const messaging = await getFirebaseMessaging();
    if (!messaging) return null;

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch (err) {
    console.log('No se pudo restaurar push:', err?.message || err);
    return null;
  }
}

export async function enableWebPush() {
  if (!VAPID_KEY) {
    throw new Error('Falta la clave VAPID (VITE_FIREBASE_VAPID_KEY).');
  }

  if (!('Notification' in window)) {
    throw new Error('Este dispositivo no soporta notificaciones web.');
  }

  // iOS solo permite pedir permiso tras un gesto del usuario (botón).
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permiso de notificaciones denegado.');
  }

  const registration = await registerMessagingServiceWorker();
  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    throw new Error('FCM no está disponible aquí. En iPhone: Añadir a inicio y iOS 16.4+.');
  }

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });

  if (!token) {
    throw new Error('No se pudieron activar las notificaciones.');
  }

  return token;
}

export async function listenForegroundMessages(handler) {
  const messaging = await getFirebaseMessaging();
  if (!messaging) return () => {};
  return onMessage(messaging, handler);
}
