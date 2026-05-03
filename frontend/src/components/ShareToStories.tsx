import React, { useRef } from "react";
import { View, Alert, Linking, Platform, Modal, StyleSheet } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import ShareCard from "./ShareCard";

type MoodShare = {
  kind: "mood";
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

// A singleton-style shareable helper renders the offscreen card and captures it.
export function useShareToStories() {
  const cardRef = useRef<View>(null);
  const [payload, setPayload] = React.useState<Payload | null>(null);

  const buildMessage = (p: Payload): string => {
    const appLink = "https://innfeel.app";
    if (p.kind === "mood") {
      const parts = [
        `My aura today: ${p.word || p.emotion} ✦`,
      ];
      if (p.music?.title) {
        parts.push(`🎵 ${p.music.title}${p.music.artist ? ` — ${p.music.artist}` : ""}`);
      }
      parts.push(`One aura a day! Share yours. Unlock the others!`);
      parts.push(appLink);
      return parts.join("\n");
    }
    return `My InnFeel streak: ${p.streak} days · ${p.dropsThisWeek} auras this week ✦ Mostly feeling ${p.dominant}.\n${appLink}`;
  };

  const share = async (p: Payload) => {
    setPayload(p);
    // Wait a beat for the offscreen view to mount/render.
    await new Promise((r) => setTimeout(r, 350));
    try {
      if (!cardRef.current) throw new Error("Card not ready");
      const uri = await captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
      const message = buildMessage(p);

      // Prefer Instagram Stories deeplink on iOS
      if (Platform.OS === "ios") {
        const canIG = await Linking.canOpenURL("instagram-stories://share");
        if (canIG) {
          // iOS Instagram expects pasteboard-based image; deep link alone will open IG Stories camera.
          // We open share sheet as the best reliable path (user picks Instagram > Stories).
          await Sharing.shareAsync(uri, {
            mimeType: "image/png",
            dialogTitle: message,
            UTI: "public.png",
          });
          setPayload(null);
          return;
        }
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: message,
        });
      } else {
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
    // Render offscreen (far negative position) so it doesn't affect layout but can be captured.
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
