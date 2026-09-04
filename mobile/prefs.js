export const DEFAULT_PREFS = { alerts: true, farmatic: true };

export function normalizePrefs(prefs) {
  return {
    alerts: prefs?.alerts !== false,
    farmatic: prefs?.farmatic !== false,
  };
}
