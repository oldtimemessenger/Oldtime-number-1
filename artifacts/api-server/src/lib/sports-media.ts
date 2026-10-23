import { Storage } from "@google-cloud/storage";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createSupabaseSignedReadUrl, deleteSupabaseMedia, putSupabaseMedia, readSupabaseMedia } from "./supabase-storage";
export type Location = { kind: "filesystem" | "s3" | "gcs" | "supabase"; key: string };
const google = new Storage();
const s3 = () => new S3Client({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}) });
function bucket(kind: Location["kind"]) {
  const value = kind === "s3" ? process.env.MEDIA_OBJECT_BUCKET : process.env.GCS_MEDIA_BUCKET;
  if (!value) throw new Error("Configure S3 or Google Cloud media storage before publishing photo cards.");
  return value;
}
function key(location: Location) {
  if (!/^sports\/[a-f0-9-]{36}\.(jpg|mp4|webm)$/.test(location.key)) throw new Error("Invalid sports media key.");
  return location.key;
}
function writeLocation(mediaKey: string): Location {
  const driver = process.env.SPORTS_MEDIA_STORAGE || "supabase";
  if (!["filesystem", "s3", "gcs", "supabase"].includes(driver)) throw new Error("Invalid Sports media storage driver.");
  if (driver !== "supabase" && process.env.NODE_ENV !== "test") {
    throw new Error("New media must be stored in Supabase. Legacy storage is read-only.");
  }
  // Legacy providers are explicit read/migration adapters, never auto-selected.
  if (driver === "gcs" && !process.env.GCS_MEDIA_BUCKET) throw new Error("Set an explicit GCS_MEDIA_BUCKET for Sports storage.");
  if (driver === "filesystem" && process.env.NODE_ENV === "production" && !process.env.SPORTS_MEDIA_DIR)
    throw new Error("Configure SPORTS_MEDIA_DIR on a persistent volume before uploading Sports media.");
  return { kind: driver as Location["kind"], key: mediaKey };
}
function diskPath(location: Location) {
  return resolve(process.env.SPORTS_MEDIA_DIR || resolve(process.cwd(), "media-data"), key(location));
}
async function save(location: Location, body: Buffer, mime: string) {
  if (location.kind === "filesystem") {
    const file = diskPath(location), temporary = `${file}.${randomUUID()}.partial`;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    try { await writeFile(temporary, body, { flag: "wx", mode: 0o600 }); await rename(temporary, file); }
    finally { await rm(temporary, { force: true }); }
  } else if (location.kind === "supabase") {
    await putSupabaseMedia(key(location), body, mime);
  } else if (location.kind === "s3") {
    await s3().send(new PutObjectCommand({ Bucket: bucket("s3"), Key: key(location), Body: body, ContentType: mime }));
  } else await google.bucket(bucket("gcs")).file(key(location)).save(body, { resumable: false, contentType: mime });
}
// Strip JPEG application/comment segments, including EXIF location, before storing.
export function safeJpeg(input: Buffer) {
  if (input[0] !== 255 || input[1] !== 216 || input.length < 32 || input.at(-2) !== 255 || input.at(-1) !== 217) throw new Error("Export a valid JPEG sports card.");
  const parts = [input.subarray(0, 2)]; let pos = 2, dimensions = false;
  while (pos < input.length - 2) {
    if (input[pos] !== 255) throw new Error("Invalid JPEG.");
    const marker = input[pos + 1], length = input.readUInt16BE(pos + 2);
    if (length < 2 || pos + 2 + length > input.length) throw new Error("Invalid JPEG segment.");
    if ([192,193,194].includes(marker)) {
      if (length < 8) throw new Error("Invalid JPEG frame.");
      const h = input.readUInt16BE(pos + 5), w = input.readUInt16BE(pos + 7);
      if (!h || !w || h * w > 16000000) throw new Error("Sports card dimensions are too large.");
      dimensions = true;
    }
    if (marker === 218) { if (!dimensions) throw new Error("Invalid JPEG frame."); parts.push(input.subarray(pos)); return Buffer.concat(parts); }
    if (!(marker >= 224 && marker <= 239) && marker !== 254) parts.push(input.subarray(pos, pos + 2 + length));
    pos += 2 + length;
  }
  throw new Error("Incomplete JPEG.");
}
export async function storeSportsImage(id: string, bytes: Buffer): Promise<Location> {
  const location = writeLocation(`sports/${id}.jpg`);
  const body = safeJpeg(bytes);
  await save(location, body, "image/jpeg");
  return location;
}
export async function storeSportsVideo(id: string, bytes: Buffer, mime: string): Promise<Location> {
  const webm = mime === "video/webm" && bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  const mp4 = mime === "video/mp4" && bytes.subarray(4, 8).toString() === "ftyp";
  if ((!webm && !mp4) || bytes.length < 100) throw new Error("Export a valid MP4 or WebM route video.");
  const location = writeLocation(`sports/${id}.${mp4 ? "mp4" : "webm"}`);
  await save(location, bytes, mime);
  return location;
}
export async function sportsMediaReadUrl(location: Location) {
  if (location.kind !== "supabase") return null;
  return createSupabaseSignedReadUrl(key(location));
}

export async function readSportsImage(location: Location) {
  if (location.kind === "filesystem") return readFile(diskPath(location));
  if (location.kind === "supabase") return readSupabaseMedia(key(location));
  if (location.kind === "s3") {
    const result = await s3().send(new GetObjectCommand({ Bucket: bucket("s3"), Key: key(location) }));
    if (!result.Body) throw new Error("Image unavailable.");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  return (await google.bucket(bucket("gcs")).file(key(location)).download())[0];
}
export async function deleteSportsImage(location: Location) {
  if (location.kind === "filesystem") await rm(diskPath(location), { force: true });
  else if (location.kind === "supabase") await deleteSupabaseMedia(key(location));
  else if (location.kind === "s3") await s3().send(new DeleteObjectCommand({ Bucket: bucket("s3"), Key: key(location) }));
  else await google.bucket(bucket("gcs")).file(key(location)).delete({ ignoreNotFound: true });
}
