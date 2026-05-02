// Bright, funky, vivid emotional palette — like a neon kaleidoscope.
export const EMOTION_COLORS: Record<string, { hex: string; glow: string; label: string }> = {
  calm: { hex: "#3B82F6", glow: "rgba(59,130,246,0.7)", label: "Calm" },
  joy: { hex: "#FACC15", glow: "rgba(250,204,21,0.75)", label: "Joy" },
  love: { hex: "#EC4899", glow: "rgba(236,72,153,0.75)", label: "Love" },
  anger: { hex: "#EF4444", glow: "rgba(239,68,68,0.7)", label: "Anger" },
  anxiety: { hex: "#F59E0B", glow: "rgba(245,158,11,0.7)", label: "Anxiety" },
  sadness: { hex: "#6366F1", glow: "rgba(99,102,241,0.7)", label: "Sadness" },
  focus: { hex: "#06D6A0", glow: "rgba(6,214,160,0.75)", label: "Focus" },
  excitement: { hex: "#FF7A00", glow: "rgba(255,122,0,0.75)", label: "Excitement" },
  peace: { hex: "#10B981", glow: "rgba(16,185,129,0.7)", label: "Peace" },
  nostalgia: { hex: "#C026D3", glow: "rgba(192,38,211,0.75)", label: "Nostalgia" },
  tired: { hex: "#94A3B8", glow: "rgba(148,163,184,0.65)", label: "Tired" },
  stressed: { hex: "#DC2626", glow: "rgba(220,38,38,0.75)", label: "Stressed" },
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
  { key: "heart", icon: "heart", label: "Love" },
  { key: "fire", icon: "flame", label: "Fire" },
  { key: "hug", icon: "hand-left", label: "Hug" },
  { key: "smile", icon: "happy", label: "Smile" },
  { key: "sparkle", icon: "sparkles", label: "Wow" },
] as const;
