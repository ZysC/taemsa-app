import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, ensureAppAuth } from './firebase';

const NAME_KEY = 'taemsa_client_name';
const PREFS_KEY = 'taemsa_prefs';

export const DEFAULT_PREFS = { alerts: true, farmatic: true };

export function normalizePrefs(prefs) {
  return {
    alerts: prefs?.alerts !== false,
    farmatic: prefs?.farmatic !== false,
  };
}

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

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  const next = normalizePrefs(prefs);
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

export function deviceIdFromClientName(clientName) {
  return `client-${safeId(clientName)}-web`;
}

export async function registerDevice(clientName, token = null, prefs = null) {
  await ensureAppAuth();
  const name = clientName.trim();
  const id = deviceIdFromClientName(name);
  const resolvedPrefs = normalizePrefs(prefs || loadPrefs());
  const payload = {
    expoGo: false,
    clientName: name,
    platform: 'web',
    uid: auth.currentUser.uid,
    prefs: resolvedPrefs,
    registeredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (token) {
    payload.token = token;
  }

  await setDoc(doc(db, 'devices', id), payload, { merge: true });
  return id;
}

export async function updateDevicePrefs(deviceId, prefs) {
  await ensureAppAuth();
  const next = savePrefs(prefs);
  await setDoc(
    doc(db, 'devices', deviceId),
    {
      prefs: next,
      uid: auth.currentUser.uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return next;
}

export async function markNotificationDelivered({ notificationId, deviceId, clientName }) {
  await ensureAppAuth();
  await updateDoc(doc(db, 'notifications', notificationId), {
    [`receipts.${deviceId}.clientName`]: clientName,
    [`receipts.${deviceId}.deliveredAt`]: serverTimestamp(),
  });
}

export async function markNotificationRead({ notificationId, deviceId, clientName }) {
  await ensureAppAuth();
  await updateDoc(doc(db, 'notifications', notificationId), {
    [`receipts.${deviceId}.clientName`]: clientName,
    [`receipts.${deviceId}.readAt`]: serverTimestamp(),
  });
}
