// dynamodb-toolbox (v2) emitter — canonical request → a runnable TypeScript
// program using the popular schema-first library (github.com/dynamodb-toolbox).
//
// WHY THIS IS PROGRAM-ONLY (not an Expression Builder target): dynamodb-toolbox
// deliberately ABSTRACTS DynamoDB expressions away — you never write
// `#pk = :pk` / `attribute_exists(...)`; you call `.query({ partition })` and
// pass a condition DSL (`{ attr, contains }`). It is also SCHEMA-FIRST: a query
// needs a `Table` with a declared key schema. So the honest representation is a
// RUNNABLE program (imports + Table setup + `build(QueryCommand)` + send), NOT a
// bare command literal. It lives in the emitter family (beside sdk-v3 etc.) but
// is wired only into the query-builder program dispatch.
//
// VALUES ARE NATIVE (the DocumentClient marshals): S→string, N→number,
// BOOL→boolean, B→Uint8Array, NULL→null, SS/NS/BS→`new Set([...])`.
//
// The emitted `Table` is a STARTER SCAFFOLD. A base-table Query knows its real
// PK/SK from the request key; a Scan or GSI query does not, so it uses
// `config.baseKeySchema` when the caller supplied the table's real schema, and
// falls back to a placeholder base key with a `// TODO` only when it didn't.

import type {OperatorValue} from '../operators';
import type {
  BuilderConfig,
  CanonicalRequest,
  DdbScalarType,
  FilterRow,
  KeyAttr,
  RangeKeyCondition,
  TypedValue
} from '../types';

/** Key attr DynamoDB type (S/N/B) → the Table `type` string dynamodb-toolbox wants. */
function tableKeyType(type: DdbScalarType): string {
  if (type === 'N') return "'number'";
  if (type === 'B') return "'binary'";
  return "'string'";
}

/** JS expression decoding a base64 `B` value to the `Uint8Array` the client wants. */
function jsBinary(base64: string): string {
  return `Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0))`;
}

/**
 * Render a {@link TypedValue} as the NATIVE JS literal dynamodb-toolbox expects
 * (the DocumentClient does the low-level AttributeValue marshalling): a bare
 * number for N, a `Uint8Array` for B, a real `Set` for SS/NS/BS.
 */
export function renderNativeValue(tv: TypedValue): string {
  switch (tv.type) {
    case 'S':
      return JSON.stringify(tv.value);
    case 'N':
      return tv.value; // already a numeric string → bare number literal
    case 'B':
      return jsBinary(tv.value);
    case 'BOOL':
      return tv.value === 'true' ? 'true' : 'false';
    case 'NULL':
      return 'null';
    case 'SS':
      return `new Set([${(tv.values ?? []).map((v) => JSON.stringify(v)).join(', ')}])`;
    case 'NS':
      return `new Set([${(tv.values ?? []).join(', ')}])`;
    case 'BS':
      return `new Set([${(tv.values ?? []).map(jsBinary).join(', ')}])`;
  }
}

/** Build a scalar TypedValue from a tag + raw string (for key/range/filter RHS). */
function scalar(type: DdbScalarType, value: string): TypedValue {
  return {type, value};
}

// ── Condition DSL ────────────────────────────────────────────────────────────

/** lowercase comparison operator → dynamodb-toolbox condition key. */
const COMPARATOR_KEY: Partial<Record<OperatorValue, string>> = {
  '=': 'eq',
  '<>': 'ne',
  '<': 'lt',
  '<=': 'lte',
  '>': 'gt',
  '>=': 'gte'
};

/** size_* operator → the comparator key its number pairs with. */
const SIZE_COMPARATOR: Partial<Record<OperatorValue, string>> = {
  size_eq: 'eq',
  size_ne: 'ne',
  size_lt: 'lt',
  size_le: 'lte',
  size_gt: 'gt',
  size_ge: 'gte'
};

/**
 * Render one filter row as a dynamodb-toolbox condition object. `size_*` targets
 * a path via the `size` key (`{ size: 'attr', gt: 3 }`); `type_ne` has no direct
 * form so it degrades to `{ not: { attr, type } }`.
 */
