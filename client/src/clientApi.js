import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { auth, db, ensureAppAuth } from './firebase';

const CLIENT_ID_KEY = 'taemsa_client_id';
const CLIENT_NAME_KEY = 'taemsa_client_name';
const DEVICE_ID_KEY = 'taemsa_device_id';
const DEVICE_NAME_KEY = 'taemsa_device_name';
const PREFS_KEY = 'taemsa_prefs';

export const DEFAULT_PREFS = { alerts: true, farmatic: true, info: true };

export function normalizePrefs(prefs) {
  return {
    alerts: prefs?.alerts !== false,
    farmatic: prefs?.farmatic !== false,
    info: prefs?.info !== false,
  };
}

export function normalizeClientCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function normalizeDeviceName(raw) {
  return String(raw || '').trim().slice(0, 80);
}

function createDeviceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function loadSession() {
  return {
    clientId: localStorage.getItem(CLIENT_ID_KEY) || '',
    clientName: localStorage.getItem(CLIENT_NAME_KEY) || '',
    deviceId: localStorage.getItem(DEVICE_ID_KEY) || '',
    deviceName: localStorage.getItem(DEVICE_NAME_KEY) || '',
  };
}

export function saveSession({ clientId, clientName, deviceId, deviceName }) {
  localStorage.setItem(CLIENT_ID_KEY, clientId);
  localStorage.setItem(CLIENT_NAME_KEY, clientName);
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
  localStorage.setItem(DEVICE_NAME_KEY, deviceName || '');
}

export function clearSession() {
  localStorage.removeItem(CLIENT_ID_KEY);
  localStorage.removeItem(CLIENT_NAME_KEY);
  localStorage.removeItem(DEVICE_ID_KEY);
  localStorage.removeItem(DEVICE_NAME_KEY);
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

export async function fetchActiveClient(code) {
  await ensureAppAuth();
  const clientId = normalizeClientCode(code);
  if (!clientId) throw new Error('Introduce el código de cliente');

  try {
    const snap = await getDoc(doc(db, 'clients', clientId));
    if (!snap.exists()) {
      const err = new Error('Código no válido o desactivado. Contacta con TAEMSA.');
      err.code = 'client-invalid';
      throw err;
    }
    const data = snap.data();
    return { id: snap.id, name: data.name || snap.id, active: true };
  } catch (err) {
    if (err?.code === 'client-invalid' || err?.message?.startsWith('Introduce')) {
      throw err;
    }
    if (err?.code === 'permission-denied' || /permission|insufficient/i.test(err?.message || '')) {
      const invalid = new Error('Código no válido o desactivado. Contacta con TAEMSA.');
      invalid.code = 'client-invalid';
      throw invalid;
    }
    const network = new Error(err?.message || 'No se pudo comprobar el código. Revisa la conexión.');
    network.code = 'client-check-failed';
    throw network;
  }
}

export async function redeemClientCode(code, deviceNameInput) {
  const deviceName = normalizeDeviceName(deviceNameInput);
  if (!deviceName) throw new Error('Indica un nombre para este dispositivo');

  const client = await fetchActiveClient(code);
  const existing = loadSession();
  const deviceId = existing.clientId === client.id && existing.deviceId
    ? existing.deviceId
    : createDeviceId();
  saveSession({
    clientId: client.id,
    clientName: client.name,
    deviceId,
    deviceName,
  });
  return { client, deviceId, deviceName };
}

export async function ensureActiveSession() {
  const session = loadSession();
  if (!session.clientId || !session.deviceId) return null;
  try {
    const client = await fetchActiveClient(session.clientId);
    saveSession({
      clientId: client.id,
      clientName: client.name,
      deviceId: session.deviceId,
      deviceName: session.deviceName || '',
    });
    return { ...session, clientName: client.name };
  } catch (err) {
    if (err?.code === 'client-invalid') {
      clearSession();
      return null;
    }
    return session;
  }
}

export async function saveDeviceNameOnly(deviceNameInput) {
  const deviceName = normalizeDeviceName(deviceNameInput);
  if (!deviceName) throw new Error('Indica un nombre para este dispositivo');
  const session = loadSession();
  if (!session.clientId || !session.deviceId) {
    throw new Error('Sesión incompleta');
  }
  saveSession({ ...session, deviceName });
  return deviceName;
}

export async function registerDevice({
  clientId,
  clientName,
  deviceId,
  deviceName,
  token = null,
  prefs = null,
}) {
  await ensureAppAuth();
  const session = loadSession();
  const id = deviceId || session.deviceId;
  const name = normalizeDeviceName(deviceName || session.deviceName);
  if (!id || !clientId || !name) throw new Error('Sesión incompleta');

  const resolvedPrefs = normalizePrefs(prefs || loadPrefs());
  const payload = {
    expoGo: false,
    clientId,
    clientName: clientName.trim(),
    deviceName: name,
    platform: 'web',
    uid: auth.currentUser.uid,
    prefs: resolvedPrefs,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    registeredAt: serverTimestamp(),
  };

  if (token) {
    payload.token = token;
  }

  await setDoc(doc(db, 'devices', id), payload, { merge: true });
  return id;
}

export async function updateDevicePrefs(deviceId, prefs, session = null) {
  await ensureAppAuth();
  const next = savePrefs(prefs);
  const s = session || loadSession();
  await setDoc(
    doc(db, 'devices', deviceId),
    {
      prefs: next,
      clientId: s.clientId,
      clientName: s.clientName,
      deviceName: s.deviceName,
      platform: 'web',
      uid: auth.currentUser.uid,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return next;
}

export async function markNotificationDelivered({ notificationId, deviceId, clientName, deviceName }) {
  await ensureAppAuth();
  await setDoc(
    doc(db, 'notifications', notificationId, 'receipts', deviceId),
    {
      clientName,
      deviceName: deviceName || '',
      uid: auth.currentUser.uid,
      deliveredAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function markNotificationRead({ notificationId, deviceId, clientName, deviceName }) {
  await ensureAppAuth();
  // Timestamp local: con serverTimestamp el snapshot a veces deja readAt en null.
  await setDoc(
    doc(db, 'notifications', notificationId, 'receipts', deviceId),
    {
      clientName,
      deviceName: deviceName || '',
      uid: auth.currentUser.uid,
      readAt: Timestamp.now(),
    },
    { merge: true },
  );
}
