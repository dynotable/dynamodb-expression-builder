// PartiQL emitter — canonical request → a DynamoDB PartiQL statement, built from
// the RAW config (`request.config`) because PartiQL uses inline typed LITERALS,
// not the `#`/`:` placeholders the SDK/CLI/boto3 emitters share.
//
// HONEST DEGRADATION: PartiQL can't express several DynamoDB features, so the
// emitter returns a discriminated `{ ok: false, reason }` rather than emitting a
// silently-wrong statement. Non-expressible cases (per the plan): a conditional
// `Put` (no condition-less `INSERT` exists for it), `ADD`, set `DELETE`,
// `if_not_exists`, `list_append`, atomic-counter arithmetic (`SET x = x ± n` —
// PartiQL SET takes only LIST_APPEND/SET_ADD/SET_DELETE), and `size()`
// comparisons. Binary/set values have no PartiQL literal form either, so they
// degrade the same way.
//
// Literals are built from the type tag (N unquoted, S single-quoted with inner
// `'` doubled, BOOL `true`/`false`, NULL). Identifiers (table / index / attribute
// names) are double-quoted and reserved-word-safe.

import {OPERATOR_BY_VALUE} from '../operators';
import {elementType, makeTypedValue} from '../types';
import type {
  BuilderConfig,
  CanonicalRequest,
  FilterRow,
  KeyAttr,
  TypedValue,
  UpdateAction
} from '../types';

/** Either a finished statement or an honest reason PartiQL can't express it. */
export type PartiqlResult = {ok: true; statement: string} | {ok: false; reason: string};

/** Thrown internally to short-circuit out of a partly-built statement. */
class NotExpressibleError extends Error {}

/** Bail out: this request has no faithful PartiQL form. */
function notExpressible(reason: string): never {
  throw new NotExpressibleError(reason);
}

/** Double-quote an identifier (reserved-word-safe), doubling any inner `"`. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Single-quote a string literal, doubling any inner `'` (PartiQL escaping). */
function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// `N` is the only type emitted as a BARE literal (the others are quoted), so a
// non-numeric N would inline verbatim into the statement — silently altering it
// rather than just being a bad bound. Mirror dynamodb-json's NUMERIC check and
// degrade honestly instead. (The SDK/CLI/boto3 emitters wrap N in a quoted
// `{"N":"…"}` placeholder, so they don't share this hazard.)
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** A typed value as a PartiQL literal — built from the tag, never the runtime. */
function literal(tv: TypedValue): string {
  switch (tv.type) {
    case 'S':
      return quoteString(tv.value);
    case 'N':
      if (!NUMERIC.test(tv.value.trim()))
        return notExpressible(`non-numeric N value "${tv.value}" has no PartiQL literal form`);
      return tv.value;
    case 'BOOL':
      return tv.value === 'true' ? 'true' : 'false';
    case 'NULL':
      return 'NULL';
    case 'B':
      return notExpressible(
        'binary (B) values have no PartiQL literal form — use the SDK/CLI emitter'
      );
    case 'SS':
    case 'NS':
    case 'BS':
      return notExpressible(
        'set-typed values have no PartiQL literal form — use the SDK/CLI emitter'
      );
  }
}

/** `"Table"` or `"Table"."Index"`. */
function fromClause(config: BuilderConfig): string {
  const table = quoteIdent(config.tableName);
  return config.indexName ? `${table}.${quoteIdent(config.indexName)}` : table;
}

/** Projected attributes → `"a", "b"`, or `*` when no projection is set. */
function selectList(config: BuilderConfig): string {
  const proj = config.projection;
  if (proj && proj.length > 0) return proj.map(quoteIdent).join(', ');
  return '*';
}

/** A FilterRow's single RHS value as a typed value (set-/scalar-aware). */
function single(row: FilterRow): TypedValue {
  return makeTypedValue(row.type, row.value, row.values);
}

/**
 * Compile one predicate row (filter, condition, or — structurally compatible —
 * a range-key condition) into a PartiQL boolean expression. Operators PartiQL
 * can't express (`size_*`, `type_*`) degrade the whole statement.
 */
