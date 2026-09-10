import { addDoc, collection, getDocs, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import { deviceWantsChannel } from './prefs';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

function isExpoPushToken(token) {
  return typeof token === 'string' && token.startsWith('ExponentPushToken[');
}

async function loadDevices() {
  const snap = await getDocs(collection(db, 'devices'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createNotificationWithReceipts(form) {
  const devices = await loadDevices();
  const receipts = {};

  devices.forEach((d) => {
    if (!deviceWantsChannel(d, 'alerts')) return;
    receipts[d.id] = {
      clientName: d.clientName || d.id,
      platform: d.platform || '',
      expoGo: !!d.expoGo,
    };
  });

  const docRef = await addDoc(collection(db, 'notifications'), {
    ...form,
    channel: 'alerts',
    createdAt: serverTimestamp(),
    receipts,
  });

  return { id: docRef.id, devices };
}

export async function createFarmaticUpdate(form) {
  const docRef = await addDoc(collection(db, 'farmaticUpdates'), {
    version: (form.version || '').trim(),
    title: form.title.trim(),
    body: form.body.trim(),
    notifyPush: !!form.notifyPush,
    createdAt: serverTimestamp(),
  });
  return { id: docRef.id };
}

export async function deleteFarmaticUpdate(id) {
  await deleteDoc(doc(db, 'farmaticUpdates', id));
}

async function postExpoBatch(messages) {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Expo Push HTTP ${res.status}`);
  }
}

export async function sendExpoPushes({
  title,
  body,
  type,
  notificationId,
  devices,
  channel = 'alerts',
}) {
  const list = devices ?? (await loadDevices());

  const messages = list
    .filter((d) => isExpoPushToken(d.token) && deviceWantsChannel(d, channel))
    .map((d) => ({
      to: d.token,
      sound: 'default',
      title,
      body,
      badge: 1,
      data: { type: type || channel, notificationId: notificationId || '', channel },
      channelId: 'default',
    }));

  if (messages.length === 0) {
    return { sent: 0, skipped: list.length };
  }

  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    await postExpoBatch(messages.slice(i, i + EXPO_BATCH_SIZE));
  }

  return { sent: messages.length, skipped: list.length - messages.length };
}
