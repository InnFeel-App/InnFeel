/**
 * NO-OP stub for notifications.
 *
 * `expo-notifications` was removed to unblock the iOS App Store build
 * (it auto-injected the `aps-environment` entitlement, which required
 * the App ID to have Push Notifications enabled at developer.apple.com).
 *
 * All public functions below are kept with the SAME signatures so that
 * existing imports (settings.tsx, home.tsx, mood-create.tsx, _layout.tsx)
 * continue to compile without changes. They simply do nothing.
 *
 * To re-enable notifications in the future:
 *   1. Enable "Push Notifications" capability on the App ID at
 *      https://developer.apple.com/account/resources/identifiers/list
 *   2. yarn add expo-notifications
 *   3. Restore the original implementation of this file
 *   4. Re-add `expo-notifications` plugin in app.json plugins[]
 *   5. Re-generate the Provisioning Profile via `eas credentials`
 */

export type ScheduledReminder = {
  identifier: string;
  trigger?: unknown;
  content?: { title?: string; body?: string };
};

// --- Push token ---------------------------------------------------------
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  return null;
}

// --- Local daily reminders ---------------------------------------------
export async function ensureDailyRandomNotification(): Promise<void> {
  return;
}

export async function refreshSmartReminder(): Promise<void> {
  return;
}

export async function cancelEveningReminder(): Promise<void> {
  return;
}

export async function scheduleEveningReminder(): Promise<void> {
  return;
}

export async function cancelAllReminders(): Promise<void> {
  return;
}

export async function getAllScheduled(): Promise<ScheduledReminder[]> {
  return [];
}

// --- Settings page helpers ---------------------------------------------
export async function getRemindersEnabled(): Promise<boolean> {
  return false;
}

export async function setRemindersEnabled(_enabled: boolean): Promise<void> {
  return;
}

export async function getReminderTime(): Promise<{ hour: number; minute: number }> {
  return { hour: 20, minute: 0 };
}

export async function setReminderTime(_hour: number, _minute: number): Promise<void> {
  return;
}

// --- Foreground notify (used by home tab to surface friend updates) ----
export function notifyIfNew(_payload: unknown): void {
  return;
}

// --- Permissions -------------------------------------------------------
export async function requestPermissions(): Promise<{ granted: boolean }> {
  return { granted: false };
}

export async function getPermissions(): Promise<{ granted: boolean }> {
  return { granted: false };
}

export default {
  registerForPushNotificationsAsync,
  ensureDailyRandomNotification,
  refreshSmartReminder,
  cancelEveningReminder,
  scheduleEveningReminder,
  cancelAllReminders,
  getAllScheduled,
  getRemindersEnabled,
  setRemindersEnabled,
  getReminderTime,
  setReminderTime,
  notifyIfNew,
  requestPermissions,
  getPermissions,
};
