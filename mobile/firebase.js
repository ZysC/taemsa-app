import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
export const auth = getAuth(app);
export const db = getFirestore(app);

let authReady = null;

/** Garantiza sesión anónima antes de leer/escribir Firestore. */
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
