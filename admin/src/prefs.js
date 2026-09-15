export const DEFAULT_PREFS = { alerts: true, farmatic: true, info: true };

export function normalizePrefs(prefs) {
  return {
    alerts: prefs?.alerts !== false,
    farmatic: prefs?.farmatic !== false,
    info: prefs?.info !== false,
  };
}

/** channel: 'alerts' | 'farmatic' | 'info' */
export function deviceWantsChannel(device, channel) {
  const prefs = normalizePrefs(device?.prefs);
  if (channel === 'farmatic') return prefs.farmatic;
  if (channel === 'info') return prefs.info;
  return prefs.alerts;
}
