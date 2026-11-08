## Working rules for batch tasks (Markazify PM loop)
- Never run a git write command (add/commit/push/stash/reset/checkout). Read-only git (status, diff, log) is fine.
- Never print secret values. Never edit .env files. Never connect to a real database; unit tests use stubbed models only.
- Do not create _review, verify/, GAPS* files. Do not commit anything.
- Per batch: run tests and tsc only for the packages/apps you touched. Run all-workspace tsc and the next builds only when the task says "FINAL CHECK".
- At the end of every batch write two files in the repo root, then say "written": (1) OB<id>_REPORT.txt, max ~60 lines: file list, test counts before/after, deviations and changed existing tests, found-but-not-touched, questions; no list of every test name. (2) OB<id>_CHANGES.txt: the output of `git diff` plus the full content of every new untracked file from `git status --short`. The PM reviews from this file.
- If budget runs low, write the report with what is done before stopping.
