import { addDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

function isExpoPushToken(token) {
  return typeof token === 'string' && token.startsWith('ExponentPushToken[');
}

export async function createNotificationWithReceipts(form) {
  const snap = await getDocs(collection(db, 'devices'));
  const receipts = {};

  snap.docs.forEach((d) => {
    const data = d.data();
    receipts[d.id] = {
      clientName: data.clientName || d.id,
      platform: data.platform || '',
      expoGo: !!data.expoGo,
    };
  });

  const docRef = await addDoc(collection(db, 'notifications'), {
    ...form,
    createdAt: serverTimestamp(),
    receipts,
  });

  return { id: docRef.id, devices: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
}

export async function sendExpoPushes({ title, body, type, notificationId, devices }) {
  const list = devices ?? (await getDocs(collection(db, 'devices'))).docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));

  const messages = list
    .filter((d) => isExpoPushToken(d.token))
    .map((d) => ({
      to: d.token,
      sound: 'default',
      title,
      body,
      data: { type, notificationId },
      channelId: 'default',
    }));

  if (messages.length === 0) {
    return { sent: 0, skipped: list.length };
  }

  const res = await fetch('/api/expo-push', {
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

  return { sent: messages.length, skipped: list.length - messages.length };
}
