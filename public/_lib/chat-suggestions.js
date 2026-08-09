/* chat-suggestions.js — shared suggested-questions module (Block 18, v1.9).

   One catalog, one card renderer, one rail renderer, one click handler, two
   mount points: project chat (public/project.html) and cross-project chat
   (public/cross-project/chat.html). Before this module the two surfaces had
   parallel implementations under different class names that had already
   drifted; see BLOCK_18_PLAN.md.

   Two render modes:
     listHtml() — first-open cards, shown while a conversation has no user
                  messages. Source-gated by the caller.
     railHtml() — returning rail above the composer, shown once a thread has
                  messages, the composer is empty and nothing is in flight.

   ESCAPING (18.3 acceptance criteria — do not weaken).
   The sprint name is third-party text: anyone with Jira board access can
   rename a sprint. It reaches two sinks and both are escaped here:
     1. text node  — via partsToHtml(), on the { b: … } catalog part
     2. attribute  — data-q, via esc() which covers " and ' as well as &<>
   Filling the composer is `input.value = …`, a value assignment, NOT an
   HTML sink. Do not "harden" it into innerHTML.

   Usage — load deferred on either chat page, before the page's own script:
     <script src="/_lib/chat-suggestions.js" defer></script>
*/
(function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── Catalog ────────────────────────────────────────────────────────────
     `text` is a function of context so interpolation and its fallback live
     in one place rather than at each call site. A part that is a string is
     literal; a part shaped { b: value } is interpolated and bolded — bold
     marks it as real data rather than a placeholder to edit, which was the
     v1.1 <topic> failure. */
  var CATALOG = {
    jira: [
      { id: 'sprint-status', icon: 'ti-target', src: 'jira',
        text: function (c) {
          return c.sprintName
            ? ['How is ', { b: c.sprintName }, ' tracking?']
            : ['How is the active sprint tracking?'];
        } },
      { id: 'workload', icon: 'ti-users', src: 'jira',
        text: function () { return ['Who has the most open tickets right now?']; } },
      { id: 'velocity', icon: 'ti-trending-up', src: 'jira',
        text: function () { return ['How has velocity changed over the last three sprints?']; } },
      { id: 'blockers', icon: 'ti-alert-triangle', src: 'jira',
        text: function () { return ['Which issues are blocking?']; } },
      { id: 'labels', icon: 'ti-tags', src: 'jira',
        text: function () { return ['Which labels show up most on in-progress work?']; } }
    ],
    slack: [
      { id: 'decisions', icon: 'ti-gavel', src: 'slack',
        text: function () { return ['Summarize the last 24 hours of decisions.']; } },
      { id: 'themes', icon: 'ti-flame', src: 'slack',
        text: function () { return ['What has the team been discussing most this week?']; } },
      { id: 'unanswered', icon: 'ti-help-circle', src: 'slack',
        text: function () { return ['Which questions went unanswered this week?']; } }
    ],
    cross: [
      { id: 'x-risk', icon: 'ti-flag',
        text: function () { return ['Which projects are at risk of missing their sprint?']; } },
      { id: 'x-velocity', icon: 'ti-trending-up',
        text: function (c) {
          return ['Compare velocity across ', { b: peersProse(c) }, ' over the last three sprints.'];
        } },
      { id: 'x-workload', icon: 'ti-users',
        text: function (c) {
          return ['Across ', { b: peersProse(c) }, ', who is the busiest assignee right now?'];
        } }
    ]
  };

  /* Explicit per-state lists, not concat() — concat produced eight cards.
     Four is the ceiling. */
  var SETS = {
    jira:  ['sprint-status', 'workload', 'velocity', 'blockers'],
    slack: ['decisions', 'themes', 'unanswered'],
    both:  ['sprint-status', 'workload', 'velocity', 'decisions'],
    cross: ['x-risk', 'x-velocity', 'x-workload']
  };

  /* Generic rail pool — the fallback when an answer succeeds but cites
     nothing. Reuses catalog ids rather than a second set of strings, so
     interpolation keeps working and the measurement query already covers it.
     `both` is CURATED, not the first three of SETS.both: taking the first
     three would drop `decisions` and leave a two-source workspace looking at
     an all-Jira rail. */
  var GENERIC_POOL = {
    jira:  ['sprint-status', 'workload', 'velocity'],
    slack: ['decisions', 'themes', 'unanswered'],
    both:  ['sprint-status', 'workload', 'decisions'],
    cross: ['x-risk', 'x-velocity', 'x-workload']
  };

  /* Keyed rail pools — chosen deterministically from the last answer's
     citation source_types. Never model-generated, never a second API call. */
  var RAIL_KEYED = {
    'jira_sprint': [
      { icon: 'ti-users',          q: 'Break that down by assignee' },
      { icon: 'ti-trending-up',    q: 'Compare with the last three sprints' },
      { icon: 'ti-alert-triangle', q: 'Which of those are blocked?' }
    ],
    'jira_issue': [
      { icon: 'ti-alert-triangle', q: 'Which of those are blocked?' },
      { icon: 'ti-users',          q: 'Who are they assigned to?' },
      { icon: 'ti-clock',          q: 'Which have been open longest?' }
    ],
    'slack_message': [
      { icon: 'ti-users',   q: 'Who was involved in that?' },
      { icon: 'ti-gavel',   q: 'What was decided?' },
      { icon: 'ti-history', q: 'Has this come up before?' }
    ],
    'cross': [
      { icon: 'ti-alert-triangle', q: 'Which of those are blocked?' },
      { icon: 'ti-git-compare',    q: 'Compare that with last sprint' },
      { icon: 'ti-clock',          q: 'Which are overdue?' }
    ]
  };

  var RAIL_MAX = 3;

  var BY_ID = {};
  ['jira', 'slack', 'cross'].forEach(function (k) {
    CATALOG[k].forEach(function (i) { BY_ID[i.id] = i; });
  });

  function peersProse(c) {
    var p = (c && c.peers) || [];
    if (p.length === 0) return 'these projects';
    if (p.length === 1) return p[0];
    if (p.length === 2) return p[0] + ' and ' + p[1];
    return p.slice(0, -1).join(', ') + ' and ' + p[p.length - 1];
  }

  /* ── Renderers ───────────────────────────────────────────────────────── */
  function partsToHtml(parts) {
    return parts.map(function (p) {
      return typeof p === 'string' ? esc(p) : '<b>' + esc(p.b) + '</b>';
    }).join('');
  }

  function plainText(parts) {
    return parts.map(function (p) {
      return typeof p === 'string' ? p : p.b;
    }).join('');
  }

  /* Rendered plain text for a catalog id under a given context. Exposed so
     callers (and the already-sent filter) can compare against sent messages
     without re-deriving the interpolation. */
  function textFor(id, ctx) {
    var item = BY_ID[id];
    return item ? plainText(item.text(ctx || {})) : '';
  }

  function cardHtml(item, showSrc, ctx) {
    var parts = item.text(ctx || {});
    var srcHtml = (showSrc && item.src)
      ? '<span class="sg-card__src is-' + item.src + '">' + esc(item.src) + '</span>'
      : '';
    return ''
      + '<button class="sg-card" type="button"'
      +   ' data-suggestion-id="' + esc(item.id) + '"'
      +   ' data-q="' + esc(plainText(parts)) + '">'
      +   '<i class="ti ' + esc(item.icon) + ' sg-card__icon"></i>'
      +   '<span class="sg-card__text">' + partsToHtml(parts) + '</span>'
      +   srcHtml
      + '</button>';
  }

  function listHtml(state, ctx) {
    var ids = SETS[state] || [];
    var showSrc = state === 'both';
    if (ids.length === 0) return '';
    return '<div class="sg-list">'
      + ids.map(function (id) { return cardHtml(BY_ID[id], showSrc, ctx); }).join('')
      + '</div>';
  }

  /* ── Rail selection ──────────────────────────────────────────────────────
     Order: errored turn → nothing. Otherwise pick the keyed pool from the
     last answer's citations, or the generic pool when it cited nothing.
     Then apply the already-sent filter AT THE RENDER BOUNDARY, so it covers
     keyed and generic alike, and backfill if that empties the list. */

  function keyFromCitations(citations, surface) {
    var types = {};
    (citations || []).forEach(function (c) {
      if (c && c.source_type) types[c.source_type] = true;
    });
    // No citations at all is the `.muted` case and takes the generic pool on
    // EVERY surface, cross included — returning a keyed pool for cross
    // unconditionally would make its generic pool unreachable.
    if (Object.keys(types).length === 0) return null;
    if (surface === 'cross') return 'cross';
    if (types['jira_sprint']) return 'jira_sprint';
    if (types['jira_issue']) return 'jira_issue';
    if (types['slack_message']) return 'slack_message';
    return null; // cited, but nothing recognised → generic pool
  }

  function genericItems(state, ctx) {
    return (GENERIC_POOL[state] || []).map(function (id) {
      var item = BY_ID[id];
      return { icon: item.icon, q: textFor(id, ctx) };
    });
  }

  /* Catalog entries for the connected source(s), in catalog order, that are
     not already in the generic pool. Project · Jira has `blockers` and
     `labels` in reserve; Slack has none; cross-project's catalog IS its set,
     so it has no reserve. */
  function backfillItems(state, ctx) {
    var groups = state === 'cross' ? ['cross']
      : state === 'both' ? ['jira', 'slack']
      : state === 'jira' ? ['jira']
      : state === 'slack' ? ['slack'] : [];
    var already = {};
    (GENERIC_POOL[state] || []).forEach(function (id) { already[id] = true; });
    var out = [];
    groups.forEach(function (g) {
      CATALOG[g].forEach(function (item) {
        if (already[item.id]) return;
        out.push({ icon: item.icon, q: textFor(item.id, ctx) });
      });
    });
    return out;
  }

  /* opts:
       surface   'project' | 'cross'
       state     'jira' | 'slack' | 'both' | 'cross'
       citations last assistant turn's citations array (may be null)
       errored   true when the last turn failed (model === null)
       sentTexts array of user-message strings already sent in this thread
       ctx       { sprintName, peers, … } */
  function railItems(opts) {
    var o = opts || {};
    if (o.errored) return [];

    var key = keyFromCitations(o.citations, o.surface);
    var primary = key ? (RAIL_KEYED[key] || []).slice() : genericItems(o.state, o.ctx);

    var sent = {};
    (o.sentTexts || []).forEach(function (t) {
      if (typeof t === 'string') sent[t.trim()] = true;
    });
    var unseen = function (it) { return !sent[String(it.q).trim()]; };

    var picked = primary.filter(unseen);
    if (picked.length === 0) {
      // Keyed pool exhausted or all already asked: fall through to generic,
      // then to the rest of the catalog. Same filter applies to both.
      picked = genericItems(o.state, o.ctx).filter(unseen);
    }
    if (picked.length === 0) {
      picked = backfillItems(o.state, o.ctx).filter(unseen);
    }
    return picked.slice(0, RAIL_MAX);
  }

  function railHtml(opts) {
    var items = railItems(opts);
    if (items.length === 0) return ''; // nothing new to offer → no rail at all
    var pills = items.map(function (it) {
      return ''
        + '<button class="sg-pill" type="button"'
        +   (it.id ? ' data-suggestion-id="' + esc(it.id) + '"' : '')
        +   ' data-q="' + esc(it.q) + '">'
        +   '<i class="ti ' + esc(it.icon) + ' sg-pill__icon"></i>'
        +   '<span class="sg-pill__text">' + esc(it.q) + '</span>'
        + '</button>';
    }).join('');
    return ''
      + '<div class="sg-rail">'
      +   '<span class="sg-rail__label">Try next</span>'
      +   '<div class="sg-rail__track">' + pills + '</div>'
      +   '<button class="sg-rail__dismiss" type="button" title="Hide for this conversation" aria-label="Hide suggestions for this conversation">&times;</button>'
      + '</div>';
  }

  /* ── Dismiss state — in memory only, per conversation ─────────────────
     Deliberately not localStorage: the rail is a nudge, not a preference,
     and a dismissal that outlives the session would silently disable the
     feature for anyone who ever clicked ×. */
  var dismissed = Object.create(null);
  function isDismissed(convId) { return !!dismissed[convId]; }
  function dismiss(convId) { if (convId) dismissed[convId] = true; }
  function resetDismissed() { dismissed = Object.create(null); }

  /* ── Wiring ──────────────────────────────────────────────────────────────
     Click fills the composer, focuses it and dispatches `input` so the
     auto-resize and send-enable logic fires. NO auto-submit: PRD §5.9 calls
     these example questions, not example answers, and auto-submit turns a
     nudge into unrequested token spend.

     opts:
       getInput()      → the composer textarea
       onDismiss()     → called when × is clicked
       onPick(id, q)   → optional, fired after the composer is filled */
  function wire(scope, opts) {
    if (!scope) return;
    var o = opts || {};
    scope.querySelectorAll('[data-q]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = o.getInput && o.getInput();
        if (!input) return;
        var q = btn.getAttribute('data-q') || '';
        input.value = q; // value assignment, not an HTML sink
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (o.onPick) o.onPick(btn.getAttribute('data-suggestion-id'), q);
      });
    });
    var x = scope.querySelector('.sg-rail__dismiss');
    if (x && o.onDismiss) x.addEventListener('click', o.onDismiss);
  }

  window.ChatSuggestions = {
    esc: esc,
    CATALOG: CATALOG,
    SETS: SETS,
    GENERIC_POOL: GENERIC_POOL,
    RAIL_KEYED: RAIL_KEYED,
    textFor: textFor,
    listHtml: listHtml,
    railItems: railItems,
    railHtml: railHtml,
    wire: wire,
    isDismissed: isDismissed,
    dismiss: dismiss,
    resetDismissed: resetDismissed
  };
})();
