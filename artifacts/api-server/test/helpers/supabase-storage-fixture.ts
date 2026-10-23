type StoredObject = { body: Buffer; contentType: string };

export function installSupabaseStorageFixture() {
  const keys = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_STORAGE_BUCKET"] as const;
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const origin = "https://storage-fixture.invalid";
  const objects = new Map<string, StoredObject>();

  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SECRET_KEY = "fixture-only-not-a-real-secret";
  process.env.SUPABASE_STORAGE_BUCKET = "oldtime-media";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) return originalFetch(input, init);

    const method = init?.method || (input instanceof Request ? input.method : "GET");
    if (url.pathname === "/functions/v1/oldtime-storage") {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      const bucket = String(body.bucket || "oldtime-media");
      const key = typeof body.key === "string" ? body.key : "";
      const objectId = `${bucket}/${key}`;
      switch (body.operation) {
        case "sign-upload":
          return Response.json({
            token: "fixture-upload-token",
            signedUrl: `${origin}/fixture-upload/${encodeURIComponent(objectId)}?token=fixture-upload-token`,
            path: key,
          });
        case "sign-read":
          return Response.json({
            signedUrl: `${origin}/fixture-read/${encodeURIComponent(objectId)}?token=fixture-read-token`,
          });
        case "info": {
          const stored = objects.get(objectId);
          return Response.json({
            info: stored ? { size: stored.body.length, contentType: stored.contentType } : null,
          });
        }
        case "copy": {
          const source = objects.get(`${bucket}/${String(body.sourceKey)}`);
          if (!source) return Response.json({ error: "Source object not found." }, { status: 502 });
          objects.set(`${bucket}/${String(body.targetKey)}`, {
            body: Buffer.from(source.body), contentType: source.contentType,
          });
          return Response.json({ ok: true });
        }
        case "remove":
          for (const keyToRemove of Array.isArray(body.keys) ? body.keys : []) {
            objects.delete(`${bucket}/${String(keyToRemove)}`);
          }
          return Response.json({ ok: true });
        case "bucket-info":
          return Response.json({ bucket: { id: bucket, name: bucket, public: false } });
        case "create-bucket":
          return Response.json({ ok: true });
        default:
          return Response.json({ error: "Unsupported fixture operation." }, { status: 400 });
      }
    }

    const prefix = url.pathname.startsWith("/fixture-upload/") ? "/fixture-upload/"
      : url.pathname.startsWith("/fixture-read/") ? "/fixture-read/" : null;
    if (!prefix) return new Response("Not found", { status: 404 });
    const objectId = decodeURIComponent(url.pathname.slice(prefix.length));
    if (prefix === "/fixture-upload/" && method === "PUT") {
      const bytes = Buffer.from(await new Response(init?.body).arrayBuffer());
      objects.set(objectId, { body: bytes, contentType: new Headers(init?.headers).get("content-type") || "application/octet-stream" });
      return new Response(null, { status: 200 });
    }
    const stored = objects.get(objectId);
    if (!stored) return new Response("Not found", { status: 404 });
    if (method === "HEAD") {
      return new Response(null, { headers: { "Content-Type": stored.contentType, "Content-Length": String(stored.body.length) } });
    }
    if (method === "GET") return new Response(stored.body, { headers: { "Content-Type": stored.contentType } });
    return new Response("Method not allowed", { status: 405 });
  }) as typeof fetch;

  function restore() {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key]!;
    }
  }

  return {
    restore,
    seed(bucket: string, key: string, body: Buffer, contentType: string) {
      objects.set(`${bucket}/${key}`, { body: Buffer.from(body), contentType });
    },
  };
}
