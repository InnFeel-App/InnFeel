import React, { useRef } from "react";
import { View, Alert, Platform, StyleSheet, ActivityIndicator, Text } from "react-native";
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
    if (p.kind === "leaderboard") {
      const lines = [`Our circle's leaderboard on InnFeel ✦`];
      const streakCat = p.categories.find((c) => c.key === "streak");
      const top = streakCat?.top3?.[0];
      if (top) lines.push(`👑 ${top.name} — ${top.value} day streak`);
      lines.push(appLink);
      return lines.join("\n");
    }
    return [
      `My InnFeel journey: ${p.streak} day streak ✦ Mostly feeling ${p.dominant}.`,
      appLink,
    ].join("\n");
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

    setBusyLabel("Building your aura… (~10s)");
    let reel: { url: string; has_audio?: boolean; has_video?: boolean };
    try {
      reel = await api(`/share/reel/${p.mood_id}`, { method: "POST", body: {} });
      if (!reel?.url) return { ok: false, reason: "Reel server response missing URL" };
    } catch (e: any) {
      return { ok: false, reason: `Server reel build failed: ${e?.message || "unknown"}` };
    }

    setBusyLabel("Downloading your aura…");
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
   * Public entry point. Single button → single flow:
   *   1. Build the dynamic file:
   *      - Mood   → server-rendered MP4 reel (photo/video + audio + Ken Burns,
   *        ~10s build). FALLBACK to PNG if the server reel fails.
   *      - Stats  → static PNG of the offscreen ShareCard (~1s).
   *      - LB     → static PNG of the offscreen ShareCard (~1s).
   *   2. Hand off to the OS share sheet (Sharing.shareAsync) — which lets the
   *      user pick ANY installed app (IG, WA, TG, Messages, Mail, etc.) and
   *      transfers the file to it. This is the only API that actually moves
   *      media to the destination app — there is no reliable way to bypass
   *      the share sheet to open IG/WA directly with attached media in Expo
   *      Go without a native module + UIPasteboard tricks.
   */
  const share = async (p: Payload) => {
    if (busy) return;
    setBusy(true);
    setBusyLabel(
      p.kind === "mood"      ? "Building your aura… (~10s)"
      : p.kind === "stats"   ? "Rendering your stats…"
      : p.kind === "leaderboard" ? "Rendering your leaderboard…"
      : "Preparing your share…",
    );
    setPayload(p);

    let file: Pending | null = null;
    try {
      // ─── Mood: dynamic MP4 reel from the server (preferred) ──────────────
      if (p.kind === "mood") {
        const res = await buildReelFile(p);
        if (res.ok) {
          file = {
            uri: res.uri,
            mimeType: "video/mp4",
            uti: "public.mpeg-4",
            msg: buildMessage(p),
            hasVideo: res.hasVideo,
          };
        } else {
          // Server reel failed — silently fall back to a static PNG render
          // so the user still gets a share. We don't gate this behind an
          // alert because the user just wants to share, not debug.
          setBusyLabel("Rendering your aura…");
        }
      }

      // ─── Stats / Leaderboard / Mood-fallback: render the offscreen card
      //     as a high-res 1080×1920 PNG (~1s). ──────────────────────────────
      if (!file) {
        let richProps: any = p;
        if (p.kind === "stats") {
          richProps = await enrichStatsPayload(p);
        }
        const uri = await captureCardAsPng(richProps);
        file = {
          uri,
          mimeType: "image/png",
          uti: "public.png",
          msg: buildMessage(p),
          hasVideo: false,
        };
      }

      // ─── Hand off to the OS share sheet ─────────────────────────────────
      // Tiny pause so the busy overlay's last "Rendering…" message is
      // visible — otherwise the share sheet appears mid-flicker.
      await new Promise((r) => setTimeout(r, 120));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: file.mimeType,
          dialogTitle: file.msg,
          UTI: Platform.OS === "ios" ? file.uti : undefined,
        });
      } else {
        Alert.alert("Sharing unavailable", "Your device doesn't support sharing.");
      }
    } catch (e: any) {
      // User-cancellation throws on iOS — that's fine, no-op.
      if (!/cancel/i.test(e?.message || "")) {
        Alert.alert("Share failed", e?.message || "Try again.");
      }
    } finally {
      setBusy(false);
      // Keep the offscreen card mounted for a moment in case captureRef is
      // still flushing, then unmount.
      setTimeout(() => setPayload(null), 400);
    }
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
      </>
    );
  }, [payload, busy, busyLabel]);

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
