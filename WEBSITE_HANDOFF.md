# Oldtime Website handoff

## Build and assets

From the repository root:

```sh
pnpm install --frozen-lockfile
node scripts/audit-website-assets.mjs
pnpm --filter @workspace/oldtimehive run build
```

Serve `artifacts/oldtimehive/dist/public` as the website. Keep the workspace
package files, lockfile, shared libraries, website source, its entire `public`
directory, and root install/PWA icons together. Vite copies public assets into
the output. Do not ship only the HTML or only the app folder without shared dependencies.

If the development environment is under memory pressure, the same production
build can be run with a bounded Node heap:

```sh
cd artifacts/oldtimehive
node --max-old-space-size=512 node_modules/vite/bin/vite.js build --config vite.config.ts
```

Reference screenshots, unused avatar models, test uploads, local databases,
credentials, browser-local drafts and development caches are not website assets
and must not be copied into a public repository.

## Connecting the backend

The current client uses the same-origin `/api` interface. Route it to the API
server on the destination host. Retain the existing authentication and database
configuration; moving the frontend does not migrate user accounts or data.

Sports uploads support portable storage. Filesystem production hosting requires
`SPORTS_MEDIA_DIR` on a durable volume. Other supported storage drivers must be
configured explicitly. Do not use a temporary container directory or silently
switch to Replit storage. Migrate existing uploaded files separately from source code.

Chat's `installChatTransport` entry point accepts an authenticated adapter:

- `send({conversationId, message})` returns `{accepted: true}` only after server acknowledgement.
- `subscribe({conversationId, onTyping, onReceipt, onError})` returns an unsubscribe function.
- Typing callbacks contain `{userId, typing, expiresAt}` records.
- Receipt callbacks contain `{messageId, userId, status: "delivered" | "read"}`.
- Optional `typing({conversationId, typing})` and `markRead({conversationId, shareReceipts})` send genuine events.

Enforce membership, actor identity, blocking and receipt consent on the server.
Use message IDs for idempotency, reconcile pending messages on reconnect, and
upload attachment blobs before sending portable media references. Never send
browser-only `blob:` URLs as permanent media URLs.

Without that connection, chat messages remain pending. Story comments/settings,
message bookmarks and portions of social state remain browser-local. Story
reactions are currently visual interactions, not verified remote delivery.
Connect and test those services before treating the website as a multi-user launch.

## Release gate

Review changes in chat before creating a commit or pushing to the new
`Oldtime-Website` GitHub repository. The user approved a private repository and
the reviewed source snapshot: https://github.com/oldtimemessenger/Oldtime-Website.
That source handoff is separate from production publication or backend connection.

After connection, verify authenticated mobile and desktop flows, media upload
and playback, Get On Board permissions, saved messages, Story comment settings,
typing and receipts. A build and unit tests alone do not establish production readiness.