function renderCondition(f: FilterRow): string {
  const attr = JSON.stringify(f.field);
  const val = () => renderNativeValue(scalar(f.type, f.value));

  if (f.operator === 'exists') return `{ attr: ${attr}, exists: true }`;
  if (f.operator === 'not_exists') return `{ attr: ${attr}, exists: false }`;
  if (f.operator === 'contains') return `{ attr: ${attr}, contains: ${val()} }`;
  if (f.operator === 'not_contains') return `{ not: { attr: ${attr}, contains: ${val()} } }`;
  if (f.operator === 'begins_with') return `{ attr: ${attr}, beginsWith: ${val()} }`;
  if (f.operator === 'between') {
    const lo = renderNativeValue(scalar(f.type, f.value));
    const hi = renderNativeValue(scalar(f.type, f.value2 ?? ''));
    return `{ attr: ${attr}, between: [${lo}, ${hi}] }`;
  }
  if (f.operator === 'in') {
    const members = (f.values ?? []).map((v) => renderNativeValue(scalar(f.type, v)));
    return `{ attr: ${attr}, in: [${members.join(', ')}] }`;
  }
  if (f.operator === 'type_eq') return `{ attr: ${attr}, type: ${JSON.stringify(f.value)} }`;
  if (f.operator === 'type_ne') {
    return `{ not: { attr: ${attr}, type: ${JSON.stringify(f.value)} } }`;
  }
  const sizeKey = SIZE_COMPARATOR[f.operator];
  if (sizeKey) return `{ size: ${attr}, ${sizeKey}: ${f.value} }`;
  const cmp = COMPARATOR_KEY[f.operator];
  if (cmp) return `{ attr: ${attr}, ${cmp}: ${val()} }`;
  // Unreachable for the widget's operator set; fail loud rather than emit wrong code.
  throw new Error(`dynamodb-toolbox: unsupported filter operator "${f.operator}"`);
}

/** Compose the filter option — a single condition, or `{ and: [...] }` for several. */
function renderFilter(filters: FilterRow[]): string {
  const conds = filters.map(renderCondition);
  if (conds.length === 1) return conds[0];
  return `{ and: [${conds.map((c) => `\n      ${c}`).join(',')}\n    ] }`;
}

// ── Table scaffold ───────────────────────────────────────────────────────────

/** A `{ name, type }` key-attr line for a Table partition/sort key. */
function keyLine(field: string, type: DdbScalarType): string {
  return `{ name: ${JSON.stringify(field)}, type: ${tableKeyType(type)} }`;
}

/**
 * Render the `new Table({...})` scaffold. A base-table Query knows its real
 * PK/SK; a Scan or a GSI query does NOT (the request's key belongs to the GSI),
 * so it emits `config.baseKeySchema` when supplied, else a placeholder base PK
 * the developer replaces.
 */
function renderTable(config: BuilderConfig): string {
  const lines: string[] = [`  name: ${JSON.stringify(config.tableName)},`];
  const onBaseTable = config.operation === 'Query' && !config.indexName;

  if (onBaseTable && config.hashKey) {
    lines.push(`  partitionKey: ${keyLine(config.hashKey.field, config.hashKey.type)},`);
    if (config.rangeKey) {
      lines.push(`  sortKey: ${keyLine(config.rangeKey.field, config.rangeKey.type)},`);
    }
  } else if (config.baseKeySchema) {
    // Scan / GSI query: the request key isn't the base key, but the caller knew
    // the table's real schema — emit it instead of the placeholder.
    const {hashKey, rangeKey} = config.baseKeySchema;
    lines.push(`  partitionKey: ${keyLine(hashKey.field, hashKey.type)},`);
    if (rangeKey) {
      lines.push(`  sortKey: ${keyLine(rangeKey.field, rangeKey.type)},`);
    }
  } else {
    lines.push(
      "  // TODO: replace with your table's real key schema (unknown from this query alone)",
      "  partitionKey: { name: 'PK', type: 'string' },"
    );
  }

  if (config.indexName && config.hashKey) {
    const idx = [
      `    ${JSON.stringify(config.indexName)}: {`,
      `      type: 'global',`,
      `      partitionKey: ${keyLine(config.hashKey.field, config.hashKey.type)},`,
      ...(config.rangeKey
        ? [`      sortKey: ${keyLine(config.rangeKey.field, config.rangeKey.type)},`]
        : []),
      '    }'
    ];
    lines.push(`  indexes: {\n${idx.join('\n')}\n  },`);
  }

  return ['const table = new Table({', '  documentClient,', ...lines, '});'].join('\n');
}

// ── Query args + options ─────────────────────────────────────────────────────

/** The `.query({...})` argument for a Query (partition [+ range] [+ index]). */
function renderQueryArg(config: BuilderConfig): string {
  if (!config.hashKey) throw new Error('dynamodb-toolbox: Query requires a partition key');
  const parts = [
    `partition: ${renderNativeValue(scalar(config.hashKey.type, config.hashKey.value))}`
  ];
  if (config.rangeKey) parts.push(`range: ${renderRange(config.rangeKey)}`);
  if (config.indexName) parts.push(`index: ${JSON.stringify(config.indexName)}`);
  return `{ ${parts.join(', ')} }`;
}

