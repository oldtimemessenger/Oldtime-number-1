import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isServerStorageCredential } from "../../../supabase/functions/oldtime-storage/storage-auth.js";
import { getSupabaseBucket } from "../src/lib/supabase-storage";
import { installSupabaseStorageFixture } from "./helpers/supabase-storage-fixture";

const token = (role: string) => `fixtureHeader.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.fixtureSignature`;

test("storage credential prefilter rejects missing, public, malformed and oversized inputs", () => {
  assert.equal(isServerStorageCredential(token("service_role")), true);
  assert.equal(isServerStorageCredential("sb_secret_fixture"), true);
  for (const provided of [null, "", token("anon"), token("authenticated"), "sb_publishable_fixture", "not-a-key", "a".repeat(4097), "bad.invalidPayload.bad"]) {
    assert.equal(isServerStorageCredential(provided), false);
  }
});

test("the broker lets Storage validate the caller key without substituting a privileged runtime key", async () => {
  const source = await readFile(new URL("../../../supabase/functions/oldtime-storage/index.ts", import.meta.url), "utf8");
  assert.match(source, /const apiKey = request\.headers\.get\("apikey"\)/);
  assert.match(source, /createClient\(Deno\.env\.get\("SUPABASE_URL"\)!, apiKey!/);
  assert.match(source, /if \(!isServerStorageCredential\(apiKey\)\)/);
  assert.match(source, /No objects supplied/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|supabaseAdmin|auth:\s*["']none["']/);
});

test("broker failures retain the HTTP status and safe code but never echo upstream secrets", async () => {
  const fixture = installSupabaseStorageFixture();
  try {
    globalThis.fetch = async () => Response.json({
      code: "INVALID_API_KEY",
      message: "never-log-this-upstream-secret",
    }, { status: 401 });
    await assert.rejects(getSupabaseBucket(), (error: any) => {
      assert.equal(error.upstreamStatus, 401);
      assert.equal(error.code, "INVALID_API_KEY");
      assert.equal(error.operation, "bucket-info");
      assert.doesNotMatch(error.message, /never-log-this-upstream-secret/);
      return true;
    });
  } finally {
    fixture.restore();
  }
});
