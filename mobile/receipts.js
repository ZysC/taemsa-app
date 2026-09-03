import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

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
