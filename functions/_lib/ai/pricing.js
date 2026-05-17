// functions/_lib/ai/pricing.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
//
// Per-token pricing constants used by Block 10.2's per-project monthly
// AI cost cap. Single source of truth — a typo here misrepresents every
// project's spend across every cap-check and admin-notification.
//
// Source: Anthropic + OpenAI public pricing pages as of May 2026.
// Verify against the actual billing dashboard before changing values.
// Mid-month price changes affect new sends only — past messages.cost_usd
// rows stay at the prior price (desirable for cap accuracy and audit
// continuity).
//
// Adding a new model:
//   1. Add its provider/model key to TOKEN_PRICES_USD_PER_MILLION below.
//   2. Add a CASE branch to the backfill SQL in BLOCK_10_PLAN.md
//      decision G (if a corresponding ALTER + backfill is needed).
//   3. computeCostUsd returns null for unknown models — downstream
//      callers store NULL cost_usd for those rows; the cap-pre-check
//      SUM treats NULL as 0 (COALESCE), so an unknown-model message
//      doesn't accidentally burst the cap. Defensive but not ideal —
//      add the model to this map sooner rather than later.
//
// Per BLOCK_10_PLAN.md uncertainty #1: if Anthropic publishes a price
// change, edit this file in default mode and run a backfill UPDATE in
// Neon for any past rows you want re-priced (in practice, leave them
// at the old price — they were billed at it).
// =========================================================================

/**
 * Per-million-token pricing by 'provider/model' identifier.
 * Match the strings used in messages.model and ai/loop.js MODEL_ID.
 *
 * @type {Record<string, { input: number, output: number }>}
 */
export const TOKEN_PRICES_USD_PER_MILLION = {
  'anthropic/claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'anthropic/claude-haiku-4-5':  { input: 0.25, output: 1.25 },
  'openai/text-embedding-3-small': { input: 0.02, output: 0 },
};

/**
 * Compute USD cost for one model call from its token counts.
 *
 * @param {string|null|undefined} model
 * @param {number|null|undefined} inputTokens
 * @param {number|null|undefined} outputTokens
 * @returns {number|null} cost in USD, or null if model not priced
 */
export function computeCostUsd(model, inputTokens, outputTokens) {
  const p = TOKEN_PRICES_USD_PER_MILLION[model];
  if (!p) return null;
  const inT = Number(inputTokens) || 0;
  const outT = Number(outputTokens) || 0;
  return (inT * p.input + outT * p.output) / 1_000_000;
}
