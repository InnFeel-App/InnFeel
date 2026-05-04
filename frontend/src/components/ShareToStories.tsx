import React, { useRef } from "react";
import { View, Alert, Platform, StyleSheet } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
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
 *   - For `mood` payloads we ask the backend to compose a 9:16 MP4 ("reel") that combines
 *     the aura's photo/video background with the selected music preview and a text overlay
 *     (word, emotion, description, user name). The client just downloads it and hands it to
 *     the native share sheet — Instagram Stories/Reels accepts MP4 from the share intent.
 *   - For `stats` payloads we still render the offscreen ShareCard as a PNG (no music / video).
 *   - If the backend reel generation fails for any reason, we gracefully fall back to the
 *     ShareCard-as-PNG path so the user always has something to post.
 */
export function useShareToStories() {
  const cardRef = useRef<View>(null);
  const [payload, setPayload] = React.useState<Payload | null>(null);

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

  // Fallback: render the offscreen ShareCard and share it as PNG.
  const shareStaticPng = async (p: Payload): Promise<boolean> => {
    try {
      if (!cardRef.current) throw new Error("Card not ready");
      const uri = await captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: buildMessage(p),
          UTI: Platform.OS === "ios" ? "public.png" : undefined,
        });
        return true;
      }
    } catch (e) {
      // swallow — caller will alert
    }
    return false;
  };

  // Primary: generate a server-side reel MP4 and share it.
  const shareReel = async (p: MoodShare): Promise<boolean> => {
    if (!p.mood_id) return false;
    try {
      const r = await api<{ url: string }>(`/share/reel/${p.mood_id}`, { method: "POST", body: {} });
      if (!r?.url) return false;
      const dest = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}innfeel_reel_${Date.now()}.mp4`;
      const dl = await FileSystem.downloadAsync(r.url, dest);
      if (dl.status !== 200) return false;
      if (!(await Sharing.isAvailableAsync())) return false;
      await Sharing.shareAsync(dl.uri, {
        mimeType: "video/mp4",
        dialogTitle: buildMessage(p),
        UTI: Platform.OS === "ios" ? "public.mpeg-4" : undefined,
      });
      return true;
    } catch {
      return false;
    }
  };

  const share = async (p: Payload) => {
    setPayload(p);
    // Let the offscreen ShareCard mount in case we need the fallback.
    await new Promise((r) => setTimeout(r, 350));
    try {
      if (p.kind === "mood") {
        const ok = await shareReel(p);
        if (ok) return;
      }
      const fallbackOk = await shareStaticPng(p);
      if (!fallbackOk) {
        Alert.alert("Sharing unavailable", "Your device doesn't support sharing.");
      }
    } catch (e: any) {
      Alert.alert("Share failed", e?.message || "Try again.");
    } finally {
      setPayload(null);
    }
  };

  const Renderer = React.useCallback(() => {
    if (!payload) return null;
    return (
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
    );
  }, [payload]);

  return { share, Renderer };
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
});
