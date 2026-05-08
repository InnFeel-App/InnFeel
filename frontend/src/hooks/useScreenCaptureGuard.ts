/**
 * useScreenCaptureGuard — DISABLED no-op.
 *
 * Originally this hook called `preventScreenCaptureAsync()` to block
 * screenshots of friends' auras. Removed at user request because:
 *   1. App Store reviewers need to capture the paywall to approve subscriptions.
 *   2. Apple's review guidelines discourage apps that intercept system gestures.
 *   3. Users legitimately need to screenshot bug reports, share moments, etc.
 *
 * The export is kept as a stub to avoid breaking any historical call sites,
 * but every call is a guaranteed no-op now. The privacy of friends' auras
 * is now communicated via the Terms of Service instead of technical blocking.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useScreenCaptureGuard(_isAdmin: boolean): void {
  // Intentional no-op. Do NOT add any expo-screen-capture calls here.
}
