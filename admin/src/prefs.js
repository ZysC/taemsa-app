export const DEFAULT_PREFS = { alerts: true, farmatic: true };

export function normalizePrefs(prefs) {
  return {
    alerts: prefs?.alerts !== false,
    farmatic: prefs?.farmatic !== false,
  };
}

/** channel: 'alerts' | 'farmatic' */
export function deviceWantsChannel(device, channel) {
  const prefs = normalizePrefs(device?.prefs);
  return channel === 'farmatic' ? prefs.farmatic : prefs.alerts;
}
