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

exports.sendWebPushesOnCreate = onDocumentCreated('notifications/{notificationId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const data = snap.data() || {};
  const notificationId = event.params.notificationId;
  const title = data.title || 'TAEMSA';
  const body = data.body || '';
  const type = data.type || 'info';

  const devices = await getFirestore().collection('devices').get();
  const tokens = [];
  devices.forEach((doc) => {
    const token = doc.data()?.token;
    if (isWebFcmToken(token)) tokens.push(token);
  });

  if (tokens.length === 0) {
    console.log('No web FCM tokens to notify');
    return;
  }

  const messaging = getMessaging();
  const chunkSize = 500;

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    // Data-only: una sola notificación la muestra el service worker
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      data: {
        type: String(type),
        notificationId: String(notificationId),
        title: String(title),
        body: String(body),
      },
      webpush: {
        fcmOptions: {
          link: 'https://taemsa-app.web.app/avisos/',
        },
        headers: {
          Urgency: 'high',
        },
      },
    });
    console.log(`FCM web sent=${res.successCount} fail=${res.failureCount}`);
  }
});
