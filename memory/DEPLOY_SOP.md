# Shelfsort Deploy SOP

This is the standing checklist I run every time you ask "ready to deploy?" —
no shortcuts.  If any step fails I surface it in the reply, prominently, in
red.  Mocks / fake responses get an **ALL-CAPS** call-out.

---

## Pre-deploy (all must pass)

### 1. Service health
- `curl -s http://127.0.0.1:8001/api/health` returns HTTP 200 in ≤8s.
- All boot checks green: `mongo`, `scheduler`, `storage`, `antivirus`,
  `env_config`, `pod_memory`.
- `sudo supervisorctl status` shows `backend`, `frontend`, `mongodb` all
  **RUNNING** with a stable uptime.

### 2. Lint
- Python (`mcp_lint_python`) clean on every file I touched this session.
- JS (`mcp_lint_javascript`) clean on every file I touched.  Pre-existing
  warnings in files I did **not** touch are logged, never blocked.

### 3. Backend regression
- `cd /app/backend && python -m pytest tests/test_presence_and_separation.py -v`
  → all pass in ≤5s.
- Any new backend file I added ships with at least a smoke pytest under
  `backend/tests/`.

### 4. Frontend regression
- `cd /app/backend && python -m pytest tests/test_navbar_frontend_regression.py -v`
  Skips cleanly in-pod (behind `RUN_FRONTEND_PLAYWRIGHT=1` — pod egress
  blocks the loopback).  Skip is not a failure.

### 5. Preview smoke
- Screenshot the public preview URL (`REACT_APP_BACKEND_URL`) — usually
  `/library`.  Expect HTTP 200, zero `pageerror` events, no
  React-error-boundary text ("Something went wrong", "ChunkLoadError").

### 6. Migration / env / mock audit
- Flag any new required env var.
- Flag any DB migration (rare — most changes are on-demand `$set` fields).
- Flag any `MOCK_*` flag or fake response in **ALL CAPS**.

### 7. Deep scan (session-diff)
- `git status --short` — every diff should map to something I intentionally
  touched.  Unexpected diffs get raised, not ignored.
- Walk every touched file for: orphan JSX (Navbar collapse incident),
  missing imports (`useRef` incident), stray `console.log` / `print()`,
  hardcoded URLs / secrets, hardcoded `localhost:...` fetches.

### 8. Prod-vs-source drift check ⚠️ **HARDENED — 2026-07-08**

Automated by `scripts/deploy_drift_check.py`.  Fetches the currently-live
prod bundle, extracts **every** `data-testid` (both JSX standard form and
`testid:"..."` custom-prop form used by Card / Link components), and
counts source occurrences.  Any prod testid with **zero** source matches
means a live feature would be silently regressed by the deploy — abort.

```bash
python3 /app/scripts/deploy_drift_check.py
```

Exit codes:
- `0` — no drift, safe to deploy
- `1` — prod-only testids detected → **ABORT**
- `2` — fetch / IO error

This step was hardened after the 2026-07-08 deploy silently dropped 19
testids / feature clusters that the OLD "hand-picked 7-marker" spot
check couldn't detect.  Every deploy now walks all 2000+ testids the
prod bundle exposes.

3rd-party library internals (epub.js, Recharts, radix-UI pseudo-testids)
are pre-listed in `IGNORE_TESTIDS` at the top of the script.  Add new
noise there if a future library shows up in the drift report.

---

## Post-deploy (after user confirms the deploy shipped)

### 9. Prod health
- `curl https://shelfsort.com/api/health` → 200, all checks green,
  `boot_id` matches a *new* value (not the pre-deploy one).

### 10. Prod stats
- `curl https://shelfsort.com/api/landing/stats` → returns real numbers,
  not zeros, `as_of` in the last minute.

### 11. Prod smoke
- Screenshot `https://shelfsort.com/` — expect zero `pageerror` events,
  hero copy visible, maintenance banner rendering correctly.

### 12. Change verification
- Hit at least one endpoint that was actually modified in this session
  (with the appropriate auth) and confirm the *new* shape / field is
  present in prod.  For a frontend-only change, grep the fresh prod
  bundle for one of the new `data-testid` values.

---

## Report format

I reply with a green-block if all pass, or a red-blocker-first block if
anything fails.  Mocks + skips are called out **before** the go/no-go line
so you never miss them.

Rules I hold myself to:

- Never silently skip a step (unavailable tool → `⚠️ SKIP: <reason>`).
- Any red mark = prominent blocker, never buried.
- Ambiguity → ask before green-lighting.
- Mocks / fake responses get an ALL-CAPS callout.
