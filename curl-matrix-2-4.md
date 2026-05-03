# Sub-task 2.4 — Curl Verification Matrix

Run on the preview deploy URL (Cursor will provide on push).
Replace `$BASE` with the preview URL, `$COOKIE_J` with Jenny's session cookie, `$COOKIE_X` with a second user (`bob` or whoever) for cross-user/cross-project scenarios.

Setup before running:
- Two users in D1: Jenny (admin) and a second user (bob, member).
- Two projects: P1 (Jenny is admin, bob is member) and P2 (Jenny is admin only — bob NOT a member).

| # | Scenario | Method + URL | Body | Expected |
|---|---|---|---|---|
| 1 | Happy path: Jenny creates conversation in P1 | `POST $BASE/api/projects/P1/conversations` | empty | 201, `{ ok: true, conversation: { id, project_id: P1, user_id: <Jenny>, title: "New conversation", message_count: 0, created_at, updated_at } }` |
| 2 | List Jenny's conversations in P1 | `GET $BASE/api/projects/P1/conversations` | — | 200, conversations array contains the one from #1, `message_count: 0` |
| 3 | First message → auto-title fires (decision H) | `POST $BASE/api/projects/P1/conversations/$C1/messages` | `{ "content": "What is the launch status of Q4?" }` | 200, `user_message + assistant_message` returned. `conversation.title` = `"What is the launch status of Q4?"` (under 50 chars, no truncation). Echo content matches `You said: "What is the launch status of Q4?" — Real AI coming in Block 5.` |
| 4 | Auto-title with truncation at word boundary | New conversation $C2; POST a 60+ char message | `{ "content": "this is a longer message that should be truncated nicely at the word boundary just here please" }` | 200, `conversation.title` ends in `…`, cut at last space within first 50 chars |
| 5 | Second message: title does NOT change | `POST $BASE/api/projects/P1/conversations/$C1/messages` | `{ "content": "follow up question" }` | 200, `conversation.title` unchanged from #3 |
| 6 | Fetch messages in conversation, ordered ASC | `GET $BASE/api/projects/P1/conversations/$C1/messages` | — | 200, messages in `created_at ASC` order: 4 messages total (2 user + 2 assistant from #3 and #5) |
| 7 | List conversations: message_count reflects insert | `GET $BASE/api/projects/P1/conversations` | — | $C1 shows `message_count: 4`, $C2 shows `message_count: 2` |
| 8 | Cross-project leakage: bob fetches P2 conversations | `GET $BASE/api/projects/P2/conversations` (cookie: bob) | — | 403 (bob not a member of P2) |
| 9 | Cross-project leakage: bob POSTs to P2 conversation | `POST $BASE/api/projects/P2/conversations` (cookie: bob) | empty | 403 |
| 10 | Per-user scoping (decision AC): bob lists P1 conversations, doesn't see Jenny's | `GET $BASE/api/projects/P1/conversations` (cookie: bob) | — | 200, conversations array does NOT include $C1 or $C2 (Jenny's). bob is a member of P1 but conversations are private per AC. |
| 11 | Per-user scoping: bob tries to POST a message to Jenny's conversation $C1 | `POST $BASE/api/projects/P1/conversations/$C1/messages` (cookie: bob) | `{ "content": "hi" }` | 403 (conversation belongs to Jenny, not bob; guard: `user_id = $session_user_id`) |
| 12 | Per-user scoping: bob tries to GET messages in $C1 | `GET $BASE/api/projects/P1/conversations/$C1/messages` (cookie: bob) | — | 403 |
| 13 | Conversation-belongs-to-project guard: use $C1 (in P1) under P2's URL | `GET $BASE/api/projects/P2/conversations/$C1/messages` | — | 403 (conversation isn't in P2). Note: Jenny IS admin of P2, so `requireProjectRole` passes; the conv-guard catches the mismatch. |
| 14 | 401 on no session | `GET $BASE/api/projects/P1/conversations` (no cookie) | — | 401 |
| 15 | 404-equivalent on non-existent conversation | `GET $BASE/api/projects/P1/conversations/00000000-0000-0000-0000-000000000000/messages` | — | 403 (collapsed, per PRD §10 enumeration prevention) |
| 16 | Validation: empty content rejected | `POST $BASE/api/projects/P1/conversations/$C1/messages` | `{ "content": "" }` | 400, `{ "error": "Message content is required" }` |
| 17 | Validation: whitespace-only content rejected | same URL | `{ "content": "   \n\t  " }` | 400, `{ "error": "Message content is required" }` |
| 18 | Validation: oversize content rejected | same URL | `{ "content": "<10001+ char string>" }` | 400, `{ "error": "Message must be 10000 characters or fewer" }` |
| 19 | Invalid JSON body | same URL | raw `not json` | 400, `{ "error": "Invalid JSON" }` |
| 20 | Soft-delete handling: tombstone $C2 manually in Neon, list again | direct SQL: `UPDATE conversations SET deleted_at = NOW() WHERE id = '$C2'`; then `GET $BASE/api/projects/P1/conversations` | — | 200, $C2 NOT in result (filtered by `c.deleted_at IS NULL`) |
| 21 | LEFT JOIN correctness: empty conversation shows message_count: 0 | Create $C3 in P1 (no messages), `GET $BASE/api/projects/P1/conversations` | — | $C3 present with `message_count: 0` (LEFT JOIN preserves the row even with no matching messages) |
| 22 | LEFT JOIN with all messages soft-deleted: conversation still appears | direct SQL: `UPDATE messages SET deleted_at = NOW() WHERE conversation_id = '$C1'`; then `GET $BASE/api/projects/P1/conversations` | — | $C1 present with `message_count: 0`. (Validates `m.deleted_at IS NULL` is in JOIN ON, not WHERE — if it were in WHERE, $C1 would vanish.) |

## Cleanup after the matrix runs

Re-active soft-deleted rows so subsequent UI testing has a populated state:

```sql
UPDATE conversations SET deleted_at = NULL WHERE id IN ('$C1', '$C2', '$C3');
UPDATE messages SET deleted_at = NULL WHERE conversation_id = '$C1';
```

Or hard-delete the test data entirely:

```sql
DELETE FROM messages WHERE conversation_id IN ('$C1', '$C2', '$C3');
DELETE FROM conversations WHERE id IN ('$C1', '$C2', '$C3');
```

## Pass criteria

All 22 scenarios PASS. Particular attention to:
- **#10, #11, #12**: per-user scoping (decision AC). If any of these fail, conversations are leaking across users in the same project.
- **#13**: conversation-belongs-to-project guard. If this fails, an attacker who's a member of project A could read project B's conversations by URL manipulation.
- **#22**: LEFT JOIN correctness. If this fails, the WHERE-vs-JOIN-ON bug is shipping.
- **#3, #4, #5**: auto-title (decision H). If #5 changes the title, the "first message only" condition is broken.

If any fail: stop, paste the failure, route to fix-and-retest. Do not proceed to UI work until all pass.
