import React, { useRef } from "react";
import { View, Alert, Platform, StyleSheet, ActivityIndicator } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
// Expo SDK 54 refactored expo-file-system. The legacy import keeps the simpler
// downloadAsync + cacheDirectory surface alive (still maintained, just deprecation-warned).
import * as LegacyFS from "expo-file-system/legacy";
import ShareCard from "./ShareCard";
import { api } from "../api";

type MoodShare = {
  kind: "mood";
  mood_id?: string;
  word: string;
  emotion: string;
  intensity: number;
  userName?: string;
  music?: { title?: string; artist?: string } | null;
};
type StatsShare = {
  kind: "stats";
  streak: number;
  dropsThisWeek: number;
  dominant: string;
  distribution: Record<string, number>;
  userName?: string;
};

type Payload = MoodShare | StatsShare;

/**
 * useShareToStories
 *   The whole point of this hook is to share a *dynamic* aura snapshot to Instagram —
 *   not a static screenshot. For mood payloads we ALWAYS try the server-composed reel
 *   (POST /api/share/reel/{mood_id}) which combines the photo/video background, the
 *   selected music preview audio, and the text overlay into a 1080x1920 H.264 MP4.
 *
 *   We surface errors loudly (with details) instead of silently falling back to a PNG
 *   so the user can tell us what went wrong. The PNG fallback only runs when:
 *     - the payload is a STATS share (no mood_id), or
 *     - the user explicitly chose the static option after a reel failure.
 */
export function useShareToStories() {
  const cardRef = useRef<View>(null);
  const [payload, setPayload] = React.useState<Payload | null>(null);
  const [busy, setBusy] = React.useState(false);

  const buildMessage = (p: Payload): string => {
    const appLink = "https://innfeel.app";
    if (p.kind === "mood") {
      const parts = [`My aura today: ${p.word || p.emotion} ✦`];
      if (p.music?.title) {
        parts.push(`🎵 ${p.music.title}${p.music.artist ? ` — ${p.music.artist}` : ""}`);
      }
      parts.push(`One aura a day! Share yours. Unlock the others!`);
      parts.push(appLink);
      return parts.join("\n");
    }
    return `My InnFeel streak: ${p.streak} days · ${p.dropsThisWeek} auras this week ✦ Mostly feeling ${p.dominant}.\n${appLink}`;
  };

  const shareStaticPng = async (p: Payload): Promise<boolean> => {
    try {
      if (!cardRef.current) throw new Error("Card not ready");
      const uri = await captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Sharing unavailable", "Your device doesn't support sharing.");
        return false;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: buildMessage(p),
        UTI: Platform.OS === "ios" ? "public.png" : undefined,
      });
      return true;
    } catch (e: any) {
      Alert.alert("Share failed", e?.message || "Try again.");
      return false;
    }
  };

  // Server reel — primary path. Returns:
  //   { ok: true } on full success
  //   { ok: false, reason } if anything broke (so we can show a useful message)
  const shareReel = async (
    p: MoodShare,
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!p.mood_id) return { ok: false, reason: "Save your aura first" };

    // 1) Build server-side
    let reel: { url: string; has_audio?: boolean; has_video?: boolean };
    try {
      reel = await api<{ url: string; has_audio?: boolean; has_video?: boolean }>(
        `/share/reel/${p.mood_id}`,
        { method: "POST", body: {} },
      );
      if (!reel?.url) return { ok: false, reason: "Reel server response missing URL" };
    } catch (e: any) {
      return { ok: false, reason: `Server reel build failed: ${e?.message || "unknown"}` };
    }

    // 2) Download to a local file the share sheet can read
    const cache = LegacyFS.cacheDirectory || LegacyFS.documentDirectory;
    if (!cache) return { ok: false, reason: "No writable cache directory available" };
    const dest = `${cache}innfeel_reel_${Date.now()}.mp4`;
    try {
      const dl = await LegacyFS.downloadAsync(reel.url, dest);
      if (dl.status !== 200) {
        return { ok: false, reason: `Download HTTP ${dl.status}` };
      }
      // Sanity: reels under 5KB are almost certainly broken.
      const info = await LegacyFS.getInfoAsync(dl.uri, { size: true });
      if (!info.exists || (typeof info.size === "number" && info.size < 5000)) {
        return { ok: false, reason: "Downloaded reel looks empty" };
      }
    } catch (e: any) {
      return { ok: false, reason: `Download error: ${e?.message || "network"}` };
    }

    // 3) Hand off to the native share sheet
    try {
      if (!(await Sharing.isAvailableAsync())) {
        return { ok: false, reason: "Sharing unavailable on this device" };
      }
      await Sharing.shareAsync(dest, {
        mimeType: "video/mp4",
        dialogTitle: buildMessage(p),
        UTI: Platform.OS === "ios" ? "public.mpeg-4" : undefined,
      });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: `Share intent error: ${e?.message || "unknown"}` };
    }
  };

  const share = async (p: Payload) => {
    if (busy) return;
    setBusy(true);
    setPayload(p);
    // Let the offscreen ShareCard mount in case we need the PNG fallback (stats-only).
    await new Promise((r) => setTimeout(r, 200));

    try {
      if (p.kind === "stats") {
        await shareStaticPng(p);
        return;
      }
      // Mood payload — always try the dynamic reel first.
      const res = await shareReel(p);
      if (res.ok) return;

      // Reel failed → ask the user whether they want the static fallback.
      Alert.alert(
        "Reel build failed",
        `${res.reason}.\n\nWould you like to share a static image instead?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Share image", onPress: () => shareStaticPng(p) },
        ],
      );
    } finally {
      setBusy(false);
      // Keep payload mounted briefly so any pending capture can finish before unmount.
      setTimeout(() => setPayload(null), 800);
    }
  };

  const Renderer = React.useCallback(() => {
    if (!payload && !busy) return null;
    return (
      <>
        {payload ? (
          <View pointerEvents="none" style={styles.offscreen}>
            <ShareCard
              ref={cardRef as any}
              kind={payload.kind}
              userName={payload.userName}
              word={(payload as MoodShare).word}
              emotion={(payload as MoodShare).emotion || (payload as StatsShare).dominant}
              intensity={(payload as MoodShare).intensity}
              music={(payload as MoodShare).music}
              streak={(payload as StatsShare).streak}
              dropsThisWeek={(payload as StatsShare).dropsThisWeek}
              dominant={(payload as StatsShare).dominant}
              distribution={(payload as StatsShare).distribution}
            />
          </View>
        ) : null}
        {busy ? (
          <View style={styles.busyOverlay} pointerEvents="auto">
            <View style={styles.busyCard}>
              <ActivityIndicator size="large" color="#A78BFA" />
            </View>
          </View>
        ) : null}
      </>
    );
  }, [payload, busy]);

  return { share, Renderer, busy };
}

const styles = StyleSheet.create({
  offscreen: {
    position: "absolute",
    left: -9999,
    top: -9999,
    width: 1080,
    height: 1920,
    opacity: 1,
  },
  busyOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  busyCard: {
    paddingHorizontal: 28,
    paddingVertical: 22,
    borderRadius: 18,
    backgroundColor: "rgba(20,20,28,0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
});
