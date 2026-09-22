import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { app, auth, db, ensureAppAuth } from './firebase';

const functions = getFunctions(app, 'europe-west1');

async function callT3(name, data) {
  await ensureAppAuth();
  if (!auth.currentUser) {
    throw new Error('Sin sesión');
  }
  const fn = httpsCallable(functions, name);
  const result = await fn(data);
  return result.data;
}

export async function fetchClientSupportEmail(clientId) {
  await ensureAppAuth();
  const snap = await getDoc(doc(db, 'clients', clientId));
  if (!snap.exists()) return '';
  return String(snap.data()?.email || '').trim();
}

export async function createT3Ticket({
  clientId,
  deviceId,
  body,
  files = [],
}) {
  return callT3('t3CreateTicket', {
    clientId,
    deviceId,
    body,
    files,
  });
}

export async function fetchMyT3Tickets({ clientId, deviceId }) {
  return callT3('t3MyTickets', { clientId, deviceId });
}
