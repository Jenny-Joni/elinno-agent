/* whats-new-data.js — the What's New content constant (PRD §5.11.5).

   Hand-authored. Not generated from commits, deploys, or HANDOFF.md.
   This is the only file that changes when an issue is written, which is
   why it lives apart from the page that renders it.

   Ordered NEWEST FIRST. Both the page and the dashboard strip render the
   newest entry whose status is 'published'; drafts are invisible to users
   even while sitting on main. That matters because session closeouts push
   to main mid-week — without the flag, a half-assembled issue would go
   live before it was finished.

   Adding an entry is not publishing it. Publication is a separate,
   explicit command on a separate day: flip status to 'published' and push.
   Claude Code cannot publish; the deny hook blocks pushes to main.

   Entry shape:
     version   Required. Semantic, v-prefixed. Assigned at publish, not at
               draft — several sessions can feed one weekly issue.
     date      Required. ISO. Publication date, not the date the code
               shipped; manual curation means these differ, as expected.
     status    'draft' | 'published'.
     headline  Required. One sentence. Rendered in the dashboard strip and
               in collapsed rows.
     features  Zero or more. Each carries a tag, title, short explanation,
               and a preview image. tag is 'New' | 'Improved' | 'Fixed'.
     fixes     Zero or more { tag, text } objects, tag defaulting to
               'Fixed'. NEVER carry images — if every item had one, a thin
               week would read as a large one and the authoring cost would
               sink the weekly cadence. The tag exists because not every
               line under "Also fixed" is a fix: small new behaviour belongs
               there too, and would otherwise be mislabelled or pushed into
               features[], which then owes a preview image it doesn't need.

   Copy, images and version numbers are Jenny's, per version. Claude Code
   edits this file mechanically; it does not draft entry text and does not
   capture, generate or edit the images.

   Version numbers are assigned by hand, which puts two constraints on any
   code reading this file: never order or compare by parsing the version
   string (string comparison sorts v1.10 below v1.9 — order by array
   position or date), and version strings must stay unique or the unread
   marker misses an issue.

   Register: user-facing copy, not a changelog of the work. No commit
   SHAs, file paths, function or table names, block numbers, or internal
   vocabulary.

   Usage — load deferred, BEFORE the badge module:
     <script src="/_lib/whats-new-data.js" defer></script>
     <script src="/_lib/whats-new-badge.js" defer></script>
*/
window.WHATS_NEW = [
  {
    // ═══════════════════════════════════════════════════════════════════
    // v2.0 — DRAFT. NOT PUBLISHED. Invisible to users while status is
    // 'draft', which is the point: this sits on main un-shipped until
    // Jenny publishes it.
    //
    // EVERY STRING BELOW IS A STAND-IN, written by Claude Code, and is to
    // be rewritten before publishing. Per the division of labour in
    // HANDOFF ("Adding an entry to What's New"), copy is Jenny's and
    // Claude Code's input is limited to NAMING what shipped. These strings
    // name the items; they are not the entry's voice and should not
    // survive into it.
    //
    // Publishing is a separate act on a separate day: rewrite the copy,
    // flip status to 'published', push. Claude Code cannot publish — the
    // deny hook blocks pushes to main.
    //
    // Deliberately NOT included, per "What belongs in an entry": the rail
    // is one shared component instead of eleven copies, the top bar and
    // its scroll script were retired, an API field was added, the
    // stylesheet was re-keyed and cache-busted. None of that is visible to
    // a user. The font and What's-new-link inconsistencies found during
    // the work were introduced and fixed inside this same unreleased
    // block, so users never met them — they are not fixes to announce.
    // ═══════════════════════════════════════════════════════════════════
    version: 'v2.0',
    // Week beginning Sunday 2026-08-16, matching the Sunday-dated
    // convention v1.8 and v1.9 use. Confirm at publication.
    date: '2026-08-16',
    status: 'draft',
    headline: 'STAND-IN — Every screen now has the same menu down the left, so your projects, chats and settings are one click away from wherever you are.',
    features: [
      {
        tag: 'New',
        // NAMED: navigation moved from a top bar to a persistent left menu,
        // present on every signed-in screen.
        title: 'STAND-IN — A menu that follows you',
        body: 'STAND-IN — Navigation used to live in a bar across the top, and what it contained changed from screen to screen. It is now a single menu down the left side of every screen, in the same place with the same contents wherever you are. It starts narrow and shows icons; open it when you want the labels.',
        image: null,
        placeholder: 'rail-desktop',
        alt: 'Placeholder illustration: a narrow icon menu down the left of the screen, and the same menu opened to show labels.'
      },
      {
        tag: 'New',
        // NAMED: projects expand in the menu to Sprint View / Chat /
        // Settings; several can stay open at once.
        title: 'STAND-IN — Your projects, without going via the projects page',
        body: 'STAND-IN — Open Projects in the menu and every project is listed. Open a project and you can go straight to its Sprint View, its chat, or its settings. More than one can stay open at a time, so you can move between two projects without collapsing the first.',
        image: null,
        placeholder: 'rail-tree',
        alt: 'Placeholder illustration: a menu with two projects expanded, each showing Sprint View, Chat and Settings.'
      },
      {
        tag: 'Improved',
        // NAMED: menu state (open/closed, which projects, scroll offset)
        // survives navigation; workspace settings and members are reachable
        // from the menu, where workspace settings previously was not linked
        // from any screen's navigation.
        title: 'STAND-IN — It stays how you left it',
        body: 'STAND-IN — The menu keeps its shape as you move around: open or closed, which projects you had expanded, and where you had scrolled to. Workspace settings and Members are in it too, which is new — workspace settings previously had no link in the navigation on any screen.',
        image: null,
        placeholder: 'rail-mobile',
        alt: 'Placeholder illustration: the menu on a phone, closed behind a button and then slid open over the page.'
      }
    ],
    fixes: [
      {
        tag: 'Improved',
        // NAMED: mobile chrome is 52px where the old bar was 70px.
        text: 'STAND-IN — Phones get a little more of the screen back: the strip across the top is shorter than the bar it replaces.'
      }
    ]
  },
  {
    version: 'v1.9',
    // Release week. Confirmed at publication (2026-08-10) — the week
    // beginning Sunday 2026-08-09, matching v1.8's Sunday-dated convention.
    // The renderer formats this as "Week of <month> <day>, <year>".
    date: '2026-08-09',
    // Published 2026-08-10. v1.9 is now published[0]: expanded, carrying
    // "Latest". v1.8 remains published and renders as the collapsed
    // .wn-past archive row beneath it, expandable on click — its object is
    // untouched.
    status: 'published',
    headline: 'Suggested questions now know what your agent can actually do — and they come back between answers instead of vanishing after the first message.',
    features: [
      {
        tag: 'Improved',
        title: 'Suggestions that match what the agent can do',
        body: 'The agent has been able to compare velocity across sprints, rank workload by assignee and count label frequency for a while now — but none of the suggested questions asked for any of it. The set has been rewritten around those capabilities, so the questions on screen are the questions worth asking. Which ones appear still depends on whether you have Slack, Jira or both connected.',
        image: null,
        placeholder: 'sg-cards',
        alt: 'Placeholder illustration: a project chat panel showing four suggested questions, three tagged Jira and one tagged Slack.'
      },
      {
        tag: 'Improved',
        title: 'The sprint question names your sprint',
        body: 'Where a suggestion used to ask about "the current sprint" in the abstract, it now names the sprint that is actually running on your board. Nothing to edit before sending. When no sprint is active it falls back to the generic wording rather than showing a blank.',
        image: null,
        placeholder: 'sg-sprint',
        alt: 'Placeholder illustration: the same suggestion shown twice, once naming a sprint and once in generic wording.'
      },
      {
        tag: 'New',
        title: 'Suggestions come back between answers',
        body: 'Until now the suggestions disappeared the moment you sent your first message. A short row of follow-ups now sits above the composer whenever it is empty, picked from what the last answer was actually about. It hides while you type, never repeats a question you have already asked, and dismissing it clears it for the rest of that conversation.',
        image: null,
        placeholder: 'sg-rail',
        alt: 'Placeholder illustration: a row of three follow-up suggestions above an empty message box.'
      },
      {
        tag: 'Improved',
        title: 'Cross-project chat gets the same set',
        body: 'Cross-project chat had its own smaller, separate list of suggestions. Both surfaces now draw from one place, so a question added on one shows up on the other — including a new comparison of velocity across the projects in scope.',
        image: null,
        placeholder: 'sg-cross',
        alt: 'Placeholder illustration: a cross-project chat panel showing three suggested questions, one tagged New.'
      }
    ],
    // The draft carried a third line — "Suggested questions are narrower on
    // small screens and no longer push the last one under the message box" —
    // cut because it is not true. Four cards still need a 733px viewport;
    // below that the last one sits under the composer and has to be scrolled
    // to. It returns only if the mobile shortfall is actually fixed.
    fixes: [
      { tag: 'Fixed', text: 'The suggestion that asked about "<topic>" is gone — no suggestion needs editing before it will work.' },
      { tag: 'Fixed', text: 'On a phone, the connect-a-source message no longer disappears when a project has nothing connected yet.' }
    ]
  },
  {
    version: 'v1.8',
    date: '2026-08-02',
    status: 'published',
    headline: 'Sprint numbers now match your board, and you can refresh every connection at once.',
    features: [
      {
        tag: 'New',
        title: "What's new",
        body: "This page. Every week we'll post a short summary of what's been added, changed or fixed — new features get a brief explanation and a preview, smaller fixes get a one-line mention. Find it any time from the top nav.",
        // Real screenshot pending. Published without one by Jenny's explicit
        // call; the slot shows the named stand-in wireframe until the PNG
        // lands at /whats-new/v1-8-whats-new.png.
        image: null,
        placeholder: 'whats-new',
        alt: "The What's new page showing the latest release."
      },
      {
        tag: 'New',
        title: 'Sync now',
        body: 'Refresh every connected source across all your projects in one go, instead of opening each project and syncing it separately. The button sits in the header on the Projects page. Admins only.',
        // Real screenshot pending — see the note above.
        image: null,
        placeholder: 'sync-now',
        alt: 'The Projects page header with the Sync now button.'
      }
    ],
    // No fixes listed in this issue. The "Also fixed" heading is suppressed
    // automatically when this array is empty.
    //
    // The overnight-auto-sync line was also deliberately left out: the
    // 2026-06-25 cron repair was never confirmed to have completed a run, so
    // the claim is unverified until the last_sync_cursor query is checked.
    fixes: []
  }
  // v1.4 and v1.3 were removed on 2026-08-03 — What's New starts at v1.8.
  // Their copy is recoverable from git history if they are ever wanted back.
  // The collapsed archive-row rendering stays in whats-new.html and returns
  // on its own the moment a second entry is published above this one.
];
