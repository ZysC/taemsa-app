import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyD_SV1DrlUuVRk692asZuTDYDYnFXZRLho",
  authDomain: "taemsa-app.firebaseapp.com",
  projectId: "taemsa-app",
  storageBucket: "taemsa-app.firebasestorage.app",
  messagingSenderId: "531023823804",
  appId: "1:531023823804:web:a043c7b153eb166844e1b9",
  measurementId: "G-9EN6SY5K08"
};

const app = initializeApp(firebaseConfig);

/**
 * App Check (reCAPTCHA Enterprise — el proveedor actual recomendado).
 * Clave: Google Cloud → reCAPTCHA Enterprise → Create key (Web, score-based)
 * Luego: Firebase → App Check → app web → reCAPTCHA Enterprise
 * Env: VITE_FIREBASE_APPCHECK_SITE_KEY
 * Localhost: VITE_FIREBASE_APPCHECK_DEBUG_TOKEN (no pongas localhost en la key de producción)
 */
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY || '';

if (appCheckSiteKey) {
  if (import.meta.env.DEV) {
    const debug = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
    // true = Firebase imprime un debug token en la consola del navegador
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
export const storage = getStorage(app);
