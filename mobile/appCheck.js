import { Platform } from 'react-native';
import { initializeAppCheck as initializeJsAppCheck, CustomProvider } from 'firebase/app-check';
import { getApp as getNativeApp } from '@react-native-firebase/app';
import {
  initializeAppCheck as initializeNativeAppCheck,
  ReactNativeFirebaseAppCheckProvider,
  getToken as getNativeAppCheckToken,
} from '@react-native-firebase/app-check';
import { app as jsApp } from './firebase';

/**
 * App Check en Android:
 * - APK internas (EAS preview): proveedor debug + token de Firebase Console.
 * - Play Store / production: Play Integrity.
 *
 * El token nativo se inyecta en el Firebase JS SDK (Auth/Firestore) vía CustomProvider.
 */
let appCheckReady = null;

function resolveAndroidProvider() {
  const debugToken = (
    process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN
    || process.env.FIREBASE_APP_CHECK_DEBUG_TOKEN
    || ''
  ).trim();

  if (debugToken) {
    return { provider: 'debug', debugToken };
  }

  // Sin token debug: intenta Play Integrity (suele requerir distribución por Play Store).
  return { provider: 'playIntegrity' };
}

export function ensureAppCheck() {
  if (Platform.OS === 'web') {
    return Promise.resolve(null);
  }

  if (!appCheckReady) {
    appCheckReady = (async () => {
      const rnfbProvider = new ReactNativeFirebaseAppCheckProvider();
      const android = resolveAndroidProvider();

      rnfbProvider.configure({
        android,
        apple: {
          // iOS nativo aún no es el foco; debug evita romper builds.
          provider: 'debug',
        },
      });

      const nativeAppCheck = await initializeNativeAppCheck(getNativeApp(), {
        provider: rnfbProvider,
        isTokenAutoRefreshEnabled: true,
      });

      const customProvider = new CustomProvider({
        getToken: async () => {
          const result = await getNativeAppCheckToken(nativeAppCheck, false);
          const expireTimeMillis = result?.expireTimeMillis
            || (Date.now() + 55 * 60 * 1000);
          return {
            token: result.token,
            expireTimeMillis,
          };
        },
      });

      initializeJsAppCheck(jsApp, {
        provider: customProvider,
        isTokenAutoRefreshEnabled: true,
      });

      // Fuerza un primer token para fallar pronto si el proveedor no está listo.
      try {
        const { token } = await getNativeAppCheckToken(nativeAppCheck, true);
        if (__DEV__ && token) {
          console.log('[TAEMSA] App Check OK (token length', token.length, ')');
        }
      } catch (err) {
        console.log('[TAEMSA] App Check token error:', err?.message ?? err);
      }

      return nativeAppCheck;
    })().catch((err) => {
      console.log('[TAEMSA] App Check init failed:', err?.message ?? err);
      appCheckReady = null;
      throw err;
    });
  }

  return appCheckReady;
}
