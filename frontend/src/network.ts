/**
 * Network connectivity helpers — bulletproof source of truth for online/offline UI.
 *
 *   • `useNetworkStatus()` — React hook returning `{ online, type }`. Always
 *     returns a populated object even if NetInfo's native bridge is unavailable
 *     (Expo Go cold start, Hermes module mismatch, EAS build edge cases). The
 *     hook NEVER throws — at worst it falls back to `{ online: true,
 *     type: "unknown" }` so consumer screens render normally.
 */
import { useEffect, useState } from "react";
import { Platform } from "react-native";

// Lazy-require so a missing native module can never crash the bundle on import.
// We tolerate the package being absent at runtime — most of the app works just
// fine without live connectivity tracking, and the OfflineBanner / EmptyState
// just stay hidden.
let NetInfo: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NetInfo = require("@react-native-community/netinfo")?.default ?? null;
} catch {
  NetInfo = null;
}

export type NetStatus = {
  /** True if we have *some* connectivity. Backend reachability is separate. */
  online: boolean;
  /** Connection family, e.g. "wifi" | "cellular" | "unknown" | "none". */
  type: string;
};

const DEFAULT_STATUS: NetStatus = { online: true, type: "unknown" };

/** Build the initial state safely — never throws. */
function buildInitial(): NetStatus {
  try {
    if (Platform.OS === "web" && typeof navigator !== "undefined") {
      return { online: navigator.onLine !== false, type: "unknown" };
    }
  } catch {}
  return DEFAULT_STATUS;
}

/**
 * Subscribe to connectivity changes. Always returns a fresh `NetStatus`.
 * Guarantees: (1) returns a non-null object on every call, (2) never throws,
 * (3) handles missing NetInfo native module gracefully.
 */
export function useNetworkStatus(): NetStatus {
  const [status, setStatus] = useState<NetStatus>(buildInitial);

  useEffect(() => {
    let mounted = true;

    if (Platform.OS === "web") {
      // Web: navigator.onLine + window events are the most reliable signal.
      // NetInfo's web shim is unreliable across browsers (often false-positives
      // disconnected on first paint), so we skip it entirely on web.
      if (typeof window === "undefined") return () => { mounted = false; };
      const onlineHandler = () => mounted && setStatus({ online: true, type: "unknown" });
      const offlineHandler = () => mounted && setStatus({ online: false, type: "none" });
      window.addEventListener("online", onlineHandler);
      window.addEventListener("offline", offlineHandler);
      return () => {
        mounted = false;
        try { window.removeEventListener("online", onlineHandler); } catch {}
        try { window.removeEventListener("offline", offlineHandler); } catch {}
      };
    }

    // Native — use NetInfo if it's available. If not, we silently stay on the
    // optimistic default and the offline UI just never triggers.
    if (!NetInfo || typeof NetInfo.addEventListener !== "function") {
      return () => { mounted = false; };
    }

    try {
      NetInfo.fetch?.()
        .then((s: any) => {
          if (!mounted || !s) return;
          setStatus({
            online: s.isConnected !== false && (s.isInternetReachable ?? true) !== false,
            type: String(s.type || "unknown"),
          });
        })
        .catch(() => {});
    } catch {}

    let unsub: (() => void) | null = null;
    try {
      unsub = NetInfo.addEventListener((s: any) => {
        if (!mounted || !s) return;
        setStatus({
          online: s.isConnected !== false && (s.isInternetReachable ?? true) !== false,
          type: String(s.type || "unknown"),
        });
      });
    } catch {
      unsub = null;
    }

    return () => {
      mounted = false;
      try { unsub?.(); } catch {}
    };
  }, []);

  // Guarantee the return is always a fully populated object — defends against
  // any historical bug where useState somehow held a non-object value.
  if (!status || typeof (status as any).online !== "boolean") {
    return DEFAULT_STATUS;
  }
  return status;
}

/** Quick HEAD probe to confirm the API is reachable. Returns false on timeout. */
export async function pingBackend(timeoutMs = 4000): Promise<boolean> {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  if (!base) return true;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/api/health`, { method: "GET", signal: ctrl.signal });
    clearTimeout(tid);
    return res.ok;
  } catch {
    return false;
  }
}
