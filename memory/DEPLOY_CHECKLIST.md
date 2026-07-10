# Deploy Ritual (Shelfsort)

Surface this checklist whenever the user mentions deploying, has just clicked Deploy, or asks about deploy timing / readiness.

## Before clicking Deploy
```bash
cd /app && bash scripts/pre_deploy.sh
```
Must show **`✓ pre-deploy sweep: PASS  5/5 checks green`** before proceeding.

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
