# Block 13 — v1.4 locked decisions

> Drafted before Phase 1 execute, per the v1.4 plan at
> `/Users/jennyshane/.claude/plans/flickering-hugging-treasure.md`.
> These are the irreversibles / schema calls. Once locked here, every
> subsequent v1.4 block treats them as settled.

**Last updated:** 2026-05-22

---

## Decision 1 — Membership model: workspace-only (option b)

**Locked: option (b).** v1.4 keeps the v1.3 workspace-scope membership
model. `project_members` stays dropped. `authorizeProjectSet` continues
to validate `projects.owner_user_id = workspaceUserId`. Every workspace
user sees every workspace project; the admin/member distinction is
**workspace-level capabilities only**, not per-project access.

**Why:**
- PRD v1.4 §3's "Member sees only their accessible projects" is
  **inherited language from PRD v1.1**, where v1.1 had per-project
  Members (PRD.md:51, :64, :213). v1.4's own §1 caveat flags it:
  "this PRD was authored from design sessions and the early PROJECT.md,
  not a verified diff against the current codebase."
- **`BLOCK_12_PLAN.md` decision I (line 156) deliberately collapsed
  per-project membership in v1.3**: "DROP `project_members` table …
  per-project membership added a layer with no current use case;
  workspace boundary stays as the security floor."
- Small-trusted-team posture (admin-set passwords, §4.5) has no
  operational case for a workspace-internal partition.
- Option (a) — reinstating `project_members` — would re-touch every
  project-scoped query, the auth boundary, and `authorizeProjectSet`,
  to restore a distinction that isn't a real requirement.

**Copy / UX implications for v1.4 (apply when each screen lands):**

| Screen | Implication |
|---|---|
| Dashboard (`screen-02`) member variant | Greeting reflects the workspace project count, not "you have access to N." Cross-project hero remains; scope = all workspace projects. |
| Projects list (`screen-05`) member variant | 2-up grid with no create card; **still lists every workspace project**, not a member-specific subset. |
| Cross-project picker (`screen-11`) member variant | Lists every workspace project (just like admin). Drop the "Ask a workspace admin to be added to more" explainer — it doesn't apply. Heading can stay neutral ("Your projects" works for both). |
| Project chat (`screen-08`) | Member can open every workspace project's chat. Unconnected-project member empty-state copy stays ("ask a workspace admin"). |

**Server-side:**
- `authorizeProjectSet` unchanged. No new failure code. **Carve-out:
  project-scoping enforcement remains via `owner_user_id` = workspace
  handle** — confirm this on every PR that touches `functions/_lib/ai/authorize.js`
  or any cross-project route.
- Role gates stay as today: `requireWorkspaceAdmin` for admin-only
  endpoints (project create, member admin, workspace settings);
  workspace-scope for everything else. **Member ≠ second-class project
  access; member = no admin capabilities.**

---

## Decision 2 — `display_name` migration shape

**Locked:** add `display_name TEXT NOT NULL DEFAULT ''` to D1 `users`.
Backfill existing rows to `split_part(email, '@', 1)` (or the SQLite
equivalent — `substr(email, 1, instr(email, '@') - 1)`).

**Why:** smallest possible migration; empty string is a valid sentinel
the UI can detect (`name || email`); backfilling to the email-prefix
gives existing rows (effectively just Jenny today) a readable name
without manual entry.

**Operational notes:**
- Migration belongs in a new file under `db/migrations/` (e.g.
  `db/migrations/v1_4_users_display_name.sql`).
- Backfill UPDATE runs once, post-ALTER; the `DEFAULT ''` covers
  inserts so subsequent backfill UPDATEs are no-ops.
- Avatar initial derives client-side from `display_name || email` so
  empty-string `display_name` doesn't render an empty avatar.

**Carve-out:** schema migration on D1 production. **Jenny runs the
DDL** — Claude drafts SQL + rollback + verification queries.

---

## Decision 3 — `must_change_password` in the same migration

**Locked:** include `must_change_password BOOLEAN NOT NULL DEFAULT 0`
in the **same migration** as `display_name`. **Do not use it in v1.4
code paths** — column exists, ignored everywhere.

**Why:** avoids a second D1 migration later if the team posture
changes; column is cheap; the flag-on-admin-create UI hook can be
added later as a one-flag change without touching schema again.

