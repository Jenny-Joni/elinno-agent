# Block 18 — Chat suggested questions (v1.9)

**Status:** approved 2026-08-09. Locked design decisions for the chat
suggested-questions feature. Committed as 18.0, the first commit on
`block-18-chat-suggestions`.

**Baseline.** Branched from `main` at
`c32570ca4f5b9000d63b71a1051066460bc4681c`, which was level with
`origin/main`, tree clean. Confirmed by Jenny as the intended baseline.

**Working agreement for this block.** 18.1 and 18.2 are the carve-out
boundary and run in DEFAULT mode with carve-out headers. 18.3 runs in DEFAULT
mode but is **not** a carve-out — no carve-out header on that commit or file.
Everything else runs in auto mode under this change-list. Nothing reaches
`main` without a per-push approval.

---

## Context

Suggested questions shipped in Block 9.3 (`7276ba6`, 2026-05-14) as four
hardcoded strings on project chat and three more, separately implemented, on
cross-project chat. Since then `aggregate_jira` (Block 11) gave the agent
velocity, workload and label-frequency capability that no suggestion surfaces,
and the two implementations have drifted. v1.9 refreshes the content, adds
sprint-name interpolation, adds a returning rail, and collapses both surfaces
onto one module.

Design is locked and mocked at `~/Downloads/suggestions-mockup.html` (six
states, desktop + 390px, real `auth.css` embedded). Its JS is the module
shape: one catalog, one card renderer, one rail renderer, one click handler,
two mount points.

---

## Locked decisions

1. Suggestion text covers `aggregate_jira` capability — velocity, per-assignee
   workload, label frequency.
2. Active Jira sprint name interpolated into the sprint card, bolded, with a
   static fallback. The `<topic>` placeholder chip is deleted outright.
3. Returning rail above the composer: thread has messages, composer empty,
   nothing in flight. Deterministic pool, **keyed off the last answer's
   citations** (see below). Not model-generated. No second API call.
   Dismiss (×) suppresses for that conversation, in memory only.
4. One shared module — `public/_lib/chat-suggestions.js` + `.sg-*` in
   `auth.css`. `.chat-empty__*` and `.xc-empty__*` merge into `.sg-empty*`.
5. Click behaviour unchanged: fill composer, focus, dispatch `input`, no
   auto-submit. Same for rail pills.
6. Slack channel names **not** interpolated this release.
7. `data-suggestion-id` on cards and pills, **DOM attribute only** — no
   payload field, no handler change, nothing on the send path. Measurement
   does not depend on it (see Measurement below).

### Rail keying — and its known limit

Keyed off `citations`, not `tool_calls`. `tool_calls` is stripped for
non-admins (`.../[conversationId]/messages.js:270-276`, BLOCK_10_PLAN
decision O), so a tool-keyed rail would work for Jenny and nobody else.
Citations are on every assistant row for every role and are already in the
fetched payload. **Decision O is not widened by this block.**

**Recorded so it isn't rediscovered:** citations are coarser than tool
identity. `get_jira_sprint_summary` and `aggregate_jira` both cite the sprint
and are indistinguishable from the payload. The pool does not branch on that
distinction, so it does not matter here. A future pool that needs it is the
point at which decision O gets reopened — deliberately, not incidentally.

### Rail — when there is nothing to key off

Two cases already modelled in the render path, both of which the rail must
handle as a stated decision rather than a discovery during 18.5:

- **Errored turn** (`model === null` → `.error`): render **no rail**.
  Following up a failure is the wrong nudge.
- **Succeeded with no citations** (the `.muted` assistant state): render the
  **generic pool** for that surface, defined below.

**Generic pool — defined here, not invented in 18.3.** It is the surface's
own first-open `SET`, re-rendered as pills and capped at three:

| Surface | Generic pool | Catalog ids |
|---|---|---|
| Project · Jira | sprint tracking · workload · velocity | `sprint-status`, `workload`, `velocity` |
| Project · Slack | decisions · themes · unanswered | `decisions`, `themes`, `unanswered` |
| Project · both | sprint tracking · workload · decisions | `sprint-status`, `workload`, `decisions` |
| Cross-project | at-risk · velocity · workload | `x-risk`, `x-velocity`, `x-workload` |

Reusing catalog ids rather than writing new copy means no second set of
strings to keep in sync, interpolation and its fallback keep working
(`sprint-status` still resolves the sprint name), and the measurement query
already covers every one of them.

