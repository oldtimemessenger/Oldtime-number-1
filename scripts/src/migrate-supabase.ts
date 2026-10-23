import { copyAppDataToSupabase } from "@workspace/db/supabase-data-migration";

if (!["--apply", "--rehearse"].includes(process.argv[2] ?? "")) {
  console.error("Use --rehearse to verify a rolled-back copy, or explicit --apply during a write pause. Source records are never deleted.");
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(await copyAppDataToSupabase(process.env, process.argv[2] === "--apply"), null, 2));
  } catch (error) {
    // All application-thrown diagnostics are fixed strings. Driver errors can
    // contain account details, so do not print them.
    const safe = error instanceof Error && !("code" in error)
      ? error.message : "Connection or SQL operation failed; no cutover was performed.";
    console.error(`Supabase data migration stopped: ${safe}`);
    process.exitCode = 1;
  }
}
