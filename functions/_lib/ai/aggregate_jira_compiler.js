// aggregate_jira DSL compiler — Block 11.
//
// Source-of-truth allowlists per PRD v1.2 §3.4 + §3.4.1.
// Validates DSL, compiles to one parameterized SQL SELECT against the
// jira_issues view, and runs it. project_id is server-injected; the DSL
// has no slot for it.
//
// See BLOCK_11_PLAN.md decisions A–P for locked rationale.
//
// Public surface:
//   - runAggregateJira(sql, projectId, dsl)
//   - compile(dsl, projectId)
//   - ALLOWED_COLUMNS / ALLOWED_PROJECTIONS / ALLOWED_AGGREGATES /
//     ALLOWED_OPERATORS / GROUPED_LIMIT_MAX / UNGROUPED_LIMIT_MAX

// ─── Allowlists (PRD §3.4 + §3.4.1) ──────────────────────────────────────

export const ALLOWED_COLUMNS = Object.freeze([
  'issue_key',
  'project_key',
  'status',
  'status_category',
  'issue_type',
  'assignee_display_name',
  'assignee_external_id',
  'reporter_display_name',
  'priority',
  'sprint_id',
  'sprint_name',
  'story_points',
  'source_created_at',
  'source_updated_at',
  'labels',
  // v1.3 Block 12.5a, PRD §3.4.1 + decision J: project_id is position-
  // aware allowlisted. ALLOWED IN select and group_by; FORBIDDEN in
  // where (the existing `project_id_forbidden` check at the top of
  // where-parsing fires before this allowlist is consulted, so adding
  // project_id here is safe — the position-aware enforcement is at
  // the parser level).
  'project_id',
]);
const COLUMNS_SET = new Set(ALLOWED_COLUMNS);

export const ALLOWED_PROJECTIONS = Object.freeze(['labels[]']);
const PROJECTIONS_SET = new Set(ALLOWED_PROJECTIONS);

const NUMERIC_COLUMNS = new Set(['story_points']);
const NUMERIC_AGGREGATES = new Set(['SUM', 'AVG']);
const LABELS_COLUMN = 'labels';
const LABELS_PROJECTION = 'labels[]';
const LABELS_LATERAL_ALIAS = 'label_value';

