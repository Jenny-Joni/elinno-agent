// functions/api/probe-bindings.js
//
// TEMPORARY — Block 5 commit-3 prerequisite per design-chat reviewer
// item 4 (HANDOFF 2026-05-09 entry). Proves env.ANTHROPIC_API_KEY,
// env.OPENAI_API_KEY, and env.HYPERDRIVE bindings resolve at Pages
// Function runtime with non-empty values. Returns presence + length
// only, never the key bytes. Delete after preview-side verification.

export async function onRequestGet({ env }) {
  const ak = env.ANTHROPIC_API_KEY;
  const ok = env.OPENAI_API_KEY;
  return new Response(
    JSON.stringify({
      anthropic_api_key: {
        present: typeof ak === 'string' && ak.length > 0,
        length_bytes: typeof ak === 'string' ? ak.length : 0,
      },
      openai_api_key: {
        present: typeof ok === 'string' && ok.length > 0,
        length_bytes: typeof ok === 'string' ? ok.length : 0,
      },
      hyperdrive: {
        present: !!env.HYPERDRIVE,
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
