// CONFIGURACIÓN FIREBASE
// Reemplaza estos valores con los de tu proyecto Firebase
// Firebase Console → tu proyecto → Configuración del proyecto → Tus apps → Web app

import { initializeApp } from 'firebase/app';
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
export const db = getFirestore(app);
