/**
 * useScreenCaptureGuard — blocks screenshots/screen-recordings for everyone except admins.
 *
 * Platform notes:
 *   • Android: expo-screen-capture fully prevents screenshots + screen recording (FLAG_SECURE).
 *   • iOS: Apple does NOT allow apps to block the screenshot gesture. `preventScreenCaptureAsync()`
 *     still protects against SCREEN RECORDING there (AVPlayer/Broadcast) and, once a screenshot
 *     is detected, we pop a one-shot warning so the user knows it's monitored.
 *   • Web: the lib is a no-op, which is fine (dev preview only).
 *
 * Usage: call once at the top of the authenticated root layout; it reacts to `user.is_admin`.
 */
import { useEffect } from "react";
import { Alert, Platform } from "react-native";
import {
  addScreenshotListener,
  allowScreenCaptureAsync,
  preventScreenCaptureAsync,
} from "expo-screen-capture";

export function useScreenCaptureGuard(isAdmin: boolean) {
  useEffect(() => {
    let mounted = true;
    let shotSub: { remove: () => void } | null = null;

    async function apply() {
      try {
        if (isAdmin) {
          // Admin QA needs screenshots to help users debug — explicitly allow.
          await allowScreenCaptureAsync();
          return;
        }
        await preventScreenCaptureAsync("innfeel-privacy");
        if (Platform.OS === "ios") {
          // iOS can't block, but we get notified. Show a single heads-up per screenshot.
          shotSub = addScreenshotListener(() => {
            if (!mounted) return;
            Alert.alert(
              "Screenshots disabled",
              "InnFeel is a privacy-first space. Please don't screenshot your friends' auras.",
            );
          });
        }
      } catch {
        // Fail silently — guard is best-effort; never crash the app over it.
      }
    }

    apply();

    return () => {
      mounted = false;
      try { shotSub?.remove(); } catch { /* ignore */ }
      // On unmount we deliberately do NOT re-allow capture — the guard should stay active
      // for the lifetime of the authenticated session.
    };
  }, [isAdmin]);
}
