# Markazify setup

A pnpm + turbo monorepo: five Next.js apps, shared packages and two storefront themes.

| App | Folder | Package | Port |
| --- | --- | --- | --- |
| Storefront (shopper site, BFF) | `apps/storefront` | `@markaz/storefront` | 3000 |
| Seller frontend (dashboard) | `apps/seller/frontend` | `@markaz/seller-portal` | 3002 |
| Seller backend (API, seller DB) | `apps/seller/backend` | `@markaz/seller-backend` | 4001 |
| Admin backend (API, platform DB) | `apps/admin/backend` | `@markaz/admin-backend-next` | 4010 |
| Admin frontend (operator console) | `apps/admin/frontend` | `@markaz/admin-frontend` | 4020 |

Shared code is in `packages/*` (auth, contracts, db-schemas, billing, platform-kit, storefront-data, sync-core and others).
The themes are in `themes/stiletto` and `themes/mustafa`.

## 1. Install

- Node 22 or newer (the seller backend requires `>=22`), pnpm 9 (`packageManager: pnpm@9.12.0`; `corepack enable` gives the right one).
- `pnpm install` in the repo root.

## 2. Environment files

Each app reads its own `.env` (git-ignored). Copy the example next to it and fill it in. Never commit real values.

| App | Copy | Must be set to start |
| --- | --- | --- |
| Storefront | `apps/storefront/.env.example` -> `.env` | `SELLER_BACKEND_API_URL`, `STOREFRONT_DATA_SOURCE=remote` |
| Seller frontend | `apps/seller/frontend/.env.example` -> `.env` | `SELLER_BACKEND_API_URL` |
| Seller backend | `apps/seller/backend/.env.example` -> `.env` | `SELLER_MONGODB_URI`, `SELLER_AUTH_SECRET` |
| Admin backend | `apps/admin/backend/.env.example` -> `.env` | `MONGODB_URI`, `ADMIN_AUTH_SECRET` |
| Admin frontend | `apps/admin/frontend/.env.example` -> `.env` | `ADMIN_BACKEND_API_URL` |

Every other variable is optional for local work. The feature it belongs to stays off until you set it: card payment,
preview links, cache purge, sync, Cloudinary uploads, email. Each example has a one-line comment for every variable.

### Sprint 4 variable names (fixed: later batches rely on them)

| Name | Where | Meaning |
| --- | --- | --- |
| `EMAIL_PROVIDER` | seller backend, admin backend | `resend`, `smtp` or `log`. Empty or `log` keeps each message in the outbox as `skipped` (development). |
| `EMAIL_FROM` | seller backend, admin backend | Sender address on a domain verified with the provider. |
| `RESEND_API_KEY` | seller backend, admin backend | Resend key when `EMAIL_PROVIDER=resend`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | seller backend, admin backend | SMTP settings when `EMAIL_PROVIDER=smtp`. |
| `OUTBOX_CRON_SECRET` | seller backend, admin backend | Bearer secret for the internal outbox retry route (EP-07.US01.T02). |
| `UNSUBSCRIBE_SIGNING_SECRET` | seller backend | Signs the unsubscribe link of broadcast emails (EP-07.US04). 16 characters or more. Without it a broadcast cannot be sent (503) and every unsubscribe link answers 404. |
| `CARD_CHECKOUT_ENABLED` | seller backend (listed in the storefront example, never read there) | Sprint 5 COD-only mode (D-107). Card checkout is offered to shoppers only when this is `true` or `1` and the Stripe values are set; unset or any other value keeps card off everywhere. Stripe stays for seller billing. **Changing it takes up to 300 seconds to show on a storefront** (SB-6, D-113): the storefront caches each store's answer for `STORE_REVALIDATE_SECONDS` = 300 (`apps/storefront/lib/api/stores.ts`), so after the switch goes off a shopper can still be offered card until the cache is revalidated or the wait ends. The order route refuses card at once (422 `PAYMENT_METHOD_UNAVAILABLE`), so nothing is charged; restart the seller backend, then wait up to 5 minutes (or revalidate the store). |
| `PLATFORM_DEFAULT_COMMISSION_PERCENT` | seller backend, admin backend | Platform default commission in percent. The placeholder is 5; the owner sets the real value (A-019). |
| `SUBSCRIPTION_STRIPE_ENABLED` | seller backend, admin backend | Sprint 6 (D-118): `true` or `1` turns Stripe subscriptions on; empty or anything else (the default) keeps them off. See Plans and subscriptions. |
| `COD_COMMISSION_PERCENT` | seller backend | Sprint 6 (D-116): commission percent on cash-on-delivery orders, used only while the platform settings document is not in the seller database. Empty or `0` (the default) means COD carries no commission; a store's own rate never applies to COD. A COD order is still written to the ledger at 0 percent (rate 0, balance effect 0). The admin console setting `codCommissionPercent` wins when present. |
| `SELLER_MAX_STORES` | seller backend, admin backend | Stores per seller when no seller override, plan limit or platform setting applies (default 3). The seller backend enforces it; the admin backend only reads it to show a seller's effective limit in the Store limit dialog, so give both the same value. |
| `APP_BASE_URL_SELLER` | seller backend, admin backend | Seller portal base URL for links in emails. |
| `APP_BASE_URL_ADMIN` | admin backend | Admin console base URL for operator password-reset links (Sprint 4 EP-08). |

