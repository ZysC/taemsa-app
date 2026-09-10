const BASE_TITLE = 'TAEMSA — Avisos';

/** Bolita/número en el icono de la PWA (Chrome/Android, Edge, Safari instalado cuando lo soporte). */
export async function setWebAppBadge(count) {
  const value = Math.max(0, Number(count) || 0);

  document.title = value > 0 ? `(${value}) ${BASE_TITLE}` : BASE_TITLE;

  try {
    if (value > 0 && 'setAppBadge' in navigator) {
      await navigator.setAppBadge(value);
    } else if (value === 0 && 'clearAppBadge' in navigator) {
      await navigator.clearAppBadge();
    }
  } catch (err) {
    console.log('No se pudo actualizar el badge web:', err?.message || err);
  }
}
