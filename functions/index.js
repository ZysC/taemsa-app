const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { setGlobalOptions } = require('firebase-functions/v2');

initializeApp();
setGlobalOptions({ region: 'europe-west1' });

function isExpoToken(token) {
  return typeof token === 'string' && token.startsWith('ExponentPushToken[');
}

function isWebFcmToken(token) {
  return typeof token === 'string' && token.length > 20 && !isExpoToken(token);
}

function wantsChannel(data, channel) {
  const prefs = data?.prefs || {};
  if (channel === 'farmatic') return prefs.farmatic !== false;
  return prefs.alerts !== false;
}

async function sendWebFcm({ title, body, type, notificationId, channel }) {
  const devices = await getFirestore().collection('devices').get();
  const tokens = [];
  devices.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!wantsChannel(data, channel)) return;
    const token = data.token;
    if (isWebFcmToken(token)) tokens.push(token);
  });

  if (tokens.length === 0) {
    console.log(`No web FCM tokens for channel=${channel}`);
    return;
  }

  const messaging = getMessaging();
  const chunkSize = 500;

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
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
          link: channel === 'farmatic'
            ? 'https://taemsa-app.web.app/avisos/?tab=farmatic'
            : 'https://taemsa-app.web.app/avisos/',
        },
        headers: {
          Urgency: 'high',
        },
      },
    });
    console.log(`FCM web channel=${channel} sent=${res.successCount} fail=${res.failureCount}`);
  }
}

exports.sendWebPushesOnCreate = onDocumentCreated('notifications/{notificationId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const data = snap.data() || {};
  await sendWebFcm({
    title: data.title || 'TAEMSA',
    body: data.body || '',
    type: data.type || 'info',
    notificationId: event.params.notificationId,
    channel: 'alerts',
  });
});

exports.sendWebPushesOnFarmaticCreate = onDocumentCreated('farmaticUpdates/{updateId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const data = snap.data() || {};
  if (!data.notifyPush) {
    console.log('Farmatic update without notifyPush');
    return;
  }

  const version = data.version ? `Farmatic ${data.version}` : 'Farmatic';
  await sendWebFcm({
    title: data.title || version,
    body: data.body || 'Nueva actualización disponible',
    type: 'farmatic',
    notificationId: event.params.updateId,
    channel: 'farmatic',
  });
});
