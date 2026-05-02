// Bright, funky, vivid emotional palette — like a neon kaleidoscope.
// Labels use the adjective form so sentences like "I feel {label}" read naturally.
// Order: best to worst (positive/expansive → low-energy → negative/intense).
export const EMOTION_COLORS: Record<string, { hex: string; glow: string; label: string }> = {
  // — TOP: positive & expansive
  joy:         { hex: "#FACC15", glow: "rgba(250,204,21,0.75)",  label: "Joyful" },
  happy:       { hex: "#FFD166", glow: "rgba(255,209,102,0.75)", label: "Happy" },
  love:        { hex: "#EC4899", glow: "rgba(236,72,153,0.75)",  label: "In Love" },
  excitement:  { hex: "#FF7A00", glow: "rgba(255,122,0,0.75)",   label: "Excited" },

  // — positive & nurturing
  grateful:    { hex: "#F59E0B", glow: "rgba(245,158,11,0.75)",  label: "Grateful" },
  hopeful:     { hex: "#38BDF8", glow: "rgba(56,189,248,0.75)",  label: "Hopeful" },
  inspired:    { hex: "#A855F7", glow: "rgba(168,85,247,0.75)",  label: "Inspired" },
  confident:   { hex: "#FB923C", glow: "rgba(251,146,60,0.75)",  label: "Confident" },
  motivated:   { hex: "#22D3EE", glow: "rgba(34,211,238,0.75)",  label: "Motivated" },

  // — calm & steady
  peace:       { hex: "#10B981", glow: "rgba(16,185,129,0.7)",   label: "Peaceful" },
  calm:        { hex: "#3B82F6", glow: "rgba(59,130,246,0.7)",   label: "Calm" },
  focus:       { hex: "#06D6A0", glow: "rgba(6,214,160,0.75)",   label: "Focused" },
  nostalgia:   { hex: "#C026D3", glow: "rgba(192,38,211,0.75)",  label: "Nostalgic" },

  // — low energy / flat
  tired:       { hex: "#94A3B8", glow: "rgba(148,163,184,0.65)", label: "Tired" },
  bored:       { hex: "#78716C", glow: "rgba(120,113,108,0.65)", label: "Bored" },
  unmotivated: { hex: "#6B7280", glow: "rgba(107,114,128,0.6)",  label: "Unmotivated" },

  // — isolating / sad
  lonely:      { hex: "#64748B", glow: "rgba(100,116,139,0.7)",  label: "Lonely" },
  sadness:     { hex: "#6366F1", glow: "rgba(99,102,241,0.7)",   label: "Sad" },

  // — worried / anxious / lost
  worried:     { hex: "#CA8A04", glow: "rgba(202,138,4,0.7)",    label: "Worried" },
  anxiety:     { hex: "#F59E0B", glow: "rgba(245,158,11,0.7)",   label: "Anxious" },
  lost:        { hex: "#475569", glow: "rgba(71,85,105,0.7)",    label: "Lost" },

  // — intense negative
  stressed:    { hex: "#DC2626", glow: "rgba(220,38,38,0.75)",   label: "Stressed" },
  overwhelmed: { hex: "#B91C1C", glow: "rgba(185,28,28,0.75)",   label: "Overwhelmed" },
  anger:       { hex: "#EF4444", glow: "rgba(239,68,68,0.7)",    label: "Angry" },
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
