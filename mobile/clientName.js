const NAME_KEY = 'taemsa-client-name';

async function storage() {
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

export async function loadClientName() {
  try {
    const AsyncStorage = await storage();
    return (await AsyncStorage.getItem(NAME_KEY)) || '';
  } catch {
    return '';
  }
}

export async function saveClientName(name) {
  try {
    const AsyncStorage = await storage();
    await AsyncStorage.setItem(NAME_KEY, name);
  } catch {
    // Sin almacenamiento local, pedirá el nombre otra vez al reabrir.
  }
}
