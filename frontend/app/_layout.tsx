import React, { useEffect, useState } from "react";
import { Alert, Linking } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import { AuthProvider, useAuth } from "../src/auth";
import { api } from "../src/api";
import { ensureDailyRandomNotification, registerForPushNotificationsAsync } from "../src/notifications";
import { loadLocaleOverride } from "../src/i18n";
import { initIAP, identifyIAP } from "../src/iap";
import ErrorBoundary from "../src/components/ErrorBoundary";

/** Pull a friend invite code out of any deep-link / universal-link the OS
 *  hands us. Accepts:
 *   - innfeel://add/ABCDEF12
 *   - https://innfeel.app/add/ABCDEF12
 *   - https://innfeel.app/add/ABCDEF12?utm=foo  (extra query params ignored)
 *  Returns the upper-cased code (matches backend storage) or null.
 */
function extractInviteCode(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const m = url.match(/\/add\/([A-Za-z0-9]{4,16})/);
    if (m && m[1]) return m[1].toUpperCase();
  } catch {}
  return null;
}

function DeepLinkHandler() {
  const { user } = useAuth();
  useEffect(() => {
    let cancelled = false;
    const handle = async (rawUrl: string | null) => {
      const code = extractInviteCode(rawUrl);
      if (!code) return;
      // Wait until the user is logged in — otherwise the API call would 401
      // and the invite intent would be lost. The auth flow re-mounts this
      // handler when `user` flips truthy, so the link is replayed naturally.
      if (!user) return;
      try {
        const res = await api<any>("/friends/add-by-code", {
          method: "POST",
          body: { code },
        });
        if (cancelled) return;
        const name = res?.friend?.name || "your new friend";
        Alert.alert(
          res?.already_friends ? "Already friends ✦" : "Friend added ✦",
          res?.already_friends
            ? `You and ${name} were already connected.`
            : `${name} is now in your circle. Send them a wave.`,
          [{ text: "Open friends", onPress: () => router.push("/(tabs)/friends") }, { text: "OK", style: "cancel" }],
        );
      } catch (e: any) {
        if (cancelled) return;
        Alert.alert("Couldn't add friend", e?.message || "That invite code didn't work — ask for a new link.");
      }
    };
    // Cold-start: did the OS launch us from a link?
    Linking.getInitialURL().then(handle).catch(() => {});
    // Warm: subsequent links while the app is open.
    const sub = Linking.addEventListener("url", (ev) => handle(ev.url));
    return () => { cancelled = true; sub.remove(); };
  }, [user]);
  return null;
}

function NotificationScheduler() {
  const { user } = useAuth();
  useEffect(() => {
    if (user) {
      // Fire-and-forget: schedule the daily aura reminders (noon + 19:30 safety-net).
      ensureDailyRandomNotification().catch(() => {});
      // Register the Expo push token with the backend so server-side notifications
      // (reactions, comments, messages, friend adds) can reach this device.
      registerForPushNotificationsAsync().catch(() => {});
      // Boot RevenueCat with the user's id so subscription state is attached to them.
      (async () => {
        try {
          const ok = await initIAP(user.user_id);
          if (ok) await identifyIAP(user.user_id);
        } catch {}
      })();
    }
  }, [user]);
  return null;
}

export default function RootLayout() {
  const [localeReady, setLocaleReady] = useState(false);
  useEffect(() => {
    // Preload the saved locale override before first render of screens so UI strings are correct.
    loadLocaleOverride().finally(() => setLocaleReady(true));
    // Global audio session config — ensures voice notes & music always play through
    // the main speaker (not earpiece) and work even when iOS silent switch is on.
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: false,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
  }, []);
  // We don't block on the locale — if it's slow, first frame uses device default; strings update on change.
  void localeReady;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#050505" }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <AuthProvider>
            <NotificationScheduler />
            <DeepLinkHandler />
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "#050505" },
                animation: "fade",
              }}
            />
          </AuthProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
