# Oldtime

Mobile-first social app: vertical video, photos, carousels, text posts, stories, and chat.

Run the app and its API from the workspace root in separate terminals:

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/oldtimehive run dev
```

Use the URL printed by the frontend server. The API needs the existing PostgreSQL connection. Frontend and API builds are independent of Replit.

Create a real account through the API, or sign in to an existing account. There are no sample-account login buttons or automatic account creation after a failed login. Portable Cognito Managed Login integration uses authorization-code flow with PKCE. Development now references the replacement pool, but Cognito remains disabled until its new web app client ID is supplied and live sign-in is tested. See [Cognito configuration](../../docs/cognito-configuration.md) for required variables, AWS callback/sign-out settings and separate production configuration. Cognito email verification and password recovery are not yet live-tested.

The API persists accounts, sessions, public text posts, likes and professional-account data in PostgreSQL. Many other social features still use browser storage under `oldtime-v1`; that is a launch blocker, not a completed multi-user backend. Preserve existing users' data during the server migration.

See [the readiness audit](../../docs/production-readiness.md) for verified checks, incomplete features and configuration requirements. This app is not ready for a public launch.

## Install on a phone

The app can be added to a phone's home screen as a progressive web app (PWA). Service workers require HTTPS, except on localhost; opening `index.html` directly as a file does not enable installation or offline caching.

- On iPhone or iPad, open the HTTPS site in Safari, tap Share, then choose **Add to Home Screen**.
- On Android, open the HTTPS site in Chrome and choose **Install app** or **Add to Home screen** from the browser menu.

The production service worker caches the app shell. Development removes old shell caches to avoid stale previews. Browser-local content and drafts do not synchronize across devices; externally hosted resources may not be available offline. A PWA is still a website and does not create App Store or Google Play listings.

## Icons, emoji, and screens

Interface controls use shared SVG icons in `app/icons.js`. Emoji pickers retain categories, recent selections, favorites, flag search and cursor insertion, without skin-tone choices. Emoji use Apple-first typography with platform fallbacks; appearance can vary by platform.

Camera and Studio preserve the existing editing tools. Save & Exit retains original media bytes and edit state in owner-scoped IndexedDB drafts without publishing. Draft storage failures leave the editor open. Camera uploads accept up to ten photos/videos, each no larger than 25 MB; other composers have their own limits.

## Production status

Registration and sign-in use server-hashed passwords and expiring, server-checked sessions. Cached local passwords cannot authorize sign-in. Existing legacy browser records are preserved for migration and may still contain old account data; preserving them is not proof of server synchronization.

Profiles, friendships, restricted-content audiences, stories, chat, reports and several content interactions still need complete server-backed persistence and authorization. Browser-only privacy filters and local “sent” states are not sufficient for independent users. Public broadcast Live is not exposed; existing direct-call tools remain.

The S3 media adapter requires `MEDIA_OBJECT_BUCKET`, `AWS_REGION` (or `AWS_DEFAULT_REGION`) and server-side AWS credentials or an IAM role. The intended bucket must support versioning. Optional `MEDIA_OBJECT_PREFIX` and `S3_ENDPOINT` settings support existing storage arrangements. No AWS resources have been provisioned or live S3 uploads certified.

Production API CORS is explicit: configure `CORS_ALLOWED_ORIGINS` for cross-origin clients. Same-origin clients do not need CORS authorization. API responses use security headers, bounded request bodies, no-store caching and sanitized errors. These safeguards do not replace the remaining access-control audit.

Checks: `pnpm run typecheck`, `pnpm --filter @workspace/oldtimehive run test`, and `pnpm --filter @workspace/api-server run test`. Both packages provide `build` scripts. Physical iOS/Android and intended AWS-environment testing remain required.

## Calls and voice notes

Voice notes use the microphone and MediaRecorder. One-to-one calls use native browser WebRTC for peer-to-peer media and authenticated Socket.IO signaling through the Oldtime API. Google public STUN is used for connection discovery; TURN is not configured by default and can only be added through explicit, unexpired relay configuration. The app does not use an SFU, recording service, or paid calling SDK. Direct ICE restart requests use the same signaling connection to recover from temporary network changes. Calls still require real cross-device tests on cellular, home Wi-Fi, restrictive networks, and VPNs before reliability can be claimed.

Test independent accounts in separate browser contexts/devices through real registration and sign-in, not sample identities or copied browser state.