### Platform settings added in Sprint 6 (admin console, Settings; no environment variable)

Each change needs a reason, is audited, advances the settings revision and is sent to the seller backend. The bootstrap script
(`scripts/bootstrap-admin-data.mjs`) seeds `codCommissionPercent` 0, `graceDays` 7 and `trialDays` 0 on a new database.

| Setting | Range | Default | Meaning |
| --- | --- | --- | --- |
| `codCommissionPercent` | 0 to 100 | 0 | Commission on cash-on-delivery orders (D-116). The default rate and a store's own rate apply to gateway (card) orders only. An entry already written is never rewritten when this changes. |
| `paymentInstructions` | text, at most 1000 characters | none | How a seller pays a subscription by hand (bank, JazzCash, Easypaisa). Plain text, escaped wherever it is shown. |
| `graceDays` | 0 to 30 | 7 | Days a lapsed subscription keeps its plan limits before it falls back to Free. |
| `trialDays` | 0 to 60 | 0 | Days of a free trial on a paid plan. |
| `supportEmail`, `supportPhone` | email, phone (at most 30 characters) | none | Where sellers can reach the platform about a subscription payment. |

The seller's store limit is resolved in this order: the seller's own override (admin, with a reason) first, then the plan limit
(EP-14, once built), then the platform setting `maxStoresPerSeller`, then `SELLER_MAX_STORES`, then 3.

## Plans and subscriptions

Plans are **data**, not code (D-118). They live in the `subscriptionPlans` collection of the shared database and are edited in the admin
console under Subscriptions. Money is whole rupees; a limit left empty is unlimited (`null`).

**Seed.** `pnpm bootstrap:admin -- --apply` (see the bootstrap section above) creates two plans, each only when no plan has its key, and never
touches a plan that exists, so an edit made in the console survives every later run:

| Key | Price | Stores | Products | Staff seats | API keys | Custom domain | Premium themes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `free` | Rs 0 | 1 | 10 | 0 | 0 | no | no |
| `growth` | Rs 2500 / month | 3 | unlimited | 3 | 3 | yes | yes |

The Free and Growth price, product limit, custom domain and themes must match `apps/storefront/content/marketing/pricing.ts`; a test fails if
they drift. Change the marketing file only with the owner's approval.

**Index.** The plan key is unique (index `plan_key_unique`, partial: plans from before Sprint 6 have no key). The seller and admin backends
build no index at runtime, so run `pnpm ensure:indexes -- --apply` once after deploying (dry run first, without `--apply`).

**Edit plans in the console.** Subscriptions, New plan / Edit / Archive. Every change needs a reason, is audited (`plan.create`,
`plan.update`, `plan.archive`), and is conditional on the revision you loaded: if someone else saved first the console says so and nothing is
overwritten. The key cannot change. Archiving takes a plan off sale and is the only removal: nothing is ever deleted, and sellers already on
the plan keep it. The Free plan cannot be archived: it is what every seller falls back to when a subscription expires. A plan from before
Sprint 6 (name, Stripe price and tier only) is listed as "Old plan"; edit it to give it a price and limits.

**What sellers see.** `GET /api/plans` on the seller backend (and `/api/dashboard/plans` in the seller dashboard) lists the active plans with
their public fields only: key, name, price, interval, limits, features, sort order. Never the Stripe price id or the revision.

**Subscriptions and limits (Sprint 6).** A seller has at most one subscription (`subscriptions`, unique on `seller`; run `pnpm ensure:indexes -- --apply`
once after deploying). The limits that are enforced are those of the plan the seller is *effectively* on, worked out from the dates on every request:
trial, active and grace give the subscribed plan's limits; expired, cancelled past its period, no subscription, or a plan that no longer exists give the
Free plan's (1 store, 10 products per store, 0 staff seats, 0 API keys). If the Free plan document is missing the same limits are built in and one
line is logged. A seller's own store limit (set by an admin in Sellers, Store limit) wins over the plan for stores. Only an ADD is refused, with
`403 PLAN_LIMIT_REACHED` (product create, import rows that create, duplicate, restore from trash, new store); editing, publishing and deleting never are,
and a seller already over a limit keeps everything.

**Expiry job.** `POST /api/internal/subscriptions/expire` on the seller backend, with the `OUTBOX_CRON_SECRET` (`x-cron-secret` or `Authorization: Bearer`),
moves the stored status along the calendar: trial to expired, active to grace at the period end (`graceDays`, default 7), grace to expired at
`graceUntil`, cancelled to expired. It is a **dry run unless the body is `{"apply": true}`** (a GET never applies); it answers counts only, one audit line
per applied change. Run it daily, first as a dry run. The limits do not wait for it.

