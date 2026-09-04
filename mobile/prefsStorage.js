import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PREFS, normalizePrefs } from './prefs';

const KEY = 'taemsa-prefs';

export async function loadPrefs() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs) {
  const next = normalizePrefs(prefs);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