export const ALLOWED_AGGREGATES = Object.freeze(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
const AGGREGATES_SET = new Set(ALLOWED_AGGREGATES);

export const ALLOWED_OPERATORS = Object.freeze([
  'eq',
  'in',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_null',
  'is_not_null',
]);
const OPERATORS_SET = new Set(ALLOWED_OPERATORS);
const COMPARISON_SQL = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

// `labels` (JSONB array) gets `contains` only — PRD §3.4
const LABELS_OPERATORS = new Set(['contains']);

export const GROUPED_LIMIT_MAX = 500;
export const UNGROUPED_LIMIT_MAX = 50;
const DEFAULT_LIMIT = 50;

const VIEW = 'jira_issues';
const ORDER_DIRS = new Set(['asc', 'desc']);

// ─── Error envelope (decision G) ──────────────────────────────────────────

function validationError(code, field, allowed = null) {
  return { ok: false, error: 'validation', code, field, allowed };
}

// ─── Select-item parsing ──────────────────────────────────────────────────
//
// A select item is one of:
//   • column name from ALLOWED_COLUMNS
//   • 'labels[]' (only valid when paired with group_by: ['labels[]'])
//   • aggregate expression: COUNT(*), COUNT(col), COUNT(DISTINCT col),
//     SUM(col), AVG(col), MIN(col), MAX(col)

const AGG_RE = /^(COUNT|SUM|AVG|MIN|MAX)\(\s*(?:(\*)|(?:(DISTINCT)\s+([a-z_][a-z0-9_]*))|([a-z_][a-z0-9_]*))\s*\)$/;

function parseSelectItem(item) {
  if (typeof item !== 'string' || item.length === 0) return null;

  if (COLUMNS_SET.has(item)) {
    return { kind: 'column', column: item, alias: item };
  }

  if (PROJECTIONS_SET.has(item)) {
    // labels[] — emitted as label_value from the LATERAL join.
    // Caller validates that group_by contains 'labels[]'.
    return { kind: 'projection', projection: item, alias: LABELS_LATERAL_ALIAS };
  }

  const m = item.match(AGG_RE);
  if (!m) return null;

  const fn = m[1];
  const isStar = !!m[2];
  const distinctCol = m[4];
  const plainCol = m[5];

  if (isStar) {
    // Only COUNT(*) — no SUM(*), MIN(*), etc.
    if (fn !== 'COUNT') return null;
    return { kind: 'aggregate', fn, star: true, alias: 'count' };
  }

  const col = distinctCol || plainCol;
  if (!COLUMNS_SET.has(col)) return null;

  if (NUMERIC_AGGREGATES.has(fn) && !NUMERIC_COLUMNS.has(col)) return null;

  const distinct = !!distinctCol;
  const alias = distinct
    ? `count_distinct_${col}`
    : `${fn.toLowerCase()}_${col}`;
  return { kind: 'aggregate', fn, column: col, distinct, alias };
}

function selectItemSql(parsed) {
  switch (parsed.kind) {
    case 'column':
      return `${parsed.column} AS ${parsed.alias}`;
    case 'projection':
      // labels[] → label_value emitted by LATERAL join (added at FROM)
      return `${LABELS_LATERAL_ALIAS} AS ${parsed.alias}`;
    case 'aggregate':
      if (parsed.star) return `COUNT(*) AS ${parsed.alias}`;
      if (parsed.distinct) return `${parsed.fn}(DISTINCT ${parsed.column}) AS ${parsed.alias}`;
      return `${parsed.fn}(${parsed.column}) AS ${parsed.alias}`;
    default:
      throw new Error(`unreachable: unknown select item kind`);
  }
}

// ─── Group-by parsing ─────────────────────────────────────────────────────

function parseGroupBy(item) {
  if (typeof item !== 'string' || item.length === 0) return null;
  if (item === LABELS_PROJECTION) return { kind: 'projection' };
  if (COLUMNS_SET.has(item)) return { kind: 'column', column: item };
  return null;
}

function groupBySql(parsed) {
  return parsed.kind === 'projection' ? LABELS_LATERAL_ALIAS : parsed.column;
}

// ─── Where parsing ────────────────────────────────────────────────────────
//
// where: { col: scalar }                  → eq
// where: { col: { op: value } }           → operator object
// where: { col: { is_null: true } }       → unary
// where: { col: { is_not_null: true } }   → unary
// where: { labels: { contains: 'x' } }    → labels-only

function parseWhereForColumn(col, raw, paramOffset, params) {
  if (!COLUMNS_SET.has(col)) {
    return { ok: false, code: 'column_not_allowlisted', field: `where.${col}` };
  }

  // Reject project_id explicitly even if it sneaks in (defense in depth;
  // it's not in ALLOWED_COLUMNS but a sharper error helps the LLM).
  if (col === 'project_id') {
    return { ok: false, code: 'project_id_forbidden', field: 'where.project_id' };
  }

  // Reject null scalars — `col = NULL` is always false in SQL and would
  // silently match nothing. Force the LLM to use the unary `is_null` op.
  if (raw === null) {
    return {
      ok: false,
      code: 'predicate_value_invalid',
      field: `where.${col}`,
      allowed: 'use { is_null: true } or { is_not_null: true } to check NULL state',
    };
  }

  // Scalar form → eq (forbidden for labels — JSONB array requires contains)
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    if (col === LABELS_COLUMN) {
      return { ok: false, code: 'operator_not_allowlisted_for_labels', field: `where.${col}`, allowed: ['contains'] };
    }
    params.push(raw);
    return { ok: true, sql: `${col} = $${paramOffset + 1}`, consumed: 1 };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'predicate_shape_invalid', field: `where.${col}` };
  }

  const ops = Object.keys(raw);
  if (ops.length !== 1) {
    return { ok: false, code: 'predicate_shape_invalid', field: `where.${col}`, allowed: 'exactly one operator per column' };
  }
  const op = ops[0];

  // Labels gets contains only.
  if (col === LABELS_COLUMN) {
    if (!LABELS_OPERATORS.has(op)) {
      return { ok: false, code: 'operator_not_allowlisted_for_labels', field: `where.${col}.${op}`, allowed: ['contains'] };
    }
    const v = raw[op];
    if (typeof v !== 'string' || v.length === 0) {
      return { ok: false, code: 'predicate_value_invalid', field: `where.${col}.${op}` };
    }
    // labels @> $::jsonb — value parameterized as a JSON array string
    params.push(JSON.stringify([v]));
    return { ok: true, sql: `${col} @> $${paramOffset + 1}::jsonb`, consumed: 1 };
  }

  if (!OPERATORS_SET.has(op)) {
    return { ok: false, code: 'operator_not_allowlisted', field: `where.${col}.${op}`, allowed: ALLOWED_OPERATORS };
  }

  if (op === 'is_null') {
    return raw[op] === true
      ? { ok: true, sql: `${col} IS NULL`, consumed: 0 }
      : { ok: false, code: 'predicate_value_invalid', field: `where.${col}.is_null` };
  }
  if (op === 'is_not_null') {
    return raw[op] === true
      ? { ok: true, sql: `${col} IS NOT NULL`, consumed: 0 }
      : { ok: false, code: 'predicate_value_invalid', field: `where.${col}.is_not_null` };
  }

  if (op === 'in') {
    const v = raw[op];
    if (!Array.isArray(v) || v.length === 0) {
      return { ok: false, code: 'predicate_value_invalid', field: `where.${col}.in` };
    }
    params.push(v);
    return { ok: true, sql: `${col} = ANY($${paramOffset + 1})`, consumed: 1 };
  }

  // eq / neq / gt / gte / lt / lte
  const sqlOp = COMPARISON_SQL[op];
  const v = raw[op];
  if (v === undefined || v === null) {
    return { ok: false, code: 'predicate_value_invalid', field: `where.${col}.${op}` };
  }
  params.push(v);
  return { ok: true, sql: `${col} ${sqlOp} $${paramOffset + 1}`, consumed: 1 };
}

