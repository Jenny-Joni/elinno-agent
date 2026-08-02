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
     fixes     Zero or more plain strings. NEVER carry images — if every
               item had one, a thin week would read as a large one and the
               authoring cost would sink the weekly cadence.

   Register: user-facing copy, not a changelog of the work. No commit
   SHAs, file paths, function or table names, block numbers, or internal
   vocabulary.

   Usage — load deferred, BEFORE the badge module:
     <script src="/_lib/whats-new-data.js" defer></script>
     <script src="/_lib/whats-new-badge.js" defer></script>
*/
window.WHATS_NEW = [
  {
    version: 'v1.5',
    date: '2026-08-02',
    status: 'draft',
    headline: 'Sprint numbers now match your Jira board, and you can refresh every connection at once.',
    features: [
      {
        tag: 'New',
        title: "What's new",
        body: "This page. Every week we'll post a short summary of what's been added, changed or fixed — new features get a brief explanation and a preview, smaller fixes get a one-line mention. Find it any time from the top nav.",
        image: '/whats-new/v1-5-whats-new.png',
        alt: "The What's new page showing the latest release with tagged entries."
      },
      {
        tag: 'New',
        title: 'Sync now',
        body: 'Refresh every connected source across all your projects in one go, instead of opening each project and syncing it separately. The button sits in the header on the Projects page. Admins only.',
        image: '/whats-new/v1-5-sync-now.png',
        alt: 'The Projects page header with the Sync now button at the end of the actions row.'
      }
    ],
    fixes: [
      'Issues carried over from an earlier sprint were counted against the wrong sprint. Sprint View now matches your board.',
      'A sprint that had already finished could keep showing as active. Projects with no running sprint now say so.',
      "Project cards show when that project's data was last synced."
    ]
  },
  {
    version: 'v1.4',
    date: '2026-05-23',
    status: 'published',
    headline: 'A new look across every screen.',
    features: [],
    fixes: [
      'Every screen has been redesigned — clearer type, calmer colours, and layouts that hold up on a phone.'
    ]
  },
  {
    version: 'v1.3',
    date: '2026-05-20',
    status: 'published',
    headline: 'Ask questions that span more than one project.',
    features: [],
    fixes: [
      'Start a chat that draws on every project in your workspace at once, instead of asking each one separately.'
    ]
  }
];