function predicate(row: FilterRow): string {
  const id = quoteIdent(row.field);
  const wire = OPERATOR_BY_VALUE[row.operator].wireForm;
  switch (wire) {
    case 'EQ':
      return `${id} = ${literal(single(row))}`;
    case 'NE':
      return `${id} <> ${literal(single(row))}`;
    case 'LT':
      return `${id} < ${literal(single(row))}`;
    case 'LE':
      return `${id} <= ${literal(single(row))}`;
    case 'GT':
      return `${id} > ${literal(single(row))}`;
    case 'GE':
      return `${id} >= ${literal(single(row))}`;
    case 'BETWEEN':
      return `${id} BETWEEN ${literal(makeTypedValue(row.type, row.value))} AND ${literal(makeTypedValue(row.type, row.value2 ?? ''))}`;
    case 'BEGINS_WITH':
      return `begins_with(${id}, ${literal(single(row))})`;
    case 'CONTAINS':
      // Scalar operand even on a set attribute — marshal the element type so a
      // set tag yields a quotable scalar literal, not an inexpressible set.
      return `contains(${id}, ${literal(makeTypedValue(elementType(row.type), row.value))})`;
    case 'IN': {
      // An empty member list is rejected upstream in buildRequest
      // (filter-expressions throws) before PartiQL ever runs, so `members` is
      // always non-empty here.
      const members = row.values ?? (row.value ? [row.value] : []);
      const lits = members.map((m) => literal(makeTypedValue(row.type, m)));
      return `${id} IN (${lits.join(', ')})`;
    }
    case 'EXISTS':
      return `${id} IS NOT MISSING`;
    case 'NOT_EXISTS':
      return `${id} IS MISSING`;
    case 'SIZE_EQ':
    case 'SIZE_NE':
    case 'SIZE_LT':
    case 'SIZE_LE':
    case 'SIZE_GT':
    case 'SIZE_GE':
      return notExpressible('size() comparisons are not expressible in PartiQL');
    case 'TYPE_EQ':
    case 'TYPE_NE':
      return notExpressible('attribute_type() checks are not expressible in PartiQL');
  }
}

/** Equality predicates for an exact primary key (GetItem/Update/Delete). */
function keyPredicates(keys: KeyAttr[]): string[] {
  return keys.map((k) => `${quoteIdent(k.field)} = ${literal(makeTypedValue(k.type, k.value))}`);
}

/** One SET action → a PartiQL `SET` body, degrading on the inexpressible idioms. */
function setClause(action: UpdateAction): string {
  const id = quoteIdent(action.field);
  const value = action.value;
  if (!value) {
    throw new Error(`SET on "${action.field}" requires a value`);
  }
  switch (action.setOp ?? 'assign') {
    case 'assign':
      return `${id} = ${literal(value)}`;
    case 'add': // atomic counter — PartiQL SET supports only
    case 'subtract': // LIST_APPEND/SET_ADD/SET_DELETE, never `x = x ± n` arithmetic
      return notExpressible(
        'atomic counters (SET x = x ± n) are not expressible in PartiQL — use the SDK/CLI emitter'
      );
    case 'if_not_exists':
      return notExpressible('if_not_exists() is not expressible in PartiQL');
    case 'list_append':
    case 'list_prepend':
      return notExpressible('list_append() is not expressible in PartiQL');
  }
}

