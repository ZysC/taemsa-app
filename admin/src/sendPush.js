import {
  addDoc, collection, getDocs, serverTimestamp, deleteDoc, doc, setDoc, writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import { deviceWantsChannel } from './prefs';

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

function normalizeTargetClientIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids = [...new Set(raw.map((id) => String(id || '').trim()).filter(Boolean))];
  return ids.length > 0 ? ids : null;
}

export async function createNotificationWithReceipts(form) {
  const devices = await loadDevices();
  const targetClientIds = normalizeTargetClientIds(form.targetClientIds);
  const targets = devices.filter((d) => {
    if (!deviceWantsChannel(d, 'alerts')) return false;
    if (targetClientIds && !targetClientIds.includes(d.clientId)) return false;
    return true;
  });

  const payload = {
    title: form.title,
    body: form.body,
    type: form.type || 'info',
    channel: 'alerts',
    createdAt: serverTimestamp(),
  };
  if (targetClientIds) {
    payload.targetClientIds = targetClientIds;
  }

  const docRef = await addDoc(collection(db, 'notifications'), payload);

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

  return { id: docRef.id, devices: targets, targetClientIds };
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

