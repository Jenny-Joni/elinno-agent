// functions/_lib/ai/embeddings.js
//
// OpenAI embeddings helper. text-embedding-3-small, 1536-dim.
//
// Errors are typed via EmbeddingError.retryable so callers (the
// embed-on-write hook and the post-sync sweep) can decide whether to
// re-try later or drop the row:
//   - retryable=true:  network failure, 429, 5xx
//   - retryable=false: 4xx other than 429 (auth, request shape)
//
// No internal retry. OpenAI per-minute caps are tight enough that a
// blanket internal retry would burn budget on transient hiccups; the
// caller knows whether it's running inside a webhook (drop, sweep
// catches it) or inside the sweep itself (already idempotent).

const OPENAI_API_BASE = 'https://api.openai.com';
const EMBEDDING_MODEL = 'text-embedding-3-small';

export class EmbeddingError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'EmbeddingError';
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * Embed a single string. Returns a 1536-element Float array.
 *
 * @param {object} env - Pages env; reads env.OPENAI_API_KEY
 * @param {string} text
 * @returns {Promise<number[]>}
 * @throws {EmbeddingError}
 */
export async function embedText(env, text) {
  const [vector] = await embedTextsBatch(env, [text]);
  return vector;
}

/**
 * Embed an array of strings in a single API call. Returns an array of
 * 1536-element Float arrays, parallel-ordered to the input.
 *
 * @param {object} env - Pages env; reads env.OPENAI_API_KEY
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 * @throws {EmbeddingError}
 */
export async function embedTextsBatch(env, texts) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError('OPENAI_API_KEY missing', { retryable: false });
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new EmbeddingError('texts must be a non-empty array', { retryable: false });
  }

  let response;
  try {
    response = await fetch(`${OPENAI_API_BASE}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
    });
  } catch (err) {
    throw new EmbeddingError(`network failure: ${err.message}`, { retryable: true });
  }

  if (!response.ok) {
    const status = response.status;
    let detail = '';
    try {
      detail = await response.text();
    } catch (_) {
      // body unreadable
    }
    const retryable = status === 429 || (status >= 500 && status < 600);
    throw new EmbeddingError(
      `openai embeddings http ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      { status, retryable }
    );
  }

  const json = await response.json();
  const data = json && Array.isArray(json.data) ? json.data : null;
  if (!data || data.length !== texts.length) {
    throw new EmbeddingError(
      `unexpected response shape: data length ${data ? data.length : 'missing'} for ${texts.length} inputs`,
      { status: 200, retryable: false }
    );
  }

  return data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((row) => row.embedding);
}

export const EMBEDDING_MODEL_ID = `openai/${EMBEDDING_MODEL}`;
