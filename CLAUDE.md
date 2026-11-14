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
