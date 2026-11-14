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
| `PLATFORM_DEFAULT_COMMISSION_PERCENT` | seller backend, admin backend | Platform default commission in percent. The placeholder is 5; the owner sets the real value (A-019). |
| `APP_BASE_URL_SELLER` | seller backend, admin backend | Seller portal base URL for links in emails. |

### Sprint 3 deploy variables (still required for those features)

`ORDER_ACCESS_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_ORDER_WEBHOOK_SECRET`, `STOREFRONT_URL`, `CLIENT_ADDRESS_SIGNING_SECRET`
(the same value on the storefront and the seller backend), `TRUSTED_PROXY_HOPS` or `TRUSTED_CLIENT_IP_HEADER` (on both),
and `REVALIDATE_SECRET` (the same value on the storefront and the seller backend).

### Do not set in production

`SELLER_NEW_STORE_STATUS` existed only for verification runs (CO-26). Leave it empty. EP-04.US06 removes it.

## 3. A throwaway database

- Unit tests never touch a database: every model is stubbed in the test file.
- To run the apps, use a local `mongod` (for example `mongodb://127.0.0.1:27017/markaz_dev_seller` and `.../markaz_dev_admin`) or a
  throwaway Atlas database. Never point a local app at a production database.
- Name every throwaway database with `verify` or `smoke` in it (for example `markaz_smoke_seller`). The smoke script
  (`scripts/smoke`, EP-06.US06) refuses any other name.
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

After a deploy that adds variables, set them on the platform first, then redeploy. Remove `SELLER_NEW_STORE_STATUS`
from production (CO-26).

### Required secrets (production)

| App | Secrets |
| --- | --- |
| Seller backend | `SELLER_MONGODB_URI`, `SELLER_AUTH_SECRET`, `PREVIEW_TOKEN_SECRET`, `REVALIDATE_SECRET`, `ORDER_ACCESS_SECRET`, `CLIENT_ADDRESS_SIGNING_SECRET`, `MODERATION_API_SECRET`, `SYNC_KEY_ID_CURRENT`, `SYNC_SECRET_CURRENT`, `RETENTION_CRON_SECRET`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_ORDER_WEBHOOK_SECRET`, `OUTBOX_CRON_SECRET`, `RESEND_API_KEY` or `SMTP_PASS` |
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
| Trash retention | `POST https://<seller backend>/api/internal/retention` | `RETENTION_CRON_SECRET` in `x-retention-secret` | daily |
| Sync drain (admin) | `GET https://<admin backend>/api/internal/sync/drain` | `CRON_SECRET` as a bearer token (`apps/admin/backend/vercel.json`) | every minute |

The outbox flush sends queued and failed emails that are due: at most 50 per call, at most 5 tries per email, with a
wait of 2, 4, 8 and then 16 minutes between tries. Each email is claimed with a compare-and-set, so two calls at the
same moment never send it twice. The route answers `401` when `OUTBOX_CRON_SECRET` is not set (or is shorter than 16
characters) or does not match. The JSON answer counts what happened:
`{ picked, sent, skipped, retry, failed, notClaimed, errors }`.

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

