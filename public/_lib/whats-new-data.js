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
    // v2.1 — DRAFT. Not published.
    //
    // AUTHORSHIP, recorded because it departs from the normal division of
    // labour, exactly as v2.0 below does: the copy was written by Claude
    // Code at Jenny's explicit direction ("write what was added in this
    // version"). This file's header says copy, images and version numbers
    // are Jenny's. This entry is the exception, not a change to that rule.
    // Read it as stand-in text and rewrite anything that does not sound
    // like you.
    //
    // PUBLISHED 2026-08-24 at Jenny's explicit direction, the same day it
    // was drafted. This file's header describes publication as a separate
    // command on a separate day; she asked for a v2.1 section she could
    // see, and said so when the draft did not appear. Noted because it
    // compresses the two-step rule, not because the rule changed.
    //
    // Images are Jenny's and are not generated here. Every feature carries
    // image: null with a placeholder slug, the same shape v2.0 shipped in.
    //
    // Deliberately excluded per "What belongs in an entry": where the data
    // is stored, the upload endpoint, the spreadsheet parser, the menu's
    // internal rework, and the cache-stamp pass — none of it visible to a
    // user. Also excluded are the two spreadsheet-reading bugs found and
    // fixed before release: no user ever met them, the same reasoning v2.0
    // applied to its own in-block fixes.
    //
    // No real figures appear here. The page is visible to every signed-in
    // user, but an example total baked into release notes would age badly
    // and would be company spend sitting in a static file.
    // ═══════════════════════════════════════════════════════════════════
    version: 'v2.1',
    // Week beginning Sunday 2026-08-23, matching the Sunday-dated
    // convention v1.8 through v2.0 use.
    date: '2026-08-23',
    status: 'published',
    headline: 'Company card spend is now a page in the app: every payment from the Reap export, grouped by project, by vendor and by month, and openable down to the individual charge.',
    features: [
      {
        tag: 'New',
        // NAMED: the Reap tab — three cards over one shared filter row.
        title: 'Three ways to read the same spend',
        body: 'Finance opens on Reap, which holds every payment in the current export. The same period is shown three ways at once: which projects the money went to, which vendors were paid, and how it split month by month. Project and vendor can each be read as a chart or as a table, whichever you find easier to scan.',
        image: null,
        placeholder: 'finance-reap',
        alt: 'Illustration: a by-project chart listing three projects with coloured bars and totals beside them.'
      },
      {
        tag: 'New',
        // NAMED: four-level drill, both directions, plus the shared filter
        // row (projects, vendors, date range, cards).
        title: 'Open any figure to see what it is made of',
        body: 'No total is a dead end. Open a project to see the vendors it paid, open a vendor to see whose card was used, and open that to reach the individual payments with their dates. It works from either end — start from a vendor and you can see which projects it was charged to instead. Above all of it, one row of filters for projects, vendors, dates and cards; set it once and all three views narrow together.',
        image: null,
        placeholder: 'finance-drill',
        alt: 'Illustration: a project total expanded into a vendor, then a cardholder, then a single dated payment.'
      },
      {
        tag: 'New',
        // NAMED: dashboard section above Projects — total, payment count,
        // upload date. Reap only; Fiat and Crypto are static.
        title: 'The headline figure without opening the page',
        body: 'The dashboard now leads with Finance, above your projects. It carries the total for the loaded period, how many payments make it up, and the date the figures were last replaced — so you can tell at a glance whether what you are looking at is current.',
        image: null,
        placeholder: 'finance-dashboard',
        alt: 'Illustration: a dashboard section headed Finance, with a Reap total, a payment count and an updated date.'
      },
      {
        tag: 'New',
        // NAMED: admin-only upload; parses the sheet in the browser,
        // confirms with counts, full-replaces, keeps one previous version.
        title: 'Updating the numbers takes one file',
        body: 'Admins keep Finance current by dropping the latest Reap export onto the page — no exporting to another format first. It reads the spreadsheet, tells you how many payments it found, and asks before it replaces anything, naming how many it is about to remove. If the file turns out to be the wrong one, the previous version is kept. Each upload replaces everything rather than adding to it, because the export always covers the full history.',
        image: null,
        placeholder: 'finance-upload',
        alt: 'Illustration: a Replace data button beside the Reap heading, and a confirmation naming how many payments will be replaced.'
      }
    ],
    fixes: [
      {
        tag: 'New',
        text: 'Finance sits in the menu on every screen, above Projects, and opens to its three sources. Reap is live; Fiat and Crypto are listed but not connected to anything yet.'
      },
      {
        tag: 'New',
        text: 'Everyone signed in can read Finance. Replacing the data is limited to admins.'
      }
    ]
  },
  {
    // ═══════════════════════════════════════════════════════════════════
    // v2.0 — PUBLISHED 2026-08-16.
    //
    // AUTHORSHIP, recorded because it departs from the normal division of
    // labour: the copy below was written by Claude Code and published at
    // Jenny's explicit direction, after she was shown that it was stand-in
    // text and approved it anyway. HANDOFF's "Adding an entry to What's
    // New" says copy is Jenny's; this entry is the exception, not a change
    // to that rule.
    //
    // Entries are frozen once published — an entry records what shipped in
    // its release and is not resynced later. Rewriting these strings is a
    // deliberate correction, not routine editing.
    //
    // Previews are the verbatim form: the navigation labels are the real
    // shipped strings, and project names are invented stand-ins (Aurora,
    // Beacon, Meridian) per PRD §5.11.6's Contents rule.
    //
    // Deliberately excluded per "What belongs in an entry": the shared
    // component, the retired top bar, the added API field, the stylesheet
    // re-key and cache-bust — none of it visible to a user. Also excluded
    // are the font and What's-new-link inconsistencies, introduced and
    // fixed inside this same unreleased block, so no user met them.
    // ═══════════════════════════════════════════════════════════════════
    version: 'v2.0',
    // Week beginning Sunday 2026-08-16, matching the Sunday-dated
    // convention v1.8 and v1.9 use. Confirm at publication.
    date: '2026-08-16',
    status: 'published',
    headline: 'Every screen now has the same menu down the left, so your projects, chats and settings are one click away from wherever you are.',
    features: [
      {
        tag: 'New',
        // NAMED: navigation moved from a top bar to a persistent left menu,
        // present on every signed-in screen.
        title: 'A menu that follows you',
        body: 'Navigation used to live in a bar across the top, and what it contained changed from screen to screen. It is now a single menu down the left side of every screen, in the same place with the same contents wherever you are. It starts narrow and shows icons; open it when you want the labels.',
        image: null,
        placeholder: 'rail-desktop',
        alt: 'Placeholder illustration: a narrow icon menu down the left of the screen, and the same menu opened to show labels.'
      },
      {
        tag: 'New',
        // NAMED: projects expand in the menu to Sprint View / Chat /
        // Settings; several can stay open at once.
        title: 'Your projects, without going via the projects page',
        body: 'Open Projects in the menu and every project is listed. Open a project and you can go straight to its Sprint View, its chat, or its settings. More than one can stay open at a time, so you can move between two projects without collapsing the first.',
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
        title: 'It stays how you left it',
        body: 'The menu keeps its shape as you move around: open or closed, which projects you had expanded, and where you had scrolled to. Workspace settings and Members are in it too, which is new — workspace settings previously had no link in the navigation on any screen.',
        image: null,
        placeholder: 'rail-mobile',
        alt: 'Placeholder illustration: the menu on a phone, closed behind a button and then slid open over the page.'
      }
    ],
    fixes: [
      {
        tag: 'Improved',
        // NAMED: mobile chrome is 52px where the old bar was 70px.
        text: 'Phones get a little more of the screen back: the strip across the top is shorter than the bar it replaces.'
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
