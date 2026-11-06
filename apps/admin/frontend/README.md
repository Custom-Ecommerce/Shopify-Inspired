# Admin frontend

The operator console for the Markazify platform. A standalone Next.js app: it imports no backend code and reaches the
admin backend only through its HTTP API, over the same-origin routes in app/api.

## Run

    pnpm --filter @markaz/admin-frontend dev          (port 4020)

Set ADMIN_BACKEND_API_URL (see .env.example). Create the first operator with the create-admin script in apps/admin-portal.

## Theming: one file

Every colour, radius, font, and shadow is a CSS variable in app/globals.css. To re-brand the console, change
--brand-accent (and its dark value) in that file. Nothing else changes. Components use semantic utilities
(bg-primary, text-muted-foreground) and never colour values.

Two checks keep it that way, and both run in pnpm test:

- check:tokens fails on any colour literal (hex, rgb, oklch, a Tailwind palette class, bg-white and similar) outside globals.css.
- the contrast test checks every foreground and background token pair, light and dark, at WCAG 4.5:1.

## Phases

AF0 foundation: sign-in, session proxy, shell, tokens.
AF1 stores and governance: store list, store detail, suspend and activate with a mandatory reason.
AF2 operations: sellers, sync outbox health, the audit log, the commission ledger with store rates, and the subscription plans, all read only.
AF3 catalogue: categories, with create, edit, and delete.
AF4 settings and overview (this phase, and the last): the platform settings form (default commission rate, stores per seller, Stripe note) with a mandatory reason, and the live overview (store, seller, ledger, and sync tiles) at the console home.
Every navigation item is a live page.
