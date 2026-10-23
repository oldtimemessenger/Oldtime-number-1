import { randomUUID, createHash } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  copySupabaseMedia, deleteSupabaseMedia, fingerprintSupabaseMedia, getSupabaseMediaMetadata,
  reserveSupabaseResumableMedia, supabaseMediaBucket, validateSupabaseObjectKey,
} from "./supabase-storage";

function supabaseObject(path: string) {
  const prefix = `supabase://${supabaseMediaBucket()}/`;
  if (!path.startsWith(prefix)) throw new Error("Invalid private Supabase media location.");
  const key = validateSupabaseObjectKey(path.slice(prefix.length));
  if (!/^creator\/(pending|originals)\/[a-f0-9-]{36}$/.test(key)) {
    throw new Error("Invalid private creator media key.");
  }
  return key;
}

function s3() {
  const endpoint = process.env.S3_ENDPOINT;
  return new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}

function s3Root() {
  const bucket = process.env.MEDIA_OBJECT_BUCKET;
  const prefix = (process.env.MEDIA_OBJECT_PREFIX || "creator-media").replace(/^\/+|\/+$/g, "");
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || !prefix ||
    prefix.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("S3 private media storage is not configured.");
  }
  return { bucket, prefix, uriRoot: `s3://${bucket}/${prefix}` };
}

function s3Object(path: string) {
  const { bucket, uriRoot } = s3Root();
  if (!path.startsWith(`${uriRoot}/`)) throw new Error("Invalid private media location.");
  return { bucket, key: path.slice(`s3://${bucket}/`.length) };
}

export async function reserveMedia(contentType: string) {
  void contentType;
  const key = `creator/pending/${randomUUID()}`;
  const upload = await reserveSupabaseResumableMedia(key);
  return { path: `supabase://${supabaseMediaBucket()}/${key}`, upload };
}

export function mediaSignatureMatches(type: string, bytes: Buffer) {
  switch (type) {
    case "image/jpeg": return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/png": return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    case "image/webp": return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    case "image/gif": return ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
    case "video/mp4": return bytes.toString("ascii", 4, 8) === "ftyp";
    case "video/webm": return bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163]));
    default: return false;
  }
}

export async function confirmMedia(path: string, type: string, expectedSize: number) {
  if (path.startsWith("supabase://")) {
    const sourceKey = supabaseObject(path);
    if (!sourceKey.startsWith("creator/pending/") || expectedSize <= 0) {
      throw new Error("Uploaded media does not match its reservation.");
    }
    const metadata = await getSupabaseMediaMetadata(sourceKey);
    if (!metadata || metadata.size !== expectedSize || metadata.contentType !== type) {
      throw new Error("Uploaded media does not match its reservation.");
    }
    const verified = await fingerprintSupabaseMedia(sourceKey, expectedSize);
    if (!mediaSignatureMatches(type, verified.header)) {
      throw new Error("Uploaded media has an invalid size or file signature.");
    }
    // Copy verified bytes to a fresh, server-only key. The browser's signed
    // pending upload token can never overwrite an approved original.
    const targetKey = `creator/originals/${randomUUID()}`;
    await copySupabaseMedia(sourceKey, targetKey);
    try {
      await deleteSupabaseMedia(sourceKey);
    } catch (error) {
      await deleteSupabaseMedia(targetKey);
      throw error;
    }
    return {
      path: `supabase://${supabaseMediaBucket()}/${targetKey}`,
      fingerprint: verified.fingerprint,
    };
  }
  const source = s3Object(path);
  const client = s3();
  const metadata = await client.send(new HeadObjectCommand({ Bucket: source.bucket, Key: source.key }));
  if (Number(metadata.ContentLength) !== expectedSize || metadata.ContentType !== type || !metadata.VersionId) {
    throw new Error("Uploaded media does not match its reservation.");
  }

  const object = await client.send(new GetObjectCommand({
    Bucket: source.bucket, Key: source.key, VersionId: metadata.VersionId,
  }));
  if (!object.Body) throw new Error("Uploaded media could not be verified.");
  const hash = createHash("sha256");
  let length = 0;
  let header = Buffer.alloc(0);
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > expectedSize) throw new Error("Uploaded media is too large.");
    if (header.length < 32) header = Buffer.concat([header, bytes.subarray(0, 32 - header.length)]);
    hash.update(bytes);
  }
  if (length !== expectedSize || !mediaSignatureMatches(type, header)) {
    throw new Error("Uploaded media has an invalid file signature.");
  }

  const targetPath = `${s3Root().uriRoot}/originals/${randomUUID()}`;
  const target = s3Object(targetPath);
  const copySource = `${source.bucket}/${source.key.split("/").map(encodeURIComponent).join("/")}?versionId=${encodeURIComponent(metadata.VersionId)}`;
  await client.send(new CopyObjectCommand({
    Bucket: target.bucket, Key: target.key, CopySource: copySource,
  }));
  await client.send(new DeleteObjectCommand({ Bucket: source.bucket, Key: source.key }));
  return { path: targetPath, fingerprint: hash.digest("hex") };
}

export async function deleteCreatorMedia(path: string) {
  if (path.startsWith("supabase://")) {
    await deleteSupabaseMedia(supabaseObject(path));
    return;
  }
  const location = s3Object(path);
  await s3().send(new DeleteObjectCommand({ Bucket: location.bucket, Key: location.key }));
}

export async function readLegacyCreatorMedia(path: string) {
  const location = s3Object(path);
  const result = await s3().send(new GetObjectCommand({ Bucket: location.bucket, Key: location.key }));
  if (!result.Body) throw new Error("Legacy creator media could not be read.");
  return Buffer.from(await result.Body.transformToByteArray());
}
