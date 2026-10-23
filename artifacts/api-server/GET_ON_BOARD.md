# Get On Board — participation contract

An entry belongs to its collection. Publishing it does not create a feed post or
Story automatically. Public sharing is a separate explicit choice. Private and
invite-only collection permissions are checked on every read, media request and
mutation, regardless of how a link was received. All endpoints require the
existing Oldtime bearer session. No paid service or new storage provider.

Client: existing `requestCloudApi(path, options)` in app/store.js; JSON body is an
object (not an encoded string), raw uploads use `rawBody` and `contentType`.
`responseType: "blob"` returns authenticated media bytes for object-URL previews.

- GET `/api/boards?sort=newest|popular|for_you&category=...&q=...&offset=0`
  → `{boards: Board[], hasMore}`. Bounded pages of 20, real counts only.
- POST `/api/boards` body `{prompt,format,category,visibility,rules,commentsEnabled}`
  → Board. Formats photo/video/text/mixed; categories creative/sports/music/places/friends/funny;
  visibility public/invite_only/private. Default invite_only.
- GET `/api/boards/:id` → `{board: Board, entries: Entry[], hasMore}`.
  Supports `sort=newest|popular|surprise&offset=0&mine=true`, pages of 24.
- PATCH `/api/boards/:id` owner only `{status?:open|closed,rules?,commentsEnabled?}`.
- DELETE `/api/boards/:id` owner only; removes collection, entries, associated
  feed links and media files, not unrelated content.
- POST `/api/boards/:id/invites` owner only `{userIds:[canonical account UUIDs]}`.
  Search actual people using `/api/users/search?query=...`. Max 20 per request.
- POST `/api/boards/:id/entries`: JSON `{id:clientUUID,caption}` for text; JPEG/MP4/
  WebM raw bytes with `?id=clientUUID&caption=...` for media, max 30MB. Convert
  other photo formats to JPEG in browser. Creates Entry; retry same UUID is
  idempotent. Collection must be open; rejects wrong format. No automatic posts.
- GET `/api/boards/:id/entries/:entryId` → Entry, including own removed originals.
- GET `/api/boards/:id/entries/:entryId/media` → authenticated image/video bytes,
  correct MIME and HTTP Range support. Never put session tokens in image URLs.
- DELETE `/api/boards/:id/entries/:entryId` author only; deletes original/file/links.
- PATCH `/api/boards/:id/entries/:entryId` owner only `{removed?:boolean,pinned?:boolean}`.
  Removal from collection is not deletion of an author's original.
- PUT/DELETE `/api/boards/:id/entries/:entryId/like` → `{likes,likedByMe}`.
- GET/POST `/api/boards/:id/entries/:entryId/comments` → `{comments:[{id,text,
  createdAt,author,canDelete}]}` / Comment; POST body `{text}`, enabled boards only.
- DELETE `/api/boards/:id/entries/:entryId/comments/:commentId` author/board owner.
- POST `/api/boards/:id/report` `{target:"board"|entryUUID,reason}`.
- GET `/api/boards/:id/reports` owner only → actual report list.
- PUT/DELETE `/api/boards/blocks/:userId` → hide/block within Get On Board.
- POST `/api/boards/:id/entries/:entryId/share` author only `{href}` → `{postId}`.
  Public boards only; creates an idempotent **link to the original entry** in the
  existing feed, not duplicate media. Other destinations share the same gated
  deep link `?board=<id>&entry=<id>`.

Board: `{id,creatorId,prompt,format,category,visibility,status,rules,commentsEnabled,
createdAt,creator:{id,username,displayName},entryCount,participantCount,canManage}`.
Entry: `{id,boardId,userId,caption,mediaType,mime,removed,pinned,createdAt,
author:{id,username,displayName},likes,likedByMe,canDelete,canManage,mediaPath}`.
No object-storage keys, email, private account settings or raw GPS in DTOs.

Advanced paid tools, scheduling, co-moderators and business sponsorships are not
part of the launch core. Never label seeded examples as real trending activity.
Friends/followers/community-only ACL needs canonical server relationships before
offering that restriction; use real invitations meanwhile.
