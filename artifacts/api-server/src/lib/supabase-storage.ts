import { createHash } from "node:crypto";

async function storageRequest(operation: string, payload: Record<string, unknown>) {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("Supabase Storage broker credentials are not configured.");
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
      endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error("SUPABASE_URL must be the project's HTTPS origin.");
  }
  const response = await fetch(new URL("/functions/v1/oldtime-storage", endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // New Supabase secret keys are API keys, not JWTs. Keep them on apikey
      // only; the Edge Function validates this key and performs Storage work.
      apikey: key,
    },
    body: JSON.stringify({ operation, bucket: supabaseMediaBucket(), ...payload }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => null) as Record<string, any> | null;
  if (!response.ok || !result) {
    // Preserve actionable diagnostics without logging response messages, which
    // may contain credentials or signed media URLs.
    const code = typeof result?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(result.code)
      ? result.code : "STORAGE_BROKER_ERROR";
    throw Object.assign(new Error(`Supabase Storage broker failed (HTTP ${response.status}, ${code}).`), {
      upstreamStatus: response.status, code, operation,
    });
  }
  if (result.error) throw new Error(String(result.error));
  return result;
}

export async function getSupabaseBucket(bucket = supabaseMediaBucket()) {
  const result = await storageRequest("bucket-info", { bucket });
  return result.bucket as { id: string; name: string; public: boolean } | null;
}

export async function createSupabaseBucket(bucket = supabaseMediaBucket()) {
  await storageRequest("create-bucket", { bucket });
}

export function supabaseMediaBucket() {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "oldtime-media";
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("Invalid Supabase media bucket.");
  }
  return bucket;
}

export function validateSupabaseObjectKey(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid private media key.");
  }
  return key;
}

export async function putSupabaseMedia(key: string, body: Buffer, contentType: string) {
  const objectKey = validateSupabaseObjectKey(key);
  const signed = await storageRequest("sign-upload", { key: objectKey });
  const response = await fetch(String(signed.signedUrl), {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "max-age=300",
      "x-upsert": "false",
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("The media upload could not be completed.");
}

export async function readSupabaseMedia(key: string) {
  const url = await createSupabaseSignedReadUrl(key, 300);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error("The media file could not be loaded.");
  return Buffer.from(await response.arrayBuffer());
}

export async function getSupabaseMediaMetadata(key: string) {
  const result = await storageRequest("info", { key: validateSupabaseObjectKey(key) });
  const data = result.info as {
    size?: number | string; contentType?: string; content_type?: string;
    metadata?: { size?: number | string; mimetype?: string; contentType?: string };
  } | null;
  if (!data) return null;
  // Storage info() returns FileObjectV2: size/contentType are top-level.
  // Older list/info adapters exposed these fields under metadata.
  const info = data as {
    size?: number | string; contentType?: string; content_type?: string;
    metadata?: { size?: number | string; mimetype?: string; contentType?: string };
  };
  const size = Number(info.size ?? info.metadata?.size);
  const contentType = String(info.contentType ?? info.content_type ??
    info.metadata?.mimetype ?? info.metadata?.contentType ?? "").toLowerCase();
  if (!Number.isSafeInteger(size) || size < 0 || !contentType) {
    throw new Error("Cloud media metadata is incomplete.");
  }
  return {
    size, contentType,
  };
}

export async function fingerprintSupabaseMedia(key: string, expectedSize: number) {
  const response = await fetch(await createSupabaseSignedReadUrl(key));
  if (!response.ok || !response.body) throw new Error("The uploaded media could not be verified.");
  const hash = createHash("sha256");
  let size = 0;
  let header = Buffer.alloc(0);
  for await (const chunk of response.body as any) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > expectedSize) throw new Error("Uploaded media does not match its reservation.");
    if (header.length < 32) header = Buffer.concat([header, bytes.subarray(0, 32 - header.length)]);
    hash.update(bytes);
  }
  if (size !== expectedSize) throw new Error("Uploaded media does not match its reservation.");
  return { size, header, fingerprint: hash.digest("hex") };
}

export async function copySupabaseMedia(sourceKey: string, targetKey: string) {
  await storageRequest("copy", {
    sourceKey: validateSupabaseObjectKey(sourceKey),
    targetKey: validateSupabaseObjectKey(targetKey),
  });
}

export async function reserveSupabaseResumableMedia(key: string) {
  const bucketName = supabaseMediaBucket();
  const objectName = validateSupabaseObjectKey(key);
  const data = await storageRequest("sign-upload", { key: objectName });
  if (!data.token) throw new Error("The media upload could not be prepared.");
  const projectUrl = new URL(process.env.SUPABASE_URL!);
  const endpoint = projectUrl.hostname.endsWith(".supabase.co")
    ? `https://${projectUrl.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co")}/storage/v1/upload/resumable/sign`
    : `${projectUrl.origin}/storage/v1/upload/resumable/sign`;
  return { token: data.token, endpoint, bucketName, objectName };
}

export async function createSupabaseSignedReadUrl(key: string, expiresIn = 300) {
  const result = await storageRequest("sign-read", {
    key: validateSupabaseObjectKey(key), expiresIn,
  });
  if (!result.signedUrl) throw new Error("The media link could not be prepared.");
  return result.signedUrl;
}

export async function deleteSupabaseMedia(key: string) {
  await storageRequest("remove", { keys: [validateSupabaseObjectKey(key)] });
}

export async function deleteSupabaseMediaMany(keys: string[]) {
  const safeKeys = [...new Set(keys.map(validateSupabaseObjectKey))];
  if (!safeKeys.length) return;
  await storageRequest("remove", { keys: safeKeys });
}

export async function reserveSupabaseMedia(key: string) {
  const data = await storageRequest("sign-upload", { key: validateSupabaseObjectKey(key) });
  if (!data.signedUrl) throw new Error("The media upload could not be prepared.");
  return data.signedUrl;
}
