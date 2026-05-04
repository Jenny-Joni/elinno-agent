// functions/_lib/connectors/registry.js
// =========================================================================
// Connector registry (Block 3, decision K).
//
// Static `source → implementation` map. Block 3 only ships the dummy
// connector; Slack/Jira/Monday/Drive land in their own blocks. NO
// pre-stubs — empty entries invite drift, and the schema CHECK
// constraint already lists them so adding implementations later is
// non-breaking.
//
// `source` strings here MUST match the values in the connections table's
// CHECK constraint (db/schema-postgres.sql). Adding a new connector
// type requires both: (a) implementation here, (b) corresponding
// CHECK value in the schema. The schema already lists all five v1.1
// types, so Block 4+ only needs to register the implementation.
// =========================================================================

import { dummy } from './dummy.js';
import { slack } from './slack.js';

/**
 * Static map of registered connectors, keyed by their `source` value.
 *
 * @type {Record<string, import('./types.js').Connector>}
 */
const connectors = {
  dummy,
  slack,
};

/**
 * Look up a connector by its source identifier.
 *
 * Throws on unknown source — callers should validate the source value
 * before calling getConnector (e.g., the connections POST handler
 * rejects unknown sources with a 400 before reaching this lookup),
 * but the throw is the safety net.
 *
 * @param {string} source - One of the schema CHECK values
 * @returns {import('./types.js').Connector}
 * @throws {Error} If the source is not registered
 */
export function getConnector(source) {
  const conn = connectors[source];
  if (!conn) {
    throw new Error(`Unknown connector source: ${source}`);
  }
  return conn;
}

/**
 * List the metadata for every registered connector. Used by future
 * Connections UI (Block 4+) to render the "Connect a tool" picker.
 *
 * getMetadata() takes no arguments — connector metadata is a static
 * constant per connector. (Decision H originally required ctx-first
 * here too; reversed in the Block 3 commit-3 review per YAGNI — see
 * the corresponding note in types.js.) If a future connector needs
 * context-dependent metadata, widen the typedef and update this
 * call site at that point.
 *
 * @returns {Array<import('./types.js').ConnectorMetadata>}
 */
export function listConnectors() {
  return Object.values(connectors).map((c) => c.getMetadata());
}

/**
 * Whether a source is registered. Cheaper than try/catch on getConnector
 * when the caller just wants a boolean (e.g., POST validation).
 *
 * @param {string} source
 * @returns {boolean}
 */
export function isKnownSource(source) {
  return Object.prototype.hasOwnProperty.call(connectors, source);
}
