import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getMessaging, isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: "AIzaSyD_SV1DrlUuVRk692asZuTDYDYnFXZRLho",
  authDomain: "taemsa-app.firebaseapp.com",
  projectId: "taemsa-app",
  storageBucket: "taemsa-app.firebasestorage.app",
  messagingSenderId: "531023823804",
  appId: "1:531023823804:web:a043c7b153eb166844e1b9",
  measurementId: "G-9EN6SY5K08"
};

export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

const app = initializeApp(firebaseConfig);

const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY || '';

if (appCheckSiteKey) {
  if (import.meta.env.DEV) {
    const debug = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debug === undefined || debug === '' ? true : debug;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
} else if (import.meta.env.DEV) {
  console.warn('[TAEMSA] Falta VITE_FIREBASE_APPCHECK_SITE_KEY — App Check no activo');
}

export const auth = getAuth(app);
export const db = getFirestore(app);

let authReady = null;
let messagingPromise = null;

export function ensureAppAuth() {
  if (!authReady) {
    authReady = new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        unsub();
        if (user) {
          resolve(user);
          return;
        }
        signInAnonymously(auth)
          .then((cred) => resolve(cred.user))
          .catch(reject);
      });
    });
  }
  return authReady;
}

export async function getFirebaseMessaging() {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      const ok = await isSupported();
      if (!ok) return null;
      return getMessaging(app);
    })();
  }
  return messagingPromise;
}
