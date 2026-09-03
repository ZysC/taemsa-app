import { Platform } from 'react-native';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

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
} = {}) {
  const name = clientName.trim();
  const id = deviceIdFromClientName(name);

  await setDoc(
    doc(db, 'devices', id),
    {
      token,
      expoGo,
      clientName: name,
      platform: Platform.OS,
      registeredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return id;
}
