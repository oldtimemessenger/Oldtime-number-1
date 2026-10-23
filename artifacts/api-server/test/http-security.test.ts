import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { applyHttpSecurity, publicApiErrorHandler } from "../src/lib/http-security.ts";

test("API boundaries reject unsafe requests without exposing private errors", async t => {
  const errors: string[] = [];
  const app = express();
  applyHttpSecurity(app, { production: true, allowedOrigins: new Set(["https://oldtime.example"]) });
  app.post("/echo", (req, res) => { res.json(req.body); });
  app.get("/crash", () => { throw new Error("private database credentials and stack"); });
  app.use(publicApiErrorHandler(type => errors.push(type)));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  await t.test("production CORS permits only explicitly configured origins", async () => {
    const approved = await fetch(`${base}/echo`, {
      method: "OPTIONS", headers: { Origin: "https://oldtime.example", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(approved.headers.get("access-control-allow-origin"), "https://oldtime.example");
    assert.equal(approved.headers.get("access-control-allow-credentials"), null);
    const rejected = await fetch(`${base}/echo`, { headers: { Origin: "https://foreign.example" } });
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  });
  await t.test("API responses have security headers and cannot be cached", async () => {
    const response = await fetch(`${base}/echo`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"valid":true}',
    });
    assert.deepEqual(await response.json(), { valid: true });
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
  await t.test("invalid and oversized JSON receive safe client errors", async () => {
    const invalid = await fetch(`${base}/echo`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"private":',
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "Invalid request." });
    const large = await fetch(`${base}/echo`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "x".repeat(1024 * 1024) }),
    });
    assert.equal(large.status, 413);
    assert.deepEqual(await large.json(), { error: "Request is too large." });
  });
  await t.test("unexpected exceptions do not expose infrastructure or private data", async () => {
    const response = await fetch(`${base}/crash`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "The service could not complete this request. Please try again.",
    });
    assert.deepEqual(errors, ["Error"]);
  });
});