function buildSelect(config: BuilderConfig): string {
  // Request-level read options are ExecuteStatement API PARAMETERS, not part of
  // the PartiQL statement text this emitter produces — degrade honestly rather
  // than silently dropping them (Limit/ConsistentRead), and pagination uses the
  // opaque NextToken, which a typed ExclusiveStartKey map can't become.
  if (config.limit !== undefined) {
    notExpressible(
      'Limit is an ExecuteStatement API parameter, not part of the PartiQL statement — use the SDK/CLI emitter'
    );
  }
  if (config.consistentRead) {
    notExpressible(
      'ConsistentRead is an ExecuteStatement API parameter, not part of the PartiQL statement — use the SDK/CLI emitter'
    );
  }
  if (config.exclusiveStartKey && config.exclusiveStartKey.length > 0) {
    notExpressible(
      'PartiQL paginates with an opaque NextToken, not ExclusiveStartKey — use the SDK/CLI emitter'
    );
  }
  const head = `SELECT ${selectList(config)}\nFROM ${fromClause(config)}`;

  if (config.operation === 'GetItem') {
    // A key-less GetItem would emit `SELECT * FROM "T"` — a full scan
    // masquerading as a point read. Degrade honestly (mirror buildUpdate/Delete).
    if (!config.key || config.key.length === 0) {
      notExpressible('GetItem requires the full primary key in WHERE');
    }
    return `${head}\nWHERE ${keyPredicates(config.key).join('\n  AND ')}`;
  }

  if (config.operation === 'Query') {
    if (!config.hashKey) notExpressible('Query requires a hash key');
    const preds: string[] = [
      predicate({
        field: config.hashKey.field,
        operator: '=',
        type: config.hashKey.type,
        value: config.hashKey.value
      })
    ];
    // A range-key condition is structurally a FilterRow.
    if (config.rangeKey) preds.push(predicate(config.rangeKey));
    // Non-key filters land in WHERE too — never silently dropped.
    for (const filter of config.filters ?? []) preds.push(predicate(filter));
    const select = `${head}\nWHERE ${preds.join('\n  AND ')}`;
    // Descending order IS expressible — as ORDER BY on the sort key — but only
    // when we know which attribute the sort key is. Without a sort-key
    // condition the emitter can't name it, so it degrades rather than guessing.
    if (config.scanIndexForward === false) {
      if (!config.rangeKey) {
        notExpressible(
          'descending order needs ORDER BY on the sort key — add a sort key condition, or use the SDK/CLI emitter'
        );
      }
      return `${select}\nORDER BY ${quoteIdent(config.rangeKey.field)} DESC`;
    }
    return select;
  }

  // Scan
  const preds = (config.filters ?? []).map(predicate);
  return preds.length ? `${head}\nWHERE ${preds.join('\n  AND ')}` : head;
}

function buildUpdate(config: BuilderConfig): string {
  if (!config.key || config.key.length === 0) {
    notExpressible('UPDATE requires the full primary key in WHERE');
  }
  const parts = [`UPDATE ${fromClause(config)}`];
  for (const action of config.updates ?? []) {
    switch (action.kind) {
      case 'SET':
        parts.push(`SET ${setClause(action)}`);
        break;
      case 'REMOVE':
        parts.push(
          `REMOVE ${
            action.index === undefined
              ? quoteIdent(action.field)
              : `${quoteIdent(action.field)}[${action.index}]`
          }`
        );
        break;
      case 'ADD':
      case 'DELETE':
        notExpressible(
          action.kind === 'ADD'
            ? 'ADD is not expressible in PartiQL'
            : 'set DELETE is not expressible in PartiQL'
        );
    }
  }
  const where = [...keyPredicates(config.key), ...(config.conditions ?? []).map(predicate)];
  parts.push(`WHERE ${where.join('\n  AND ')}`);
  return parts.join('\n');
}

function buildInsert(config: BuilderConfig): string {
  if (config.conditions && config.conditions.length > 0) {
    notExpressible(
      'a conditional Put has no condition-less PartiQL INSERT — use the SDK/CLI emitter'
    );
  }
  const entries = (config.item ?? []).map(
    (attr) =>
      `${quoteString(attr.field)}: ${literal(makeTypedValue(attr.type, attr.value, attr.values))}`
  );
  return `INSERT INTO ${fromClause(config)} VALUE {${entries.join(', ')}}`;
}

function buildDelete(config: BuilderConfig): string {
  // PartiQL DELETE needs the full primary key in WHERE (mirror buildUpdate) — a
  // condition-only WHERE would emit a key-less DELETE that DynamoDB rejects.
  if (!config.key || config.key.length === 0) {
    notExpressible('DELETE requires the full primary key in WHERE');
  }
  const where = [...keyPredicates(config.key), ...(config.conditions ?? []).map(predicate)];
  return `DELETE FROM ${fromClause(config)}\nWHERE ${where.join('\n  AND ')}`;
}

function buildStatement(config: BuilderConfig): string {
  switch (config.operation) {
    case 'GetItem':
    case 'Query':
    case 'Scan':
      return buildSelect(config);
    case 'Update':
      return buildUpdate(config);
    case 'Put':
      return buildInsert(config);
    case 'Delete':
      return buildDelete(config);
  }
}

/**
 * Emit a PartiQL statement for a canonical request, or an honest
 * `{ ok: false, reason }` when the request has no faithful PartiQL form.
 */
export function emitPartiql(request: CanonicalRequest): PartiqlResult {
  try {
    return {ok: true, statement: buildStatement(request.config)};
  } catch (error) {
    if (error instanceof NotExpressibleError) {
      return {ok: false, reason: error.message};
    }
    throw error;
  }
}
