/* finance-xlsx.js — turn a Reap .xlsx export into the payload
   /api/finance/<dataset> expects.

   Block 25, decision B: Jenny drops the file Reap produces and the browser
   parses it, so the Worker stays dependency-free. The server does NOT trust
   what comes out of here — functions/api/finance/[dataset].js revalidates
   every row and rebuilds it from a fixed field list. This file's job is to
   produce something sensible, not to be the gate.

   Depends on read-excel-file.min.js having been loaded first (it sets the
   global `readXlsxFile`).

   ---------------------------------------------------------------------
   THE SHAPE TRAPS, all four from the 2026-08-20/21 session:

     1. The header is not row 1. On the 2026-08-21 export it is row 3;
        rows 1-2 are titles. Rather than hardcode "row 3" and break on the
        next export, findHeaderRow scans the first ROWS_TO_SCAN rows and
        takes the one that actually looks like a header.
     2. The last row is a totals footer, not a payment. It is detected by
        having no usable date, not by its position, so a trailing blank
        row does not fool it. Its amount is kept as the declared total —
        that is the value the server's integrity check compares the row
        sum against, so the footer earns its keep instead of being thrown
        away.
     3. `Category` is misspelled `Catrgory` in the file. Both spellings
        are in the alias table.
     4. Dates arrive in at least three forms depending on how the cell is
        formatted — a real Date, an Excel serial number, or a string.
        All three are handled; anything else fails loudly.

   Cell fill colours are deliberately NOT read. The per-project palette is
   a static map in the page with the contrast-corrected values; see the
   closeout for why seven of them were darkened.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var ROWS_TO_SCAN = 10;

  /* Normalise a header cell so "Account Owner", "account_owner" and
     "ACCOUNTOWNER" all collapse to the same key. */
  function norm(v) {
    return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /* field -> accepted header spellings, normalised. `catrgory` is the
     misspelling in the real file; `category` is here so a corrected export
     keeps working. */
  var ALIASES = {
    name: ['name'],
    requestedBy: ['requestedby', 'requester', 'requestedbyuser'],
    accountOwner: ['accountowner', 'owner', 'cardowner'],
    card: ['card', 'cardname', 'cardlabel'],
    project: ['project', 'projectname'],
    merchant: ['merchant', 'merchantname'],
    vendor: ['vendor', 'vendorname', 'supplier'],
    department: ['department', 'dept'],
    category: ['catrgory', 'category'],
    description: ['description', 'desc', 'vendordescription'],
    date: ['date', 'transactiondate', 'paymentdate'],
    amount: ['amount', 'amountusd', 'total', 'value']
  };

  /* Without these four there is no usable payment record. Everything else
     degrades to an empty string. */
  var REQUIRED = ['project', 'vendor', 'date', 'amount'];

  function buildColumnMap(headerCells) {
    var map = {};
    var seen = {};
    for (var i = 0; i < headerCells.length; i++) {
      var key = norm(headerCells[i]);
      if (!key || seen[key]) continue;
      seen[key] = true;
      for (var field in ALIASES) {
        if (!Object.prototype.hasOwnProperty.call(ALIASES, field)) continue;
        if (map[field] === undefined && ALIASES[field].indexOf(key) !== -1) {
          map[field] = i;
          break;
        }
      }
    }
    return map;
  }

  function scoreHeaderRow(cells) {
    var map = buildColumnMap(cells);
    var n = 0;
    for (var f in map) if (Object.prototype.hasOwnProperty.call(map, f)) n++;
    return n;
  }

  /* Trap 1. Pick the row that looks most like a header rather than trusting
     a fixed index. Ties go to the earliest row. */
  function findHeaderRow(rows) {
    var best = -1, bestScore = 0;
    var limit = Math.min(ROWS_TO_SCAN, rows.length);
    for (var i = 0; i < limit; i++) {
      var s = scoreHeaderRow(rows[i] || []);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return { index: best, score: bestScore };
  }

  /* Trap 4. Excel serials count days from 1899-12-30. A Date arrives when
     the cell carries a date format; a string when it does not. */
  function toIsoDate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v.getTime())) {
      return v.getFullYear() + '-' +
        String(v.getMonth() + 1).padStart(2, '0') + '-' +
        String(v.getDate()).padStart(2, '0');
    }
    if (typeof v === 'number' && isFinite(v)) {
      var ms = Math.round((v - 25569) * 86400 * 1000);
      var d = new Date(ms);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (m) {
      /* Day-first. The range picker displays dd/mm/yy and the source is a
         Hong Kong export; month-first would silently mis-bucket every
         payment before the 13th of a month. */
      var yr = m[3].length === 2 ? '20' + m[3] : m[3];
      return yr + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    }
    return '';
  }

  function toAmount(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null || v === '') return null;
    /* Strip currency symbols, thousands separators and whitespace; keep a
       leading minus and the decimal point. */
    var s = String(v).replace(/[^0-9.\-]/g, '');
    if (!s || s === '-' || s === '.') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function cell(row, map, field) {
    var i = map[field];
    if (i === undefined) return '';
    var v = row[i];
    if (v == null) return '';
    return String(v).trim();
  }

  /* read-excel-file 9.3.10's bundle returns [{ data: [...rows], sheet: name }]
     for every call shape, while its docs describe a bare array of rows. The
     first real .xlsx put through this hit that difference: rows[0] was an
     object, header detection found nothing, and the "could not find a header"
     path then threw on .concat instead of reporting anything useful.

     Accept both shapes so a library update cannot silently break uploads, and
     take the sheet name from the same result rather than a second parse — the
     `getSheets` call this replaces read `.name`, which does not exist on that
     object either. */
  function normaliseSheet(res) {
    if (Array.isArray(res) && res.length && res[0] && Array.isArray(res[0].data)) {
      return { rows: res[0].data, sheet: res[0].sheet || '' };
    }
    if (Array.isArray(res) && (!res.length || Array.isArray(res[0]))) {
      return { rows: res, sheet: '' };
    }
    return { rows: [], sheet: '' };
  }

  /**
   * @param {File|Blob} file  the .xlsx the admin picked
   * @returns {Promise<object>} payload for POST /api/finance/<dataset>
   * @throws {Error} with a message naming what was actually found
   */
  async function parseFinanceWorkbook(file) {
    if (!global.readXlsxFile) {
      throw new Error('read-excel-file.min.js has not loaded');
    }

    var parsed = normaliseSheet(await global.readXlsxFile(file, { sheet: 1 }));
    var rows = parsed.rows;
    var sheetName = parsed.sheet;

    if (!rows.length) throw new Error('That file has no rows in its first sheet.');

    var found = findHeaderRow(rows);
    if (found.index === -1 || found.score < REQUIRED.length) {
      var peek = rows.slice(0, 3)
        .reduce(function (acc, r) { return acc.concat(Array.isArray(r) ? r : [r]); }, [])
        .filter(function (c) { return c != null && String(c).trim() !== ''; })
        .slice(0, 12).join(', ');
      throw new Error(
        'Could not find a header row in the first ' + ROWS_TO_SCAN + ' rows. ' +
        'Expected columns including Project, Vendor, Date and Amount. ' +
        'Saw: ' + (peek || '(nothing)')
      );
    }

    var map = buildColumnMap(rows[found.index]);
    var missing = REQUIRED.filter(function (f) { return map[f] === undefined; });
    if (missing.length) {
      var headers = (Array.isArray(rows[found.index]) ? rows[found.index] : [])
        .filter(function (c) { return c != null && String(c).trim() !== ''; })
        .join(', ');
      throw new Error(
        'The sheet is missing required column(s): ' + missing.join(', ') +
        '. Header row reads: ' + headers
      );
    }

    var out = [];
    var declaredTotal = null;
    var minDate = null, maxDate = null;

    for (var i = found.index + 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var date = toIsoDate(row[map.date]);
      var amount = toAmount(row[map.amount]);

      if (!date) {
        /* Trap 2. No date but an amount is the totals footer — keep its
           value so the server can check the row sum against it. A row with
           neither is blank padding and is skipped silently. */
        if (amount !== null) declaredTotal = amount;
        continue;
      }
      if (amount === null) continue;

      var rec = { date: date, amount: Math.round(amount * 100) / 100 };
      rec.name = cell(row, map, 'name');
      rec.requestedBy = cell(row, map, 'requestedBy');
      rec.accountOwner = cell(row, map, 'accountOwner');
      rec.card = cell(row, map, 'card');
      rec.project = cell(row, map, 'project');
      rec.merchant = cell(row, map, 'merchant');
      rec.vendor = cell(row, map, 'vendor');
      rec.department = cell(row, map, 'department');
      rec.category = cell(row, map, 'category');
      rec.description = cell(row, map, 'description');
      out.push(rec);

      if (minDate === null || date < minDate) minDate = date;
      if (maxDate === null || date > maxDate) maxDate = date;
    }

    if (!out.length) {
      throw new Error('No payment rows found below the header. Nothing was uploaded.');
    }

    var payload = {
      sourceFile: (file && file.name) || '',
      sheet: sheetName,
      periodStart: minDate || '',
      periodEnd: maxDate || '',
      rows: out
    };
    /* Only sent when the file actually carried a footer total. The server
       treats it as optional and rejects a mismatch over a cent. */
    if (declaredTotal !== null) payload.footerTotal = Math.round(declaredTotal * 100) / 100;
    return payload;
  }

  global.parseFinanceWorkbook = parseFinanceWorkbook;
  /* Exposed for the header-mapping check against a real export. */
  parseFinanceWorkbook._internals = {
    norm: norm,
    buildColumnMap: buildColumnMap,
    normaliseSheet: normaliseSheet,
    findHeaderRow: findHeaderRow,
    toIsoDate: toIsoDate,
    toAmount: toAmount,
    ALIASES: ALIASES
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
