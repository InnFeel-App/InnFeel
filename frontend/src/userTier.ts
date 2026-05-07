import type { User } from "./auth";

/**
 * Single source of truth for the user's "tier" badge across the app.
 *
 * Hierarchy (high → low priority): owner → admin → zen → pro → free.
 *
 * Why a helper?
 *  Before this, several screens would just check `user.pro` and render a
 *  "PRO" badge. That was wrong for owners (who are Zen) and admins —
 *  so a Zen user would see "PRO" all over the app even though their
 *  actual entitlement is much higher. This helper keeps all those
 *  places consistent.
 */

export type TierKey = "owner" | "admin" | "zen" | "pro" | "free";

export type TierInfo = {
  key: TierKey;
  /** Short uppercase label (3–5 chars) suitable for badges. */
  label: string;
  /** Tinted accent colour. */
  color: string;
  /** Soft tinted background colour for badge fill. */
  bg: string;
  /** Soft tinted border colour. */
  border: string;
  /** Ionicons name to put next to the label. */
  icon: "shield" | "shield-checkmark" | "moon" | "sparkles" | "leaf";
  /** Big descriptive title for the "you're X" card on /me. */
  cardTitle: string;
  /** Subtitle for that card. */
  cardSub: string;
  /** Whether the tier counts as paid/unlocked (no upsell needed). */
  unlocked: boolean;
};

const TIERS: Record<TierKey, Omit<TierInfo, "key">> = {
  owner: {
    label: "OWNER",
    color: "#FDE047",
    bg: "rgba(253,224,71,0.15)",
    border: "rgba(253,224,71,0.45)",
    icon: "shield",
    cardTitle: "You're the Owner ✦",
    cardSub: "Full access — every feature, forever.",
    unlocked: true,
  },
  admin: {
    label: "ADMIN",
    color: "#F472B6",
    bg: "rgba(244,114,182,0.15)",
    border: "rgba(244,114,182,0.45)",
    icon: "shield-checkmark",
    cardTitle: "You're an Admin ✦",
    cardSub: "Zen access included while you hold this role.",
    unlocked: true,
  },
  zen: {
    label: "ZEN",
    color: "#A78BFA",
    bg: "rgba(167,139,250,0.15)",
    border: "rgba(167,139,250,0.45)",
    icon: "moon",
    cardTitle: "You're Zen ✦",
    cardSub: "20 AI credits / day · unlimited rituals.",
    unlocked: true,
  },
  pro: {
    label: "PRO",
    color: "#22D3EE",
    bg: "rgba(34,211,238,0.15)",
    border: "rgba(34,211,238,0.45)",
    icon: "sparkles",
    cardTitle: "You're Pro ✦",
    cardSub: "5 AI credits / day · all features unlocked.",
    unlocked: true,
  },
  free: {
    label: "FREE",
    color: "#94A3B8",
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.30)",
    icon: "leaf",
    cardTitle: "Free plan",
    cardSub: "Upgrade to unlock daily AI credits and rituals.",
    unlocked: false,
  },
};

export function getUserTier(user?: User | null): TierInfo {
  // Owner > Admin > Zen > Pro > Free. Each flag is independent on the
  // backend (`is_owner`, `is_admin`, `zen`, `pro`), so we apply strict
  // priority here. Note: admins always carry `pro=true` for feature
  // gating, so checking `pro` alone would mislabel them.
  let key: TierKey = "free";
  if (user?.is_owner) key = "owner";
  else if (user?.is_admin) key = "admin";
  else if ((user as any)?.zen) key = "zen";
  else if (user?.pro) key = "pro";

  return { key, ...TIERS[key] };
}
