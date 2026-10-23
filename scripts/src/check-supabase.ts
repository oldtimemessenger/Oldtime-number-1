import { inspectSupabaseReadiness } from "@workspace/db/supabase-readiness";

try {
  const report = await inspectSupabaseReadiness();
  console.log(JSON.stringify(report, null, 2));
  if (!report.compatibility.compatible) process.exitCode = 2;
} catch {
  console.error(
    "Supabase check failed. Verify the Session Pooler URL and selected TLS mode in server-side Secrets/settings. No database changes were made.",
  );
  process.exitCode = 1;
}
