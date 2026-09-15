import {
  addDoc, collection, getDocs, serverTimestamp, deleteDoc, doc, setDoc, writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import { deviceWantsChannel } from './prefs';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

function isExpoPushToken(token) {
  return typeof token === 'string' && token.startsWith('ExponentPushToken[');
}

function safeFileName(name) {
  return String(name || 'documento.pdf')
    .replace(/[^\w.\-()\sÀ-ÿ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'documento.pdf';
}

async function loadActiveClientIds() {
  const snap = await getDocs(collection(db, 'clients'));
  const ids = new Set();
  snap.docs.forEach((d) => {
    if (d.data().active === true) ids.add(d.id);
  });
  return ids;
}

async function loadDevices() {
  const [devicesSnap, activeIds] = await Promise.all([
    getDocs(collection(db, 'devices')),
    loadActiveClientIds(),
  ]);
  return devicesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.clientId && activeIds.has(d.clientId));
}

export async function createNotificationWithReceipts(form) {
  const devices = await loadDevices();
  const targets = devices.filter((d) => deviceWantsChannel(d, 'alerts'));

  const docRef = await addDoc(collection(db, 'notifications'), {
    ...form,
    channel: 'alerts',
    createdAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  targets.forEach((d) => {
    const receiptRef = doc(db, 'notifications', docRef.id, 'receipts', d.id);
    batch.set(receiptRef, {
      clientName: d.clientName || d.id,
      deviceName: d.deviceName || '',
      clientId: d.clientId || '',
      platform: d.platform || '',
      uid: d.uid || '',
      expoGo: !!d.expoGo,
    });
  });
  if (targets.length > 0) {
    await batch.commit();
  }

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

export async function createInfoArticle(form, pdfFiles = []) {
  const docRef = doc(collection(db, 'infoArticles'));
  const files = Array.isArray(pdfFiles) ? pdfFiles.filter(Boolean) : (pdfFiles ? [pdfFiles] : []);
  const pdfs = [];

  for (const pdfFile of files) {
    if (pdfFile.type && pdfFile.type !== 'application/pdf') {
      throw new Error(`Solo se admiten PDF: ${pdfFile.name || 'archivo'}`);
    }
    const baseName = safeFileName(pdfFile.name);
    // Evita colisión si suben dos con el mismo nombre
    const uniqueName = pdfs.some((p) => p.name === baseName)
      ? `${Date.now()}_${baseName}`
      : baseName;
    const pdfPath = `info/${docRef.id}/${uniqueName}`;
    const storageRef = ref(storage, pdfPath);
    await uploadBytes(storageRef, pdfFile, { contentType: 'application/pdf' });
    const pdfUrl = await getDownloadURL(storageRef);
    pdfs.push({ url: pdfUrl, name: uniqueName, path: pdfPath });
  }

  const first = pdfs[0] || null;

  await setDoc(docRef, {
    title: form.title.trim(),
    body: form.body.trim(),
    notifyPush: !!form.notifyPush,
    pdfs,
    // Compatibilidad con artículos antiguos de 1 PDF
    pdfUrl: first?.url || '',
    pdfName: first?.name || '',
    pdfPath: first?.path || '',
    createdAt: serverTimestamp(),
  });

  return { id: docRef.id };
}

export async function deleteInfoArticle(article) {
  const id = typeof article === 'string' ? article : article?.id;
  if (!id) return;

  const paths = [];
  if (typeof article === 'object') {
    if (Array.isArray(article.pdfs)) {
      article.pdfs.forEach((p) => {
        if (p?.path) paths.push(p.path);
      });
    }
    if (article.pdfPath) paths.push(article.pdfPath);
  }

  await Promise.all(
    [...new Set(paths)].map(async (pdfPath) => {
      try {
        await deleteObject(ref(storage, pdfPath));
      } catch (err) {
        console.warn('No se pudo borrar el PDF:', err?.message || err);
      }
    }),
  );

  await deleteDoc(doc(db, 'infoArticles', id));
}

export async function deleteNotificationWithReceipts(notificationId) {
  const receiptsSnap = await getDocs(collection(db, 'notifications', notificationId, 'receipts'));
  const batch = writeBatch(db);
  receiptsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'notifications', notificationId));
  await batch.commit();
}

export async function loadNotificationReceipts(notificationId) {
  const snap = await getDocs(collection(db, 'notifications', notificationId, 'receipts'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
