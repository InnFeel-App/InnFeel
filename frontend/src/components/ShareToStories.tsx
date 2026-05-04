import React, { useRef } from "react";
import { View, Alert, Platform, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
// Expo SDK 54 refactored expo-file-system. The legacy import keeps the simpler
// downloadAsync + cacheDirectory surface alive (still maintained, just deprecation-warned).
import * as LegacyFS from "expo-file-system/legacy";
import ShareCard from "./ShareCard";
import ShareDestinationPicker, { ShareDestination } from "./ShareDestinationPicker";
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
type LeaderboardCategoryPayload = {
  key: string;
  label: string;
  color: string;
  suffix: string;
  icon?: string;
  top3: Array<{ name: string; value: number; isMe: boolean; rank: number; avatar_color?: string | null }>;
  myRank?: number | null;
  total: number;
};
type LeaderboardShare = {
  kind: "leaderboard";
  userName?: string;
  categories: LeaderboardCategoryPayload[];
};

type Payload = MoodShare | StatsShare | LeaderboardShare;

// Internal "ready to share" file descriptor passed to the destination picker.
type Pending = {
  uri: string;
  mimeType: string;
  uti?: string;
  msg: string;
  hasVideo: boolean;
};

/**
 * useShareToStories
 *   1. For mood payloads → builds the server-composed reel (POST /share/reel/{mood_id}).
 *   2. For stats payloads → enriches the payload with /badges + /moods/insights,
 *      renders the offscreen ShareCard, captures it as PNG.
 *   3. Once the file is ready, opens our own ShareDestinationPicker (Story / Reel / DM).
 *      Each destination triggers the same native share intent but with copy hinting
 *      the user which Instagram tab to tap. We deliberately omit "Post" since auras
 *      don't fit IG's permanent grid.
 */
export function useShareToStories() {
  const cardRef = useRef<View>(null);
  const [payload, setPayload] = React.useState<Payload | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [busyLabel, setBusyLabel] = React.useState<string>("Preparing your share…");
  const [pending, setPending] = React.useState<Pending | null>(null);

  const buildMessage = (p: Payload, dest?: ShareDestination): string => {
    const appLink = "https://innfeel.app";
    const tabHint =
      dest === "story"     ? "→ Tap STORY in Instagram"
      : dest === "reel"    ? "→ Tap REEL in Instagram"
      : dest === "dm"      ? "→ Tap DIRECT in Instagram"
      : dest === "whatsapp"? "→ Pick WhatsApp"
      : dest === "telegram"? "→ Pick Telegram"
      : dest === "messages"? "→ Pick Messages"
      : "";
    if (p.kind === "mood") {
      const parts = [`My aura today: ${p.word || p.emotion} ✦`];
      if (p.music?.title) {
        parts.push(`🎵 ${p.music.title}${p.music.artist ? ` — ${p.music.artist}` : ""}`);
      }
      parts.push(`One aura a day! Share yours. Unlock the others!`);
      parts.push(appLink);
      if (tabHint) parts.push(tabHint);
      return parts.join("\n");
    }
    if (p.kind === "leaderboard") {
      const lines = [`Our circle's leaderboard on InnFeel ✦`];
      const streakCat = p.categories.find((c) => c.key === "streak");
      const top = streakCat?.top3?.[0];
      if (top) lines.push(`👑 ${top.name} — ${top.value} day streak`);
      lines.push(appLink);
      if (tabHint) lines.push(tabHint);
      return lines.join("\n");
    }
    const lines = [
      `My InnFeel journey: ${p.streak} day streak ✦ Mostly feeling ${p.dominant}.`,
      appLink,
    ];
    if (tabHint) lines.push(tabHint);
    return lines.join("\n");
  };

  // Direct deep-link schemes per destination. We try these AFTER the system share
  // sheet so the user can pick the app from inside our flow without leaving InnFeel
  // forever stuck. NOTE: with media, only the iOS share sheet can deliver the file
  // — these schemes only carry text. We use them as a last resort fallback for the
  // "More" button or when the user installed the app but the share sheet hangs.
  const DEEP_LINKS: Partial<Record<ShareDestination, (msg: string) => string>> = {
    whatsapp: (msg) => `whatsapp://send?text=${encodeURIComponent(msg)}`,
    telegram: (msg) => `tg://msg?text=${encodeURIComponent(msg)}`,
    messages: (msg) => Platform.OS === "ios" ? `sms:&body=${encodeURIComponent(msg)}` : `sms:?body=${encodeURIComponent(msg)}`,
    story:    () => `instagram://story-camera`,
    reel:     () => `instagram://reels-camera`,
    dm:       () => `instagram://direct-inbox`,
  };

  /**
   * Enrich a stats payload with achievements + insights so the ShareCard renders
   * a layout that matches the in-app Insights page.
   */
  const enrichStatsPayload = async (p: StatsShare): Promise<any> => {
    let achievements: { key: string; label: string; hint?: string }[] = [];
    let insights: any[] = [];
    let auras = 0;
    let uniqueEmotions = 0;
    let reactionsReceived = 0;
    try {
      const b: any = await api("/badges");
      const earned = (b?.badges || []).filter((x: any) => x.earned);
      achievements = earned.map((x: any) => ({ key: x.key, label: x.label, hint: x.hint }));
      const m = b?.metrics || {};
      auras = m.moods_count || 0;
      uniqueEmotions = m.unique_emotions || 0;
      reactionsReceived = m.reactions_received || 0;
    } catch {}
    try {
      const ins: any = await api("/moods/insights");
      if (ins?.ready && Array.isArray(ins?.insights)) {
        insights = ins.insights.map((x: any) => ({
          id: x.id, title: x.title, subtitle: x.subtitle, tone: x.tone,
        }));
      }
    } catch {}
    return {
      kind: "stats",
      userName: p.userName,
      streak: p.streak,
      auras,
      aurasThisWeek: p.dropsThisWeek,
      uniqueEmotions,
      reactionsReceived,
      dominant: p.dominant,
      distribution: p.distribution,
      insights,
      achievements,
    };
  };

  const captureCardAsPng = async (richProps: any): Promise<string> => {
    setPayload(richProps);
    // Robust ref-attached check: poll up to ~2s for the offscreen card to mount
    // and the layout to settle. With long iOS animations or first-mount delays,
    // 400ms wasn't always enough → users were getting "Card not ready".
    for (let i = 0; i < 12; i++) {
      if (cardRef.current) break;
      await new Promise((r) => setTimeout(r, 180));
    }
    if (!cardRef.current) throw new Error("Card not ready");
    // Even with a ref, layout pass may need one more tick to flush.
    await new Promise((r) => setTimeout(r, 120));
    return await captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
  };

  // Server reel — primary path for MOOD payloads. Returns
  //   { ok: true, uri }  on full success
  //   { ok: false, reason } if anything broke
  const buildReelFile = async (
    p: MoodShare,
  ): Promise<{ ok: true; uri: string; hasVideo: boolean } | { ok: false; reason: string }> => {
    if (!p.mood_id) return { ok: false, reason: "Save your aura first" };

    setBusyLabel("Building your reel… (~10s)");
    let reel: { url: string; has_audio?: boolean; has_video?: boolean };
    try {
      reel = await api(`/share/reel/${p.mood_id}`, { method: "POST", body: {} });
      if (!reel?.url) return { ok: false, reason: "Reel server response missing URL" };
    } catch (e: any) {
      return { ok: false, reason: `Server reel build failed: ${e?.message || "unknown"}` };
    }

    setBusyLabel("Downloading your reel…");
    const cache = LegacyFS.cacheDirectory || LegacyFS.documentDirectory;
    if (!cache) return { ok: false, reason: "No writable cache directory available" };
    const dest = `${cache}innfeel_reel_${Date.now()}.mp4`;
    try {
      const dl = await LegacyFS.downloadAsync(reel.url, dest);
      if (dl.status !== 200) return { ok: false, reason: `Download HTTP ${dl.status}` };
      const info = await LegacyFS.getInfoAsync(dl.uri, { size: true });
      if (!info.exists || (typeof info.size === "number" && info.size < 5000)) {
        return { ok: false, reason: "Downloaded reel looks empty" };
      }
    } catch (e: any) {
      return { ok: false, reason: `Download error: ${e?.message || "network"}` };
    }
    return { ok: true, uri: dest, hasVideo: !!reel.has_video };
  };

  /**
   * Save the prepared file to the device camera roll. Most apps (Instagram,
   * WhatsApp, Telegram) have a "select from gallery" picker — saving first lets
   * the user attach the freshly-saved aura right inside the destination app.
   * Returns true on success, false on permission denied or any other error
   * (we don't block the share flow on it).
   */
  const saveToGallery = async (uri: string): Promise<boolean> => {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) return false;
      await MediaLibrary.saveToLibraryAsync(uri);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Hand off the prepared file. Strategy (June 2026):
   *   1. SAVE the file to the device's photo library (one-time permission).
   *      Without this step, deep-linking IG/WhatsApp lands the user with their
   *      OLD photos — they can't attach our visual.
   *   2. For app-specific destinations, DIRECTLY LAUNCH the app via its URL
   *      scheme. This is what makes Instagram actually OPEN instead of "nothing
   *      happens" when expo-sharing silently no-ops.
   *   3. For "more", show the iOS/Android system share sheet (universal handoff).
   *   4. If neither path works, fall back to share sheet as a last resort.
   *
   * 380ms delay so iOS dismisses our own modal before any system UI presents —
   * otherwise iOS silently drops UIActivityViewController.
   */
  const dispatchShare = async (p: Payload, dest: ShareDestination, file: Pending) => {
    await new Promise((r) => setTimeout(r, 380));

    // "More apps…" → straight to the OS share sheet.
    if (dest === "more") {
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: file.mimeType,
            dialogTitle: buildMessage(p, dest),
            UTI: Platform.OS === "ios" ? file.uti : undefined,
          });
        } else {
          Alert.alert("Sharing unavailable", "Your device doesn't expose a share sheet.");
        }
      } catch (e: any) {
        if (!/cancel/i.test(e?.message || "")) {
          Alert.alert("Share failed", e?.message || "Try again.");
        }
      }
      return;
    }

    // Save to gallery first (best effort) — needed for IG/WA/TG/SMS to pick up.
    const saved = await saveToGallery(file.uri);

    // Try direct deep-link to the destination app.
    const builder = DEEP_LINKS[dest];
    let opened = false;
    if (builder) {
      const url = builder(buildMessage(p, dest));
      try {
        const can = await Linking.canOpenURL(url);
        if (can) {
          await Linking.openURL(url);
          opened = true;
        }
      } catch {
        opened = false;
      }
    }

    if (opened) {
      const tip =
        dest === "story" || dest === "reel" || dest === "dm"
          ? saved
            ? "Tap '+' inside Instagram and pick the latest photo from your gallery."
            : "We couldn't save the visual to Photos — please retry."
          : saved
            ? "Attach the latest photo from your gallery to your message."
            : "Visual not saved — retry and allow Photos access.";
      Alert.alert("Opening app…", tip);
      return;
    }

    // App not installed → fall back to system share sheet.
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: file.mimeType,
          dialogTitle: buildMessage(p, dest),
          UTI: Platform.OS === "ios" ? file.uti : undefined,
        });
        return;
      }
    } catch (e: any) {
      if (/cancel/i.test(e?.message || "")) return;
    }

    Alert.alert(
      "App not found",
      saved
        ? "Your aura is saved in Photos. Open the app manually and attach it from your gallery."
        : "We couldn't open the destination app on this device.",
    );
  };

  /** Public entry point — call this from any screen. */
  const share = async (p: Payload) => {
    if (busy) return;
    setBusy(true);
    setBusyLabel(p.kind === "mood" ? "Building your reel…" : "Preparing your share…");
    setPayload(p);
    await new Promise((r) => setTimeout(r, 200)); // mount offscreen card

    try {
      if (p.kind === "stats") {
        // 1) Enrich, 2) Render PNG, 3) Open destination picker
        setBusyLabel("Loading your insights…");
        const rich = await enrichStatsPayload(p);
        setBusyLabel("Rendering your card…");
        const uri = await captureCardAsPng(rich);
        setPending({
          uri,
          mimeType: "image/png",
          uti: "public.png",
          msg: buildMessage(p),
          hasVideo: false,
        });
        return;
      }
      if (p.kind === "leaderboard") {
        setBusyLabel("Rendering your leaderboard…");
        const uri = await captureCardAsPng(p);
        setPending({
          uri,
          mimeType: "image/png",
          uti: "public.png",
          msg: buildMessage(p),
          hasVideo: false,
        });
        return;
      }
      // Mood — build the dynamic reel
      const res = await buildReelFile(p);
      if (res.ok) {
        setPending({
          uri: res.uri,
          mimeType: "video/mp4",
          uti: "public.mpeg-4",
          msg: buildMessage(p),
          hasVideo: res.hasVideo,
        });
        return;
      }
      // Reel failed → ask the user whether they want the static fallback.
      Alert.alert(
        "Reel build failed",
        `${res.reason}.\n\nWould you like to share a static image instead?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Share image",
            onPress: async () => {
              try {
                const uri = await captureCardAsPng({
                  kind: "mood",
                  word: p.word,
                  emotion: p.emotion,
                  intensity: p.intensity,
                  userName: p.userName,
                  music: p.music,
                });
                setPending({
                  uri,
                  mimeType: "image/png",
                  uti: "public.png",
                  msg: buildMessage(p),
                  hasVideo: false,
                });
              } catch (e: any) {
                Alert.alert("Share failed", e?.message || "Try again.");
              }
            },
          },
        ],
      );
    } finally {
      setBusy(false);
    }
  };

  const onPickDestination = async (dest: ShareDestination) => {
    if (!pending || !payload) return;
    const file = pending;
    const p = payload;
    setPending(null);
    await dispatchShare(p, dest, file);
    // Keep payload mounted briefly so any pending capture can finish.
    setTimeout(() => setPayload(null), 600);
  };

  const onCancelDestination = () => {
    setPending(null);
    setTimeout(() => setPayload(null), 400);
  };

  const Renderer = React.useCallback(() => {
    return (
      <>
        {payload ? (
          <View pointerEvents="none" style={styles.offscreen}>
            <ShareCard
              ref={cardRef as any}
              kind={payload.kind}
              userName={(payload as any).userName}
              word={(payload as any).word}
              emotion={(payload as any).emotion || (payload as any).dominant}
              intensity={(payload as any).intensity}
              music={(payload as any).music}
              streak={(payload as any).streak}
              auras={(payload as any).auras}
              aurasThisWeek={(payload as any).aurasThisWeek ?? (payload as any).dropsThisWeek}
              uniqueEmotions={(payload as any).uniqueEmotions}
              reactionsReceived={(payload as any).reactionsReceived}
              dominant={(payload as any).dominant}
              distribution={(payload as any).distribution}
              insights={(payload as any).insights}
              achievements={(payload as any).achievements}
              categories={(payload as any).categories}
            />
          </View>
        ) : null}
        {busy ? (
          <View style={styles.busyOverlay} pointerEvents="auto">
            <View style={styles.busyCard}>
              <ActivityIndicator size="large" color="#A78BFA" />
              <Text style={styles.busyTxt}>{busyLabel}</Text>
            </View>
          </View>
        ) : null}
        <ShareDestinationPicker
          visible={!!pending}
          hasVideo={!!pending?.hasVideo}
          kind={(payload?.kind as any) || "mood"}
          onPick={onPickDestination}
          onCancel={onCancelDestination}
        />
      </>
    );
  }, [payload, busy, busyLabel, pending]);

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
    alignItems: "center",
    minWidth: 220,
  },
  busyTxt: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 14,
    textAlign: "center",
  },
});
