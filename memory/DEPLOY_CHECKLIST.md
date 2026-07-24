# Deploy Ritual (Shelfsort)

Surface this checklist whenever the user mentions deploying, has just clicked Deploy, or asks about deploy timing / readiness.

## 🚨 STEP 0 — SAVE TO GITHUB FIRST 🚨

**NON-NEGOTIABLE.** Before running the pre-deploy sweep, the user MUST click **"Save to Github"** in the chat input. Without a fresh GitHub save, a rollback strands work in a detached state — preview code diverges from the deployed prod bundle, and the only recovery is manual rebuild from chat turn history. This cost hours on 2026-07-19 to recover 100 testids across iter 89-95.

**Assistant rule:** Never say "ready to deploy" until Save to Github has been named explicitly in the current turn. If the user says "deploy" without confirming Save to Github, pause and remind them.

## 🚨 STEP 0.5 — HELP PAGES UP TO DATE? 🚨

Every user-facing feature shipped since the last deploy needs matching copy in `/app/frontend/src/pages/Help.jsx`. Admin-only features → `/app/frontend/src/pages/AdminHelp.jsx`. The auto-parsed "What's New" strip reads from `CHANGELOG.md` and handles announcements, but static how-to sections do NOT. Before greenlighting a deploy the assistant MUST:

1. Grep Help.jsx for any stale copy referring to removed behavior.
2. Confirm every new user-facing capability (e.g. list-view resize / column reorder / show-hide menu / Retry Dedup card) has at least one sentence in the appropriate section.
3. Offer the user a diff if anything is missing — never assume it's fine.


## Before clicking Deploy
```bash
cd /app && bash scripts/pre_deploy.sh
```
Must show **`✓ pre-deploy sweep: PASS  8/8 checks green`** before proceeding.

The 8 checks (as of 2026-08-20):
1. `.gitignore` env-block fix
2. Standing lints (dark-mode, tiny-fonts, gitignore, white-overlay, text-contrast)
3. Preview backend `/api/health` probe
4. Backend pytest (session tests)
5. Bundle-size regression vs `/app/memory/bundle_size_baseline.txt` (fails if >10% growth)
6. Mobile viewport smoke — key pages screenshot at 375x667 (fails on ErrorBoundary or blank body)
7. `data-testid` drift vs live prod bundle (fails if any prod-only testid missing from source)
8. Route sentinel — every internal `<Link to>` / `navigate()` target must map to a registered route

## When each check should be re-baselined
- **Bundle size**: after a legitimate feature adds ≥10% — run
  `python3 scripts/check_bundle_size.py --update-baseline`.
- **Mobile screenshots** live in `/app/artifacts/mobile_screenshots/` — no
  auto-diff yet, but a human can eyeball the folder against the previous
  deploy's set. Full pixel diff is BACKLOG.
- **Legacy pytests** (`test_friends.py`, `test_moderators.py`) are NOT in
  the pre-deploy sweep — verified 2026-08-20: they don't time out
  (run in ~8s against localhost) but have **14 real assertion failures**
  in test_friends alone (likely stale endpoint expectations from
  before iter 89). Backlog: audit each failing test and either fix
  the assertion or delete the stale scenario; then re-add to the
  sweep as a 9th check.

## After clicking Deploy — wait timeline
| When | What's happening |
|---|---|
| 0–30s | Build + `MANAGE_SECRETS` step |
| 30s–2 min | New pod boots, backend/frontend supervised, Calibre/ClamAV bootstrap |
| ~2 min | First smoke check OK |
| 3–5 min | Cloudflare cache aligned, stale tabs pick up new bundle on next click |
| 5–10 min | Real-world sanity window |

**Rule of thumb**: wait ~2 min before first refresh; ~5 min before declaring success.

## One-liner — paste in terminal to watch production health turn green
```bash
while true; do printf "%s " "$(date +%H:%M:%S)"; curl -s -m 5 "https://shelfsort.com/api/health" | python3 -c "import sys,json;d=json.load(sys.stdin);print('✓' if d.get('status')=='ok' else '⏳ '+d.get('status','?'))" 2>/dev/null || echo "✗ 520/timeout"; sleep 5; done
```

Output legend:
- `✗ 520/timeout` → pod still booting (normal for first ~90s)
- `⏳ degraded` → pod up, one check still warming (usually antivirus)
- `✓` → fully green; one more cycle to confirm, then done

Press `Ctrl-C` to stop.

## Red flags
- Still 520-ing after **3 minutes** → likely the `.gitignore` regression biting.
  Check `cat /app/.gitignore | grep -E '^\.env|\*\.env'` — if it has lines, the platform regression hit again. Boot-time sanitizer in `backend/server.py` should have caught it but the deploy ref may have been taken before sanitizer ran.
  → Run `bash scripts/fix_gitignore.sh` locally, commit, re-deploy. Also worth replying to the existing `support@emergent.sh` thread saying "fired again at <timestamp>".

## Green flag
- Hitting any `/api/*` and getting JSON back (even a 401) means the pod is alive and env vars are readable.

## When agent should surface this file
- User says "deploy" / "deploying" / "deployed"
- User asks "is it live?" / "is it ready?" / "ready to deploy?"
- User reports a production-only issue (https://shelfsort.com)
