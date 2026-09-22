import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'taemsa-receipts-cache-v1';

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function serializeMap(receipts) {
  const out = {};
  Object.entries(receipts || {}).forEach(([id, data]) => {
    if (!data) return;
    const readAt = toMillis(data.readAt);
    const deliveredAt = toMillis(data.deliveredAt);
    if (readAt == null && deliveredAt == null) return;
    out[id] = {};
    if (readAt != null) out[id].readAt = readAt;
    if (deliveredAt != null) out[id].deliveredAt = deliveredAt;
  });
  return out;
}

function deserializeMap(raw) {
  const out = {};
  Object.entries(raw || {}).forEach(([id, data]) => {
    if (!data) return;
    out[id] = {};
    if (data.readAt != null) out[id].readAt = new Date(data.readAt);
    if (data.deliveredAt != null) out[id].deliveredAt = new Date(data.deliveredAt);
  });
  return out;
}

export async function loadReceiptsCache(deviceId) {
  if (!deviceId) return {};
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed?.deviceId !== deviceId || !parsed?.receipts) return {};
    return deserializeMap(parsed.receipts);
  } catch {
    return {};
  }
}

export async function saveReceiptsCache(deviceId, receipts) {
  if (!deviceId) return;
  try {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        deviceId,
        receipts: serializeMap(receipts),
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // ignore
  }
}
