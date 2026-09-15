import { isStandalonePwa } from './webPush';

const BASE_TITLE = 'TAEMSA — Avisos';

/**
 * Bolita en el icono solo si la PWA está instalada (standalone).
 * Si se llama desde una pestaña de Chrome, el badge acaba en el icono de Chrome.
 */
export async function setWebAppBadge(count) {
  const value = Math.max(0, Number(count) || 0);

  document.title = value > 0 ? `(${value}) ${BASE_TITLE}` : BASE_TITLE;

  if (!isStandalonePwa()) {
    try {
      if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
    } catch (_) {}
    return;
  }

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
