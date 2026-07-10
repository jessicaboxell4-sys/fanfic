# Compensation Email Draft — HOLD until issue fully resolved

**Status:** DRAFT — do NOT send yet.  Jessica wants to wait until the
Save-to-GitHub push (HTTP 500 / repo-history case) is fully cleared
by Emergent Support, then update this draft with the final resolution
timeline before sending.

**Trigger to send:** once Support has either (a) confirmed the direct
branch export of commit `b3fbaa76` to `conflict_100726_0825`, or
(b) fixed the underlying GitHub push flow so the push works end-to-end.

---

## Evidence snapshot (as of 2026-07-10 12:32 UTC)

- **First regression detected:** 29 June 2026 01:25 UTC
- **Latest regression detected:** 10 July 2026 12:32 UTC
- **Duration blocked so far:** ~11 days, 11 hours
- **Total incidents in `memory/gitignore_regression_audit.log`:** 86 across 9 days
- **Peak days:** 3 Jul (18), 7 Jul (13), 1 Jul (12), 2 Jul (12)
- **Support postmortem email:** 10 July 2026 (root cause confirmed
  as platform-side — misleading error handler + push flow injecting
  `.env` ignore lines)
- **Support remediation commit:** `10987d07 "stability sprint"` (182 files)
- **Follow-up outage type:** GitHub HTTP 500 pack transfer, likely
  related to ~2.2 GB repo history — Support offered engineering
  export as option (b).

## Credit usage window to screenshot before sending

- Open Emergent dashboard → Profile → Universal Key / Billing / Usage
- Screenshot usage from **29 June 2026 onwards**
- Attach to the email

### Credit usage tally captured 2026-07-10 (from dashboard screenshots) — COMPLETE

| Date | Credits used | Notes |
|---|---:|---|
| Jun 29 | 220.14 | first regression detected 01:25 UTC |
| Jun 30 | 627.03 | Agent 607.03 + Univ Key 20 |
| Jul 1 | **1,088.41** | Agent 863.41 + **Deployment fail -225** (net -141.67 after +83.33 refund). Separate platform incident. |
| Jul 2 | 395.59 | |
| Jul 3 | **917.11** | ← peak spike (18 gitignore regressions) |
| Jul 4 | 128.10 | |
| Jul 5 | 107.37 | |
| Jul 6 | 131.63 | |
| Jul 7 | 36.67 | |
| Jul 8 | 340.81 | |
| Jul 9 | **594.74** | spike (7 regressions) |
| Jul 10 | **407.15** | today (8 regressions + Support-triggered fix attempts) |
| **TOTAL — 12 days (29 Jun – 10 Jul)** | **🔴 4,994.75 credits** | |

**Top-ups paid for during the same window:**
- Jul 2: +500
- Jul 3: +1,250
- Jul 9: +1,250
- **Total real money spent during outage: 3,000 credits topped up**

**Current balance (2026-07-10):** 386.89 · Plan credits 0/100

**Peak-day / regression-count correlation:**
- Jul 3 (spike 917 credits) matches 18 gitignore regressions — highest day
- Jul 9 (594 credits) matches 7 regressions
- Jul 10 (407 credits) matches 8 regressions (today, Support-remediation day)
- Jul 1 (1,088 credits, HIGHEST day) had a *separate* platform deployment
  failure (-225 charged, +83.33 partial refund) — worth calling out.

---

## Draft body

```
To: support@emergent.sh
Subject: Compensation request — 11-day platform outage on Save-to-GitHub (Shelfsort)

Hi Emergent team,

Following up on your 10 July 2026 email where you confirmed the "Save
to GitHub" failures were caused by two platform-side bugs on your end
(misleading error handler + push flow injecting env-ignore lines the
pre-commit hook forbade).

Grateful for the postmortem and the direct commit of my staged work
(commit 10987d07 "stability sprint") — but I'd like to formally
request compensation for the impact this had on my project.

## Impact summary
- **Project:** Shelfsort (drift-check-live.preview.emergentagent.com)
- **Duration blocked:** 29 June 2026 – [FINAL RESOLUTION DATE]
- **Forensic evidence:** `memory/gitignore_regression_audit.log` on my
  pod contains 86+ documented regression detections across 9+ days,
  auto-captured by my own audit script before each failed commit.
- **Impact:**
    - Blocked all pushes to GitHub for the entire window
    - Forced multiple pod forks and re-verification cycles
    - Delayed Emergent Contest submission preparation
    - Consumed a significant chunk of my Emergent credits on
      re-debugging what turned out to be platform bugs
      (screenshot of usage from 29 June onwards attached)
    - Cost me ~11+ days of active development momentum on the app

## Root cause (per your 10 July email)
1. Your platform push flow adds `.env` / `.env.*` / `*.env` to
   `.gitignore` right before committing — the exact lines my
   Shelfsort lint (built after your platform lost my env files
   three times in 48 hours in late June) forbids.
2. Your error handler was pattern-matching on the hook's advice
   text and replacing the real error with "pod has become inactive,"
   sending me and my agent into a week-long infrastructure
   wild-goose-chase.

Neither of these were things I could have diagnosed or fixed on my
side — as you noted in your email, my diagnostics were consistently
correct and were "what made this findable."

## Ask
Given the confirmed platform origin, the [FINAL]-day blockage, and the
credit spend during that window, I'd like to request:

- A credit refund covering usage from 29 June 2026 onwards, OR
- An equivalent value credit top-up, OR
- Whatever your standard compensation policy is for verified
  multi-day platform outages — I'll defer to what's fair.

Thanks for the transparency in the postmortem — I appreciated it.
Just want to make sure the impact side is addressed too.

Best,
Jessica
```

---

## Before sending, update these placeholders

- [ ] `[FINAL RESOLUTION DATE]` — the day Support confirms full fix
- [ ] `[FINAL]-day blockage` — total days from 29 Jun to resolution
- [ ] Refresh regression count from `memory/gitignore_regression_audit.log`
- [ ] Attach screenshot of Emergent credit usage from 29 Jun onwards
- [ ] Grab Job ID from the "i" button in the chat sidebar
