import { Platform } from 'react-native';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, ensureAppAuth } from './firebase';
import { normalizePrefs } from './prefs';

function safeId(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'cliente';
}

export function deviceIdFromClientName(clientName) {
  return `client-${safeId(clientName)}-${Platform.OS}`;
}

export async function registerDevice({
  token = null,
  expoGo = false,
  clientName,
  prefs,
} = {}) {
  await ensureAppAuth();
  const name = clientName.trim();
  const id = deviceIdFromClientName(name);
  const payload = {
    expoGo,
    clientName: name,
    platform: Platform.OS,
    uid: auth.currentUser.uid,
    registeredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Solo escribe token si hay uno nuevo; así no se borra al remount.
  if (token) {
    payload.token = token;
  }

  if (prefs) {
    payload.prefs = normalizePrefs(prefs);
  }

  await setDoc(doc(db, 'devices', id), payload, { merge: true });
  return id;
}

export async function updateDevicePrefs(deviceId, prefs) {
  await ensureAppAuth();
  await setDoc(
    doc(db, 'devices', deviceId),
    {
      prefs: normalizePrefs(prefs),
      uid: auth.currentUser.uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
