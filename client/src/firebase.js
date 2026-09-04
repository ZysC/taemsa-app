import { initializeApp } from 'firebase/app';
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

// Firebase Console → Project settings → Cloud Messaging → Web Push certificates
export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

let messagingPromise = null;

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