The `both` pool is **curated, not the first three of `SETS.both`.** `SETS.both`
is `sprint-status`, `workload`, `velocity`, `decisions`; taking the first three
would drop `decisions` and leave a workspace with both sources connected
looking at an all-Jira rail. Trading `velocity` for `decisions` keeps a Slack
question in the pool, which is the reason the `both` set exists at all. The
other three surfaces take their `SET` in order.

**Already-sent exclusion — applies to every rail pill, keyed and generic.**
Drop any pill whose rendered text was already sent in this conversation.

The generic pool makes this obvious — it reuses first-open ids, so it can
offer back the question just asked: click "Who has the most open tickets right
now?", get a muted answer, and the fallback returns that same pill. But keyed
pills have the same defect and are the primary path — "Break that down by
assignee" can be offered, clicked, and offered again on a later turn whose
citations look the same, and the keyed pool is small enough that repetition
surfaces fast.

So the filter lives **at the render boundary**, applied once to whatever list
the rail is about to draw, rather than inside the fallback branch. The module
already holds the message list, so it is a filter over existing data, not new
state.

**When the filter empties the list:** backfill from the rest of the catalog
for the connected source(s), in catalog order, still capped at three. Project
· Jira has `blockers` and `labels` in reserve beyond its `SET`; project ·
Slack has none; cross-project's catalog *is* its `SET`, so it has no reserve.
When the filter and the backfill are both exhausted, **render no rail** —
a rail offering nothing new is worse than its absence, and a long
conversation is precisely where repetition would be most obvious. Because the
filter sits at the render boundary, this exhaustion rule covers keyed pills
too, with no separate statement needed.

### Measurement — no new sink

**18.7b (server-side log event) is dropped.** Pages Function logs are not
durably retained without Logpush or Workers Logs, and their retention window
is short. A number visible only while tailing is not a measurement, and this
is the evidence gate for whether generated follow-ups ever get built.

The sink already exists. Chips fill the composer verbatim and never
auto-submit, so a suggestion send is a `messages` row whose `content` equals a
catalog string exactly. Measurement is a text query against data already
stored:

- Works **retroactively** across all history — no instrumentation lead time.
- An edited-before-send shows up as a near-miss rather than a lost event,
  which is itself the signal about whether the copy is right.
- Zero DDL, zero new dependency.

**The sprint card cannot be matched by equality.** It is interpolated, so its
sent content is `How is <sprint name> tracking?` — different per project, and
different again every time a sprint rolls. Equality matching returns zero for
the one card the entire interpolation decision exists to justify, and that
zero would read as "nobody clicks it" rather than "we cannot see it."

Match that card on a **pattern anchored to the invariant parts**:

```sql
content LIKE 'How is %tracking?'
```

Useful property: the no-sprint fallback string, "How is the active sprint
tracking?", matches the same pattern — so the card is measured as one thing
whether or not a sprint resolved. Cost: a user who freely types a sentence of
that shape is counted too. Acceptable for an evidence gate; not acceptable to
present as an exact figure.

Every other card is a fixed catalog string and matches by equality.

**What the number does not cover.** Generic-pool rail pills emit byte-identical
strings to the first-open cards, so the query cannot separate a first-open
click from a rail-fallback click. Keyed pills are distinguishable — "Break
that down by assignee" appears nowhere else — but the fallback is not.

Accepted as a limit rather than fixed with separate phrasings: **returning-rail
usage is measurable only for keyed pills.** Report it that way. A future read
of the number must not treat first-open totals as pure first-open, nor
conclude the fallback is unused because it is invisible.

`data-suggestion-id` (18.7) is kept anyway — it costs nothing and may be
useful later.

---

## Flags on the mockup — resolved

| Flag | Resolution |
|---|---|
| Rail keyed off admin-only `tool_calls` | Accepted → citation keying, limit recorded above |
| Decision 7 had nowhere to land | Accepted → messages-table text query; 18.7b dropped |
| Rail must not re-render from `input` | Accepted → **toggle a class on a persistent node.** Never re-render the rail from an `input` handler: it thrashes layout and fights the textarea it sits above. Stated here because the mockup is static and cannot express it |
| `css-sg` says `--jira-chip` unused | It is used at `public/dashboard.html:328`. Fix the comment when porting |
| Mobile `.sg-empty__sub` hide breaks the `none` state | `.sg-empty--none` modifier keeps it visible below 700px — see the dedicated section |

### Verified sound

- `.chat-empty` and `.xc-empty` are byte-identical (`margin:40px auto;
  max-width:460px; text-align:center`). The merge premise holds.
- `pickActiveSprint` is at `functions/api/projects/[id]/sprint.js:63`, under
  the `SECURITY-CARVE-OUT` header at line 3, module-local — extraction
  required, as stated.
