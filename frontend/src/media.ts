/**
 * Media helpers — compress photos, then upload directly to Cloudflare R2
 * via a pre-signed PUT URL the backend hands us.
 *
 * Flow:
 *   1) `compressPhoto(uri)`                 → produces a small JPEG local URI
 *   2) `getUploadUrl(kind, contentType)`    → backend signs a PUT URL + gives us the R2 object key
 *   3) `uploadBinaryToR2(url, uri, ct)`     → PUTs the file bytes directly to R2
 *   4) Return the `key` to the caller so it can be attached to a mood/message/avatar
 */
import * as ImageManipulator from "expo-image-manipulator";
// Legacy export of expo-file-system keeps `uploadAsync` + `FileSystemUploadType`
// available on SDK 54. Streams the local file directly to R2 without ever
// hydrating the bytes into a JS-side Blob — critical for ~10–30 MB videos
// where `fetch(fileUri).blob()` would hang or OOM on iOS / older Androids.
import * as LegacyFS from "expo-file-system/legacy";
import { api } from "./api";

export type MediaKind =
  | "mood_photo"
  | "mood_audio"
  | "mood_video"
  | "msg_photo"
  | "msg_audio"
  | "avatar";

export type UploadUrlResponse = {
  url: string;
  method: "PUT";
  key: string;
  headers: Record<string, string>;
  expires_in: number;
};

// ---------------------------------------------------------------------- //
// Compression
// ---------------------------------------------------------------------- //
export async function compressPhoto(
  uri: string,
  opts?: { maxWidth?: number; quality?: number },
): Promise<{ uri: string; width: number; height: number }> {
  const maxWidth = opts?.maxWidth ?? 1280;
  const quality = opts?.quality ?? 0.7;
  try {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: maxWidth } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
    );
    return { uri: out.uri, width: out.width, height: out.height };
  } catch {
    // Fallback: return the original URI if the manipulator fails (rare).
    return { uri, width: 0, height: 0 };
  }
}

export async function compressAvatar(uri: string): Promise<string> {
  const r = await compressPhoto(uri, { maxWidth: 512, quality: 0.8 });
  return r.uri;
}

// ---------------------------------------------------------------------- //
// Direct-to-R2 upload helpers
// ---------------------------------------------------------------------- //
export async function getUploadUrl(
  kind: MediaKind,
  contentType: string,
  ext?: string,
): Promise<UploadUrlResponse> {
  return api<UploadUrlResponse>("/media/upload-url", {
    method: "POST",
    body: { kind, content_type: contentType, ext },
  });
}

/** PUTs the bytes of a local file URI to the signed R2 URL. Throws on HTTP errors.
 *
 * Implementation notes:
 *  • On native (iOS/Android) we use `FileSystem.uploadAsync` with
 *    `BINARY_CONTENT`. This streams the file from disk straight to the
 *    network without ever materialising it as a JS Blob — essential for
 *    10 s videos (10–30 MB) where `fetch(fileUri).blob()` was hanging
 *    indefinitely on iOS and OOMing on older Android devices.
 *  • On web (Expo Web) we keep the original `fetch + blob` path because
 *    `expo-file-system` doesn't proxy file:// URIs in browsers.
 *  • A hard 90 s wall-clock timeout wraps the whole call so a flaky
 *    network never leaves the UI's "Uploading…" spinner spinning forever.
 */
export async function uploadBinaryToR2(
  signedUrl: string,
  fileUri: string,
  contentType: string,
): Promise<void> {
  const TIMEOUT_MS = 90_000;
  const isWeb = typeof document !== "undefined";
  const isNativeFile = !isWeb && /^(file|content|asset|ph):/i.test(fileUri);

  // Race the actual upload against a wall-clock timeout — guarantees the
  // caller's spinner can't hang forever on a stalled connection.
  const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("Upload timed out (90s) — check your connection.")), TIMEOUT_MS),
      ),
    ]);

  if (isNativeFile && (LegacyFS as any)?.uploadAsync) {
    const { FileSystemUploadType, FileSystemSessionType } = LegacyFS as any;
    const uploadType =
      FileSystemUploadType?.BINARY_CONTENT ?? 0; // 0 = BINARY_CONTENT in legacy enum
    // CRITICAL — FOREGROUND session mode.
    // `expo-file-system`'s default on iOS is the BACKGROUND URLSession, which
    // has a long-standing known bug inside Expo Go SDK 54 where large file
    // uploads stall for minutes or never complete (see github.com/expo/expo
    // issue #26754). Forcing the foreground session keeps the upload on the
    // app's main URLSession and uploads complete in normal time.
    // Production EAS builds are unaffected, but we keep this for safety.
    const sessionType = FileSystemSessionType?.FOREGROUND ?? 0;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log("[UPLOAD] uploadAsync start", { fileUri, contentType, sessionType });
    }
    const result = await withTimeout(
      (LegacyFS as any).uploadAsync(signedUrl, fileUri, {
        httpMethod: "PUT",
        headers: { "Content-Type": contentType },
        uploadType,
        sessionType,
      }),
    );
    const status = (result as any)?.status ?? 0;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log("[UPLOAD] uploadAsync done", { status, body: ((result as any)?.body || "").toString().slice(0, 200) });
    }
    if (status < 200 || status >= 300) {
      const body = ((result as any)?.body || "").toString().slice(0, 200);
      throw new Error(`R2 upload failed (${status}): ${body}`);
    }
    return;
  }

  // Web fallback — fetch the (likely blob:) URI and PUT the resulting Blob.
  const res = await fetch(fileUri);
  const blob = await res.blob();
  const put = await withTimeout(
    fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob as any,
    }),
  );
  if (put.status < 200 || put.status >= 300) {
    const txt = await put.text().catch(() => "");
    throw new Error(`R2 upload failed (${put.status}): ${txt.slice(0, 200)}`);
  }
}

/**
 * One-liner: compress (if image) + get signed URL + upload + return the `key`.
 * For non-image kinds, skip compression.
 */
export async function uploadMedia(
  kind: MediaKind,
  fileUri: string,
  contentType: string,
  opts?: { compress?: boolean; maxWidth?: number; quality?: number; ext?: string },
): Promise<string> {
  let uri = fileUri;
  let ct = contentType;
  const isImage = contentType.startsWith("image/");
  if (isImage && opts?.compress !== false) {
    const c = await compressPhoto(uri, {
      maxWidth: opts?.maxWidth ?? (kind === "avatar" ? 512 : 1280),
      quality: opts?.quality ?? (kind === "avatar" ? 0.8 : 0.7),
    });
    uri = c.uri;
    ct = "image/jpeg"; // after compression we always get JPEG
  }
  const signed = await getUploadUrl(kind, ct, opts?.ext);
  await uploadBinaryToR2(signed.url, uri, ct);
  return signed.key;
}
