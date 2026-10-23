import assert from "node:assert/strict";
import test from "node:test";
import { cloudApiUrl } from "./api-origin.js";

test("keeps same-origin API URLs when no separate backend is configured", () => {
  assert.equal(cloudApiUrl("/api/auth/login"), "/api/auth/login");
});

test("uses only the configured API origin while preserving path and query", () => {
  assert.equal(
    cloudApiUrl("/api/feed?limit=30", "https://api.oldtime.example/"),
    "https://api.oldtime.example/api/feed?limit=30",
  );
});

test("rejects API origins containing paths, credentials, or non-HTTP protocols", () => {
  for (const origin of [
    "https://user:secret@api.oldtime.example",
    "https://api.oldtime.example/api",
    "ftp://api.oldtime.example",
    "not a url",
  ]) {
    assert.throws(() => cloudApiUrl("/api/auth/login", origin), /VITE_API_BASE_URL/);
  }
});

test("rejects URLs outside the API route", () => {
  for (const path of ["https://attacker.example/api/auth/login", "//attacker.example/api/auth/login", "/login", "/api/../profile", "/api\\profile"]) {
    assert.throws(() => cloudApiUrl(path), error =>
      error.message.includes("same-origin") || error.message.includes("within the /api/"));
  }
});
