# Email draft — Emergent Platform: Memory-Tier Upgrade Request

**To:** support@emergent.sh
**From:** *(your email)*
**Subject:** [Prod-degraded] Shelfsort — Request bump from 2 Gi → 4 Gi pod memory (ClamAV signature DB eating budget)

---

Hi Emergent team,

Following the 2026-06-30 OOM diagnosis by your team (thanks for that write-up!), I'd like to request a memory-tier upgrade for our Shelfsort production pod.

## Project
- **App:** Shelfsort
- **Public URL:** https://shelfsort.com
- **Preview URL:** https://genre-sort.preview.emergentagent.com
- **Job ID:** *(grab from the "i" info button in the Emergent chat sidebar)*

## Current situation

Our app scans every user upload with ClamAV. The signature database is ~200 MB on disk but expands to ~978 MB resident when loaded into `clamd` (measured on our preview pod: PID 4666, RSS = 978,452 KB).

On the 2 Gi tier, that leaves us with roughly:
- clamd daemon (steady): ~978 MB
- FastAPI + all our routes + motor + apscheduler + litellm: ~400 MB
- Boot-time spike (apt-get install calibre transient): ~500 MB
- **Total worst case: ~1.9 GB** → OOMKill loop on cold-boot every deploy

We've applied every code-side mitigation we can:
1. Bounded concurrent scans via `threading.BoundedSemaphore(AV_MAX_CONCURRENT_SCANS=1)` in `backend/utils/antivirus.py` (protects against burst OOMs, e.g. 26-file upload triggering 40+ scans).
2. Disabled `clamd` daemon in production and fell back to standalone `clamscan` CLI so signatures don't sit in RAM permanently — invocation-only loads keep idle memory at ~400 MB.
3. Deferred Calibre install to a background task so boot doesn't block.
4. Boot-time gitignore sanitizer + fail-open behaviour if AV isn't available.

Those all help but the scan latency has gone from ~50 ms (daemon mode) to ~6–8 s (standalone mode). For a batch of 20 files, that's ~2 minutes of scanning where it used to be ~1 second. It's acceptable but not ideal.

## What I'd like

Bump our pod memory limit from **2 Gi → 4 Gi** so we can re-enable `clamd` daemon mode. That would:

- Drop scan latency back to ~50 ms per file.
- Leave a safe 3 Gi headroom for FastAPI + apt installs + future features.
- Free me from needing the aggressive concurrency cap (could raise `AV_MAX_CONCURRENT_SCANS=4` for faster burst throughput).

If a memory upgrade isn't feasible on our current plan, an alternative would be a **larger CPU + memory tier as a paid add-on** — happy to discuss pricing.

## Repro / verification

If your team wants to reproduce the OOM loop, our production pod was flapping between 200/520 on ~30–90 s cycles this morning (2026-07-01 ~02:45 UTC) — Cloudflare Ray IDs `a14214ff8a6241cb` and `a1421500caacc5cb` should be in your logs.

Happy to share the full forensic trace, `htop` snapshots from preview, or a live shared session if useful.

Thanks,
*(your name)*

---

## Where to find the Job ID before sending

In the Emergent chat interface, click the small **"i"** (info) button in the sidebar — it'll show you a Job ID you can paste into the line above so the platform team can correlate this email with the right project.
