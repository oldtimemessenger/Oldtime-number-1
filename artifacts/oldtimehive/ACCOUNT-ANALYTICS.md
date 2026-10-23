# Account types, analytics and revenue readiness

## Implemented scope

Old Time remains the existing mobile-first website. No native app, payment processor, paid analytics vendor, creator payouts or simulated membership purchases were added.

Settings contains Account Type, the account's appropriate activity dashboard, Blue Badge, and (for Creator accounts) Creator Center. Creator Studio/Business Dashboard/Your activity is available from the appropriate own profile and account menu. Creator Center and Blue Badge shortcuts were removed from those two locations. Primary creator and account-tool buttons use the existing red direction; selection and navigation colors remain neutral.

Personal is the database default, including existing accounts through additive migration. Creator and Business switches are free, preserve the existing user ID and all unrelated profile/social/privacy/payment data, and require an appropriate category before confirmation. Professional metadata is persisted; public figures are Creator categories. Classification, creator recognition, membership and future earning eligibility remain independent.

## Data and authorization

Development-only additive migrations:

- `lib/db/migrations/revenue-readiness.sql`: entitlement lifecycle, store subscription bindings/event idempotency, private creator originals/media and actual persisted public-post comments.
- `lib/db/migrations/account-analytics.sql`: user classification/professional metadata, owner-controlled analytics resources, server-timed playback sessions, deduplicated activity events, daily aggregates and recorded follow relationships.

No historical financial tables or records are removed. No migration runs at application startup. Production database linkage/schema is not verified; do not assume the preview database is the published database.

Authenticated `/account/professional` updates only the current account's classification/professional fields. Unknown keys, unsupported categories and unsafe website URLs are rejected. It cannot set roles, paid membership or creator approval.

Creator Center/evaluation/new original uploads require the server-stored Creator type. Business and Creator analytics modes require the matching stored classification. Personal analytics is own-account only. Content insights require ownership; session progress requires the session's authenticated actor. No dashboard endpoint accepts an arbitrary reporting owner ID. Administrator routes retain their independent existing administrator checks.

## Actual measurements and limitations

- Profile visits: one signed-in visitor/profile/30-minute window, excluding self. No visitor identity list is exposed.
- Image/text content: at least two visible, loaded seconds.
- Native video elements: three seconds of actual playback, or a completed shorter known-duration video. Opening a player, failed autoplay, buffering, seeking forward, hidden tabs and self-views do not qualify as views.
- Story plays: one qualifying play per account per Story; repeated opens do not inflate it. Device-only counts are labelled as such; available owner-authorized shared counts come from persisted reports.
- Other content views: one per viewer/content/30-minute window. Unique viewers are distinct signed-in qualifying viewers in the selected UTC range.
- Likes/comments/shares/saves: positive recorded interactions, at most one actor/content/action per UTC day. These are activity counts, not a replacement for the current post's social state. Removing a like does not erase its historical interaction.
- Follow/unfollow: actual public-follow transitions recorded by authenticated accounts, not client-supplied follower totals. Existing device-only follower history is preserved but not imported as measured analytics.
- Watch time: measured video playback seconds. Completion requires a known duration and an actual end signal with sufficient measured watch time.
- Retention: watched-duration fractions across at least ten measured starts with known duration; **not precise playhead-position retention**.
- Audience activity: actual activity of recorded followers, UTC day/hour buckets, suppressed unless a bucket contains at least ten distinct people. Demographics are unavailable.
- Growth: comparisons with a preceding equal-length measured period only when its baseline has at least ten observations. Ranking is explicitly limited to displayed measured content.

Reports support 7/28/90-day and custom ranges up to 90 days, interactive metric charts, content filters/sorts, twenty-item pagination, own-content details and honest empty/error states. No invented historical counts, locations, ages, financial balances or recommendations are supplied.

Private/Close Friends content is not made public for analytics. Its registration contains generic “Private content” metadata rather than private captions; remote playback measurement is unavailable without a trusted shared audience. Private media uploads occur only through the explicit originals sync. That archive is eligibility proof, not a complete social sync or restorable creative-project backup. Server byte/signature/hash validation and duplicate detection do not certify copyright/authorship.

Raw events/playback sessions retain 120 days; daily summaries retain two years. User foreign keys remove raw actor/owner records on backend account deletion. Browser tracking failures do not block social actions. Client telemetry remains observational and is never proof for financial transactions or payouts.

