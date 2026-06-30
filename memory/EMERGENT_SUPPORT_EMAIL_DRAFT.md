# Email draft — Emergent Platform: `.gitignore` Auto-commit Regression

**To:** support@emergent.sh
**From:** *(your email)*
**Subject:** [P0 / Deploy-blocking] Recurring platform regression — `emergent-agent-e1` auto-commit re-adds env-blocking lines to `.gitignore` (7+ occurrences in 4 days)

---

Hi Emergent team,

I'm reporting a recurring platform-side regression that has blocked our deploys 7+ times in the last 4 days. Forensic evidence below.

## Project
- **App:** Shelfsort
- **Preview URL:** https://genre-sort.preview.emergentagent.com
- **Job ID:** *(I'll grab this from the "i" button in the chat sidebar before sending)*

## Bug

The Emergent platform's automated commit step — visible in git as author `emergent-agent-e1 <github@emergent.sh>` with subjects like `"auto-commit for <uuid>"` and `"Auto-generated changes"` — periodically re-adds the following lines to `.gitignore`:

```
.env
.env.*
*.env
```

When these are present at deploy time, the `MANAGE_SECRETS` step apparently can't include `backend/.env` and `frontend/.env` in the deploy commit. It falls back to fetching from the source pod, which has already been cleaned up, and deploy dies with:

```
failed to get pod: pods "agent-env-..." not found
```

The production pod boots without `MONGO_URL` (and the other critical env vars), and the public URL returns Cloudflare 520 on every endpoint until a human notices and manually re-runs the deploy after stripping the lines.

## Frequency

**7+ separate occurrences between 2026-06-25 and 2026-06-29.** This isn't a one-off — every 12–24h the auto-commit step undoes my fix.

## Forensic evidence

A sample regression entry from our forensic log (`/app/memory/gitignore_regression_audit.log`, full file available on request):

```
Hit lines (active rules matching forbidden set):
  line 150: '.env'
  line 151: '.env.*'
  line 152: '*.env'

git author/committer identity:
  AUTHOR    = emergent-agent-e1 <github@emergent.sh> 1782696330 +0000
  COMMITTER = emergent-agent-e1 <github@emergent.sh> 1782696330 +0000

git log -10 -- .gitignore:
  6961f4ff 2026-06-28 15:25:33  emergent-agent-e1  auto-commit for c4a92b16-...
  b423cc21 2026-06-28 02:07:52  emergent-agent-e1  Auto-generated changes
  23b5bebb 2026-06-28 00:08:12  emergent-agent-e1  auto-commit for fa215f72-...
  20093a18 2026-06-27 23:14:33  emergent-agent-e1  Auto-generated changes
  7d814bdc 2026-06-27 15:57:14  emergent-agent-e1  auto-commit for cf859b19-...
  7048f012 2026-06-27 05:11:11  emergent-agent-e1  auto-commit for 0d1cec7b-...
  574dce9c 2026-06-25 12:36:17  emergent-agent-e1  Auto-generated changes
  b4b178fd 2026-06-25 04:12:05  emergent-agent-e1  auto-commit for e7b1dd26-...
  ba85ba73 2026-06-25 03:56:26  emergent-agent-e1  Auto-generated changes
  6354cfaf 2026-06-25 03:12:37  emergent-agent-e1  auto-commit for 2c375a3c-...

git diff --cached -- .gitignore (what THIS commit would add):
diff --git a/.gitignore b/.gitignore
@@ -146,3 +146,6 @@ frontend/node_modules/.cache/default-development/31.pack
+.env
+.env.*
+*.env
```

The pattern is consistent: the platform-side auto-commit appends the env-blocking lines to the bottom of `.gitignore` on a roughly 12–24h cadence, even when I've explicitly removed them.

## What I'd like

Either:

- **(a)** Stop the `emergent-agent-e1` auto-commit step from appending `.env` / `.env.*` / `*.env` to `.gitignore`, OR
- **(b)** Make `MANAGE_SECRETS` resilient to those patterns being present (e.g. read env files via filesystem directly instead of via the git tree).

Either fix would also help any other Emergent app using `.env` files, since the same regression presumably hits them too.

## Local mitigations I've already built (so the bug isn't worse than it is)

In case it's useful for your investigation, my agent has built the following workaround stack so deploys don't actually fail in production any more:

1. `scripts/check_gitignore_health.py` — standing lint that fails on the forbidden patterns
2. `scripts/audit_gitignore_regression.py` — forensic snapshot recorder
3. `scripts/fix_gitignore.sh` — idempotent stripper
4. `scripts/pre_deploy.sh` — auto-runs the fix as step 1/5 of every pre-deploy sweep
5. `.git/hooks/pre-commit` — blocks human commits that introduce the bad lines

The platform-side auto-commit bypasses my pre-commit hook (it runs on Emergent's infrastructure), so the above is mitigation, not a fix.

Happy to share any additional forensic data (full audit log, scripts, commit history) on request.

Thanks,
*(your name)*

---

## Where to find the Job ID before sending

In the Emergent chat interface, click the small **"i"** (info) button in the sidebar — it'll show you a Job ID you can paste into the line above so the platform team can correlate this email with the right project.