// ─── Order-by parsing ─────────────────────────────────────────────────────

function parseOrderBy(item, aliasSet, isGrouped) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const { field, dir } = item;
  if (typeof field !== 'string') return null;
  if (typeof dir !== 'string' || !ORDER_DIRS.has(dir.toLowerCase())) return null;

  // Always allow select-item aliases (e.g. 'count', 'sum_story_points',
  // or any column name that's in select).
  if (aliasSet.has(field)) return { field, dir: dir.toLowerCase() };

  // For ungrouped queries, also allow ordering by any allowlisted column
  // that isn't in select. PRD §3.3 doesn't constrain order_by.field to
  // select aliases — e.g. "list issues, oldest first" is `select:
  // ['issue_key','title']` + `order_by: source_created_at asc` and that
  // is valid SQL for non-DISTINCT, non-grouped queries. For grouped
  // queries we keep the stricter rule because postgres requires
  // non-aggregated order_by columns to appear in group_by; rather than
  // surfacing a postgres-side error message, we reject at validation.
  if (!isGrouped && COLUMNS_SET.has(field)) {
    return { field, dir: dir.toLowerCase() };
  }

  return null;
}

// ─── Compile ──────────────────────────────────────────────────────────────

export function compile(dsl, projectId, crossProjectIds = null) {
  if (!dsl || typeof dsl !== 'object' || Array.isArray(dsl)) {
    return validationError('dsl_not_object', null);
  }
  // v1.3 Block 12.5a: cross-project mode takes precedence. When
  // crossProjectIds is a non-empty array, projectId may be empty
  // (cross-project routes don't bind a single project to the URL).
  // Otherwise the v1.2 single-project requirement holds.
  const isCrossProject = Array.isArray(crossProjectIds) && crossProjectIds.length > 0;
  if (!isCrossProject && (typeof projectId !== 'string' || projectId.length === 0)) {
    return validationError('project_id_missing', null);
  }

  // ── select (required) ───────────────────────────────────────────────
  if (!Array.isArray(dsl.select) || dsl.select.length === 0) {
    return validationError('select_required', 'select');
  }
  const selectParsed = [];
  for (let i = 0; i < dsl.select.length; i++) {
    const parsed = parseSelectItem(dsl.select[i]);
    if (!parsed) {
      return validationError('select_item_not_allowlisted', `select[${i}]`, {
        columns: ALLOWED_COLUMNS,
        projections: ALLOWED_PROJECTIONS,
        aggregates: ALLOWED_AGGREGATES,
      });
    }
    selectParsed.push(parsed);
  }

  // ── group_by (optional) ─────────────────────────────────────────────
  const groupByRaw = dsl.group_by;
  const groupByParsed = [];
  if (groupByRaw !== undefined) {
    if (!Array.isArray(groupByRaw)) {
      return validationError('group_by_shape_invalid', 'group_by');
    }
    for (let i = 0; i < groupByRaw.length; i++) {
      const parsed = parseGroupBy(groupByRaw[i]);
      if (!parsed) {
        return validationError('group_by_item_not_allowlisted', `group_by[${i}]`, {
          columns: ALLOWED_COLUMNS,
          projections: ALLOWED_PROJECTIONS,
        });
      }
      groupByParsed.push(parsed);
    }
  }
  const isGrouped = groupByParsed.length > 0;

  // labels[] pairing: select 'labels[]' iff group_by contains 'labels[]'
  const selectHasLabelsProjection = selectParsed.some((p) => p.kind === 'projection');
  const groupByHasLabelsProjection = groupByParsed.some((p) => p.kind === 'projection');
  if (selectHasLabelsProjection !== groupByHasLabelsProjection) {
    return validationError(
      'labels_projection_pairing',
      selectHasLabelsProjection ? 'select' : 'group_by',
      "select['labels[]'] must be paired with group_by:['labels[]'] per PRD §3.4.1"
    );
  }

  // Aggregate / non-aggregate / group_by consistency: every non-aggregate
  // select item must appear in group_by when group_by is non-empty.
  if (isGrouped) {
    const groupKeys = new Set(groupByParsed.map((p) => (p.kind === 'projection' ? LABELS_PROJECTION : p.column)));
    for (let i = 0; i < selectParsed.length; i++) {
      const s = selectParsed[i];
      if (s.kind === 'aggregate') continue;
      const key = s.kind === 'projection' ? LABELS_PROJECTION : s.column;
      if (!groupKeys.has(key)) {
        return validationError('select_not_in_group_by', `select[${i}]`, {
          message: 'non-aggregate select items must appear in group_by',
        });
      }
    }
  }

  // ── where (optional) ────────────────────────────────────────────────
  // v1.3 Block 12.5a: project scope is single-project (param=string) OR
  // cross-project (param=Postgres array literal string '{a,b,c}' cast
  // to uuid[]). postgres-js's sql.unsafe serializes JS arrays as CSV
  // ('a,b,c') by default — not a valid Postgres array literal — so we
  // build the literal manually and cast. Same lesson as
  // conversations.js INSERT (`{${ids.join(',')}}::uuid[]`).
  const params = isCrossProject
    ? ['{' + crossProjectIds.join(',') + '}']
    : [projectId];
  const whereFragments = isCrossProject
    ? [`project_id = ANY($1::uuid[])`]
    : [`project_id = $1`];

  const whereRaw = dsl.where;
  if (whereRaw !== undefined) {
    if (!whereRaw || typeof whereRaw !== 'object' || Array.isArray(whereRaw)) {
      return validationError('where_shape_invalid', 'where');
    }
    if ('project_id' in whereRaw) {
      return validationError('project_id_forbidden', 'where.project_id');
    }
    for (const col of Object.keys(whereRaw)) {
      const result = parseWhereForColumn(col, whereRaw[col], params.length, params);
      if (!result.ok) return validationError(result.code, result.field, result.allowed ?? null);
      whereFragments.push(result.sql);
    }
  }

  // ── order_by (optional) ─────────────────────────────────────────────
  const aliasSet = new Set(selectParsed.map((p) => p.alias));
  const orderByRaw = dsl.order_by;
  const orderByParsed = [];
  if (orderByRaw !== undefined) {
    if (!Array.isArray(orderByRaw)) {
      return validationError('order_by_shape_invalid', 'order_by');
    }
    for (let i = 0; i < orderByRaw.length; i++) {
      const parsed = parseOrderBy(orderByRaw[i], aliasSet, isGrouped);
      if (!parsed) {
        return validationError('order_by_item_invalid', `order_by[${i}]`, {
          message: isGrouped
            ? 'for grouped queries, field must match a select-item alias; dir must be asc|desc'
            : 'field must match a select-item alias or be an allowlisted column; dir must be asc|desc',
          select_aliases: [...aliasSet],
          allowed_columns: isGrouped ? undefined : ALLOWED_COLUMNS,
        });
      }
      orderByParsed.push(parsed);
    }
  }

  // ── limit (optional) ────────────────────────────────────────────────
  const cap = isGrouped ? GROUPED_LIMIT_MAX : UNGROUPED_LIMIT_MAX;
  let limit = DEFAULT_LIMIT;
  if (dsl.limit !== undefined) {
    if (typeof dsl.limit !== 'number' || !Number.isFinite(dsl.limit) || dsl.limit < 1) {
      return validationError('limit_invalid', 'limit');
    }
    limit = Math.floor(dsl.limit);
  }
  const clamped = limit > cap;
  if (clamped) limit = cap;

  // ── Compose SQL ─────────────────────────────────────────────────────
  const selectSqlList = selectParsed.map(selectItemSql);
  selectSqlList.push(`COUNT(*) OVER () AS total_groups`);

  const fromClause = selectHasLabelsProjection
    ? `${VIEW} CROSS JOIN LATERAL jsonb_array_elements_text(${LABELS_COLUMN}) AS ${LABELS_LATERAL_ALIAS}`
    : VIEW;

  let sqlString = `SELECT ${selectSqlList.join(', ')}\n  FROM ${fromClause}\n WHERE ${whereFragments.join(' AND ')}`;

  if (isGrouped) {
    sqlString += `\n GROUP BY ${groupByParsed.map(groupBySql).join(', ')}`;
  }

  if (orderByParsed.length > 0) {
    const orderClauses = orderByParsed.map(({ field, dir }) =>
      `${field} ${dir === 'desc' ? 'DESC NULLS LAST' : 'ASC NULLS LAST'}`
    );
    sqlString += `\n ORDER BY ${orderClauses.join(', ')}`;
  }

  params.push(limit);
  sqlString += `\n LIMIT $${params.length}`;

  return {
    ok: true,
    sql: sqlString,
    params,
    isGrouped,
    limitCap: cap,
    aliases: [...aliasSet],
    clampedLimit: clamped,
  };
}

// ─── Executor — runAggregateJira(sql, projectId, dsl) ────────────────────

export async function runAggregateJira(sql, projectId, dsl, crossProjectIds = null) {
  const compiled = compile(dsl, projectId, crossProjectIds);
  if (!compiled.ok) return compiled;

  const rows = await sql.unsafe(compiled.sql, compiled.params);

  // Shape per PRD §3.5
  const totalGroups = rows.length > 0 ? Number(rows[0].total_groups) || 0 : 0;
  const cleaned = rows.map((row) => {
    const { total_groups, ...rest } = row;
    return rest;
  });

  return {
    ok: true,
    rows: cleaned,
    returned: cleaned.length,
    total_groups: totalGroups,
    truncated: totalGroups > cleaned.length,
  };
}
