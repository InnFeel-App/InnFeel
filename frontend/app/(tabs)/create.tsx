/**
 * Aura tab — entry point for the daily mood-share flow.
 *
 * UX decision (post-feedback): keep the bottom tab bar visible while the
 * user composes their aura, instead of pushing the screen as a full-screen
 * modal. Reasoning:
 *   • This is the app's *primary daily action* — losing the navigation
 *     reference makes daily users feel "stuck" inside a modal.
 *   • The compose UI is already busy (color, intensity, music, audio,
 *     image, optional close-friends) — there's no "pure focus" benefit
 *     to hiding chrome.
 *   • Industry parity: Instagram, BeReal, TikTok all keep their bottom
 *     bar during creation flows.
 *
 * Implementation: render the existing `mood-create.tsx` component directly
 * here so it inherits the (tabs) group layout (= the floating bottom bar).
 * The internal close-X is hidden when rendered in this context (handled
 * in mood-create via `inTabsLayout` prop).
 */
import React from "react";
import MoodCreate from "../mood-create";

export default function CreateTab() {
  return <MoodCreate inTabsLayout />;
}
