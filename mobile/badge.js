import * as Notifications from 'expo-notifications';

/** Actualiza la bolita/número del icono de la app (iOS y la mayoría de Android). */
export async function setAppIconBadge(count) {
  const value = Math.max(0, Number(count) || 0);
  try {
    await Notifications.setBadgeCountAsync(value);
  } catch (err) {
    console.log('No se pudo actualizar el badge del icono:', err?.message ?? err);
  }
}
