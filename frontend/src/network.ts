/**
 * Network connectivity helpers — single source of truth for online/offline UI.
 *
 *  • `useNetworkStatus()` — React hook returning `{ online, type }`. On the web
 *    it falls back to navigator.onLine + window 'online'/'offline' events
 *    because NetInfo's web shim is not 100% reliable across browsers.
 *  • `pingBackend()` — quick HEAD probe so we can surface a soft "backend
 *    unreachable" state even when the device is on Wi-Fi but the API is down
 *    (e.g. tunnels going to sleep, captive portal, etc.).
 */
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";

export type NetStatus = {
  /** True if we have *some* connectivity. Backend reachability is separate. */
  online: boolean;
  /** Connection family, e.g. "wifi" | "cellular" | "unknown" | "none". */
  type: string;
};

const initial: NetStatus = (() => {
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    return { online: navigator.onLine !== false, type: "unknown" };
  }
  return { online: true, type: "unknown" };
})();

/**
 * Subscribe to connectivity changes. Always returns a fresh `NetStatus` object
 * so React's reference equality triggers re-renders on transitions.
 */
export function useNetworkStatus(): NetStatus {
  const [status, setStatus] = useState<NetStatus>(initial);

  useEffect(() => {
    let mounted = true;

    if (Platform.OS === "web") {
      // NetInfo's web shim is flaky across browsers (often reports
      // disconnected even on a healthy connection during the first paint).
      // Use the browser's own events as the single source of truth on web.
      if (typeof window !== "undefined") {
        const onlineHandler = () => mounted && setStatus({ online: true, type: "unknown" });
        const offlineHandler = () => mounted && setStatus({ online: false, type: "none" });
        window.addEventListener("online", onlineHandler);
        window.addEventListener("offline", offlineHandler);
        return () => {
          mounted = false;
          window.removeEventListener("online", onlineHandler);
          window.removeEventListener("offline", offlineHandler);
        };
      }
      return () => { mounted = false; };
    }

    // Native (iOS / Android): NetInfo is reliable.
    NetInfo.fetch()
      .then((s) => {
        if (!mounted) return;
        setStatus({
          online: s.isConnected !== false && s.isInternetReachable !== false,
          type: String(s.type || "unknown"),
        });
      })
      .catch(() => {});

    const unsub = NetInfo.addEventListener((s) => {
      if (!mounted) return;
      setStatus({
        // `isInternetReachable` is sometimes null while NetInfo probes — treat
        // null as "online" to avoid flapping the banner on every screen change.
        online:
          s.isConnected !== false && (s.isInternetReachable ?? true) !== false,
        type: String(s.type || "unknown"),
      });
    });

    return () => {
      mounted = false;
      try { unsub(); } catch {}
    };
  }, []);

  return status;
}

/** Quick HEAD probe to confirm the API is reachable. Returns false on timeout. */
export async function pingBackend(timeoutMs = 4000): Promise<boolean> {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  if (!base) return true; // Nothing to probe in some configurations.
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
