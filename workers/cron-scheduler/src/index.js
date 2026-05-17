// workers/cron-scheduler/src/index.js
// =========================================================================
// SECURITY-CARVE-OUT: do not edit in auto mode
// Signer side of the cron-Worker -> Pages-endpoint trust boundary. The
// signing algorithm and body-shape contract MUST stay in sync with
// functions/_lib/cron_auth.js. Any change to either is a re-lock trigger.
// =========================================================================
//
// Per BLOCK_9_PLAN.md §9.4 decisions Q + R + T:
//   - Triggered at 08:00 UTC daily (wrangler.toml)
//   - Splits env.CRON_SOURCES_FAN_OUT ("jira,slack") and POSTs each
//     source as a SEPARATE request, in parallel via Promise.allSettled.
//     Each Pages invocation gets its own 30s CPU budget (decision T).
//   - HMAC-SHA256 signature over `${t}:${sha256(body)}` using
//     env.CRON_SECRET. Header: X-Cron-Auth: t=<unix>,v1=<hex>.
//   - JSON.stringify(obj) with NO second arg (canonical compact form
//     per cron_auth.js jsdoc — must match verifier byte-for-byte).
// =========================================================================

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(keyText, dataText) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyText),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dataText));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function postOneSource(env, source) {
  // NO second arg to JSON.stringify — see header re: canonical compact form.
  const bodyText = JSON.stringify({ sources: [source] });
  const enc = new TextEncoder();
  const bodyHashHex = await sha256Hex(enc.encode(bodyText));
  const t = Math.floor(Date.now() / 1000);
  const v1 = await hmacSha256Hex(env.CRON_SECRET, `${t}:${bodyHashHex}`);

  const url = `${env.PAGES_BASE_URL}/api/cron/incremental-sync`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cron-Auth': `t=${t},v1=${v1}`,
    },
    body: bodyText,
  });
  const responseText = await res.text();
  let responseSummary;
  try {
    const parsed = JSON.parse(responseText);
    responseSummary = {
      ok: parsed.ok,
      ran: parsed.ran,
      succeeded: parsed.succeeded,
      failed: parsed.failed,
    };
  } catch {
    responseSummary = { ok: false, raw: responseText.slice(0, 200) };
  }
  return { source, status: res.status, ...responseSummary };
}

export default {
  async scheduled(event, env, ctx) {
    if (!env || !env.CRON_SECRET) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'cron_secret_missing_in_worker',
      }));
      return;
    }
    if (!env.PAGES_BASE_URL) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'cron_pages_base_url_missing',
      }));
      return;
    }
    const sources = String(env.CRON_SOURCES_FAN_OUT || 'jira,slack')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (sources.length === 0) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'cron_no_sources_configured',
      }));
      return;
    }

    // Parallel per-source POSTs per decision T. allSettled so one
    // source's failure does not reject the other's result.
    const results = await Promise.allSettled(
      sources.map((source) => postOneSource(env, source))
    );

    for (let i = 0; i < results.length; i++) {
      const source = sources[i];
      const r = results[i];
      if (r.status === 'fulfilled') {
        console.log(JSON.stringify({
          level: 'info',
          event: 'cron_post_success',
          ...r.value,
        }));
      } else {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'cron_post_failed',
          source,
          error: r.reason && r.reason.message ? String(r.reason.message).slice(0, 200) : 'unknown',
        }));
      }
    }
  },
};
