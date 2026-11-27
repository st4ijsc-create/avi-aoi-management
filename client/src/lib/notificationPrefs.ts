/**
 * Doc 10 / U8 — per-user notification preferences (localStorage).
 *
 * Lets a user reduce alert noise during a shift without changing what the backend sends:
 *   • highPriorityOnly — show only NG_ALERT (hide YIELD_WARNING + info).
 *   • snoozeUntil      — epoch ms; while in the future, hide all alerts.
 *
 * Presentation-only (the alerts still arrive; this just filters the UI). Stored per-user so
 * a shared kiosk doesn't leak prefs between operators.
 */
export interface NotificationPrefs {
  highPriorityOnly: boolean;
  snoozeUntil: number; // epoch ms; 0 = not snoozed
}

const DEFAULTS: NotificationPrefs = { highPriorityOnly: false, snoozeUntil: 0 };
const KEY = (userKey: string) => `notifPrefs:${userKey}`;

/** Parse a single stored value: accept only the expected type, else return `fallback`. */
function parseBool(val: unknown, fallback: boolean): boolean {
  return typeof val === "boolean" ? val : fallback;
}

/** Parse snoozeUntil: accept only finite number ≥ 0, else return `fallback`. */
function parseSnooze(val: unknown, fallback: number): number {
  return typeof val === "number" && Number.isFinite(val) && val >= 0 ? val : fallback;
}

export function loadNotifPrefs(userKey: string): NotificationPrefs {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY(userKey));
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // Chỉ chấp nhận plain object (không phải mảng, null, số, chuỗi…)
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULTS };
    return {
      highPriorityOnly: parseBool(parsed.highPriorityOnly, DEFAULTS.highPriorityOnly),
      snoozeUntil: parseSnooze(parsed.snoozeUntil, DEFAULTS.snoozeUntil),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveNotifPrefs(userKey: string, prefs: NotificationPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(userKey), JSON.stringify(prefs));
  } catch {
    /* best-effort */
  }
}

export function isSnoozed(prefs: NotificationPrefs, now = Date.now()): boolean {
  return prefs.snoozeUntil > now;
}

/** Filter an alert list by the prefs. `priorityTypes` are the alert types treated as high. */
export function filterAlertsByPrefs<T extends { type?: string }>(
  alerts: T[],
  prefs: NotificationPrefs,
  priorityTypes: string[] = ["NG_ALERT"],
  now = Date.now(),
): T[] {
  if (isSnoozed(prefs, now)) return [];
  if (prefs.highPriorityOnly) return alerts.filter((a) => a.type != null && priorityTypes.includes(a.type));
  return alerts;
}
