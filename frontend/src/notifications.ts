import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getItem, setItem } from "./storage";
import { api } from "./api";

/**
 * Notification preferences — per-category toggles.
 * All default to ON. User can disable any in Settings.
 */
export type NotifCategory =
  | "reminder"     // daily aura reminder (noon + backup 19:30)
  | "reaction"     // someone reacted/commented on my aura
  | "message"      // new DM received
  | "friend";      // friend added / accepted

const CAT_KEYS: Record<NotifCategory, string> = {
  reminder: "innfeel_notif_reminder",
  reaction: "innfeel_notif_reaction",
  message: "innfeel_notif_message",
  friend: "innfeel_notif_friend",
};

// Per-category last-seen counters (so we can detect "new" events)
const SEEN_KEYS = {
  reaction: "innfeel_last_reaction_count",
  message: "innfeel_last_message_count",
  friend: "innfeel_last_friend_count",
};

const KEY_LAST_SCHEDULED = "innfeel_last_notif_scheduled_day";
// Bump this when we change notification scheduling semantics — forces every client to
// nuke any stale schedules (e.g. legacy ones that fired on UTC hour instead of local hour).
const KEY_SCHEDULE_VERSION = "innfeel_notif_schedule_version";
const CURRENT_SCHEDULE_VERSION = "v3_smart_hour_2026_06";

// Fixed reminder times — fallback when smart hour is unavailable
export const REMINDER_NOON_HOUR = 12;
export const REMINDER_NOON_MINUTE = 0;
export const REMINDER_EVENING_HOUR = 19;
export const REMINDER_EVENING_MINUTE = 30;

// Legacy constants kept for import compat elsewhere
export const DEFAULT_HOUR = REMINDER_NOON_HOUR;
export const DEFAULT_MINUTE = REMINDER_NOON_MINUTE;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const KEY_PUSH_TOKEN = "innfeel_expo_push_token";

/**
 * Register for Expo push notifications and send the token to the backend.
 * Safe to call repeatedly — only sends to backend when the token changes.
 * Returns the token (or null on web/sim/denied).
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    // Web has no native push in Expo Go/dev; skip.
    if (Platform.OS === "web") return null;
    // Simulator / non-physical devices cannot receive push.
    if (!Device.isDevice) return null;

    // Android requires a channel to render notifications properly.
    if (Platform.OS === "android") {
      try {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.MAX,
          sound: "default",
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#EC4899",
        });
        for (const chan of ["reminder", "reaction", "message", "friend"]) {
          await Notifications.setNotificationChannelAsync(chan, {
            name: chan,
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
          });
        }
      } catch {}
    }

    // Permission
    const ok = await ensurePermission();
    if (!ok) return null;

    // Resolve the Expo projectId from EAS config / manifest if set; fall back to undefined.
    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId ||
      undefined;

    let tokenData;
    try {
      tokenData = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
    } catch {
      // Expo Go without a projectId can still return a legacy token, but may error on some SDKs.
      return null;
    }
    const token = tokenData?.data || null;
    if (!token) return null;

    // Avoid re-posting the same token more than once.
    const cached = await getItem(KEY_PUSH_TOKEN);
    if (cached !== token) {
      try {
        await api("/notifications/register-token", {
          method: "POST",
          body: { token, platform: Platform.OS },
        });
        await setItem(KEY_PUSH_TOKEN, token);
      } catch {
        // If backend rejected (e.g. offline), we'll retry next boot.
      }
    }
    return token;
  } catch {
    return null;
  }
}

export async function clearCachedPushToken() {
  try { await setItem(KEY_PUSH_TOKEN, ""); } catch {}
}

export async function getCategoryEnabled(cat: NotifCategory): Promise<boolean> {
  const v = await getItem(CAT_KEYS[cat]);
  return v !== "0"; // default ON
}

export async function setCategoryEnabled(cat: NotifCategory, enabled: boolean) {
  await setItem(CAT_KEYS[cat], enabled ? "1" : "0");
  if (cat === "reminder") {
    // Re-schedule (or cancel) the daily reminders immediately
    if (enabled) {
      await scheduleDailyReminder();
    } else {
      await cancelReminderOnly();
    }
  }
}

export async function getAllPrefs(): Promise<Record<NotifCategory, boolean>> {
  return {
    reminder: await getCategoryEnabled("reminder"),
    reaction: await getCategoryEnabled("reaction"),
    message: await getCategoryEnabled("message"),
    friend: await getCategoryEnabled("friend"),
  };
}

async function ensurePermission(): Promise<boolean> {
  const { granted } = await Notifications.getPermissionsAsync();
  if (granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return !!req.granted;
}

/**
 * Smart Reminders (B4) — Fetch the user's typical posting hour from the backend.
 * Returns the noon fallback (12:00) if the call fails or there's not enough history.
 */
async function fetchSmartHour(): Promise<{ hour: number; minute: number; source: string; samples: number }> {
  try {
    const r = await api<{ hour: number; minute: number; source: string; samples: number }>("/notifications/smart-hour");
    return {
      hour: typeof r?.hour === "number" ? r.hour : REMINDER_NOON_HOUR,
      minute: typeof r?.minute === "number" ? r.minute : REMINDER_NOON_MINUTE,
      source: r?.source || "default",
      samples: r?.samples || 0,
    };
  } catch {
    return { hour: REMINDER_NOON_HOUR, minute: REMINDER_NOON_MINUTE, source: "default", samples: 0 };
  }
}

