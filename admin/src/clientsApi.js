import {
  collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateClientCode() {
  let part = '';
  for (let i = 0; i < 6; i += 1) {
    part += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `TAEM-${part}`;
}

export function normalizeClientCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export async function createClient(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Nombre obligatorio');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateClientCode();
    const ref = doc(db, 'clients', code);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    await setDoc(ref, {
      name: trimmed,
      active: true,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || '',
    });
    return { id: code, name: trimmed, active: true };
  }
  throw new Error('No se pudo generar un código único');
}

export async function setClientActive(clientId, active) {
  await updateDoc(doc(db, 'clients', clientId), { active: !!active });
}

export async function deleteClientAndDevices(clientId, devices) {
  const owned = devices.filter((d) => d.clientId === clientId);
  await Promise.all(owned.map((d) => deleteDoc(doc(db, 'devices', d.id))));
  await deleteDoc(doc(db, 'clients', clientId));
}

export async function loadClients() {
  const snap = await getDocs(collection(db, 'clients'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function clientDeviceStats(clientId, devices) {
  const owned = devices.filter((d) => d.clientId === clientId);
  let lastSeenAt = null;
  owned.forEach((d) => {
    const ts = d.lastSeenAt?.toMillis?.() ?? d.updatedAt?.toMillis?.() ?? 0;
    if (ts && (!lastSeenAt || ts > lastSeenAt)) lastSeenAt = ts;
  });
  return { count: owned.length, lastSeenAt, devices: owned };
}
