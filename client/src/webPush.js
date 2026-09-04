import { getToken, onMessage } from 'firebase/messaging';
import { getFirebaseMessaging, VAPID_KEY } from './firebase';

export async function registerMessagingServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Este navegador no soporta service workers.');
  }
  return navigator.serviceWorker.register('/firebase-messaging-sw.js');
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
    throw new Error('No se pudo obtener el token push.');
  }

  return token;
}

export async function listenForegroundMessages(handler) {
  const messaging = await getFirebaseMessaging();
  if (!messaging) return () => {};
  return onMessage(messaging, handler);
}
