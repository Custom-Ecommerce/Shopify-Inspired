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

### Custom domains (Sprint 7, S7-B5): all optional

Seller backend. A custom domain is a Growth plan feature (D-118). None of these is required to start; with none set, a seller can still
connect a domain and pass the check with the TXT record alone, and no domain is added to Vercel.

| Name | What it does |
| --- | --- |
| `CUSTOM_DOMAIN_CNAME_TARGET` | The host a subdomain's CNAME must point to (for example `cname.markazify.com`). |
| `CUSTOM_DOMAIN_A_TARGET` | The IPv4 address a bare domain's A record must point to. |
| `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID` | Both set: a verified domain is added to the Vercel project, a disconnected one is removed. Either missing: a stub is used. Never log the token. |
| `ROOT_DOMAIN`, `PLATFORM_HOSTNAMES` | The platform's own hosts, refused as a seller's domain (same values as the storefront). The host of `STOREFRONT_URL` is always refused too. |

Before the first deploy of S7-B5, drop the old non-unique index on `stores.domain` (it is named `domain_1`) and run
`scripts/ensure-indexes.mjs` (dry run first): the store model now declares a UNIQUE index on `domain` that only applies to stores
that have one, so two stores can never hold one host. The plan reports a conflict until the old index is dropped; it never drops it itself.

### Custom domain runbook (Sprint 7, S7-B6)

How a seller's own domain (for example `shop.zara.pk`) reaches the storefront, and what the platform owner does.

**How it works.** The seller connects a domain on the Domain page and sets two DNS records: a CNAME (or an A record for a bare domain) that points to us, and a
TXT record `_markazify-verify.<domain>` that proves they own it. "Check now" reads the live DNS; when both are right the backend adds the domain to the Vercel
project (S7-B5) and the domain is `verified`. From then on the storefront serves the domain EXACTLY like `<slug>.<root>`: the middleware sends the host to the
same `/tenant/<key>` routes (home, product, cart, checkout, track, pages, blog, `sitemap.xml`, `robots.txt`) and the store is looked up by the host through the
seller backend (`GET /api/storefront/v1/stores/by-key/<host>?by=domain`). Only a VERIFIED domain resolves: an unknown, pending, failed or disconnected host gets the
same "store unavailable" page. The platform subdomain keeps working; the verified domain is the canonical address (canonical links, sitemap, robots.txt), and the
seller can switch on "send visitors to my own domain" to redirect the platform address to it with a 308.

