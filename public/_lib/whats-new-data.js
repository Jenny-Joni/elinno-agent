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
