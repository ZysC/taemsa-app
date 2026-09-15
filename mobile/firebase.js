import { initializeApp, getApps } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  signInAnonymously,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyD_SV1DrlUuVRk692asZuTDYDYnFXZRLho",
  authDomain: "taemsa-app.firebaseapp.com",
  projectId: "taemsa-app",
  storageBucket: "taemsa-app.firebasestorage.app",
  messagingSenderId: "531023823804",
  appId: "1:531023823804:web:a043c7b153eb166844e1b9",
  measurementId: "G-9EN6SY5K08"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

/**
 * Firebase 12 + Metro a veces no exporta getReactNativePersistence en el bundle web.
 * Persistencia propia del uid anónimo en AsyncStorage.
 */
const AUTH_UID_KEY = 'taemsa-firebase-auth-uid';

function getReactNativePersistenceSafe() {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const authMod = require('firebase/auth');
    if (typeof authMod.getReactNativePersistence === 'function') {
      return authMod.getReactNativePersistence(AsyncStorage);
    }
  } catch (_) {}
  return undefined;
}

let auth;
try {
  const persistence = getReactNativePersistenceSafe();
  auth = persistence
    ? initializeAuth(app, { persistence })
    : initializeAuth(app);
} catch {
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);

let authReady = null;

/** Garantiza sesión anónima (reutiliza uid guardado si el SDK no persiste). */
export function ensureAppAuth() {
  if (!authReady) {
    authReady = (async () => {
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }
      if (auth.currentUser) {
        try {
          await AsyncStorage.setItem(AUTH_UID_KEY, auth.currentUser.uid);
        } catch (_) {}
        return auth.currentUser;
      }
      const cred = await signInAnonymously(auth);
      try {
        await AsyncStorage.setItem(AUTH_UID_KEY, cred.user.uid);
      } catch (_) {}
      return cred.user;
    })();
  }
  return authReady;
}
