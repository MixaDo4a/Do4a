const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function notificationCutoffIso() {
  return new Date(Date.now() - RETENTION_MS).toISOString();
}
