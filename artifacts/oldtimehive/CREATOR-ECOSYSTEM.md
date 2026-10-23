# Creator ecosystem

Creator Center, Blue Badge and Notifications & Announcements are available through the app menu, own profile and Settings. Normal posting stays free.

## Working now

- Server-side creator eligibility from persistent account, original text-post and interaction records.
- Initial criteria: 14-day account age, complete account identity fields (display name, username and email), five qualifying original posts, ten active posting/interaction days in the last 14 days, engagement from 20 distinct established accounts, interactions with five other established authors, and good account standing.
- Qualifying posts have at least 20 characters and three words. Normalized duplicate text and self-interactions do not increase eligibility; interaction partners must be at least seven days old. Imported timestamps cannot fabricate historical active days.
- A valid, server-verified Apple/Google membership is required for Approved Creator status. Expiration/revocation pauses that status; verified renewal restores it. Paid membership never bypasses eligibility or restrictions.
- Server-persisted progression, approval history, milestones, badge-launch interest, targeted announcements, dismissal cooldowns and notification preferences.
- One optional automatic announcement per account per browser session; none during calls, editing, message composition, or account actions. Essential safety/service notices cannot be permanently suppressed.
- Configurable thresholds, campaign schedules, feature flags and proposed membership pricing. Admin routes require a separately granted role; signup never grants administration.

## Explicitly not activated

This workspace includes the existing web app and a separate Expo mobile app. Apple/Google purchase and restore are not connected; the user selected Apple and Google subscriptions managed through RevenueCat for the future app billing path. Web billing is also deferred. Checkout is disabled and no user is charged. No API or administrative action can manufacture a membership entitlement.

Future native billing must validate Apple/Google transactions on the server and update the entitlement expiry/revocation fields. No client flag, purchase button tap, or historic Stripe record can grant membership.

Creator earnings, financial ledgers, payout onboarding and withdrawals are not implemented. Existing Stripe records and secrets are preserved; Stripe is not used by this system.

The requested planned standard price is $2.99/month. Membership gifts and a 50% discount on the sender's next two eligible monthly charges after a qualifying gift are not active. Actual store pricing, billing terms, gift eligibility, discount support and cancellation flow must be confirmed with connected billing providers before any purchase flow is activated.

## Database and administration

The additive, idempotent migration is `lib/db/migrations/creator-ecosystem.sql`. It was applied to development only. Apply it to the deployment database before publishing these server routes. It does not drop or change historical payment tables.

To grant or revoke access to an existing online account, the workspace owner can run:

```
pnpm --filter @workspace/scripts run creator-admin --grant <username>
pnpm --filter @workspace/scripts run creator-admin --revoke <username>
```

The Creator Center then exposes Creator admin. Its configuration editor cannot enable billing or payouts. Never grant administration through public registration or a browser flag.
