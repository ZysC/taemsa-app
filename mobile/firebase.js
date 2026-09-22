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
export { app };

/**
 * Firebase 12: getReactNativePersistence a veces no llega al bundle de Metro.
 * Misma API que el SDK RN (clase con type LOCAL + AsyncStorage).
 */
function createAsyncStoragePersistence(storage) {
  const PersistenceClass = class {
    constructor() {
      this.type = 'LOCAL';
    }
    async _isAvailable() {
      try {
        if (!storage) return false;
        await storage.setItem('__firebase_auth_available', '1');
        await storage.removeItem('__firebase_auth_available');
        return true;
      } catch {
        return false;
      }
    }
    _set(key, value) {
      return storage.setItem(key, JSON.stringify(value));
    }
    async _get(key) {
      const json = await storage.getItem(key);
      return json ? JSON.parse(json) : null;
    }
    _remove(key) {
      return storage.removeItem(key);
    }
    _addListener() {}
    _removeListener() {}
  };
  PersistenceClass.type = 'LOCAL';
  return PersistenceClass;
}

function resolveAuthPersistence() {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const authMod = require('firebase/auth');
    if (typeof authMod.getReactNativePersistence === 'function') {
      return authMod.getReactNativePersistence(AsyncStorage);
    }
  } catch (_) {}
  return createAsyncStoragePersistence(AsyncStorage);
}

let auth;
try {
  auth = initializeAuth(app, { persistence: resolveAuthPersistence() });
} catch {
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);

let authReady = null;

/** Garantiza sesión anónima (persiste en AsyncStorage vía Auth persistence). */
export function ensureAppAuth() {
  if (!authReady) {
    authReady = (async () => {
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }
      if (auth.currentUser) return auth.currentUser;
      const cred = await signInAnonymously(auth);
      return cred.user;
    })();
  }
  return authReady;
}
