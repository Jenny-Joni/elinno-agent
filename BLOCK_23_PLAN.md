# Block 23 — the agent loop survives a dropped database connection

**Execute mode: DEFAULT (security carve-out, no auto)**

`functions/_lib/ai/loop.js` carries the `SECURITY-CARVE-OUT: do not edit in
auto mode` banner. Per-action review.

**Blocks the Block 22 merge.** Both merge together once this lands.

## Context

Observed on the Block 22 preview, 2026-08-18, on a real question against Gems
Launchpad ("Which issues in the current sprint are still in QA, and who owns
them?"). The agent burned all six iterations and returned a partial answer:

| Iteration | `query_jira_issues` result |
|---|---|
| 3 | `Network connection lost.` |
| 4 | `write CONNECTION_CLOSED …hyperdrive.local:5432` |
| 5 | `write CONNECTION_CLOSED …hyperdrive.local:5432` |

**This is one failure cascading, not three failures.**
`messages.js:331` opens a single Postgres client per request, hands it to
`runAgent` (`:512`), which passes that same client into `executeTool` on every
iteration (`loop.js:543`), closing it only at `:599`. When the socket drops
mid-loop, every later tool call reuses a dead client and cannot succeed. The
model cannot distinguish a dead socket from a bad query, so it retries until
the iteration cap.

**Block 22 exposed this; it did not cause it.** The bug is latent on `main`.
Sonnet 4.5 answers fast enough that the pooled connection rarely idles long
enough to be dropped; Opus 5 thinks for tens of seconds between tool calls,
which is exactly the idle window that kills it. Merging Block 22 without this
fix converts a rare degradation into a common one.

**Why it was invisible.** `executeTool` catches its own errors and returns
`{ error: 'tool_execution_failed', error_message }` as a tool *result* rather
than throwing. Nothing 500s, no alert fires — the answer just quietly gets
worse. The user only learned about it because Opus 5 volunteered it:

> "the issue-list query failed three times with database connection errors,
> so I only have the grouped counts above"

**Cost.** That question cost ~$0.23, and four of its six iterations were the
cascade. Fixing this is expected to cut per-message cost substantially, which
is why cap-setting is deliberately sequenced *after* this block.

## Locked decisions

- **A. Retry once, on a fresh client.** A tool result carrying a
  connection-class failure triggers exactly one retry of that call against a
  newly-created client. Once per request, not once per call — a genuinely
  unhealthy database must not buy six reconnect attempts.
- **B. The replacement client's lifecycle belongs to the loop.** `messages.js`
  closes the client it created; it knows nothing about a replacement.
  `runAgent` closes anything it creates.
  **Amended during execute (2026-08-18):** this said "in a `finally`". It is
  implemented on the normal return path instead. A true `finally` requires
  wrapping and reindenting the entire iteration loop in a carve-out file,
  producing a large diff that makes per-action review harder than the leak it
  prevents. On the exception path — `AnthropicError` propagates by design —
  the replacement client is reclaimed at Worker isolate teardown, with
  Hyperdrive pooling underneath. The exposure is bounded and accepted; it is
  not zero.
- **C. Break after 2 consecutive failed tool calls.** The retry covers a
  transient drop; this bounds the cost when the failure is not transient. The
  model still gets the failure results and can answer from what it has —
  which it demonstrably does well.
- **D. Detection is by error-message match**, on a narrow list:
  `CONNECTION_CLOSED`, `Network connection lost`, `CONNECT_TIMEOUT`,
  `ECONNRESET`. Deliberately narrow: a query error, a permission error, or an
  empty result must NOT trigger a reconnect.
- **E. The retry is logged.** `console.warn` with the event name
  `agent_sql_reconnect`, so the real frequency is readable from production
  logs rather than inferred. This is how the fix gets verified for real —
  see the verification note below.
- **F. `ITERATION_CAP` stays 6.** Decision C addresses the wasted-iteration
  cost; changing the cap is a separate question and needs its own evidence.

## Architecture

The loop currently receives a live client and assumes it stays alive. After
this block it owns a *current* client, which it can replace once:

```
messages.js  ──creates──▶ sql  ──passed to──▶ runAgent
                                                 │
                                    activeSql = sql (initially)
                                                 │
                             executeTool(env, activeSql, …)
                                                 │
                        connection-class failure? ──yes──▶ activeSql = fresh client
                                                            (tracked, closed by runAgent)
                                                            retry this call once
```

`messages.js` and the cross-project message route are untouched: they still
create one client and still close it. `runAgent` closes only what it creates.

## Sub-tasks

| # | Sub-task | Mode |
|---|---|---|
| 23.0 | This plan | AUTO |
| 23.1 | Connection-class failure detection (decision D) | DEFAULT · CARVE-OUT |
| 23.2 | Reconnect-and-retry once per request, with the replacement client closed by the loop (decisions A, B, E) | DEFAULT · CARVE-OUT |
| 23.3 | Break after 2 consecutive failed tool calls (decision C) | DEFAULT · CARVE-OUT |
| **23.4** | **VERIFICATION GATE — matrix below** | DEFAULT |

## Files

- **Modified:** `functions/_lib/ai/loop.js` only
- **Untouched:** `tools.js` (also a carve-out — the swallow-into-result
  behaviour is relied upon here, not changed), `messages.js`, the
  cross-project message route, `ITERATION_CAP`, the D11 system prompt

## Verification matrix (23.4)

| # | Check | Threshold |
|---|---|---|
| 1 | A real sprint question answers completely | Issue-level detail present, not just grouped counts |
| 2 | Iterations drop | Materially fewer than 6 on a healthy run |
| 3 | Cost per message drops | Compare against the $0.23 baseline measured 2026-08-18 |
| 4 | No connection leak | One `sql.end()` per client created; replacement closed on the normal return path (decision B as amended) |
| 5 | Non-connection errors do NOT reconnect | Decision D's list is exhaustive; a query error still returns normally |
| 6 | Consecutive-failure break | 2 consecutive failures ends the loop with a usable answer |
| 7 | Block 22 checks still hold | Cost attributed to the served model; no truncation; citations server-derived |

**On reproducing the drop.** The failure depends on how long the model happens
to think, so it cannot be provoked on demand. Items 1–3 are the practical
evidence, and decision E's log line is how the retry path gets confirmed for
real — read `agent_sql_reconnect` from production logs after a few days of
traffic. Item 5 is verified by inspection of the match list. Stated here so
the gate is not later read as stronger than it was.

## Risks worth naming

- **The reconnect is unproven under the real failure.** It is written against
  an observed error signature, not a reproduced one. If the signature differs
  in production, the log line is what will reveal it.
- **A fresh client mid-request costs a connection.** Bounded to one per
  request by decision A, and Hyperdrive pools underneath, so the blast radius
  is small — but it is not free.
- **Decision C can end a turn earlier than the model would have.** That is
  the intent. The observed behaviour — answering from partial data and saying
  so — is good, and two failures is enough signal.
- **This does not fix the underlying drop.** Whether Hyperdrive, Neon, or the
  Worker is closing the socket is undiagnosed. This block makes the loop
  survive it; it does not stop it happening.
