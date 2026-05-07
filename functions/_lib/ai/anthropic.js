// functions/_lib/ai/anthropic.js
//
// Minimal fetch-based wrapper for POST /v1/messages.
//
// Retry policy (locked, BLOCK_5_PLAN v2.2):
//   - 429: respect Retry-After header if present (seconds), else 500ms.
//   - 5xx: 250ms.
//   Both retry ONCE only. No exponential ladder. After one retry,
//   throw AnthropicError with the final status.

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = 'AnthropicError';
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * POST /v1/messages.
 *
 * @param {object} env - Pages env; reads env.ANTHROPIC_API_KEY
 * @param {object} body - Anthropic Messages request body
 * @returns {Promise<object>} parsed JSON on 2xx
 * @throws {AnthropicError}
 */
export async function createMessage(env, body) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicError('ANTHROPIC_API_KEY missing', { retryable: false });
  }

  let attempt = 0;
  while (true) {
    const response = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return await response.json();
    }

    const status = response.status;

    if (status === 429 && attempt === 0) {
      const waitMs = parseRetryAfterMs(response.headers.get('retry-after')) ?? 500;
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

    if (status >= 500 && status < 600 && attempt === 0) {
      await sleep(250);
      attempt += 1;
      continue;
    }

    let detail = '';
    try {
      detail = await response.text();
    } catch (_) {
      // body unreadable; surface status only
    }
    const retryable = status === 429 || (status >= 500 && status < 600);
    throw new AnthropicError(
      `anthropic http ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      { status, retryable }
    );
  }
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const seconds = parseInt(headerValue, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
