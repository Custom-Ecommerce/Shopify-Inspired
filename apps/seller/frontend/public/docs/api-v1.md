# Markazify API v1

The v1 API lets your own tools read one store's products and orders. It is **read-only**: no request changes anything. There are no webhooks.

> Status: API keys, the key check, scopes and the rate limit are built. The endpoints below are **planned**; they are not available yet.

## API keys

The store owner creates keys in the seller portal under **API keys**. Managers, staff and support cannot see or create them. How many live keys a store can have depends on its plan.

A key looks like this:

```
mkz_live_<8 characters>_<secret>
```

- The full key is shown **once**, when it is created. Markazify keeps only a fingerprint of it and cannot show it again.
- The part `mkz_live_<8 characters>` is public. It is how you recognise a key in the list.
- Revoking a key stops it at once and cannot be undone. A revoked key no longer counts against the plan.
- A key belongs to one store and reads only that store.

Keep a key on a server. Do not put it in a web page, a mobile app, a URL or a repository.

## Authentication

Send the key in the `Authorization` header of every request:

```
Authorization: Bearer mkz_live_<8 characters>_<secret>
```

A key in the query string is not accepted.

## Scopes

A key can read only what its scopes allow. Choose them when you create the key.

| Scope | Allows |
| --- | --- |
| `products:read` | List products and read one product |
| `orders:read` | List orders and read one order, including customer contact details |

## Endpoints

All endpoints are `GET`.

| Endpoint | Scope | Status |
| --- | --- | --- |
| `GET /api/v1/products` | `products:read` | planned |
| `GET /api/v1/products/{id}` | `products:read` | planned |
| `GET /api/v1/orders` | `orders:read` | planned |
| `GET /api/v1/orders/{id}` | `orders:read` | planned |

Money is in whole Pakistani rupees.

## Pagination (planned)

List endpoints will return one page at a time, newest first.

| Parameter | Meaning |
| --- | --- |
| `limit` | Items per page. Default 20, at most 100. |
| `cursor` | The `nextCursor` of the previous page. Leave it out for the first page. |

```json
{ "data": [], "nextCursor": null }
```

`nextCursor` is `null` on the last page. Treat a cursor as an opaque string.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "CODE", "message": "What happened." } }
```

### 401: no valid key

A missing, malformed, unknown, wrong or revoked key all get the same answer.

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Missing or invalid API key." } }
```

### 403: the key lacks the scope

```json
{ "error": { "code": "FORBIDDEN_SCOPE", "message": "This API key does not have the scope for this request." } }
```

### 404: not found (planned)

The record does not exist in the store of this key. A record of another store gets the same answer.

```json
{ "error": { "code": "NOT_FOUND", "message": "Not found." } }
```

### 429: too many requests

The response has a `Retry-After` header with the number of seconds to wait.

```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Wait and try again.", "retryAfterSeconds": 30 } }
```

## Rate limit

Each key can make **120 requests per minute**. The count is per key, in fixed one-minute windows. There is no daily limit.

When you get a 429, wait the number of seconds in `Retry-After` before the next request.