## Main changed components

- Shared schema/API: `lib/db/src/schema/{accounts,analytics,creator-content,creator-program}.ts`, migration files, OpenAPI and generated clients/validators.
- Account classification: server `lib/account-professional.ts`, `routes/account-professional.ts`; frontend `app/account-professional.js` and CSS.
- Analytics: server `lib/analytics-{events,report}.ts`, `routes/analytics-{events,report}.ts`; frontend `app/activity-tracking.js`, `app/studio-charts.jsx`, and focused social-action hooks.
- Originals/comments: creator-content routes/storage/cleanup, frontend sync and persisted comments modules.
- Membership: lifecycle presentation, configurable offers/distribution URLs, Blue Badge UI and server-only future verified-store boundary.
- Navigation/profile/Settings integration: existing `app/app.js`; creator button styles and placement regression checks.

## Six-part revenue-readiness report

1. **First legitimate purchase flow:** one native store subscription on the first authorized, approved mobile platform. Neither can be activated in this website today. An already production-approved store account would determine which is fastest; account readiness is not known. For a new personal Google Play account, production access includes at least twelve continuously opted-in closed-test participants for fourteen days; Apple has its own enrollment and app/product review requirements, so approval speed cannot be guaranteed.
2. **Still required:** explicit authorization to build mobile; Apple Developer/App Store Connect and/or verified Google Play Console enrollment; correct legal entity and paid-app/payment/tax/banking agreements; app identifiers/signing; approved localized subscription products and store-confirmed trial/returning offers; server verification credentials through secrets; authenticated store notification configuration; testing/review; actual published store URLs and verified universal/app-link domain association.
3. **Future code changes:** native StoreKit 2 or Play Billing purchase/pending/cancellation/restore UI; genuine server adapters implementing the verified-store boundary; authenticated Apple/Google lifecycle notifications, durable account binding and idempotency tests; native verified app links and published distribution settings. Existing shared website membership reads the verified entitlement; it must not add web checkout.
4. **Available now:** the existing web social experience, account switching, separate measured dashboards, creator progression/private originals and membership information/interest registration in preview, subject to verification below. A public update additionally needs a verified deployed database/schema and a successful release build; this report does not assert that unpublished preview changes are already live.
5. **Prevents payment today:** no authorized native build, published store app/product, installed purchase SDK, genuine store verification adapter, notification integration or tested purchase/restore flow. Website buttons remain unavailable without real links. No browser flag or administrator configuration can manufacture paid access.
6. **Shortest safe path:** finish/verify the website and its production database linkage; receive authorization for one mobile platform; register one monthly Blue Badge product and eligible offers; implement that platform's real purchase and restore flow against the shared authenticated backend; verify lifecycle notifications and account binding; test sandbox and approved production release; publish the genuine store link. Only a successful production store transaction is revenue. Sandbox and interest requests are not revenue.

The user's latest product decision supersedes prior proposed prices: Blue Badge is planned at $2.99/month, with a gift-sender discount planned for the next two eligible monthly charges. Apple and Google subscriptions will use RevenueCat when billing work resumes. Billing integrations remain deferred; web billing is not selected, and no purchase, gift, discount or revenue is active.

Official requirements:

- Apple subscriptions: https://developer.apple.com/app-store/subscriptions/
- Apple agreements: https://developer.apple.com/support/terms/
- Google personal-account testing: https://support.google.com/googleplay/android-developer/answer/14151465
- Google subscription lifecycle: https://developer.android.com/google/play/billing/lifecycle/subscriptions

## Environment/costs

Analytics uses the existing PostgreSQL database and existing Recharts dependency. No additional analytics vendor, subscription processor or secret is required for account switching/reporting. Existing private object storage is used for explicitly synced media, with a 512 MB per-account archive cap, 25 MB per file, short-lived reservations and cleanup retry. The storage adapter can use managed storage or standard Google Cloud Storage/application-default credentials; the product data model is not tied to the hosting platform.

## Verification

Shared code generation and API type checking passed. The production frontend build passed. Workflow startup was checked. Account/classification/analytics security and private original flows receive a focused authenticated browser check; its final result is reported separately.

The initial existing suite had 81/84 passes. Two assertions still expected the old drawer placement/web restore-button wording and were updated to the user's new placement/native-only restoration requirements. The unrelated camera-gallery browser test timed out; no unrelated camera implementation was changed.
