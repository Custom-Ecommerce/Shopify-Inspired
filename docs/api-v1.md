# Markazify API v1

The v1 API lets your own tools read one store's products and orders. It is **read-only**: no request changes anything. There are no webhooks.

> Status: **live**. Version `v1`: the field names below do not change within v1. A breaking change would be a new version.

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
| `orders:read` | List orders and read one order. Of the customer, only the city |

## Endpoints

All endpoints are `GET` on the seller API server. Any other method is answered `405`. Send only the `Authorization` header: cookies and other headers are ignored, and the key alone decides which store is read.

| Endpoint | Scope | Status |
| --- | --- | --- |
| `GET /api/v1/products` | `products:read` | live |
| `GET /api/v1/products/{id}` | `products:read` | live |
| `GET /api/v1/orders` | `orders:read` | live |
| `GET /api/v1/orders/{id}` | `orders:read` | live |

A list answers `{ "data": [...], "nextCursor": ... }`; one record answers `{ "data": { ... } }`. Money is in whole Pakistani rupees. Dates are ISO 8601 in UTC.

## Pagination and filters

List endpoints return one page at a time, newest created first.

| Parameter | Meaning |
| --- | --- |
| `limit` | Items per page. Default 20, at most 100. |
| `cursor` | The `nextCursor` of the previous page. Leave it out for the first page. |
| `updatedSince` | Only records changed at or after this instant, for example `2026-11-01T00:00:00Z`. Write a `+` in a time zone as `%2B`. |

```json
{ "data": [], "nextCursor": null }
```

`nextCursor` is `null` on the last page. Treat a cursor as an opaque string. Send the same `updatedSince` with every page.

## Product

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Record id, used in `/api/v1/products/{id}` |
| `name` | string | Product name |
| `slug` | string | The product's address in the store |
| `description` | string or null | |
| `price` | integer | The lowest price of the product's variants |
| `comparePrice` | integer or null | The compare-at price, when higher than `price` |
| `stock` | integer or null | Units over all variants; `null` when stock is not tracked |
| `status` | string | `published`, `draft` or `taken_down` |
| `category` | object or null | `{ "id", "name", "slug" }`, the product's first category |
| `images` | array | `{ "url", "alt" }`, in the store's order |
| `updatedAt` | string | Last change |

A product moved to the trash is no longer listed, and reading it answers `404`.

## Order

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Record id, used in `/api/v1/orders/{id}` |
| `orderId` | string | The order number shown to the customer |
| `status` | string | `pending`, `confirmed`, `processing`, `dispatched`, `delivered`, `cancelled` or `returned` |
| `paymentMethod` | string or null | `cod` or `card` |
| `paymentStatus` | string | `unpaid`, `collected` or `paid` |
| `items` | array | `{ "productId", "variantId", "name", "variantName", "sku", "unitPrice", "quantity" }` |
| `subtotal` | integer | |
| `deliveryCharges` | integer | |
| `discount` | integer | Taken off the subtotal |
| `taxAmount` | integer | `0` when the order had no tax |
| `total` | integer | |
| `city` | string or null | The delivery city |
| `createdAt` | string | |
| `updatedAt` | string | |

An order has **no customer name, phone number, email address or street address**. Read those in the seller portal.

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

### 403: the store or its plan

The store is suspended or closed:

```json
{ "error": { "code": "STORE_UNAVAILABLE", "message": "The store of this API key is not available." } }
```

The seller's plan no longer includes API keys, for example because a subscription ended:

```json
{ "error": { "code": "PLAN_LIMIT_REACHED", "message": "The plan of this store no longer includes API keys." } }
```

### 400: a bad query parameter

```json
{ "error": { "code": "INVALID_REQUEST", "message": "limit must be a whole number from 1 to 100.", "field": "limit" } }
```

### 404: not found

The record does not exist in the store of this key. A record of another store gets the same answer.

```json
{ "error": { "code": "NOT_FOUND", "message": "Not found." } }
```

### 429: too many requests

The response has a `Retry-After` header with the number of seconds to wait.

```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Wait and try again.", "retryAfterSeconds": 30 } }
```

### 503: try again

```json
{ "error": { "code": "SERVICE_UNAVAILABLE", "message": "The service is temporarily unavailable. Try again." } }
```

A `503` says nothing about your key. Wait and retry.

## Rate limit

Each key can make **120 requests per minute**. The count is per key, in fixed one-minute windows. There is no daily limit.

When you get a 429, wait the number of seconds in `Retry-After` before the next request.
