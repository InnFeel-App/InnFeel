import * as Notifications from "expo-notifications";
import { getItem, setItem } from "./storage";

const KEY_LAST_SCHEDULED = "innfeel_last_notif_scheduled_day";
const KEY_NOTIF_HOUR = "innfeel_notif_hour";
const KEY_NOTIF_MINUTE = "innfeel_notif_minute";

// Defaults: 12:00 (noon) — auras run noon→noon, so this gives users a full
// day to drop and see their friends' auras (rather than a short evening window).
export const DEFAULT_HOUR = 12;
export const DEFAULT_MINUTE = 0;
export const WINDOW_MIN_HOUR = 8;
export const WINDOW_MAX_HOUR = 21;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function getNotificationTime(): Promise<{ hour: number; minute: number }> {
  const h = await getItem(KEY_NOTIF_HOUR);
  const m = await getItem(KEY_NOTIF_MINUTE);
  const hour = h !== null && !isNaN(Number(h)) ? Number(h) : DEFAULT_HOUR;
  const minute = m !== null && !isNaN(Number(m)) ? Number(m) : DEFAULT_MINUTE;
  return { hour, minute };
}

export async function setNotificationTime(hour: number, minute: number) {
  await setItem(KEY_NOTIF_HOUR, String(hour));
  await setItem(KEY_NOTIF_MINUTE, String(minute));
  // Force reschedule on next call
  await setItem(KEY_LAST_SCHEDULED, "");
}

export async function scheduleDailyReminder(): Promise<{ scheduled: boolean; when?: Date }> {
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      if (!req.granted) return { scheduled: false };
    }

    const { hour, minute } = await getNotificationTime();

    const todayKey = `${new Date().toISOString().slice(0, 10)}_${hour}_${minute}`;
    const last = await getItem(KEY_LAST_SCHEDULED);
    if (last === todayKey) {
      return { scheduled: true };
    }

    // Cancel previous to avoid duplicates
    await Notifications.cancelAllScheduledNotificationsAsync();

    // Schedule a DAILY repeating notification at the chosen hour/minute
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "It's time. ✦",
        body: "Share your aura in 20 seconds.",
        data: { kind: "daily_drop" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      } as any,
    });

    // compute next fire date for UI preview
    const now = new Date();
    const fire = new Date();
    fire.setHours(hour, minute, 0, 0);
    if (fire.getTime() <= now.getTime()) fire.setDate(fire.getDate() + 1);

    await setItem(KEY_LAST_SCHEDULED, todayKey);
    return { scheduled: true, when: fire };
  } catch {
    return { scheduled: false };
  }
}

// Back-compat alias used from _layout.tsx
export async function ensureDailyRandomNotification(
  _startHour?: number,
  _endHour?: number
): Promise<{ scheduled: boolean; when?: Date }> {
  return scheduleDailyReminder();
}

export async function clearAllScheduled() {
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
}