**What the owner does, once.**
1. Set `CUSTOM_DOMAIN_CNAME_TARGET` (for example `cname.vercel-dns.com`, the value Vercel shows for the project) and, for bare domains, `CUSTOM_DOMAIN_A_TARGET`
   (Vercel's A record address) on the seller backend. Set `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID` (the STOREFRONT project) so verified domains are added to Vercel
   by the backend. Without them a stub is used: the check passes on the TXT record alone and nothing is added to Vercel, so the domain would not serve.
2. On the storefront set `ROOT_DOMAIN` and `PLATFORM_HOSTNAMES` as before. Behind Vercel nothing else is needed. Behind your own proxy set `TRUSTED_PROXY_HOPS` or
   `TRUSTED_CLIENT_IP_HEADER` too: without them `x-forwarded-host` is ignored and the `Host` header is the host (a forged forwarded header cannot pick a store).
3. Make sure the storefront project accepts any host (Vercel: the domains the backend adds are attached to the project; no wildcard is needed for custom domains).
4. SSL: the host issues the certificate (Vercel does it automatically once the domain's DNS points at it). Nothing to do here; a domain whose DNS is wrong has no
   certificate and the browser warns, which the Domain page's "Check now" explains in plain words.

**What the seller does.** Buys the domain, opens the DNS settings of the company they bought it from, adds the two records the Domain page shows, waits a few
minutes (sometimes hours), presses "Check now". A plan without a custom domain (Free) is refused with an upgrade message. A seller whose plan LAPSES keeps a
domain that is already verified (a live shop is never switched off silently); they lose only the ability to connect another, and can disconnect any time.

**Testing without a real domain.**
- Hosts-file names: add `127.0.0.1 shop1.localtest.me` (and `shop2.localtest.me` for a second store) to your hosts file (`C:\Windows\System32\drivers\etc\hosts`,
  `/etc/hosts`). `*.localtest.me` already resolves to 127.0.0.1 without a hosts entry. Open `http://shop1.localtest.me:3000`.
- The storefront treats any host that is not `ROOT_DOMAIN` or one of its subdomains as a custom domain candidate. With `ROOT_DOMAIN=localhost:3000`, `shop1.localtest.me`
  is one. A store resolves only after its domain is `verified`: in a development database connect `shop1.localtest.me` on the Domain page (the DNS check needs
  a real resolver, so for local work set the store's `customDomainStatus` to `verified` in the database by hand, or run the seller backend with a test resolver).
- Two stores on two hosts must show their own data, carts and orders: open both in one browser and check. Cookies are host-only (no `Domain` attribute) and the cart is
  stored per origin.
- `*.localhost` names (for example `zara.localhost:3000`) are store subdomains, not custom domains. The preview cookie works there only; a custom host never takes a preview.
- The redirect (308) is meant for production: it keeps no port, so in local development leave "send visitors to my own domain" off.

### Themes (Sprint 7, S7-B7)

**What a seller sees.** Only Stiletto (D-115). The Theme tab lists the themes in `listSellerThemes()` (installed, available, not hidden), a preview button for the saved
look, and a "Customise the look" editor for Stiletto. Mustafa stays in the repository but is hidden; mola, gani and farooq are "coming soon".

**What a seller may change in Stiletto** (store settings group `themeConfig`, stored in `store.storefront.themeConfig`, one live version, saved with one PATCH):

| Field | Rule |
| --- | --- |
| `primaryColor`, `accentColor` | A hex colour, `#rgb` or `#rrggbb` in any case, stored as lower-case `#rrggbb`. Nothing else (no names, `rgb()`, `url()`). |
| `fontFamily` | A NAME from the whitelist `theme` (Stiletto's own fonts), `system`, `serif`, `rounded`, `mono`. The theme maps it to a fixed font stack (`THEME_FONT_STACKS` in `packages/contracts/src/theme-config.ts`). The seller never sends a CSS string. |
| `heroTitle` (80), `heroSubtitle` (160), `heroCtaLabel` (30), `announcementText` (120) | Plain text, no `<` or `>`. Rendered as React text nodes. |
| `heroCtaLink` | A path on the store (starts with `/`, never `//`) or an `https://` address. Never `javascript:`, `data:`, `http:`. |
| `heroImage` | A media id of the SELLER'S OWN store (an image, not a video). Another store's file or an unknown id is a 422 `THEME_CONFIG_IMAGE_INVALID`. A picture in use cannot be deleted (media registry feature `themeConfig`). |
| `announcementEnabled`, `showFeatured`, `showCategories`, `showReviews`, `showBlog` | Switches (all on by default). `showBlog` hides the footer Blog link. |

The group is strict: an unknown key is a 400 naming it. `themeConfig: null` resets everything to the defaults. The storefront validates the config AGAIN and fills the
defaults, and colours and the font reach the page only as CSS custom properties built from validated values (`themeStyleVars`), never as a style string.

**Draft and preview.** The store settings have one live version of the config (there is no saved draft), so the editor has a small "preview before saving" drawing of the
Stiletto header and hero that updates as you type, and after saving the existing preview button shows the real store through the preview token (D-019).

**Plans.** Stiletto is free. A theme on the paid tier is PREMIUM and needs a plan with `limits.premiumThemes` (Growth): choosing it on Free is a 403 `PLAN_LIMIT_REACHED`
with `limitKind: "premiumThemes"`, and `GET /api/themes` reports `premium` and `locked` for each theme. No installed theme is premium today (mola and gani are paid but not finished).

**Adding a theme later: checklist.**
1. Manifest entry in `packages/platform-kit/src/themes/manifest.ts` (slug, label, `tier`: `free` or `paid`, `status`, `installed: true`, `supportsCardCheckout`, `previewImage`). Paid tier makes it premium.
2. The theme package `themes/<slug>` (contract `@markaz/storefront-theme-kit`), listed in `apps/storefront/package.json` and the loader map in `apps/storefront/lib/themes.ts`. Give the package a
   `test` script (see `themes/stiletto/test/run-checks.mjs`) so its checks run in `pnpm test` (CO-101).
3. Its config schema: add the fields it lets sellers change to `packages/contracts/src/theme-config.ts` (or a sibling file) with the same rules: hex colours, font NAMES from a whitelist,
   plain text, safe links, media ids of the store; keep the update schema strict; add the group to `SETTINGS_GROUPS` (`apps/seller/frontend/lib/settings-groups.ts`) and the writer
   in `apps/seller/backend/src/lib/store-settings.ts`. Register any image the config holds in `lib/media-usage.ts`.
4. A preview image `public/theme-previews/<slug>.svg` and the gallery data; check `/demo/<slug>` renders with the DEFAULT config (a demo has no config).
5. Tests: contracts (valid, invalid, injection), the theme's `*.check.ts`, the seller route test, and the plan gate if the theme is premium.

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

## 10. Store tax (Sprint 8, S8-B1, D-118)

A store can charge **one** tax on its orders. It is deliberately simple. Markazify only calculates what the seller enters; it does not know the seller's tax
rules, and the settings screen says so ("Check your own tax rules; Markazify only calculates what you enter").

- **PKR only, whole rupees.** There is no other currency and no paisa.
- **Off by default.** A store that never saved tax, and every store that existed before Sprint 8, charges none. The settings group is `tax` of
  `PATCH /api/stores/:id` (Store settings, Tax tab), kept in `store.storefront.tax`: `enabled` (default false), `ratePercent` (0 to 100, at most 2 decimals),
  `mode` (`exclusive` or `inclusive`) and `label` (plain text, 1 to 20 characters, no `<` or `>`, default `Tax`). The group is strict: a rate with 3 decimals,
  a negative rate, a rate over 100, an unknown key, or turning tax on with no rate is a 400 that names the field and writes nothing. The owner and a manager may
  change it (it is not an owner-only setting); a save is a compare-and-set on the store revision, is audited, and purges the storefront cache once.
- **One rate for the whole store.** No per-product or per-city rates, no tax classes, no tax ID on the invoice.
- **Exclusive** (default): the prices are before tax and the tax is **added**: `total = subtotal - discount + tax + delivery`.
  **Inclusive**: the prices already contain the tax, so it is **extracted and shown** and the total is unchanged: `tax = round(taxable x rate / (100 + rate))`.
  Exclusive is `tax = round(taxable x rate / 100)`.
- **What is taxed.** `taxable = subtotal - discount` (the discount comes off first; a discount equal to the subtotal leaves no tax). **Delivery is never taxed.**
- **The one rounding rule.** Round half up, applied **once** to the whole tax amount of the order, never per line (`packages/contracts/src/tax.ts`, integer
  arithmetic on hundredths of a percent). The server calculation (`lib/storefront/pricing.ts`, shared by the cart quote and the order) is the only source:
  a total or a tax sent by the browser is ignored, and a card payment is charged the order total, which holds an exclusive tax.
- **Commission.** The commission base is `subtotal - discount` and **never includes tax** (D-089). The CommissionEntry code is not touched: a refund or a
  return changes nothing about that.
- **Old orders keep tax 0.** An order stores its own snapshot (`taxAmount`, `taxMode`, `taxRatePercent`, `taxLabel`); an order from before Sprint 8 has none of
  these fields and reads as tax 0 everywhere. Changing the store's tax later never rewrites an order. No data migration and no new index.
- **Where it shows.** Cart drawer and checkout (the line is the store's label, "Tax (included)" for an inclusive tax, hidden at 0), the order confirmation
  and the customer order lookup, the seller's order detail and slips, and the order emails (the line is left out when the tax is 0). The customer tracking
  answer shows no money by design and is unchanged.
- **Returns.** The refund cap of a return is its tax-free base plus its **proportional share of an exclusive tax** (an inclusive price already contains
  it, so nothing is added). Shares are the difference of two running amounts, so the shares of all the returns of an order add up to exactly the tax paid. The
  commission reversal keeps reading the tax-free base.

## 11. Store team: staff roles and invites (Sprint 8, S8-B2, D-118)

- **Roles.** `owner` (the account that owns the store) and three staff roles: `manager` (everything except the owner-only list), `staff` (orders, products with their
  categories and media, inventory) and `support` (orders view and customer notes, returns, customers, review replies, contact inbox and tickets). **Owner-only:** the
  settings groups payments, fraud, domain and payout, go-live, billing and plan, API keys, team, earnings, payouts and commission data. The tax group is writable by the
  owner and a manager. The one matrix is `packages/auth/src/seller-capabilities.ts` (`sellerCan(role, capability)`): a missing or unknown role, and an unknown capability, are denied.
- **Membership** is the `storemembers` collection (`packages/db-schemas/src/models/store-member.ts`). Run `ensure-indexes` after deploying: three unique PARTIAL indexes
  ({store,user} for rows with a user, {store,email} for status invited, {tokenHash} for rows with a hash) and {user,status}.
- **Every request reads the member row from the database** (no cache), so disabling or removing a member takes effect on their very next request.
  `resolveStoreAccess` (lib/data-plane.ts) answers `{ storeId, role, isOwner }`; `resolveOwnedStoreId` keeps answering the store id. **Until S8-B3 sweeps a route, an active member is
  refused 403 `NOT_OWNER_YET` by it** (only the team routes and PATCH /api/stores/:id name a capability so far).
- **Invites.** Owner-only, 7 days, one open invite per email per store, the owner's own email is refused, seats come from the plan (`limits.staffSeats`: Free 0, Growth 3; invited and
  active members count, a disabled one does not; 403 `PLAN_LIMIT_REACHED`). The token is 32 random bytes: only its SHA-256 hash is stored, the raw value is in the emailed
  link `<APP_BASE_URL_SELLER>/accept-invite?token=...` alone. An unknown, expired, used or other-account token is one neutral 400 `INVITE_INVALID`.
- **Routes:** `GET|POST /api/stores/:id/team[/invite]`, `PATCH .../team/:memberId`, `POST .../team/:memberId/{resend,disable,enable,remove}`, `GET /api/team/invite?token=`, `POST /api/team/accept`.

## 12. Referrals and storefront counters (Sprint 8, S8-B5 and S8-B6, D-118)

### Referrals
- Platform settings (admin console, Settings): `referralRewardMonths` (default 1; **0 turns referrals off**: no new referral rows, and no reward is given) and
  `referralMonthlyCap` (default 5).
- **`referralMonthlyCap` is read in two places.** At signup it is the most NEW referral rows one referrer can get in a UTC day. At reward time it is the most REWARDS one
  referrer can receive in a UTC calendar month. A referral past the monthly cap is `capped` and is never rewarded later.
- **The reward** is given when the referred seller's FIRST subscription payment with an amount above 0 is confirmed. It is a `subscriptioncredits` row: added at once to the
  referrer's running paid period, else at the referrer's next confirmed payment. It never grants a plan. Whole calendar months (31 January + 1 month = end of February).
- A reward-time self-referral (accounts' and stores' emails and phones) or a suspended or blocked referrer makes the row `refused`.
- **Voiding the payment that earned a reward does not take the reward back.** The audit entry `referral.payment_voided_after_reward` and the note on the admin Referrals page
  say so; the owner decides by hand. An audit entry `referral.credit_failed` means a row is `rewarded` but no months were stored: add them by hand.
- A reward that lengthens a referrer's period changes their subscription, so the referrer's own last payment can then no longer be voided in the console (`SUBSCRIPTION_CHANGED`).
- Admin console: **Referrals** (owner and finance), with a CSV of rewards.

### Storefront counters
- Anonymous and first-party: no cookie, no visitor id, no IP, no personal data. `dailystats` (store, UTC day: visits, productViews, addToCart, checkoutStarts, orders) and
  `productdailystats` (store, product slug, day: views; at most 500 slugs per store and day). MongoDB removes rows 400 days after their day (TTL index).
- **A visit** is one `page_view` per browser session of one store: a `sessionStorage` flag remembers it was sent (a new tab, or a closed and reopened one, is a new visit).
  With `sessionStorage` blocked, no visit is counted. Nothing is counted on demo hosts, in a seller's preview, or when the browser sends Do Not Track.
- `orders` is counted by the server when a NEW order is created, whatever the browser allows, so it can exceed what the other counters suggest.
- Flow: browser -> `POST /api/storefront/events` (storefront) -> `POST /api/storefront/v1/events` (seller backend, 60 a minute per client address and store).

**Deploy:** run `ensure-indexes` (dry run, then `--apply`): without it the TTLs, the one-row-per-day indexes, the referral reward slot and the one-credit-per-referral rule
do not exist. `users.referralCode_unique` (S8-B5) is built by the same run.

## 13. Analytics and reports (Sprint 8, S8-B7, D-118)

### What is counted
- **A visit** is one `page_view` per browser session of one store (a `sessionStorage` flag; a new tab is a new visit). Product views, add to cart and started checkouts are
  counted as they happen; **orders** are counted by the server when a new order is created.
- These are **counters, not people**. One visitor can view many products or order twice, and an order from a browser with Do Not Track has no counted visit, so a funnel
  step can be larger than the one before; its percentage is then shown as 100.
- **Not counted or stored:** no IP address, no cookie, no visitor id, no personal data; nothing from a seller's preview, a demo store, or a browser that sends Do Not Track.
- **Retention:** `dailystats` and `productdailystats` rows are removed by MongoDB 400 days after their day (TTL index).

### The analytics page (owner and managers)
- 7, 30 or 90 days (UTC days): the funnel, visits per day, top products by views and by orders, revenue, order status and cities.
- Orders counted: every status but `cancelled`. Revenue: every status but `cancelled` and `returned`, the order total in whole rupees (`lib/analytics-rules.ts`).

### The sales report (owner and managers; analytics and orders pages)
- `GET /api/stores/:id/reports/sales?from&to&status&method`. Dates are **Pakistan days**, at most **366** (without dates: the last 366). `method`: `cod` (also an order with no
  recorded method) or `card`.
- Columns: Order number, Date (ISO, UTC), Status, Payment method, Subtotal, Discount, Delivery, Tax, Total, Commission. Commission is the ledger's entries for the order net of
  reversals (0 for cash on delivery at 0%; empty when no entry exists yet). **No customer name, phone, email or address.**
- At most **10000** rows, newest first. A cut file has the header `X-Report-Truncated: 1` and a first line saying so.
- CSV in UTF-8 with a BOM; text cells starting `= + - @`, tab or CR are guarded. Each download is audited (`report.sales_exported`: who, role, filters, row count, truncated).

### Admin overview
- Visits and orders per day for the last 14 days, summed over every store.

**Deploy:** run `ensure-indexes` (new `{day}` index on `dailystats`).

## 14. Mobile apps (Sprint 9, D-123, D-124)

Two Android apps built with React Native and Expo SDK 58 (TypeScript, Hermes, New Architecture): `apps/seller/mobile` and `apps/admin/mobile`.
What they share lives in `packages/mobile-kit` (API client, sign-in session, cache, offline queue, design tokens). The API is described in
`docs/mobile-api-v1.md`.

- Node 22.13 or newer on the 22 line, or 24.3 or newer on the 24 line (Expo's tooling needs it).
- `pnpm install` at the root installs them too. **No pnpm setting was changed** (no `node-linker`, no `.npmrc`): Expo's Metro config resolves the workspace
  packages with pnpm's normal isolated layout. Do not switch to `node-linker=hoisted`: it would change how the web apps resolve their packages as well.
- The apps use React 19.3 (React Native's version); the web apps keep their own React. pnpm keeps them apart.

### Run an app on a real phone (Expo Go)

No Android Studio and no emulator are needed.

1. Install Expo Go for **SDK 58** on the phone from https://expo.dev/go (the Play Store build can lag behind a new SDK).
2. Put the phone and the computer on the same Wi-Fi. If Windows asks, allow Node on private networks.
3. Start the backend the app talks to: `pnpm dev:seller-backend` (port 4001), or `pnpm dev:admin` (port 4010) for the admin app.
4. In another terminal: `pnpm --filter @markaz/seller-mobile start` (or `@markaz/admin-mobile`), then scan the QR code with Expo Go.

With no address set, the app talks to the computer Expo Go loaded it from. To point it elsewhere, copy the app's `.env.example` to `.env` in the app's folder
and set `EXPO_PUBLIC_API_URL` (seller) or `EXPO_PUBLIC_ADMIN_API_URL` (admin). `EXPO_PUBLIC_SELLER_PORTAL_URL` is the website the seller app's
"Contact support" button opens. These values are built into the app and readable by anyone: never a secret.

### Admin app sign-in

An admin signs in with their password and then a code from an authenticator app (Google Authenticator, Aegis, or similar). The first sign-in on a phone
sets it up and shows ten recovery codes once. For a lost authenticator with no codes an owner calls `POST /api/admin/users/:id/reset-second-factor` with
a `reason` (the console has no button for this yet).

### What Expo Go cannot do

- **Remote push notifications.** They need an installed build, made in Expo's cloud with EAS (`npx eas-cli build --profile preview --platform android`
  from the app's folder; `eas.json` is there). Owner steps first: an Expo account and `npx eas-cli init`, which adds the project id push needs. Everything
  else works in Expo Go.
- **Android push also needs Firebase (FCM).** Add each package id to a Firebase project, put its `google-services.json` in the app's folder and name it in
  `app.json` (`expo.android.googleServicesFile`), then upload the service account key with `npx eas-cli credentials` (Android, FCM V1). The service account key
  is a secret: never put it in the repository. Steps: `sprint-9-prompts/reports/S9-DEVICE-CHECKLIST.txt`, items 30 to 33.
- The app's own icon, name and package id appear only in a build, not in Expo Go.

### Checks

```
pnpm --filter @markaz/mobile-kit --filter @markaz/seller-mobile --filter @markaz/admin-mobile run type-check
```

The same filters take `lint` and `test` (jest). `pnpm --filter @markaz/seller-mobile run export:android` builds the Hermes bundle into the app's `dist/`
(not in git). CI runs all of these in the "Mobile apps" job.

### Offline (seller app, D-124)

Screens opened before can be read without a network. Three changes can be made offline and wait on the phone: an order status, an order note and a stock
count (Settings, "Pending changes"). They are sent once, in order, when the network returns; if the record changed meanwhile the seller chooses which value
wins. Everything else says it needs the network. Speed and release checks: `docs/mobile-performance.md`.

### Release builds and the signing key (owner steps)

- Build the Play Store bundle with EAS (`eas build --platform android --profile production`). A release build refuses a server address that is not `https`.
- The **app signing key** is the owner's: let EAS keep it or upload your own, keep a backup outside the repository, and never commit a keystore.
- Package ids: `com.markazify.seller` and `com.markazify.admin` (the "update the app" screen links to these Play Store pages). Raise `version` and
  `android.versionCode` in `app.json` for every release. Set the minimum app version in the console settings only after the new build is in the store.
- On the phone: the refresh token is kept in Android's encrypted storage; cached screens and queued changes are in the app's private storage, are removed on
  sign-out or when the device is revoked, and are excluded from Android backups (`allowBackup: false`).
