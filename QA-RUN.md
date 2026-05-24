# QA Run Log

> Per-scenario results from running `QA.md` against
> `elinnoagent.com`. Appended in real time during the run.
> See `QA.md` for the full plan and scenario expectations.

---

## Current run

- **Run ID:** _populated when execute phase starts_
- **Started:** _populated when execute phase starts_
- **Prod commit at start:** _populated_
- **Tester:** Jenny + Claude
- **Browser MCP:** _confirmed / not yet / failed_
- **Scratch project slug:** `qa-scratch`
- **Scratch user email:** _populated when execute phase starts_
- **Fix branches created during this run:** _populated as they happen_

### Status legend

- **PASS** — scenario behaved as expected.
- **FAIL** — scenario did not match expected; defect logged.
- **FIXED** — failed, fix pushed to `qa-fix-<slug>` preview, re-run on preview shows PASS, queued for main-push approval.
- **DEFER** — failed; carve-out or out-of-scope-to-fix; recorded for Jenny.
- **BLOCKED** — could not run (external outage, missing setup).
- **N/A** — not applicable in v1.4 (e.g., feature deferred).

---

## §0.5 UI layout & overlap audit

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S0.5.1 |   |   |   |   |
| S0.5.2 |   |   |   |   |
| S0.5.3 |   |   |   |   |
| S0.5.4 |   |   |   |   |
| S0.5.5 |   |   |   |   |
| S0.5.6 |   |   |   |   |
| S0.5.7 |   |   |   |   |
| S0.5.8 |   |   |   |   |
| S0.5.9 |   |   |   |   |
| S0.5.10 |   |   |   |   |
| S0.5.11 |   |   |   |   |
| S0.5.12 |   |   |   |   |
| S0.5.13 |   |   |   |   |
| S0.5.14 |   |   |   |   |
| S0.5.15 |   |   |   |   |

## §1 Auth & session

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S1.1 |   |   |   |   |
| S1.2 |   |   |   |   |
| S1.3 |   |   |   |   |
| S1.4 |   |   |   |   |
| S1.5 |   |   |   |   |
| S1.6 |   |   |   |   |
| S1.7 |   |   |   |   |
| S1.8 |   |   |   |   |
| S1.9 |   |   |   |   |
| S1.10 |   |   |   |   |

## §2 Workspace admin — user mgmt

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S2.1 |   |   |   |   |
| S2.2 |   |   |   |   |
| S2.3 |   |   |   |   |
| S2.4 |   |   |   |   |
| S2.5 |   |   |   |   |
| S2.6 |   |   |   |   |
| S2.7 |   |   |   |   |
| S2.8 |   |   |   |   |
| S2.9 |   |   |   |   |

## §3 Workspace metadata + spend cap

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S3.1 |   |   |   |   |
| S3.2 |   |   |   |   |
| S3.3 |   |   |   |   |
| S3.4 |   |   |   |   |

## §4 Projects CRUD + slug surface

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S4.1 |   |   |   |   |
| S4.2 |   |   |   |   |
| S4.3 |   |   |   |   |
| S4.4 |   |   |   |   |
| S4.5 |   |   |   |   |
| S4.6 |   |   |   |   |
| S4.7 |   |   |   |   |
| S4.8 |   |   |   |   |
| S4.9 |   |   |   |   |
| S4.10 |   |   |   |   |
| S4.11 |   |   |   |   |
| S4.12 |   |   |   |   |
| S4.13 |   |   |   |   |
| S4.14 |   |   |   |   |
| S4.15 |   |   |   |   |
| S4.16 |   |   |   |   |

## §5 Project members

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S5.1 |   |   |   |   |
| S5.2 |   |   |   |   |
| S5.3 |   |   |   |   |
| S5.4 |   |   |   |   |
| S5.5 |   |   |   |   |

## §6 Conversations & messages — chat end-to-end

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S6.1 |   |   |   |   |
| S6.2 |   |   |   |   |
| S6.3 |   |   |   |   |
| S6.4 |   |   |   |   |
| S6.5 |   |   |   |   |
| S6.6 |   |   |   |   |
| S6.7 |   |   |   |   |
| S6.8 |   |   |   |   |
| S6.9 |   |   |   |   |
| S6.10 |   |   |   |   |
| S6.11 |   |   |   |   |
| S6.12 |   |   |   |   |
| S6.13 |   |   |   |   |
| S6.14 |   |   |   |   |
| S6.15 |   |   |   |   |

## §7 Connections — Slack [carve-out]

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S7.1 |   |   |   |   |
| S7.2 |   |   |   |   |
| S7.3 |   |   |   |   |
| S7.4 |   |   |   |   |
| S7.5 |   |   |   |   |
| S7.6 |   |   |   |   |
| S7.7 |   |   |   |   |
| S7.8 |   |   |   |   |

## §8 Connections — Jira [carve-out]

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S8.1 |   |   |   |   |
| S8.2 |   |   |   |   |
| S8.3 |   |   |   |   |
| S8.4 |   |   |   |   |
| S8.5 |   |   |   |   |
| S8.6 |   |   |   |   |

## §9 Cron & sync runs [carve-out]

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S9.1 |   |   |   |   |
| S9.2 |   |   |   |   |
| S9.3 |   |   |   |   |
| S9.4 |   |   |   |   |

## §10 Cross-project chat end-to-end

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S10.1 |   |   |   |   |
| S10.2 |   |   |   |   |
| S10.3 |   |   |   |   |
| S10.4 |   |   |   |   |
| S10.5 |   |   |   |   |
| S10.6 |   |   |   |   |
| S10.7 |   |   |   |   |
| S10.8 |   |   |   |   |
| S10.9 |   |   |   |   |
| S10.10 |   |   |   |   |
| S10.11 |   |   |   |   |

## §11 Dashboard

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S11.1 |   |   |   |   |
| S11.2 |   |   |   |   |
| S11.3 |   |   |   |   |
| S11.4 |   |   |   |   |

## §12 Slug routing pinned-incident regression

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S12.1 |   |   |   |   |
| S12.2 |   |   |   |   |
| S12.3 |   |   |   |   |
| S12.4 |   |   |   |   |
| S12.5 |   |   |   |   |

## §13 Crypto + envelope encryption [carve-out]

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S13.1 |   |   |   |   |
| S13.2 |   |   |   |   |
| S13.3 |   |   |   |   |

## §14 Externals health

_Section status: pending._

| Scenario | Time | Result | Expected vs. actual | Defect / Fix |
|---|---|---|---|---|
| S14.1 |   |   |   |   |
| S14.2 |   |   |   |   |
| S14.3 |   |   |   |   |

## §15 Closeout

_Section status: pending._

| Scenario | Time | Result | Notes |
|---|---|---|---|
| S15.1 |   |   |   |
| S15.2 |   |   |   |
| S15.3 |   |   |   |
| S15.4 |   |   |   |

---

## Run summary

_Populated after §15._

- **Total scenarios:** 122
- **PASS:**
- **FAIL:**
- **FIXED:**
- **DEFER:**
- **BLOCKED:**
- **N/A:**

### Fix branches awaiting per-push-to-main approval

_None yet._

### Carve-out defects deferred to Jenny (default mode)

_None yet._

---

## Defect register

| ID | Section | Scenario | Severity | Description | Status | Fix branch |
|---|---|---|---|---|---|---|
| _None yet._ |||||||

---

## Historical runs

_Earlier runs (if any) get archived here as headed subsections after a new run starts._
