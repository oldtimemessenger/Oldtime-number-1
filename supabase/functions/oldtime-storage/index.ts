import { createClient } from "npm:@supabase/supabase-js@2";
import { isServerStorageCredential } from "./storage-auth.js";

const objectKeyPattern = /^[a-zA-Z0-9/_.-]+$/;
const bucketPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function safeKey(value: unknown): string {
  if (typeof value !== "string" || !objectKeyPattern.test(value) ||
      value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid object key.");
  }
  return value;
}

function safeBucket(value: unknown): string {
  if (typeof value !== "string" || !bucketPattern.test(value)) {
    throw new Error("Invalid bucket.");
  }
  return value;
}

function storageFailure(message: string, error: unknown) {
  const value = error as { statusCode?: unknown; status?: unknown } | null;
  const upstreamStatus = Number(value?.statusCode ?? value?.status);
  return Object.assign(new Error(message), { status: upstreamStatus === 401 || upstreamStatus === 403 ? upstreamStatus : 502 });
}

async function handleStorageRequest(request: Request) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  const apiKey = request.headers.get("apikey");
  if (!isServerStorageCredential(apiKey)) {
    return Response.json({ error: "Server storage credentials required.", code: "STORAGE_AUTH_FAILED" }, { status: 401 });
  }

  // Authentication is performed by Storage using the actual supplied key.
  // This supports valid legacy and modern server keys even when they differ
  // from the runtime's injected defaults. No caller is elevated to a different
  // built-in admin credential.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, apiKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 32_768) return Response.json({ error: "Request is too large." }, { status: 413 });
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }
    input = parsed;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  let bucketName: string;
  try { bucketName = safeBucket(input.bucket); }
  catch { return Response.json({ error: "Invalid bucket." }, { status: 400 }); }
  const bucket = admin.storage.from(bucketName);

  try {
    switch (input.operation) {
      case "sign-upload": {
        const key = safeKey(input.key);
        const { data, error } = await bucket.createSignedUploadUrl(key, { upsert: false });
        if (error || !data?.token || !data?.signedUrl) throw storageFailure("Upload signing failed.", error);
        return Response.json({ token: data.token, signedUrl: data.signedUrl, path: data.path });
      }
      case "sign-read": {
        const key = safeKey(input.key);
        const expiresIn = Number.isInteger(input.expiresIn)
          ? Math.max(30, Math.min(3600, Number(input.expiresIn)))
          : 300;
        const { data, error } = await bucket.createSignedUrl(key, expiresIn);
        if (error || !data?.signedUrl) throw storageFailure("Read signing failed.", error);
        return Response.json({ signedUrl: data.signedUrl });
      }
      case "info": {
        const key = safeKey(input.key);
        const { data, error } = await bucket.info(key);
        if (error) {
          if ("statusCode" in error && String(error.statusCode) === "404") {
            return Response.json({ info: null });
          }
          throw storageFailure("Metadata lookup failed.", error);
        }
        return Response.json({ info: data || null });
      }
      case "bucket-info": {
        const { data, error } = await admin.storage.getBucket(bucketName);
        if (error) {
          if ("statusCode" in error && String(error.statusCode) === "404") {
            return Response.json({ bucket: null });
          }
          throw storageFailure("Bucket lookup failed.", error);
        }
        return Response.json({ bucket: data || null });
      }
      case "create-bucket": {
        const { error } = await admin.storage.createBucket(bucketName, {
          public: false,
          allowedMimeTypes: [
            "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
            "video/mp4", "video/webm", "video/quicktime", "audio/mp4", "audio/webm", "audio/ogg", "audio/mpeg",
            "application/pdf", "text/plain", "text/csv", "application/rtf", "application/zip",
            "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          ],
        });
        if (error) throw storageFailure("Bucket creation failed.", error);
        return Response.json({ ok: true });
      }
      case "copy": {
        const sourceKey = safeKey(input.sourceKey);
        const targetKey = safeKey(input.targetKey);
        const { error } = await bucket.copy(sourceKey, targetKey);
        if (error) throw storageFailure("Media finalization failed.", error);
        return Response.json({ ok: true });
      }
      case "remove": {
        const keys = Array.isArray(input.keys) ? [...new Set(input.keys.map(safeKey))] : [];
        if (keys.length > 100) throw new Error("Too many objects.");
        if (!keys.length) return Response.json({ error: "No objects supplied." }, { status: 400 });
        const { error } = await bucket.remove(keys);
        if (error) throw storageFailure("Media removal failed.", error);
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: "Unsupported storage operation." }, { status: 400 });
    }
  } catch (error) {
    console.error("Oldtime Storage operation failed", {
      operation: String(input.operation || "unknown"),
      reason: error instanceof Error ? error.message : "unknown",
    });
    const status = error instanceof Error && "status" in error && [401, 403].includes(Number(error.status))
      ? Number(error.status) : 502;
    return Response.json({
      error: status === 401 || status === 403 ? "Storage authorization failed." : "Supabase Storage request failed.",
      code: status === 401 || status === 403 ? "STORAGE_AUTH_FAILED" : "STORAGE_REQUEST_FAILED",
    }, { status });
  }
}

Deno.serve(handleStorageRequest);
