## Working rules for batch tasks (Markazify PM loop)
- Never run a git write command (add/commit/push/stash/reset/checkout). Read-only git (status, diff, log) is fine.
- Never print secret values. Never edit .env files. Never connect to a real database; unit tests use stubbed models only.
- Do not create _review, verify/, GAPS* files. Do not commit anything.
- Dev batches SB-1..SB-9 ONLY write code and tests. Do NOT run build, lint, tsc, tests, dev servers or any script that starts an app. You may read code, grep, and run read-only git.
- Because nothing compiles until SB-10, be extra careful: exact imports, types and exports; when you change a signature or rename something, grep every caller and update it; write tests that will pass, but do not run them.
- SB-10 (FINAL CHECK, same chat) runs tsc for every workspace, lint where a lint script exists, all tests and the five next builds, fixes failures, and reports the numbers.
- Gate verification happens in a separate chat. Never create verify/ files here.
- At the end of every batch write two files in the repo root, then say "written": (1) OB<id>_REPORT.txt, max ~60 lines: file list, test counts before/after, deviations and changed existing tests, found-but-not-touched, questions; no list of every test name. (2) OB<id>_CHANGES.txt: the output of `git diff` plus the full content of every new untracked file from `git status --short`. The PM reviews from this file.
- If budget runs low, write the report with what is done before stopping.

## Sprint 4 state (read this instead of exploring)
- Route order: authenticate -> role -> parse (400 + field) -> assertCan -> DB -> id -> resolveOwnedStoreId(request, ctx, null) -> findOne({_id, store}) -> ONE compare-and-set write -> re-read -> best-effort audit.
- Notifications: @markaz/notifications (outbox, templates, providers). Seller glue: apps/seller/backend/src/lib/notifications.ts (enqueueEmail, runAfterResponse, notifyOrderPlaced, notifyOrderStatus, createSellerAlert, loadStoreNotifyInfo). Never throws; runs after the response.
- Auth: packages/auth (auth-tokens, session-guard, rate-limit, account-flows). Limiter glue in seller lib/account-support.ts. requireVerifiedEmail helper and EMAIL_NOT_VERIFIED in contracts.
- Store settings: seller lib/store-settings.ts, lib/store-readiness.ts, lib/owned-store.ts; contracts src/store-settings.ts. Go-live route: api/stores/[id]/go-live.
- Money is whole rupees. New ledger collection CommissionEntry (SB-6). The old commissionLedger is read-only and never touched.
- Dev batches write code and tests only: no build, lint, tsc, tests, install or servers. No git write commands, no .env edits, no secret values printed, no real DB.
- Batch report: write SBn_REPORT.txt only (max 60 lines). Do NOT hand-write a changes file; run: git diff HEAD > SBn_CHANGES.txt and git ls-files -o --exclude-standard > SBn_NEWFILES.txt. Reply: written.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `python -m graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `python -m graphify path "<A>" "<B>"` for relationships and `python -m graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `python -m graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
