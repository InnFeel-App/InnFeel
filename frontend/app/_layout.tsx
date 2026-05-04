import React, { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import { AuthProvider, useAuth } from "../src/auth";
import { ensureDailyRandomNotification, registerForPushNotificationsAsync } from "../src/notifications";
import { loadLocaleOverride } from "../src/i18n";
import { initIAP, identifyIAP } from "../src/iap";
import ErrorBoundary from "../src/components/ErrorBoundary";
import { useScreenCaptureGuard } from "../src/hooks/useScreenCaptureGuard";

function NotificationScheduler() {
  const { user } = useAuth();
  // Block screenshots/screen-recording for everyone except admins.
  // When signed out, user is null → treated as non-admin → guard remains ON.
  useScreenCaptureGuard(!!user?.is_admin);
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
