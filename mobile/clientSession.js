import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = 'taemsa-session-v1';
/** Se conserva aunque se limpie la licencia, para no duplicar dispositivos. */
const DEVICE_ID_KEY = 'taemsa-device-id-stable';

export function normalizeClientCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function normalizeDeviceName(raw) {
  return String(raw || '').trim().slice(0, 80);
}

export function createDeviceId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId() {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = createDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return createDeviceId();
  }
}

export async function loadSession() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const deviceId = parsed.deviceId || (await AsyncStorage.getItem(DEVICE_ID_KEY)) || '';
      if (deviceId && deviceId !== parsed.deviceId) {
        await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
      }
      return {
        clientId: parsed.clientId || '',
        clientName: parsed.clientName || '',
        deviceId,
        deviceName: parsed.deviceName || '',
      };
    }

    // Migración desde claves sueltas de versiones anteriores
    const [clientId, clientName, deviceId, deviceName] = await Promise.all([
      AsyncStorage.getItem('taemsa-client-id'),
      AsyncStorage.getItem('taemsa-client-name'),
      AsyncStorage.getItem('taemsa-device-id'),
      AsyncStorage.getItem('taemsa-device-name'),
    ]);
    if (clientId && deviceId) {
      const session = {
        clientId,
        clientName: clientName || '',
        deviceId,
        deviceName: deviceName || '',
      };
      await saveSession(session);
      return session;
    }
    return { clientId: '', clientName: '', deviceId: '', deviceName: '' };
  } catch (err) {
    console.log('loadSession error:', err?.message ?? err);
    return { clientId: '', clientName: '', deviceId: '', deviceName: '' };
  }
}

export async function saveSession({ clientId, clientName, deviceId, deviceName }) {
  const payload = {
    clientId: String(clientId || ''),
    clientName: String(clientName || ''),
    deviceId: String(deviceId || ''),
    deviceName: String(deviceName || ''),
  };
  if (!payload.clientId || !payload.deviceId) {
    throw new Error('Sesión incompleta al guardar');
  }
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, payload.deviceId);
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    const verify = await AsyncStorage.getItem(SESSION_KEY);
    if (!verify) {
      throw new Error('No se pudo verificar la sesión guardada');
    }
  } catch (err) {
    console.log('saveSession error:', err?.message ?? err);
    throw err;
  }
}

export async function clearSession() {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
    await AsyncStorage.multiRemove([
      'taemsa-client-id',
      'taemsa-client-name',
      'taemsa-device-name',
      // No borramos device id estable ni legacy device id a propósito
    ]);
  } catch (err) {
    console.log('clearSession error:', err?.message ?? err);
  }
}
