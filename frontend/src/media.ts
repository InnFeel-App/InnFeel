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

/** PUTs the bytes of a local file URI to the signed R2 URL. Throws on HTTP errors. */
export async function uploadBinaryToR2(
  signedUrl: string,
  fileUri: string,
  contentType: string,
): Promise<void> {
  // react-native fetch supports { uri, type, name } body shapes via blob; cleanest is to
  // fetch the file as a blob then PUT the blob back out.
  const res = await fetch(fileUri);
  const blob = await res.blob();
  const put = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob as any,
  });
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
