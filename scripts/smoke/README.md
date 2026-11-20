# Smoke script

`run.mjs` checks a set of already-running apps. It starts nothing: you start the apps first, pointed at a **throwaway**
database, and give the script their base URLs.

```bash
SELLER_BACKEND_URL=http://127.0.0.1:4001 \
ADMIN_BACKEND_URL=http://127.0.0.1:4010 \
STOREFRONT_URL=http://127.0.0.1:3000 \
MONGODB_URI=<the throwaway database URI the apps use> \
node scripts/smoke/run.mjs
```

## Safety

- It refuses to run unless the database NAME in `MONGODB_URI` (and in `SELLER_MONGODB_URI`, if set) contains the word `throwaway` or `test`.
  Only the name is looked at, not the host, user, password or options. The value is never printed.
- Every request is one that must be refused or that only reads, so the database is not written to.

## What it checks

| App | Check | Expected |
| --- | --- | --- |
| Seller backend | `GET /api/health` | 200, `{ status: "ok" }` |
| Seller backend | `POST /api/unsubscribe` with a bad signature | 404 |
| Seller backend | `GET /api/storefront/v1/stores/by-key/<unknown>?by=slug` | 404 (the public route answers) |
| Seller backend | `GET /api/internal/notifications/flush` without the secret | 401 |
| Admin backend | `GET /api/internal/notifications/flush` without the secret | 401 |
| Admin backend | `GET /api/admin/me` without a session | 401 |
| Storefront | `GET /robots.txt` | 200 |

The admin backend has no health route, so its liveness is shown by the two refusals above. Exit code: 0 all passed,
1 a check failed, 2 refused to run.

## The Sprint 3 gate harness (`verify/`)

`verify/` is **git-ignored and stays out of git**. It is a local folder and is not in a fresh clone or in CI. A gate
run needs these pieces of it:

- `env.mjs`: builds each app's environment from the `.env` files and forces the throwaway database names. Needed by all the rest.
- `servers.mjs` and `stop.mjs` (with `pids.json`): start and stop the apps for a run.
- `seed.json`: the seed data the gates expect.
- `stripe-mock.mjs` and `stripe-preload.cjs`: a stand-in for Stripe, so no gate talks to the real one.
- `s3-lib.mjs`, `s3-control.mjs`, `delay-proxy.mjs`, `drop-s3.mjs`: helpers of the S3 gates (delay or drop a call).
- `gates-api.mjs`, `gates-ui.mjs`, `gates-ui-checkout.mjs`, `gates-s3-api.mjs`, `gates-s3-ui.mjs`, `v01-v02.mjs`: the gates themselves.

This smoke script is independent of that folder: it needs only the three URLs and a throwaway database.