**Payment is manual first.** A seller pays a plan by bank transfer, JazzCash or Easypaisa (the instructions are the `paymentInstructions`
platform setting) and an admin marks it paid. Nothing in this section charges a card.

**Stripe subscriptions are off.** The Stripe subscription code stays in the repository behind `SUBSCRIPTION_STRIPE_ENABLED` (default off; only
`true` or `1` turns it on). While it is off:

- `POST /api/billing/checkout` on the seller backend and `POST /api/internal/stripe/checkout-session` on the admin backend answer
  `404` with the code `SUBSCRIPTION_STRIPE_OFF`;
- the admin Stripe webhook acknowledges `customer.subscription.created`, `customer.subscription.updated` and subscription checkout sessions
  with `200` and ignores them (CO-62: a subscription session used to answer `500` and Stripe retried it for days). A storefront card order
  checkout is handled exactly as before.

Set the same value on both backends. Leave it empty until the owner decides to take subscriptions by card.

### Manual subscription payments: runbook (Sprint 6, S6-B4)

Payment is by hand (bank, JazzCash, Easypaisa); no gateway is involved.

1. **Set up once.** In Settings fill `paymentInstructions` (plain text, shown to sellers), `supportEmail` (the address that is emailed when a seller says "I paid"),
   `graceDays` (default 7). Run `pnpm ensure:indexes -- --apply` once per database: it builds the unique partial index `seller_open_unique` on
   `subscriptionPayments` (one open payment per seller).
