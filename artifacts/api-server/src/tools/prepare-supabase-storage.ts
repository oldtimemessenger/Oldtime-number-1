import { createSupabaseBucket, getSupabaseBucket, supabaseMediaBucket } from "../lib/supabase-storage";

try {
  const bucket = supabaseMediaBucket();
  const existing = await getSupabaseBucket(bucket);
  if (existing) {
    if (existing.public) throw new Error("Existing media bucket is public; review before using it.");
    console.log("Existing private Supabase media bucket verified.");
  } else {
    await createSupabaseBucket(bucket);
    console.log("Created a private Supabase media bucket.");
  }
} catch {
  console.error("Supabase Storage setup failed. Check the server-side project key and private bucket configuration.");
  process.exitCode = 1;
}
