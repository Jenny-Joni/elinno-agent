# elinno-agent-cron-scheduler

Scheduled-trigger Cloudflare Worker that POSTs HMAC-signed nightly
incremental-sync requests to the elinno-agent Pages endpoint. Sibling to
`functions/` — not deployed by Pages.

Per BLOCK_9_PLAN.md §9.4 decisions Q–U.

## What it does

Fires at **08:00 UTC** every night (~04:00 ET / 01:00 PT). For each source
in `CRON_SOURCES_FAN_OUT` (default `jira,slack`), POSTs in parallel to
`{PAGES_BASE_URL}/api/cron/incremental-sync` with body `{ sources: [<src>] }`
and an `X-Cron-Auth` header signed by `CRON_SECRET`.

The Pages endpoint enumerates active connections for that source across
all projects and runs `connector.incrementalSync` per connection,
isolated per failure (decision U).

## Deploy

From the repo root:

```bash
cd workers/cron-scheduler
npx wrangler deploy
```

This deploys to the same Cloudflare account that hosts the Pages project
but as a separate Worker named `elinno-agent-cron-scheduler`.

## Secret setup

`CRON_SECRET` MUST be set on **both** sides — the Worker (which signs)
and the Pages endpoint (which verifies). Same value, both places.

```bash
# Generate a fresh secret (32 random bytes hex = 64 chars):
openssl rand -hex 32

# Set on Pages (verifier):
npx wrangler pages secret put CRON_SECRET --project-name elinno-agent

# Set on this Worker (signer):
cd workers/cron-scheduler
npx wrangler secret put CRON_SECRET
```

## Rotation

Set the new secret on **Pages first**, then on the cron Worker within
5 minutes. The ±5-min replay window is the rotation grace (decision R).
A single missed nightly fire is the worst-case during a botched rotation;
next night recovers.

## Local test

```bash
cd workers/cron-scheduler

# .dev.vars carries the secret for `wrangler dev` (do NOT commit this file)
echo "CRON_SECRET=<paste-secret-here>" > .dev.vars
# Optional: override the target Pages URL for local-only testing
echo "PAGES_BASE_URL=https://preview.elinno-agent.pages.dev" >> .dev.vars

npx wrangler dev --test-scheduled

# In a second terminal, fire the scheduled handler:
curl -s "http://localhost:8787/__scheduled?cron=0+8+*+*+*"
```

The Worker logs a JSON line per source POST; expect `{ status: 200 }`
from each.

## Files

- `wrangler.toml` — Worker config + cron trigger schedule.
- `src/index.js` — SECURITY-CARVE-OUT scheduled handler. HMAC signing
  + parallel per-source POSTs via `Promise.allSettled` (decision T).
- `package.json` — minimal stub. No runtime deps; uses Workers' built-in
  Web Crypto for HMAC.
