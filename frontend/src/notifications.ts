import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getItem, setItem } from "./storage";

const KEY_LAST_SCHEDULED = "mooddrop_last_notif_scheduled_day";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureDailyRandomNotification(
  startHour = 9,
  endHour = 21
): Promise<{ scheduled: boolean; when?: Date }> {
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      if (!req.granted) return { scheduled: false };
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const last = await getItem(KEY_LAST_SCHEDULED);
    if (last === todayKey) {
      // already scheduled for today
      return { scheduled: true };
    }

    // Cancel previous to avoid duplicates
    await Notifications.cancelAllScheduledNotificationsAsync();

    // Pick a random moment in the window for TODAY if still ahead, else for TOMORROW
    const now = new Date();
    const target = new Date(now);
    target.setHours(startHour, 0, 0, 0);
    const windowStartMs = target.getTime();
    const windowEndMs = new Date(now).setHours(endHour, 0, 0, 0);
    let rand = windowStartMs + Math.random() * (windowEndMs - windowStartMs);
    if (rand <= now.getTime() + 60_000) {
      // push to tomorrow if today's window has passed
      const tmr = new Date(windowStartMs + 24 * 3600_000);
      const tmrEnd = new Date(windowEndMs + 24 * 3600_000).getTime();
      rand = tmr.getTime() + Math.random() * (tmrEnd - tmr.getTime());
    }
    const fireAt = new Date(rand);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "It's time. ✦",
        body: "Drop your mood in 20 seconds.",
        data: { kind: "daily_drop" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
      } as any,
    });
    await setItem(KEY_LAST_SCHEDULED, todayKey);
    return { scheduled: true, when: fireAt };
  } catch {
    return { scheduled: false };
  }
}

export async function clearAllScheduled() {
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
}
