export const DEFAULT_PREFS = { alerts: true, farmatic: true, info: true };

export function normalizePrefs(prefs) {
  return {
    alerts: prefs?.alerts !== false,
    farmatic: prefs?.farmatic !== false,
    info: prefs?.info !== false,
  };
}