/** A sort-key `range` condition: `{ beginsWith: 'x' }` / `{ between: [a, b] }` / … */
function renderRange(range: RangeKeyCondition): string {
  const v = () => renderNativeValue(scalar(range.type, range.value));
  if (range.operator === 'begins_with') return `{ beginsWith: ${v()} }`;
  if (range.operator === 'between') {
    const lo = renderNativeValue(scalar(range.type, range.value));
    const hi = renderNativeValue(scalar(range.type, range.value2 ?? ''));
    return `{ between: [${lo}, ${hi}] }`;
  }
  const cmp = COMPARATOR_KEY[range.operator];
  if (cmp) return `{ ${cmp}: ${v()} }`;
  throw new Error(`dynamodb-toolbox: unsupported range operator "${range.operator}"`);
}

/** Native key map for `exclusiveStartKey` (typed KeyAttr[] → `{ pk: 'x' }`). */
function renderKeyMap(key: KeyAttr[]): string {
  const entries = key.map(
    (k) => `${JSON.stringify(k.field)}: ${renderNativeValue(scalar(k.type, k.value))}`
  );
  return `{ ${entries.join(', ')} }`;
}

/**
 * The `.options({...})` entries. When `paginate`, `exclusiveStartKey` is OWNED
 * by the loop (seeded from the manual resume point there), so it is omitted here
 * — the loop appends its own `exclusiveStartKey` shorthand entry instead.
 */
function optionEntries(config: BuilderConfig, paginate: boolean): string[] {
  const opts: string[] = [];
  if (config.filters && config.filters.length > 0) {
    opts.push(`filter: ${renderFilter(config.filters)}`);
  }
  if (config.limit !== undefined) opts.push(`limit: ${config.limit}`);
  if (config.consistentRead) opts.push('consistent: true');
  // reverse is Query-only; scanIndexForward:false means descending.
  if (config.operation === 'Query' && config.scanIndexForward === false) opts.push('reverse: true');
  if (config.projection && config.projection.length > 0) {
    opts.push(`attributes: [${config.projection.map((a) => JSON.stringify(a)).join(', ')}]`);
  }
  if (!paginate && config.exclusiveStartKey && config.exclusiveStartKey.length > 0) {
    opts.push(`exclusiveStartKey: ${renderKeyMap(config.exclusiveStartKey)}`);
  }
  return opts;
}

/** Wrap `optionEntries` into the `.options({...})` object literal. */
function renderOptions(config: BuilderConfig, paginate: boolean): string {
  const opts = optionEntries(config, paginate);
  return opts.length > 0 ? `{ ${opts.join(', ')} }` : '{}';
}

// ── Program ──────────────────────────────────────────────────────────────────

/**
 * Emit the runnable dynamodb-toolbox program for a Query/Scan canonical request.
 * `paginate` wraps the send in a `LastEvaluatedKey` loop (dynamodb-toolbox's
 * `send()` returns `{ Items, LastEvaluatedKey }` and takes `exclusiveStartKey`).
 */
export function emitDdbToolboxProgram(request: CanonicalRequest, paginate: boolean): string {
  const config = request.config;
  const isQuery = config.operation === 'Query';
  const command = isQuery ? 'QueryCommand' : 'ScanCommand';
  const commandPath = isQuery
    ? "'dynamodb-toolbox/table/actions/query'"
    : "'dynamodb-toolbox/table/actions/scan'";

  const header = [
    `import { DynamoDBClient } from "@aws-sdk/client-dynamodb";`,
    `import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";`,
    `import { Table } from "dynamodb-toolbox/table";`,
    `import { ${command} } from ${commandPath};`,
    '',
    'const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));',
    '',
    renderTable(config),
    ''
  ];

  // The build → (query) → options chain, indented for a `const response = ...`.
  const queryLine = isQuery ? `  .query(${renderQueryArg(config)})\n` : '';

  if (!paginate) {
    return [
      ...header,
      'const response = await table',
      `  .build(${command})`,
      `${queryLine}  .options(${renderOptions(config, false)})`,
      '  .send();',
      '',
      'console.log(response.Items);'
    ].join('\n');
  }

  // The loop owns exclusiveStartKey: seed from the manual resume point (when set)
  // and follow LastEvaluatedKey until exhausted.
  const seed =
    config.exclusiveStartKey && config.exclusiveStartKey.length > 0
      ? ` = ${renderKeyMap(config.exclusiveStartKey)}`
      : '';
  // The loop appends its own `exclusiveStartKey` shorthand to the option entries.
  const loopOptions = `{ ${[...optionEntries(config, true), 'exclusiveStartKey'].join(', ')} }`;
  return [
    ...header,
    'const items = [];',
    `let exclusiveStartKey${seed};`,
    'do {',
    '  const response = await table',
    `    .build(${command})`,
    isQuery ? `    .query(${renderQueryArg(config)})` : null,
    `    .options(${loopOptions})`,
    '    .send();',
    '  items.push(...(response.Items ?? []));',
    '  exclusiveStartKey = response.LastEvaluatedKey;',
    '} while (exclusiveStartKey);',
    '',
    'console.log(items);'
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}
