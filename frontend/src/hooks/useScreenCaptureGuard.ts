/**
 * useScreenCaptureGuard — blocks screenshots/screen-recordings for the CURRENT screen only.
 *
 * We used to install this globally, but users legitimately need to screenshot bug reports
 * (errors, DMs, settings). So this hook is now *screen-scoped* — it activates on mount and
 * releases on unmount. Currently wired only on the Home screen, which is the one that
 * renders friends' auras.
 *
 * Platform notes:
 *   • Android: expo-screen-capture fully prevents screenshots + screen recording (FLAG_SECURE).
 *   • iOS: Apple does NOT allow apps to block the screenshot gesture. `preventScreenCaptureAsync()`
 *     still protects against SCREEN RECORDING there and we pop a one-shot warning if a shot is
 *     detected while the guard is active.
 *   • Web: the lib is a no-op, which is fine (dev preview only).
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
    if (isAdmin) {
      // Admin QA needs captures to help users debug — do nothing here.
      return;
    }
    let mounted = true;
    let shotSub: { remove: () => void } | null = null;

    (async () => {
      try {
        await preventScreenCaptureAsync("innfeel-home");
        if (Platform.OS === "ios") {
          shotSub = addScreenshotListener(() => {
            if (!mounted) return;
            Alert.alert(
              "Screenshots disabled here",
              "To protect your friends' privacy, InnFeel asks not to screenshot auras.",
            );
          });
        }
      } catch {
        /* best-effort — never crash the app over capture guard */
      }
    })();

    return () => {
      mounted = false;
      try { shotSub?.remove(); } catch { /* ignore */ }
      // Release the block when leaving this screen so other screens stay capturable.
      allowScreenCaptureAsync("innfeel-home").catch(() => {});
    };
  }, [isAdmin]);
}
