import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

const NAME_KEY = 'taemsa_client_name';

function safeId(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'cliente';
}

export function loadClientName() {
  return localStorage.getItem(NAME_KEY) || '';
}

export function saveClientName(name) {
  localStorage.setItem(NAME_KEY, name.trim());
}

export function deviceIdFromClientName(clientName) {
  return `client-${safeId(clientName)}-web`;
}

export async function registerDevice(clientName, token = null) {
  const name = clientName.trim();
  const id = deviceIdFromClientName(name);
  await setDoc(
    doc(db, 'devices', id),
    {
      token: token || null,
      expoGo: false,
      clientName: name,
      platform: 'web',
      registeredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return id;
}

export async function markNotificationDelivered({ notificationId, deviceId, clientName }) {
  await updateDoc(doc(db, 'notifications', notificationId), {
    [`receipts.${deviceId}.clientName`]: clientName,
    [`receipts.${deviceId}.deliveredAt`]: serverTimestamp(),
  });
}

export async function markNotificationRead({ notificationId, deviceId, clientName }) {
  await updateDoc(doc(db, 'notifications', notificationId), {
    [`receipts.${deviceId}.clientName`]: clientName,
    [`receipts.${deviceId}.readAt`]: serverTimestamp(),
  });
}