- Dashboard divergence real: `functions/api/dashboard.js:143` filters
  `metadata->>'state' = 'active'` ordered by `source_updated_at DESC`, no
  `complete_date` or stale-`end_date` exclusion.
- `height: calc(100vh - 130px)` on both shells (`project.html:251`,
  `cross-project/chat.html:46`).
- Mobile fit: cleared in headless Chromium at 390×760 (four cards + trimmed
  empty block above the composer). Real device chrome eats more height —
  still a preview-deploy check, not a settled fact.

---

## Which call carries the sprint name

**`GET /api/projects/:id`.** Boot step 1 (`project.html:711`), awaited before
conversations, members, connections and first paint, and boot already fails
cleanly on a non-OK response. Adding `suggestion_context` there costs no round
trip and no new failure mode.

Not `/connections`: step 3.5 (`:769-779`) is deliberately swallow-on-failure,
so the sprint name would vanish silently on a transient error while the chips
still rendered.

Cross-project needs no server change — it interpolates peer names, already
available from `/api/projects` and `/api/dashboard`.

---

## Sub-tasks

**Carve-out boundary: 18.1 and 18.2 only.**
18.3 is DEFAULT mode but is **not** a carve-out — see the escaping note.

| # | Commit | Mode | What |
|---|---|---|---|
| 18.0 | `docs: BLOCK_18_PLAN` | AUTO | This plan, first commit on the branch |
| 18.1 | `refactor` | **DEFAULT · CARVE-OUT** | Extract `pickActiveSprint` from `functions/api/projects/[id]/sprint.js` into `functions/_lib/jira-sprint.js`; import back. Pure move, zero behaviour change. Carve-out header on the new file **and** the commit |
| 18.2 | `feat` | **DEFAULT · CARVE-OUT** | `GET /api/projects/:id` returns `suggestion_context: { active_sprint_name }` via the shared helper |
| 18.3 | `feat` | **DEFAULT** (not a carve-out) | New `public/_lib/chat-suggestions.js` — catalog, `SETS`, card + rail renderers, click handler, in-memory per-conversation dismiss. No page wiring yet. Escaping criteria below are acceptance conditions |
| 18.4 | `style` | AUTO | `.sg-*` into `auth.css`, **including the `.sg-empty--none` modifier** (below); **delete the dead legacy `.chat-suggestions-*` block** (dead by `project.html:~107`'s own comment — it outlives this refactor otherwise); cache-bust sweep |
| 18.5 | `feat` | AUTO | Wire `project.html`: mount empty-state list + rail; apply `.sg-empty--none` in the `none` branch; delete `SUGGESTIONS_SLACK`/`SUGGESTIONS_JIRA`/`getSuggestionList`/`suggestionCardHtml` and `.chat-empty__*` local CSS. **Keep** `getConnectionState` and the eager connections fetch |
| 18.6 | `feat` | AUTO | Wire `cross-project/chat.html`: same, deleting `suggestionRow` and `.xc-empty*`/`.xc-suggestion*` local CSS. No `none` state on this surface |
| 18.7 | `feat` | AUTO | `data-suggestion-id` on cards and pills, **DOM attribute only** — no payload field, no handler change, nothing on the send path |
| 18.8 | `docs` | AUTO | What's New v1.9 entry — Jenny's copy, images and version string per PRD §5.11 |

One-fix rule and the 10-call iteration cap apply per sub-task.

### `.sg-empty--none` — the mobile rule breaks the `none` state

The mockup hides `.sg-empty__sub` below 700px
(`suggestions-mockup.html:4854`). That is correct for the four suggestion
states, where the sub-paragraph is decorative.

In the **`none`** state it is not decorative — it carries the entire
actionable message: "Connect Slack or Jira to start asking questions about
this project's data" for admins, "Ask a workspace admin to connect Slack or
Jira" for members. Members also get **no CTA card** in that state
(`project.html:1388-1395`), so hiding the sub leaves a non-admin with no
connections looking at an icon, "Ask <project>", and nothing else.

**Fix:** a `.sg-empty--none` modifier that keeps the sub visible below 700px.
CSS lands in 18.4, the class is applied in the `none` branch in 18.5.
Project chat only — cross-project has no `none` state.

### 18.3 — escaping, acceptance criteria

18.3 is the first point at which this component interpolates **external,
third-party-controlled** text into an `innerHTML` string. The sprint name
comes from Jira and anyone with board access can rename a sprint.

Run in **DEFAULT** mode: it is the only commit in the block with an
untrusted-input-to-`innerHTML` path, and the module is shared, so a dropped
escape ships to both surfaces simultaneously. One review of one new file is
cheap against that. Criteria are stated as well as the mode change, because
the criteria are what make it checkable in review.

Both sinks must be escaped, named explicitly:

1. **Text node** — the interpolated value inside `.sg-card__text`, rendered
   via the `{ b: … }` catalog part. Mockup reference: `partsToHtml()`.
2. **Attribute** — `data-q` on the `<button>`. Attribute context, so the
   escape must cover `"` and `'` as well as `&<>`. Mockup reference:
   `esc(plainText(parts))`.

Not a sink, and must not be "fixed" into one: filling the composer is
`input.value = …`, a value assignment, not HTML.

Verification runs **at module level inside 18.3**, against a stubbed
`suggestion_context` — render a card with a sprint name containing
`<img src=x onerror=…>` and a `"`, and confirm it appears as literal text in
the card and as an inert attribute value, with no node created and no handler
fired. It is deliberately **not** a preview-deploy check: that would mean
renaming a real Jira sprint to an XSS payload and syncing it.

---

## Cache-bust

`.sg-*` in `auth.css` means every page linking it needs its `?v=` bumped —
`project.html:105` calls this "the 14-page cache-bust dance."

Two pages are already off the common stamp: `404.html:12` and
`forgot-password.html:12` at `?v=2026-06-03-1`, everything else at
`?v=2026-08-02-1`. **18.4 brings every page onto one new stamp** — the split
serves nothing and guarantees the question recurs.

Enumerate before editing so none is missed:

```
grep -rn 'auth.css?v=' public/ | wc -l
```

---

## Called out, deliberately not bundled

`api/dashboard.js` and `pickActiveSprint` disagree on "active sprint." After
18.2 the chat chip and the Sprint View tab agree with each other, and the
**dashboard card can still name a sprint the other two treat as absent** — a
completed sprint with `complete_date` set, or one whose `end_date` passed more
than 30 days ago.

Pre-existing, not widened here, but this block makes it visible on two
surfaces of the same page. Bringing `dashboard.js` onto
`functions/_lib/jira-sprint.js` is small once 18.1 lands. **Separate task.**

---

## Verification (preview deploy, before any ff-merge)

1. Six mockup states reproduced: project first-open at `jira` / `slack` /
   `both`, project rail, cross-project first-open, cross-project rail.
2. `none` state, **at 390px, both roles** — the `.sg-empty--none` case. Admin
   sees the sub-paragraph plus the CTA card; member sees the sub-paragraph
   (their only actionable text) and no card. Desktop `none` unchanged.
3. Sprint interpolation: real name bolded; the no-active-sprint fallback reads
   "How is the active sprint tracking?" with nothing else shifting; **and a
   long sprint name at 390px wraps rather than truncates** (untested — the
   card has no explicit wrap rule).
4. Chip and pill click fill the composer, focus it, dispatch `input`, and do
   **not** submit.
5. Rail visibility: appears only with messages present, composer empty,
   nothing in flight; hides on typing **without a re-render**; `×` suppresses
   for that conversation only, returns on a new one. Plus the two
   nothing-to-key-off cases: **errored turn → no rail**, **succeeded with no
   citations → generic pool**. Plus the already-sent filter, on **keyed and
   generic pills alike**: a pill whose text was already sent in this
   conversation does not reappear, and an exhausted list renders **no rail**
   rather than a repeat. Project · Slack and cross-project are where
   exhaustion is actually reachable — neither has reserve beyond its `SET`.
6. **Rail as a non-admin member** — the citation-keying case. Confirm a member
   sees a populated rail.
7. Interpolation renders correctly on preview — real sprint name, bolded,
   both surfaces. The hostile-input case is **not** run here; it is a
   module-level check inside 18.3 against a stubbed context.
8. Mobile 390px, both surfaces: four cards plus the empty block fit above the
   composer inside `calc(100vh - 130px)`; sub-paragraph hidden below 700px.
   Headless cleared this; device chrome is the open question.
9. Cache-bust: hard-reload every page touched, confirm no stale `auth.css`.
10. Sprint View tab still correct after the 18.1 extraction — the carve-out
    regression check.

---

## Out of scope (stated, not fixed)

- Slack channel-name interpolation (decision 6).
- Model-generated follow-ups — gated on the evidence from the **Measurement**
  section's messages-table query. Not on 18.7, which is an inert attribute and
  measures nothing.
- `dashboard.js` active-sprint alignment (above).
- Widening BLOCK_10_PLAN decision O.
- The `_dev` mockup history item (separate task).
