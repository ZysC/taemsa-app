import { Platform } from 'react-native';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, ensureAppAuth } from './firebase';
import { normalizePrefs } from './prefs';
import {
  clearSession,
  getOrCreateDeviceId,
  loadSession,
  normalizeClientCode,
  normalizeDeviceName,
  saveSession,
} from './clientSession';

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
    // No convertir permission-denied genérico en "código inválido":
    // en arranque suele ser carrera de auth y borraba la sesión local.
    const network = new Error(err?.message || 'No se pudo comprobar el código. Revisa la conexión.');
    network.code = 'client-check-failed';
    network.cause = err;
    throw network;
  }
}

export async function redeemClientCode(code, deviceNameInput) {
  const deviceName = normalizeDeviceName(deviceNameInput);
  if (!deviceName) throw new Error('Indica un nombre para este dispositivo');

  const client = await fetchActiveClient(code);
  const existing = await loadSession();
  const deviceId =
    (existing.clientId === client.id && existing.deviceId)
      ? existing.deviceId
      : await getOrCreateDeviceId();
  await saveSession({
    clientId: client.id,
    clientName: client.name,
    deviceId,
    deviceName,
  });
  return { client, deviceId, deviceName };
}

export async function ensureActiveSession() {
  const session = await loadSession();
  if (!session.clientId || !session.deviceId) return null;
  try {
    const client = await fetchActiveClient(session.clientId);
    const next = {
      clientId: client.id,
      clientName: client.name,
      deviceId: session.deviceId,
      deviceName: session.deviceName || '',
    };
    await saveSession(next);
    return next;
  } catch (err) {
    // Solo borrar si el get del cliente respondió "no existe".
    // Cualquier otro error (red, auth, permisos) mantiene la sesión local.
    if (err?.code === 'client-invalid') {
      await clearSession();
      return null;
    }
    return session;
  }
}

export async function saveDeviceNameOnly(deviceNameInput) {
  const deviceName = normalizeDeviceName(deviceNameInput);
  if (!deviceName) throw new Error('Indica un nombre para este dispositivo');
  const session = await loadSession();
  if (!session.clientId || !session.deviceId) {
    throw new Error('Sesión incompleta');
  }
  await saveSession({ ...session, deviceName });
  return deviceName;
}

export async function registerDevice({
  token = null,
  expoGo = false,
  clientId,
  clientName,
  deviceId,
  deviceName,
  prefs,
  forceCreate = false,
} = {}) {
  await ensureAppAuth();
  const session = await loadSession();
  const id = deviceId || session.deviceId;
  const resolvedClientId = clientId || session.clientId;
  const name = (clientName || session.clientName || '').trim();
  const resolvedDeviceName = normalizeDeviceName(deviceName || session.deviceName);
  if (!id || !resolvedClientId || !name || !resolvedDeviceName) {
    throw new Error('Sesión incompleta');
  }

  const payload = {
    expoGo,
    clientId: resolvedClientId,
    clientName: name,
    deviceName: resolvedDeviceName,
    platform: Platform.OS,
    uid: auth.currentUser.uid,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (token) {
    payload.token = token;
  }

  if (prefs) {
    payload.prefs = normalizePrefs(prefs);
  }

  const ref = doc(db, 'devices', id);

  if (forceCreate) {
    await setDoc(ref, {
      ...payload,
      registeredAt: serverTimestamp(),
    }, { merge: true });
    return id;
  }

  try {
    await updateDoc(ref, payload);
  } catch (err) {
    if (err?.code === 'not-found') {
      await clearSession();
      const revoked = new Error('Este dispositivo fue dado de baja. Vuelve a introducir el código.');
      revoked.code = 'device-revoked';
      throw revoked;
    }
    throw err;
  }
  return id;
}

export async function updateDevicePrefs(deviceId, prefs, session = null) {
  await ensureAppAuth();
  const s = session || await loadSession();
  try {
    await updateDoc(doc(db, 'devices', deviceId), {
      prefs: normalizePrefs(prefs),
      clientId: s.clientId,
      clientName: s.clientName,
      deviceName: s.deviceName,
      platform: Platform.OS,
      uid: auth.currentUser.uid,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    if (err?.code === 'not-found') {
      await clearSession();
      const revoked = new Error('Este dispositivo fue dado de baja. Vuelve a introducir el código.');
      revoked.code = 'device-revoked';
      throw revoked;
    }
    throw err;
  }
}