**Operational notes:**
- Migration filename can pair them: `v1_4_users_display_name_and_must_change.sql`.
- No endpoint reads or writes `must_change_password` in v1.4. Login
  flow does not check it. PRD §4.5 trade-off note ("acceptable for a
  small trusted team") still applies.

---

## Decision 4 — Slug uniqueness + reserved-words list

**Locked:** `projects.slug TEXT UNIQUE NOT NULL` in Postgres
(`projects` lives in Neon, not D1). Uniqueness is **workspace-wide**
(matches the current `owner_user_id` workspace handle — slug only
needs to be unique within the namespace it's used in, which is
`/project/<slug>`).

**Reserved words** (cannot be assigned as a slug; the
availability-check endpoint and the create/edit paths reject these):

```
new
settings
admin
dashboard
projects
api
login
logout
forgot-password
reset-password
workspace
cross-project
_dev
```

**Format:** lowercase letters, digits, hyphens only; must start with a
letter; max length 64; no leading or trailing hyphen; no consecutive
hyphens.

**Why:** workspace-wide uniqueness avoids ambiguous resolution at
`/project/<slug>`. Reserved list maps to current and reasonably-foreseen
top-level paths under `/`. 64-char cap is generous + bounded for index
size.

**Carve-out:** schema migration on Neon production. **Jenny runs the
DDL.** Claude drafts the SQL, the migration plan, and a Neon-branch
dry-run.

**Note:** Phase 8 (slug system) is **deferrable** per the plan. Lock the
decision now so when we get there it's already settled.

---

## Decision 5 — Design-system token naming: bare nouns + legacy aliases

**Locked:** adopt the mockup's bare-noun token names (`--brand`,
`--brand-strong`, `--text`, `--border`, `--r-md`, `--font`); **keep
legacy prefixed names as aliases** (`--color-brand: var(--brand);` etc.)
for backward compatibility with all existing component CSS in
`public/auth.css`.

**Why:**
- Future component CSS lifted from new mockups drops in unchanged.
- Existing `public/auth.css` rules using `--color-brand`, `--radius-md`,
  `--color-text-dark`, etc. continue to work without a sweep edit.
- One namespace is the source of truth; the other is a thin alias
  layer. Aliases can be deprecated later by a one-shot find/replace
  when convenient.

**Implementation rule:** when porting `design-system.css` into
`public/auth.css` in Phase 1:
1. Define bare-noun tokens in `:root` (the source of truth).
2. Add `--color-brand: var(--brand);` (and similar) immediately after,
   commented `/* legacy v1.2 alias */`.
3. New component CSS (Phase 1 onward) references **only the bare-noun
   names**. Old CSS keeps working unchanged.

---

## Decision 6 — Citations become non-clickable everywhere

**Locked:** collapse the `if (url)` branch in `renderCitationRailHtml`
(`public/project.html:926-941`) so every citation renders as a
`<span class="chat-citation chat-citation-noref">` label. **"Refresh &
re-ask" stays interactive.** Apply the same change to the cross-project
chat surface's citation renderer (verify there's a single renderer used
by both, or replicate the change).

**Why:** PRD §5.3 / SPEC §8 — "the outbound link (to a Jira the user
may not be logged into) is dropped." User-visible behavior change,
confirmed intended.

**Implementation note:** this is a near-trivial one-line change. Lands
as part of Phase 4d (Project chat restructure), not its own commit.

---

## Decision 7 — `authorizeProjectSet` semantics

**Locked (follows from Decision 1):** **no change.**
`authorizeProjectSet` continues to validate workspace ownership via
`projects.owner_user_id = ${workspaceUserId}`. No new failure code. No
fifth adversarial cell.

The four current failure modes stay:
- `project_ids_malformed` (non-array / non-UUID / non-string)
- `cross_project_empty_set` (post-dedup empty)
- `project_not_in_workspace` (one or more IDs not owned by workspace)
- `project_id_forbidden` (the `aggregate_jira` compiler check)

**Carve-out:** any PR that touches `functions/_lib/ai/authorize.js` or
its callsites is **project-scoping enforcement** — default mode, second
look at the diff before merge.

---

## What changes in the plan file

The 7 locks above resolve Phase 0 of the implementation plan at
`/Users/jennyshane/.claude/plans/flickering-hugging-treasure.md`.
Phases 1 onward proceed as written, with the following Phase-specific
notes:

- **Phase 1** — adopt the bare-noun + legacy-alias token scheme (Decision 5).
- **Phase 3a** — `display_name` + `must_change_password` migration as a
  single D1 file (Decisions 2 + 3); Jenny runs DDL.
- **Phase 4a + 4b + 6** — picker / dashboard / projects-list member
  variants render **all workspace projects** (Decision 1).
- **Phase 4d** — citation `<a>` collapse (Decision 6).
- **Phase 8** — slug system with workspace-wide uniqueness + reserved
  words (Decision 4); deferrable; design done.
