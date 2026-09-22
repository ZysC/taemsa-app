import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { auth, db, ensureAppAuth } from './firebase';

export async function markNotificationDelivered({ notificationId, deviceId, clientName, deviceName }) {
  await ensureAppAuth();
  await setDoc(
    doc(db, 'notifications', notificationId, 'receipts', deviceId),
    {
      deviceId,
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
  await setDoc(
    doc(db, 'notifications', notificationId, 'receipts', deviceId),
    {
      deviceId,
      clientName,
      deviceName: deviceName || '',
      uid: auth.currentUser.uid,
      readAt: Timestamp.now(),
    },
    { merge: true },
  );
}
