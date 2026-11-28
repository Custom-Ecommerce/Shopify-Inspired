# Markazify mobile API v1

For the developer of the two Android apps. The seller app talks to the seller backend under `/api/mobile/v1`; the admin app talks to the admin backend under
`/api/admin/mobile/v1` and, with the same access token, to the existing `/api/admin/...` routes.

> **Frozen.** A new optional field in an answer is fine. Anything that would break an installed app needs a `v2`. The wire shapes are the zod schemas in
> `packages/contracts/src/mobile.ts` and `mobile-data.ts` (import `@markaz/contracts/mobile` and `@markaz/contracts/mobile-data`).
>
> The public address of this API (its own host or path behind a gateway) is **not decided** yet; today it is the backend's own address.

## Every request

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <access token>` (except sign-in, refresh, sign-out). `Bearer` only: no cookie, no other scheme. |
| `X-App-Version` | The app's version, for example `1.4.0`. |
| `X-App-Platform` | `android` |
| `x-store-id` | Seller data routes: the store the screen is about. The app chooses it; nothing is guessed. |
| `Idempotency-Key` | Data writes: see below. |

When the platform settings name a minimum version and the app is older (or sends none), every request answers **426**
`{ code: "UPGRADE_REQUIRED", minVersion, storeUrl }`. Show the update screen and keep the session.

Errors: the seller backend answers `{ errors: [{ message }], code?, field? }` (order and product refusals put `code` inside `errors[0]`); the admin backend
answers `{ error, code?, field? }`.

## Sign-in and sessions

| Request | Body | Answer |
| --- | --- | --- |
| `POST auth/login` | `email, password, deviceName, platform, appVersion, installationId?` (admin also `totp?` or `recoveryCode?`) | `accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt, deviceId, user` |
| `POST auth/refresh` | `refreshToken, appVersion?` | new tokens |
| `POST auth/logout` | `refreshToken` | `{ ok: true }` |
| `GET devices` | | the signed-in phones of the account, `current` marks this one |
| `POST devices/:id/revoke` | | `{ id, revoked, changed }` |

- The access token lives **15 minutes**, the refresh token **30 days** (each refresh starts 30 new days).
- A refresh token works **once**. Using one twice ends the whole device session. **Never run two refreshes at the same time**; keep the new token before using it.
- 401 with `SESSION_REVOKED` or `ACCOUNT_SUSPENDED` on refresh: delete the tokens and the cached data, and show sign-in.
- Keep the refresh token in secure storage only. Never log a token.
- `installationId`: a random id made once per installation. Signing in again then replaces the old device entry.
- Password change, "sign out of all other devices" and suspension end every phone session. Password change itself is done on the website (a phone token gets
  403 `WEB_SESSION_REQUIRED`).
- Sign-in limits are shared with the website: 10 wrong passwords per account or 30 per address in 15 minutes, then 429 with `Retry-After`.

### Admin second factor

Every admin phone needs an authenticator app.

1. Sign in with email and password. If the account has no second factor: **403** `TOTP_ENROLMENT_REQUIRED` with `enrolment: { secret, otpauthUri }`.
2. Add it to the authenticator app, then sign in again with `totp`. The answer holds ten `recoveryCodes`, **once**: show them and let the admin save them.
3. Later sign-ins need `totp` (403 `TOTP_REQUIRED` without) or one `recoveryCode`. Wrong: 401 `TOTP_INVALID` or `RECOVERY_CODE_INVALID`; 5 wrong in 15 minutes: 429.
4. Lost authenticator and no codes: an owner resets it (`POST /api/admin/users/:id/reset-second-factor { reason }`).

The sign-in answer also has `adminLevel` and `capabilities`; show only what they allow (the server enforces it anyway).

## Seller data

All need `x-store-id` except `stores`. Lists take `page` and `limit` (default 20, at most 50) and answer `{ docs, page, limit, totalDocs, totalPages }`.

| Request | Who | Notes |
| --- | --- | --- |
| `GET stores` | any seller | the stores the user can work in, with the role |
| `GET dashboard` | owner, manager, staff, support | `revenueThisMonth` is null except for the owner; `lowStockProducts` null without product access; `salesToday`, `salesThisWeek` (analytics rules, UTC days) only for owner and manager |
| `GET orders` | all four roles | `status, from, to, q, confirmation, payment` (`cod` or `paid`); also `counts`, `unconfirmedCount` |
| `GET orders/:id` | all four roles | `allowedNext` says which status moves to offer |
| `GET products`, `GET products/:id` | owner, manager, staff | `q, status, sort, stock=low` |
| `GET customers` | owner, manager, support | `q, sort, repeat, hasEmail, phone` |
| `GET customers/:key` | owner, manager, support | the key of a list row (URL encoded): statistics, note, tags, orders, addresses |
| `GET alerts` | by role | `unread` |
| `POST alerts/:id/read`, `POST alerts/read-all` | by role | mark read; safe to repeat, no Idempotency-Key |

A store the user cannot work in is 403; a record of another store is 404.

## Revision

Every record has `revision` (a number) and `updatedAt`. A variant has its product's revision. A write sends the revision of the record **as the user saw it**.
If the record moved on, nothing is written and the answer is **409** `{ code: "CONFLICT", errors, current }`, where `current` is the record now (same shape as the
read). Show both values and let the user decide; a new attempt is a new `Idempotency-Key`.

## Writes

| Request | Body | Who |
| --- | --- | --- |
| `POST orders/:id/status` | `revision, status, note?, courier?, trackingNumber?, trackingUrl?` | owner, manager, staff |
| `POST orders/:id/notes` | `revision, text` | all four roles |
| `POST products/:id/stock` | `revision, variantId, quantity, reason?` (the absolute count) | owner, manager, staff |
| `POST products/:id/price` | `revision, variantId, price, compareAtPrice?` | owner, manager, staff |

If the record already has the wanted value (same status, same count, same price) the answer is 200 with `changed: false`, whatever the revision.

### Idempotency-Key

Required on the four writes above: 8 to 128 letters, digits, `-` or `_` (a UUID). Make it when the user acts and keep it with the queued change.

| Case | Answer |
| --- | --- |
| First time | the write runs |
| Same key, same request again | the first answer again, header `Idempotent-Replay: true` |
| Same key while the first is still running | 409 `IDEMPOTENCY_IN_PROGRESS`: try again shortly |
| Same key, different request | 422 `IDEMPOTENCY_KEY_REUSED` |

Answers are kept 7 days. 401, 403, 429 and 5xx are not kept: send the same key again.

## Push

| Request | Body |
| --- | --- |
| `POST devices/push-token` | `{ token }` (Expo push token) or `{ token: null }` |
| `GET push-settings` | answers `{ muted, mutedKinds, kinds, quietHours? }` |
| `PATCH push-settings` | `{ muted?, mutedKinds?, quietHours? }` (`{ start, end }` as HH:MM Pakistan time, or null; a push inside them is not sent) |

Register the token after every sign-in and when Expo gives a new one. A push has a title, one short line (order number and amount at most) and a `data` object
with `screen` and ids. Open only these screens, and ignore anything else:

| `data.screen` | App | Ids |
| --- | --- | --- |
| `order` | seller | `storeId, orderId` |
| `inventory` | seller | `storeId` |
| `billing` | seller | |
| `ticket` | seller, admin | `ticketId` |
| `payment` | admin | `paymentId` |
| `sync` | admin | |

Remote push does not work in Expo Go: it needs a development build.