/**
 * Schedules BOTH daily reminders:
 *  - SMART HOUR  primary — user's typical posting time (noon fallback)
 *  - 19:30       safety-net (will fire only if user hasn't posted yet today)
 * Called on app boot & when user toggles the reminder on.
 */
export async function scheduleDailyReminder(): Promise<{ scheduled: boolean; hour?: number; source?: string }> {
  try {
    const enabled = await getCategoryEnabled("reminder");
    if (!enabled) return { scheduled: false };

    const ok = await ensurePermission();
    if (!ok) return { scheduled: false };

    // ---- One-time migration: if a user has a legacy schedule from a previous version
    // that may have been committed in UTC, wipe EVERYTHING scheduled and re-plant clean ones.
    const version = await getItem(KEY_SCHEDULE_VERSION);
    if (version !== CURRENT_SCHEDULE_VERSION) {
      try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
      await setItem(KEY_LAST_SCHEDULED, "");
      await setItem(KEY_SCHEDULE_VERSION, CURRENT_SCHEDULE_VERSION);
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const last = await getItem(KEY_LAST_SCHEDULED);
    if (last === todayKey) {
      return { scheduled: true }; // already scheduled today
    }

    await cancelReminderOnly();

    // Smart hour: use server-computed hour from user's posting history.
    const smart = await fetchSmartHour();

    // IMPORTANT: `SchedulableTriggerInputTypes.DAILY` fires at `hour`:`minute` in the
    // DEVICE'S LOCAL TIMEZONE (Android via AlarmManager, iOS via UNCalendarNotificationTrigger).
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Your daily aura ✨",
        body: smart.source === "history"
          ? "Time for your usual aura check-in."
          : "Take 20 seconds to share how you feel today.",
        data: { kind: "reminder_noon", hour: smart.hour, source: smart.source },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: smart.hour,
        minute: smart.minute,
      } as any,
    });

    // Evening safety-net at 19:30 — only schedule if smart hour isn't already in the evening
    // (avoid two reminders within an hour of each other).
    const tooCloseToEvening = Math.abs(smart.hour - REMINDER_EVENING_HOUR) <= 1;
    if (!tooCloseToEvening) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Haven't shared yet?",
          body: "One aura, 20 seconds — then see your friends' day.",
          data: { kind: "reminder_evening" },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: REMINDER_EVENING_HOUR,
          minute: REMINDER_EVENING_MINUTE,
        } as any,
      });
    }

    await setItem(KEY_LAST_SCHEDULED, todayKey);
    return { scheduled: true, hour: smart.hour, source: smart.source };
  } catch {
    return { scheduled: false };
  }
}

/**
 * Force-refresh the smart reminder (e.g. after the user posts, to pick up the new
 * histogram median). Cancels existing schedules and re-plants them with the latest
 * smart hour from the backend.
 */
export async function refreshSmartReminder(): Promise<{ scheduled: boolean }> {
  try {
    await cancelReminderOnly();
    await setItem(KEY_LAST_SCHEDULED, ""); // reset day-key guard so re-scheduling actually happens
    return await scheduleDailyReminder();
  } catch {
    return { scheduled: false };
  }
}

/** Cancel only the scheduled DAILY reminders (not the instant push ones). */
export async function cancelReminderOnly() {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all) {
      const kind = (n.content?.data as any)?.kind;
      if (kind === "reminder_noon" || kind === "reminder_evening") {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
    // Reset the guard so next enable will re-schedule
    await setItem(KEY_LAST_SCHEDULED, "");
  } catch {}
}

/** Cancel the evening reminder (called when user successfully posts today). */
export async function cancelEveningReminder() {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all) {
      const kind = (n.content?.data as any)?.kind;
      if (kind === "reminder_evening") {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch {}
}

/** Legacy alias kept for any old imports. */
export async function clearAllScheduled() {
  await cancelReminderOnly();
}

/** Legacy alias — boots the reminder system. */
export async function ensureDailyRandomNotification(): Promise<{ scheduled: boolean }> {
  return scheduleDailyReminder();
}

/**
 * In-app event notifier — call this when polled counts increase.
 * We only trigger a local notification if the category is enabled AND the
 * count has strictly increased since last seen.
 */
export async function notifyIfNew(
  cat: Exclude<NotifCategory, "reminder">,
  newCount: number,
  opts: { title: string; body: string; data?: any },
) {
  try {
    const enabled = await getCategoryEnabled(cat);
    if (!enabled) return;
    const key = SEEN_KEYS[cat];
    const prev = await getItem(key);
    const prevN = prev === null ? -1 : Number(prev);
    if (newCount > prevN && prevN >= 0) {
      const ok = await ensurePermission();
      if (ok) {
        await Notifications.scheduleNotificationAsync({
          content: { title: opts.title, body: opts.body, data: opts.data || { kind: cat } },
          trigger: null, // fire immediately
        });
      }
    }
    // Always record the new count (even on first call, to avoid a burst)
    await setItem(key, String(newCount));
  } catch {}
}

export async function resetSeenCounter(cat: Exclude<NotifCategory, "reminder">) {
  try { await setItem(SEEN_KEYS[cat], "0"); } catch {}
}
