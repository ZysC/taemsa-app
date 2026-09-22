const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { setGlobalOptions } = require('firebase-functions/v2');

initializeApp();
setGlobalOptions({ region: 'europe-west1' });

const t3 = require('./t3');
exports.t3Catalog = t3.t3Catalog;
exports.t3CreateTicket = t3.t3CreateTicket;
exports.t3MyTickets = t3.t3MyTickets;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;
const FCM_BATCH_SIZE = 500;

function isExpoToken(token) {
  return typeof token === 'string' && token.startsWith('ExponentPushToken[');
}

function isWebFcmToken(token) {
  return typeof token === 'string' && token.length > 20 && !isExpoToken(token);
}

function wantsChannel(data, channel) {
  const prefs = data?.prefs || {};
  if (channel === 'farmatic') return prefs.farmatic !== false;
  if (channel === 'info') return prefs.info !== false;
  return prefs.alerts !== false;
}

function webLinkForChannel(channel) {
  if (channel === 'farmatic') return 'https://taemsa-app.web.app/avisos/?tab=farmatic';
  if (channel === 'info') return 'https://taemsa-app.web.app/avisos/?tab=info';
  if (channel === 'incidencia') return 'https://taemsa-app.web.app/avisos/?tab=incidencia';
  return 'https://taemsa-app.web.app/avisos/';
}

function normalizeTargetClientIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids = [...new Set(raw.map((id) => String(id || '').trim()).filter(Boolean))];
  return ids.length > 0 ? ids : null;
}

async function loadActiveDevices(targetClientIds) {
  const db = getFirestore();
  const [clientsSnap, devicesSnap] = await Promise.all([
    db.collection('clients').get(),
    db.collection('devices').get(),
  ]);

  const activeIds = new Set();
  clientsSnap.forEach((d) => {
    if (d.data()?.active === true) activeIds.add(d.id);
  });

  const targetSet = normalizeTargetClientIds(targetClientIds);
  const allowedIds = targetSet
    ? new Set(targetSet.filter((id) => activeIds.has(id)))
    : activeIds;

  const devices = [];
  devicesSnap.forEach((d) => {
    const data = d.data() || {};
    if (!data.clientId || !allowedIds.has(data.clientId)) return;
    devices.push({ id: d.id, ...data });
  });
  return devices;
}

async function sendExpoPushes({ title, body, type, notificationId, channel, devices }) {
  const messages = devices
    .filter((d) => isExpoToken(d.token) && wantsChannel(d, channel))
    .map((d) => ({
      to: d.token,
      sound: 'default',
      title,
      body,
      badge: 1,
      data: {
        type: String(type || channel),
        notificationId: String(notificationId || ''),
        channel: String(channel),
      },
      channelId: 'default',
    }));

  if (messages.length === 0) {
    console.log(`No Expo tokens for channel=${channel}`);
    return { sent: 0 };
  }

  let sent = 0;
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const chunk = messages.slice(i, i + EXPO_BATCH_SIZE);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Expo Push HTTP ${res.status}: ${text}`);
    }

    sent += chunk.length;
  }

  console.log(`Expo channel=${channel} sent=${sent}`);
  return { sent };
}

async function sendWebFcm({ title, body, type, notificationId, channel, devices }) {
  const tokens = devices
    .filter((d) => isWebFcmToken(d.token) && wantsChannel(d, channel))
    .map((d) => d.token);

  if (tokens.length === 0) {
    console.log(`No web FCM tokens for channel=${channel}`);
    return { sent: 0, fail: 0 };
  }

  const messaging = getMessaging();
  let sent = 0;
  let fail = 0;

  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    const chunk = tokens.slice(i, i + FCM_BATCH_SIZE);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      data: {
        type: String(type),
        notificationId: String(notificationId || ''),
        channel: String(channel),
        title: String(title),
        body: String(body),
      },
      webpush: {
        fcmOptions: {
          link: webLinkForChannel(channel),
        },
        headers: {
          Urgency: 'high',
        },
      },
    });
    sent += res.successCount;
    fail += res.failureCount;
  }

  console.log(`FCM web channel=${channel} sent=${sent} fail=${fail}`);
  return { sent, fail };
}

async function sendAllPushes(payload) {
  const devices = await loadActiveDevices(payload.targetClientIds);
  const [expo, fcm] = await Promise.all([
    sendExpoPushes({ ...payload, devices }),
    sendWebFcm({ ...payload, devices }),
  ]);
  console.log(
    `Push done channel=${payload.channel} targets=${payload.targetClientIds?.length || 'all'} expo=${expo.sent} fcm=${fcm.sent} fcmFail=${fcm.fail}`,
  );
  return { expo, fcm };
}

// Nombres existentes (update in-place en deploy)
exports.sendWebPushesOnCreate = onDocumentCreated(
  'notifications/{notificationId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() || {};
    await sendAllPushes({
      title: data.title || 'TAEMSA',
      body: data.body || '',
      type: data.type || 'info',
      notificationId: event.params.notificationId,
      channel: 'alerts',
      targetClientIds: data.targetClientIds,
    });
  },
);

exports.sendWebPushesOnFarmaticCreate = onDocumentCreated(
  'farmaticUpdates/{updateId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() || {};
    if (!data.notifyPush) {
      console.log('Farmatic update without notifyPush');
      return;
    }

    const version = data.version ? `Farmatic ${data.version}` : 'Farmatic';
    await sendAllPushes({
      title: data.title || version,
      body: data.body || 'Nueva actualización disponible',
      type: 'farmatic',
      notificationId: event.params.updateId,
      channel: 'farmatic',
    });
  },
);

exports.sendWebPushesOnInfoCreate = onDocumentCreated(
  'infoArticles/{articleId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() || {};
    if (!data.notifyPush) {
      console.log('Info article without notifyPush');
      return;
    }

    await sendAllPushes({
      title: data.title || 'Información TAEMSA',
      body: data.body || 'Nueva información disponible',
      type: 'info',
      notificationId: event.params.articleId,
      channel: 'info',
    });
  },
);
