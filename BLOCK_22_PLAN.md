# Block 22 — chat moves to Claude Opus 5

**Execute mode: DEFAULT (security carve-out, no auto)**

`functions/_lib/ai/loop.js` and `functions/_lib/ai/pricing.js` both carry the
`SECURITY-CARVE-OUT: do not edit in auto mode` banner. Every commit in this
block is per-action review.

## Context

Chat runs on `claude-sonnet-4-5` (`loop.js:28`), a generation behind. The
agent loop is a 6-iteration tool-calling loop over five Jira/Slack tools —
squarely the workload the current Opus tier is strongest at. Jenny chose
**Claude Opus 5** (`claude-opus-5`, $5/$25 per MTok) on 2026-08-18.

The request body today sets **no** `temperature`, `top_p`, `top_k`, or
`thinking` — verified in `anthropic.js`. Those parameters are rejected on
Opus 5, so their absence means the usual migration breaking changes do not
apply here. The migration is small; the two problems below are what make it
a block rather than a one-line swap.

**Problem 1 — `max_tokens: 1024` will truncate.** Opus 5 thinks by default
when `thinking` is omitted, and `max_tokens` caps thinking *plus* response
text together. 1024 is already tight for a 137-issue sprint answer; with
thinking sharing the budget it truncates mid-sentence.

**Problem 2 — cost attribution is hardcoded, and fallbacks would break it.**
`MODEL_ID` is the constant `'anthropic/claude-sonnet-4-5'` (`loop.js:29`),
used at lines 485, 491, and 555 to stamp the message row and compute
`cost_usd`. Enabling `fallbacks` lets Opus 4.8 serve a declined request —
but the row would still claim Opus 5 and bill at Opus 5 rates. Cost
attribution must read the **served** model from the response, not a constant.

**Problem 3 — a refusal renders blank.** `loop.js:495` branches only on
`stop_reason !== 'tool_use'`. Opus 5 ships elevated cybersecurity safeguards,
so `stop_reason: "refusal"` is a real outcome; `content` is then empty and
the user sees an empty answer with no explanation. It does not crash — the
code filters `content` rather than indexing `[0]` — but it fails silently.

## Locked decisions

Settled with Jenny, 2026-08-18.

- **A. Model: `claude-opus-5`.** `MODEL_ID` becomes
  `anthropic/claude-opus-5`.
- **B. `max_tokens`: 1024 → 8000.** Generous for thinking on a sprint
  question while staying clear of a non-streaming HTTP timeout in the Worker.
- **C. Effort: `high`** — the API default, stated explicitly so it is visible
  rather than implied. `medium` is the cost lever if needed; Opus 5's lower
  effort levels are unusually strong, so a sweep belongs after it is live,
  not before.
- **D. The D11 system prompt is NOT touched.** The file requires a re-lock
  conversation for any prompt edit. Opus 5's known shifts (longer answers,
  self-verification, scope expansion) are all prompt-tuned — we ship the model
  swap alone, read real answers, and open a scoped re-lock later only if the
  behaviour warrants it. One variable moves.
- **E. Cost is attributed to the model that actually served the turn**, read
  from the response, not from a constant.
- **F. `fallbacks: "default"` is enabled** so a declined request re-runs on
  Opus 4.8 server-side instead of returning nothing. Requires the
  `server-side-fallback-2026-07-01` beta header. Decision E is a precondition
  for this, not an optional companion.

### Defaults taken where no instruction was given

- **Cost caps unchanged.** `projects.ai_monthly_cap_usd` and
  `daily_message_limit` are production data and Jenny's to write. They were
  sized for Sonnet 4.5 at $3/$15; at Opus 5's $5/$25 plus thinking, expect
  **2–4× per message**, so the existing caps bite 2–4× sooner. No SQL in this
  block — flagged in the closeout instead.
- **Haiku 4.5 misprice corrected, not deleted.** `pricing.js:39` carries
  `{0.25, 1.25}`; actual Haiku 4.5 pricing is `{1.00, 5.00}`. Corrected
  rather than removed: `computeCostUsd` returns `null` for an unpriced model,
  and a null cost is a silent gap, whereas a correct row costs nothing to
  keep.

## Sub-tasks

| # | Sub-task | Mode |
|---|---|---|
| 22.0 | This plan | AUTO |
| 22.1 | `pricing.js`: add `anthropic/claude-opus-5` and `anthropic/claude-opus-4-8`; correct Haiku 4.5 to $1/$5 | DEFAULT · CARVE-OUT |
| 22.2 | `loop.js`: model, `max_tokens`, explicit `effort` | DEFAULT · CARVE-OUT |
| 22.3 | Cost attribution reads the served model from the response (decision E) | DEFAULT · CARVE-OUT |
| 22.4 | `fallbacks: "default"` + beta header (decision F) | DEFAULT · CARVE-OUT |
| 22.5 | Handle `stop_reason: "refusal"` — a user-facing message, never a blank answer | DEFAULT · CARVE-OUT |
| **22.6** | **VERIFICATION GATE — matrix below, on the preview, against a real sprint question** | DEFAULT |

## Files

- **Modified:** `functions/_lib/ai/loop.js` (model constants, `max_tokens`,
  `effort`, `fallbacks`, refusal branch, cost attribution),
  `functions/_lib/ai/pricing.js` (three table rows)
- **Reused:** `createMessage` in `anthropic.js` — it forwards an arbitrary
  body, so `effort`, `fallbacks`, and the beta header need no transport change
- **Untouched:** the D11 `SYSTEM_PROMPT` (decision D), `tools.js` and every
  executor's project scoping, `ITERATION_CAP`

## Verification matrix (22.6)

| # | Check | Threshold |
|---|---|---|
| 1 | A real sprint question answers end to end | No truncation; `stop_reason` is `end_turn`, never `max_tokens` |
| 2 | Tool calling still works | ≥1 `tool_use` round trip; citations still server-derived |
| 3 | Cost row is correct | `messages.model` matches the served model; `cost_usd` non-null and priced at that model's rates |
| 4 | Answers are not truncated at 8000 | Inspect `usage.output_tokens` against the cap across several questions |
| 5 | Refusal path | Forced refusal renders a user-facing message, never a blank bubble |
| 6 | Fallback path | A fallback-served turn attributes cost to Opus 4.8, not Opus 5 |
| 7 | No regression in project scoping | Citations reference only rows the tools returned; cross-project isolation unchanged |
| 8 | Console + logs | 0 errors across several chat turns |

## Risks worth naming

- **Cost is the real risk, not correctness.** Every chat message gets more
  expensive on a live product, and the existing caps were sized for a
  cheaper model. Watch the first day's spend before assuming the caps hold.
- **Answer style will shift and we are deliberately not compensating.**
  Decision D means the first Opus 5 answers may be longer or more
  self-verifying than the current voice. That is information, not a defect —
  read it before deciding whether a prompt re-lock is warranted.
- **The thinking budget is unmeasured.** 8000 is a reasoned starting point,
  not a measured one; item 4 exists to catch it being wrong in either
  direction.
- **`ITERATION_CAP = 6` is unchanged and untested against Opus 5**, which
  reasons more per step. If answers start hitting the cap, that is the next
  dial — not `max_tokens`.
