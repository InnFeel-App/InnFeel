export const EMOTION_COLORS: Record<string, { hex: string; glow: string; label: string }> = {
  calm: { hex: "#60A5FA", glow: "rgba(96,165,250,0.45)", label: "Calm" },
  joy: { hex: "#FDE047", glow: "rgba(253,224,71,0.45)", label: "Joy" },
  love: { hex: "#F472B6", glow: "rgba(244,114,182,0.45)", label: "Love" },
  anger: { hex: "#F87171", glow: "rgba(248,113,113,0.45)", label: "Anger" },
  anxiety: { hex: "#FB923C", glow: "rgba(251,146,60,0.45)", label: "Anxiety" },
  sadness: { hex: "#818CF8", glow: "rgba(129,140,248,0.45)", label: "Sadness" },
  focus: { hex: "#2DD4BF", glow: "rgba(45,212,191,0.45)", label: "Focus" },
  excitement: { hex: "#F97316", glow: "rgba(249,115,22,0.45)", label: "Excitement" },
  peace: { hex: "#34D399", glow: "rgba(52,211,153,0.45)", label: "Peace" },
  nostalgia: { hex: "#A78BFA", glow: "rgba(167,139,250,0.45)", label: "Nostalgia" },
};

export const EMOTION_KEYS = Object.keys(EMOTION_COLORS);

export const COLORS = {
  bg: "#050505",
  panel: "#0A0A0C",
  glass: "rgba(255,255,255,0.05)",
  glassHover: "rgba(255,255,255,0.08)",
  border: "rgba(255,255,255,0.10)",
  textPrimary: "#FFFFFF",
  textSecondary: "#A1A1AA",
  textTertiary: "#71717A",
};

export const REACTIONS = [
  { key: "heart", symbol: "♥" },
  { key: "fire", symbol: "✦" },
  { key: "hug", symbol: "❀" },
  { key: "smile", symbol: "☺" },
  { key: "sparkle", symbol: "✧" },
];