2. **Seller flow.** Billing page: Upgrade (the server writes the amount = the plan's price) -> pay outside the platform -> "I have paid" (method, reference, optional https receipt link).
3. **Who confirms.** Any admin, in the console under Subscription payments (until the admin levels of S6-B6: then owner and finance confirm, owner voids a confirmed payment).
   Check the money is in the account, tick the box, give a note, Confirm. The plan is active for one month (a renewal while active extends from the current period end).
   A double confirm has one effect; the second click is a 409. Reject needs a reason (5+ characters) and the seller is emailed it. Void takes a confirmed payment back only while nothing else changed the subscription.
4. **Grace and expiry.** The expiry job (section 7) runs daily with `{"apply": true}`. It emails "ending in 7 days" once per period, moves an unpaid period to grace for `graceDays`,
   then to expired (Free limits, nothing deleted) and emails "expired" once. A downgrade the seller asked for (pending plan) is applied at the period end: Free at once,
   a cheaper paid plan as grace until its price is paid. Cancel at period end skips grace. Cancel wins over a pending downgrade.
5. **Carry-over.** Automatic charging of subscriptions comes with the payment-gateways epic; Stripe subscription code stays behind its flag.

### Sprint 3 deploy variables (still required for those features)

`ORDER_ACCESS_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_ORDER_WEBHOOK_SECRET`, `STOREFRONT_URL`, `CLIENT_ADDRESS_SIGNING_SECRET`
(the same value on the storefront and the seller backend), `TRUSTED_PROXY_HOPS` or `TRUSTED_CLIENT_IP_HEADER` (on both),
and `REVALIDATE_SECRET` (the same value on the storefront and the seller backend).

### Removed in Sprint 4

`SELLER_NEW_STORE_STATUS` is no longer read (CO-26, EP-04.US06): every new store starts `pending` and goes live
through the readiness checklist. Delete it from any environment that still has it.

## 3. A throwaway database

- Unit tests never touch a database: every model is stubbed in the test file.
- To run the apps, use a local `mongod` (for example `mongodb://127.0.0.1:27017/markaz_throwaway_dev`) or a
  throwaway Atlas database. Put the SAME database in `SELLER_MONGODB_URI` and `MONGODB_URI`, as production does (see
  "One shared database"). Never point a local app at a production database.
- Name every throwaway database with `throwaway` or `test` in it (for example `markaz_throwaway_seller`). The smoke script
  (`scripts/smoke`, EP-06.US06) refuses any other name; it looks at the database name only.
- Drop the database when you are done.

## 4. Run

| What | Command |
| --- | --- |
| Everything (turbo) | `pnpm dev` |
| Storefront | `pnpm dev:storefront` |
| Seller frontend | `pnpm dev:seller-portal` |
| Seller backend | `pnpm dev:seller-backend` |
| Admin backend | `pnpm dev:admin` |
| Admin frontend | `pnpm dev:admin-frontend` |
| Type-check every workspace | `pnpm typecheck` (turbo `type-check`, `tsc --noEmit` per workspace, `--continue` so every failure is listed) |
| Type-check, without turbo | `pnpm type-check:all` |
| Lint (where a lint script exists) | `pnpm lint` |
| All tests | `pnpm test` |
| One workspace's tests | `pnpm --filter @markaz/seller-backend test` (same for `@markaz/admin-backend-next`, `@markaz/admin-frontend`, `@markaz/auth`, `@markaz/contracts`, `@markaz/db-schemas`, `@markaz/billing`, `@markaz/platform-kit`, `@markaz/storefront-data`, `@markaz/sync-core`, `@markaz/api-compat`, `@markaz/notifications`) |
| Builds | `pnpm build`, or `pnpm --filter <package> build` |

Tests use Node's built-in runner through tsx (`node --import tsx --test "test/**/*.test.ts"`). The storefront-data
package runs `node test/run-checks.mjs`.

A storefront build without a running backend: `STOREFRONT_DATA_SOURCE=remote` with `SELLER_BACKEND_API_URL` set to a
dummy URL. To build without calling the backend at all, also set `STOREFRONT_REMOTE_MODE=stub`.

## 5. Deploy order

1. **Admin backend**: first, or together with the seller backend. The sync and moderation contract between the two
   backends must match on both sides.
2. **Storefront**: before the seller backend, so the storefront already reads any new field the backend starts sending,
   and its `/api/revalidate` route is live when the backend purges.
3. **Seller backend**.
4. **Seller frontend** and **admin frontend**: last; they only call the backends.

5. **Admin data bootstrap**: once, after the first deploy to a database (see "One shared database" below).

After a deploy that adds variables, set them on the platform first, then redeploy.

### One shared database (D-087, D-098, D-105)

Production uses ONE database. `SELLER_MONGODB_URI` (seller backend) and `MONGODB_URI` (admin backend) must point at the
same database: both URIs must be the same database. Both backends use the same models and collection names (`users`,
`stores`, `globals`, `sync-outbox`), so a seller user and a store written by the seller are the very documents the admin
console reads. Nothing is copied between two databases.

- The seller-to-admin sync groups (`store.operations`, `seller.profile`) are not used: nothing sends them and the admin
  receiver is a stub. Do not rely on them.
- The admin-to-seller groups (`store.governance`, `seller.controls`, `platform.settings`) still run through the outbox
  and the drain cron, but on a shared database they write into the documents the seller already reads.
- Two documents are created by no code and must exist in that database. Without them: the admin Commission settings
  answer 404 "not set up", and a per-store rate change stays pending (`OWNER_TRANSLATION_PENDING`):
  1. the platform-settings document (collection `globals`, `globalType: platformSettings`), and
  2. the `sellers` mirror (one row per seller that owns a store; `_id` is the seller's user id, `sellerId` the same id as text).

Deploy step (idempotent: it creates what is missing and never updates or deletes anything; it prints counts only):

```bash
node --env-file=apps/admin/backend/.env scripts/bootstrap-admin-data.mjs --i-know-this-is-real
node --env-file=apps/admin/backend/.env scripts/bootstrap-admin-data.mjs --i-know-this-is-real --apply
```

(`pnpm bootstrap:admin -- --apply` runs the same script.) The first line is the dry run: it prints what it would create.
The second writes it. A database whose name contains `throwaway` or `test` does not need `--i-know-this-is-real`. The
script stops if `SELLER_MONGODB_URI` is set and names a different database than `MONGODB_URI`. No code creates the
mirror row for a seller who signs up later, so re-run the script (it is safe) whenever a per-store rate change shows
`OWNER_TRANSLATION_PENDING`.

### Sprint 5: customers and the phone key (run once per database)

The seller's Customers pages group orders by `Order.phoneKey` (the normalized phone, `+923xxxxxxxxx`). New orders get it at
checkout. Orders placed before Sprint 5 have none, and until they are backfilled their phone-only customers are not listed.
Run the backfill once on each database, dry run first (it writes nothing unless `--apply`, never changes `phone`, and is safe to
repeat). A database whose name does not contain `throwaway` also needs `--i-know-this-is-real`:

```bash
pnpm --filter @markaz/contracts exec node --env-file=../../apps/seller/backend/.env --import tsx ../../scripts/backfill-order-phone-key.mjs
pnpm --filter @markaz/contracts exec node --env-file=../../apps/seller/backend/.env --import tsx ../../scripts/backfill-order-phone-key.mjs --apply
```

### Sprint 5: indexes and the data steps, in this order (once per database)

The seller backend connects with `bufferCommands: false`, so Mongoose builds **no index at runtime**. Without the next step the unique and
TTL indexes of Sprint 5 do not exist (one review per order and product, one open abandoned cart per store and phone, the 7 day cart expiry,
the return number and blocklist uniques). After deploying the backends run, in this order, each one dry run first and then with `--apply`
(a database whose name does not contain `throwaway` also needs `--i-know-this-is-real`, for the dry run too). Every step is idempotent:

1. `migrate-commission-index` (moves the ledger's unique index to include `returnId`; it creates the new one before it drops the old one).
2. `ensure-indexes` (below). It must come after step 1, so the ledger's old index is already replaced.
3. `backfill-order-phone-key` (previous section).
4. `bootstrap-admin-data` (section "One shared database").
5. `mark-sellers-verified` (section 8).

Sprint 6 adds `migrate-admin-levels` (section "Admin levels"). The order is now: `migrate-commission-index`, `ensure-indexes` (it also builds the new
`storeSyncRevisions` and `subscriptionPayments` indexes), **`migrate-admin-levels`**, `backfill-order-phone-key`, `bootstrap-admin-data`, `mark-sellers-verified`.

```bash
pnpm --filter @markaz/contracts exec node --env-file=../../apps/seller/backend/.env --import tsx ../../scripts/migrate-commission-index.mjs
pnpm --filter @markaz/contracts exec node --env-file=../../apps/seller/backend/.env --import tsx ../../scripts/ensure-indexes.mjs
pnpm --filter @markaz/contracts exec node --env-file=../../apps/seller/backend/.env --import tsx ../../scripts/ensure-indexes.mjs --apply
```

`ensure-indexes` calls `createIndexes()` per model and **never** `syncIndexes` or `dropIndexes`: an index nobody declares stays. It prints, per
model, which indexes are missing and which conflict (an index of the same name with another definition: reported and left alone, that model is
skipped), then, with `--apply`, creates the missing ones. A unique index can fail when the data already breaks it: that model is reported with
the error name and the other models are still done (the script then exits with 1). It prints names and counts only. A second run finds nothing missing.
(Root script: `pnpm ensure:indexes -- --apply`, with `SELLER_MONGODB_URI` exported in the shell.)

The **dry run only reads** (SB-6): the script switches Mongoose `autoCreate` and `autoIndex` off before the models load, so nothing is created on connect; only `--apply` creates. `mark-sellers-verified` has the same guard as the other deploy scripts: a database whose name does not contain `throwaway` needs `--i-know-this-is-real`, the dry run included.

### Required secrets (production)

| App | Secrets |
| --- | --- |
| Seller backend | `SELLER_MONGODB_URI`, `SELLER_AUTH_SECRET`, `PREVIEW_TOKEN_SECRET`, `REVALIDATE_SECRET`, `ORDER_ACCESS_SECRET`, `CLIENT_ADDRESS_SIGNING_SECRET`, `MODERATION_API_SECRET`, `SYNC_KEY_ID_CURRENT`, `SYNC_SECRET_CURRENT`, `RETENTION_CRON_SECRET`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_ORDER_WEBHOOK_SECRET`, `OUTBOX_CRON_SECRET`, `UNSUBSCRIBE_SIGNING_SECRET`, `RESEND_API_KEY` or `SMTP_PASS` |
| Admin backend | `MONGODB_URI`, `ADMIN_AUTH_SECRET`, `MODERATION_API_SECRET`, `SYNC_KEY_ID_CURRENT`, `SYNC_SECRET_CURRENT`, `SYNC_HMAC_SECRET`, `CRON_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OUTBOX_CRON_SECRET`, `RESEND_API_KEY` or `SMTP_PASS` |
| Storefront | `CLIENT_ADDRESS_SIGNING_SECRET`, `REVALIDATE_SECRET` |
| Seller frontend, admin frontend | none (only backend URLs) |

Secrets that two apps share must hold the same value on both: `REVALIDATE_SECRET` and `CLIENT_ADDRESS_SIGNING_SECRET`
(storefront and seller backend), and `MODERATION_API_SECRET` and the `SYNC_*` pair (seller backend and admin backend).

## 6. package.json scripts that pointed to missing files (EP-06.US04)

| Script | Pointed to | Decision |
| --- | --- | --- |
| root `check:no-payload` | `tools/check-no-payload.js` (the `tools/` folder does not exist) | Removed. Payload was removed in Phase 2 and no code imports it. |
| root `prelaunch` | `tools/prelaunch/check.js` | Removed. There is no source to restore; the CI workflow (EP-06.US03) and the env coverage script take over the launch checks. |
| root `check:no-shopify` | `tools/check-no-shopify.js` | Removed. There is no source to restore. |
| root `stiletto:verify` | `tools/stiletto-patch/verify.mjs` | Removed. A one-off patch check; the Stiletto patch was applied long ago. |
| root `check:tokens` | admin frontend `check:tokens` | Removed together with the target below. |
| admin frontend `check:tokens` | `scripts/check-tokens.ts` (missing) | Removed. The storefront keeps its own `check:tokens` (`scripts/check-tokens.mjs`, exists). |
| admin backend `create-admin` | `scripts/create-admin.ts` (missing) | Kept. EP-08.US05.T02 (CO-05) writes the script in Sprint 4 SB-3. |
| root `typecheck` | turbo `type-check` | Added (EP-06.US01.T02). |

Every other script points to a file that exists.

## 7. Scheduled jobs

| Job | Call | Secret | How often |
| --- | --- | --- | --- |
| Email outbox retry (EP-07.US01.T02) | `POST` or `GET https://<seller backend>/api/internal/notifications/flush` | `OUTBOX_CRON_SECRET`, sent as `x-cron-secret: <secret>` or `Authorization: Bearer <secret>` | every 5 minutes |
| Commission ledger retry (EP-05.US01) | `POST` or `GET https://<seller backend>/api/internal/commission/backfill` | `OUTBOX_CRON_SECRET`, sent like the outbox flush | every 15 minutes |
| Trash retention | `POST https://<seller backend>/api/internal/retention` | `RETENTION_CRON_SECRET` in `x-retention-secret` | daily |
| Sync drain (admin) | `GET https://<admin backend>/api/internal/sync/drain` | `CRON_SECRET` as a bearer token (`apps/admin/backend/vercel.json`) | every minute |
| Plan expiry (Sprint 6) | `POST https://<seller backend>/api/internal/subscriptions/expire` with `{"apply": true}` (without it: dry run) | `OUTBOX_CRON_SECRET` (`x-cron-secret` or bearer) | daily |
| **Retention run** (Sprint 6) | `POST https://<seller backend>/api/internal/retention/run` with `{"apply": true}` (without it: dry run) | `RETENTION_CRON_SECRET` in `x-retention-secret` | daily, after the trash retention |
| **Media orphan sweep** (Sprint 7, CO-10), **called by hand, not scheduled** | `POST https://<seller backend>/api/internal/media/orphans` with `{"olderThanDays": 30}` (without `apply` it is a dry run that only lists); then with `{"apply": true}` to remove. At most 500 records per call: when the answer says `more`, call again with `{"after": "<nextAfter>"}` | `OUTBOX_CRON_SECRET` (`x-cron-secret` or bearer) | by hand, for example monthly. Removes media records that no product, store setting or other feature uses, older than N days (default 30, 1 to 365), and their Cloudinary files |
| Email outbox flush (admin) | `POST` or `GET https://<admin backend>/api/internal/notifications/flush` | `OUTBOX_CRON_SECRET` | every 5 minutes |

The media orphan sweep is in the table for completeness: it is a job somebody calls by hand (dry run first, read the list, then apply). It is not
on any schedule in the repository.

That is every route in the repository protected by a cron secret (`OUTBOX_CRON_SECRET`, `CRON_SECRET`, `RETENTION_CRON_SECRET`). By hand, from the admin console:
**Sync** (retry dead events, retry failed emails), **Retention** (dry run, then apply, owner only) and **Subscription payments**. The signed internal
sync routes `receive`, `digest` and `repair` on the admin backend are called by the sellers' sender (HMAC), not by a scheduler.

### Backup and retention policy (Sprint 6, EP-29)

- **Backups are the owner's step**, not the code's: turn on Atlas continuous or scheduled snapshots for the shared database, and a Cloudinary backup of
  the media account. Neither is configured in the repository.
- **Restore runbook, on a THROWAWAY database only, never on production:** (1) restore the Atlas snapshot into a NEW cluster or database whose name contains
  `throwaway`; (2) point a copy of the env files at it; (3) run `ensure-indexes` dry run, then check counts of `users`, `stores`, `orders`, `commissionEntries`
  and `subscriptionPayments` against the source; (4) open the consoles against it and read the audit log; (5) delete it. A real recovery is a
  decision of the owner and Atlas support, made from the snapshot, not by running these scripts on production.

| Data | Kept | Purged by |
| --- | --- | --- |
| Commission ledger (`commissionEntries`) | forever, append-only | never |
| Audit log (`audit-log`) | forever | never |
| Subscription payments | forever | never |
| Sent emails (notification outbox) | 90 days | `retention/run` |
| Sent sync events (sync outbox) | 30 days | `retention/run` |
| Stock history | 365 days | `retention/run` |
| Products in seller trash | 365 days (never one an admin took down or deleted) | `retention` and `retention/run` |
| Closed tickets (Sprint 7) | 730 days after they were closed | `retention/run` |
| Closed contact messages (Sprint 7) | 365 days after they were closed (open, new and read messages are kept) | `retention/run` |

Every period lives in `apps/seller/backend/src/lib/retention-policy.ts`. A run is a dry run unless it is told to apply, removes at most 500 rows per kind,
and writes one audit line (`retention.run`) with the counts.
The outbox flush sends queued and failed emails that are due: at most 50 per call, at most 5 tries per email, with a
wait of 2, 4, 8 and then 16 minutes between tries. Each email is claimed with a compare-and-set, so two calls at the
same moment never send it twice. The route answers `401` when `OUTBOX_CRON_SECRET` is not set (or is shorter than 16
characters) or does not match. The JSON answer counts what happened:
`{ picked, sent, skipped, retry, failed, notClaimed, errors }`.

Broadcasts (EP-07.US04): a seller's broadcast writes one outbox row per recipient (at most 500) and sends none of them at
once. The flush sends 50 per call, so 500 recipients take at least ten flush runs; with the 5-minute schedule above that is
about 50 minutes. The broadcast history in the seller dashboard shows how many are queued, sent, failed and skipped.

Example (any scheduler: cron-job.org, GitHub Actions schedule, a server cron):

```bash
curl -fsS -X POST -H "x-cron-secret: $OUTBOX_CRON_SECRET" https://<seller backend>/api/internal/notifications/flush
```

Vercel Cron sends `Authorization: Bearer $CRON_SECRET` with the project's `CRON_SECRET`. To use it, set `CRON_SECRET`
to the same value as `OUTBOX_CRON_SECRET` on the seller backend, and add `{ "path": "/api/internal/notifications/flush",
"schedule": "*/5 * * * *" }` to `apps/seller/backend/vercel.json`. Neither change is made in the repo: the owner
chooses the scheduler.

Email in development: leave `EMAIL_PROVIDER` empty or set it to `log`. Every message is still written to the
`notificationoutbox` collection with status `skipped`, so you can read it there. Nothing is sent.

The admin backend has the same flush route (`/api/internal/notifications/flush`, same `OUTBOX_CRON_SECRET`) for
the emails it queues (operator password reset). Schedule both.

**Two secrets are required for broadcasts and the flush route.** Without them the feature does not work, and nothing in
the build tells you:

| Secret | App | Without it |
| --- | --- | --- |
| `UNSUBSCRIBE_SIGNING_SECRET` | seller backend | Every broadcast answers `503 BROADCAST_NOT_CONFIGURED`. The same signed link is the unsubscribe link in each mail, so no broadcast is sent without it. |
| `OUTBOX_CRON_SECRET` (16 characters or more) | seller backend, admin backend | The flush route answers `401` to everyone, so queued, failed and broadcast emails are never sent (they stay queued) and the commission ledger retry route is refused too. |

Both are in the production secrets table above and in each `.env.example`; set them before the first broadcast.

## 8. Accounts (Sprint 4 EP-08)

### Deploy notes

1. Deploy the seller backend and the admin backend together: a token now carries `tv` (tokenVersion), and both check
   the account on every request. Tokens issued before have no `tv` and keep working (read as 0).
2. Right after the seller backend deploy, mark the existing sellers verified once, so nobody is locked out of go-live
   or payouts (EP-08.US02.T03):

```bash
cd apps/seller/backend && node --env-file=.env --import tsx scripts/mark-sellers-verified.mjs
```

```bash
cd apps/seller/backend && node --env-file=.env --import tsx scripts/mark-sellers-verified.mjs --apply
```

   The first command is a dry run that prints how many accounts would change. The script prints counts only.

   After `--apply`, a running seller backend can still see the old "not verified" value for up to 30 seconds: it
   keeps each session's account in a short cache (`SESSION_USER_CACHE_MAX_MS`, 30 s). Go-live and payouts may keep
   saying "verify your email" for that long. Nothing is wrong; wait half a minute or redeploy. The same 30 seconds
   apply to suspending a seller: the instance that applies it refuses the seller at once, every other running
   instance within 30 seconds.
3. Set `APP_BASE_URL_SELLER` (seller backend) and `APP_BASE_URL_ADMIN` (admin backend), so the reset and
   verification links point to the right site.

### Admin levels (Sprint 6, S6-B6, D-118)

Every admin account has a level; the admin backend checks a capability on every route (one matrix: `packages/auth/src/admin-levels.ts`; the server
enforces it, the console only hides what a level cannot use). Where the matrix is silent the answer is deny.

| Level | May |
| --- | --- |
| `owner` | everything, including admin users (invite, change level, disable) and the audit export |
| `finance` | subscription payments (list, confirm, reject), payouts, commission and reports, plans (read) |
| `operations` | sellers and stores (read, status, store limit), sync and outbox retry, plans (read), settings (read) |
| `customer_support` | orders (read only, safe fields), sellers (read), tickets and the contact inbox (Sprint 7) |

- **The first owner** is created by `create-admin` (it writes `adminLevel: owner`). An admin with no level is read as an owner, so nothing locks out on upgrade.
- **One-time migration** for existing admins: `node scripts/migrate-admin-levels.mjs` (dry run by default; `--apply` writes `adminLevel: owner` on accounts with
  no level; a database whose name does not contain `throwaway` needs `--i-know-this-is-real`). Safe to run twice.
- **Invite** (Admin users page, owner only): the person gets an email with a link that works once for 7 days (needs `APP_BASE_URL_ADMIN`); they set the password on
  `/accept-invite`. **Forgot / reset password** are at `/forgot-password` and `/reset-password`.
- **Protections:** the last active owner cannot be disabled or demoted; nobody changes their own level or disables themselves; every change is in the audit log.
  A level change or a disable applies on the next request (the account is read on every request, there is no cache).
- **Audit export** (owner only): Audit log, Export CSV (UTF-8 with BOM, at most 5000 rows; cells starting with = + - @ are guarded). Each export is itself audited.

### First admin account (CO-05)

```bash
cd apps/admin/backend && node --env-file=.env --import tsx scripts/create-admin.mjs
```

It reads `MONGODB_URI`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` (and `ADMIN_NAME`, optional), and asks for the email and a
hidden password when they are not set. It refuses when an admin already exists; add `--force` to create another one.
The password follows the shared rule (8 to 128 characters). Neither the password nor its hash is ever printed.
`pnpm --filter @markaz/admin-backend-next create-admin` runs the same script; pass the variables in the environment.

### Limits (shared MongoDB counters, D-081)

| Route | Limit |
| --- | --- |
| Login (seller and admin) | 10 failures per account and 30 per IP in 15 minutes; then 429 with `Retry-After`. A success clears the account counter, not the IP counter. |
| Forgot password | 5 per hour per IP, 3 per hour per email |
| Reset password, verify email | 10 per hour per IP |
| Resend verification | 3 per hour per account |

### Per-IP limits: the client address (Sprint 4, D-097)

The seller portal and the admin console call their backend server to server, so the backend sees the frontend's
address, not the browser's. The frontend therefore resolves the browser's address and signs it
(`x-markaz-client-address`, scope `account-portal`, valid 60 seconds). The backend believes it only with a valid
signature. Deploy settings:

| App | Set |
| --- | --- |
| Seller frontend | `CLIENT_ADDRESS_SIGNING_SECRET` (the same value as the seller backend's) and `TRUSTED_PROXY_HOPS=1` on Vercel |
| Seller backend | `CLIENT_ADDRESS_SIGNING_SECRET` (already set for the storefront; one value serves both) |
| Admin frontend | `CLIENT_ADDRESS_SIGNING_SECRET` (the same value as the admin backend's) and `TRUSTED_PROXY_HOPS=1` on Vercel |
| Admin backend | `CLIENT_ADDRESS_SIGNING_SECRET` |

Use `TRUSTED_CLIENT_IP_HEADER` instead of `TRUSTED_PROXY_HOPS` only behind a proxy that always sets that header itself.
When no address can be known (no secret, or no setting), the per-IP bucket is skipped and only the per-account or
per-email bucket applies. There is never one shared bucket for unknown callers.

**Set `TRUSTED_PROXY_HOPS` on both portals. Do not leave it out.** With neither `TRUSTED_PROXY_HOPS` nor
`TRUSTED_CLIENT_IP_HEADER`, the portal reads "the address of the connection itself", and behind a proxy or Vercel that is
the proxy's address, not the shopper's. It signs that one address for every visitor, so **all portal users share one
per-IP bucket**: a handful of forgot-password requests (5 per hour) or failed logins (30 per 15 minutes) from anyone
locks every seller out of those pages with "Too many attempts". The Sprint 4 verification hit exactly this. After a deploy
check it: open `/forgot-password` from two different networks; both must work, and one must not use up the other's five.

## 9. Content: articles and pages (Sprint 7)

A store has a **blog** and **static pages**. Sellers write both in the dashboard (Blog, Pages); shoppers read them on the store's own host.

- **Articles** (`/blog`, `/blog/<slug>`): blog articles only. A draft is private. Publishing sets the publish date once and keeps it. Written through
  `api/storeArticles`; the storefront reads only published blog articles (`GET /api/storefront/v1/stores/:id/articles`, `.../articles/:slug`).
- **Pages** (`/pages/<slug>`): about, contact, shipping, returns, privacy, or any page the seller writes. Written through `api/storePages`. A page can be
  linked in the footer (`showInFooter`, ordered by `sortOrder`). The words `products`, `cart`, `checkout`, `track`, `favourites`, `search`, `collections`, `blog`,
  `pages`, `account`, `api`, `orders` and `feedback` cannot be a page address.
- **Default pages are never created for a seller.** Opening the Pages screen creates nothing; each of the five templates is made only when the seller chooses
  "Create from template", as a draft. The templates live in `packages/platform-kit/src/page-templates.ts`. The legal ones (returns, privacy) carry visible
  `[[EDIT: ...]]` placeholders: the editor warns while one is in the text and asks for confirmation before publishing it.
- **Default copy**: a store with no page at `/pages/about` or `/pages/contact` shows the platform's default text from `apps/storefront/lib/content-pages.ts`. A
  store that has a page there, even a draft, never shows it (a draft is a 404).
- **The text format** is plain text with a small Markdown subset: `#`, `##`, `###` headings (shown as h2 to h4), `**bold**`, `*italic*`, `-` and `1.` lists,
  `[text](https://link)` links (http, https, mailto, tel only) and `![alt](https://image)` pictures (https only; in the dashboard they must be files of the
  store's own media library). Everything else is plain text: raw HTML is never rendered, it is shown as the letters it is made of. Up to 50,000 characters. The
  parser is `packages/platform-kit/src/content-markdown.ts`; the seller backend, the dashboard preview and the storefront all use it.
- **Caching**: the storefront reads the blog and the pages under the store's `static` cache tag. Every publish, unpublish, edit and delete of an article or page
  makes the seller backend purge that tag (`revalidateStore`), so a change shows at once. Needs `STOREFRONT_URL` and `REVALIDATE_SECRET` on the seller backend.
- **Sitemap and robots**: every live store serves `/sitemap.xml` (home, products, blog, each published article and page) and `/robots.txt` on its own host. A
  store that is not live, and any preview, is closed.
- **Indexes**: run `ensure-indexes` after deploying Sprint 7. New: a unique `{store, slug}` on `storepages` (and `storearticles` already had one), plus
  `{store, mediaRefs}` on both, so a media file used by an article or a page can never be deleted.
