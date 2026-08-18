// aws-sdk-ruby (v3) emitter — canonical request → a `client.<op>(…)` call for
// `Aws::DynamoDB::Client`. The Ruby SDK accepts PLAIN Ruby values ("simple
// attributes") and marshals them itself, so — like the DocumentClient — the
// value side renders natively: strings, bare numbers, `Set.new`, booleans,
// `nil`. The expression strings and alias maps stay identical to the wire.
//
// BINARY: the Ruby client sends binary as a string of bytes; the canonical
// base64 renders as `Base64.decode64('…')` (requires `base64`, stdlib) so the
// emitted code runs and the payload stays reviewable.
//
// Number caveat (same statement as the DocumentClient emitter): an N renders
// as a bare numeric literal; a value past Float precision belongs on a
// BigDecimal the user constructs deliberately.

import type {CanonicalRequest, DdbOperation, TypedValue} from '../types';

/** Operation → the `Aws::DynamoDB::Client` method (snake_case). */
const CLIENT_METHOD_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'get_item',
  Query: 'query',
  Scan: 'scan',
  Update: 'update_item',
  Put: 'put_item',
  Delete: 'delete_item'
};

/** The client method name (snake_case) for an operation. */
export function rubyClientMethodName(operation: DdbOperation): string {
  return CLIENT_METHOD_BY_OP[operation];
}

/** Ruby single-quoted string — only `\` and `'` need escaping. */
function rubyString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Render one typed value as the native Ruby literal the SDK marshals. */
export function renderRubyValue(tv: TypedValue): string {
  switch (tv.type) {
    case 'S':
      return rubyString(tv.value);
    case 'N':
      return tv.value; // numeric string → bare literal
    case 'B':
      return `Base64.decode64(${rubyString(tv.value)})`;
    case 'BOOL':
      return tv.value === 'true' ? 'true' : 'false';
    case 'NULL':
      return 'nil';
    case 'SS':
      return `Set.new([${(tv.values ?? []).map(rubyString).join(', ')}])`;
    case 'NS':
      return `Set.new([${(tv.values ?? []).join(', ')}])`;
    case 'BS':
      return `Set.new([${(tv.values ?? []).map((b) => `Base64.decode64(${rubyString(b)})`).join(', ')}])`;
  }
}

/** Render a typed map as a Ruby hash of native values, one entry per line. */
function renderValueMap(map: Record<string, TypedValue>, indent: string): string {
  const inner = `${indent}  `;
  const entries = Object.entries(map).map(
    ([name, tv]) => `${inner}${rubyString(name)} => ${renderRubyValue(tv)},`
  );
  return `{\n${entries.join('\n')}\n${indent}}`;
}

/** Render the plain string map (`expression_attribute_names`). */
function renderNameMap(map: Record<string, string>, indent: string): string {
  const inner = `${indent}  `;
  const entries = Object.entries(map).map(
    ([alias, name]) => `${inner}${rubyString(alias)} => ${rubyString(name)},`
  );
  return `{\n${entries.join('\n')}\n${indent}}`;
}

/**
 * Render the request keyword-argument hash, one field per line at `indent + 2`.
 * Exported for the program emitter.
 */
export function renderRubyParams(request: CanonicalRequest, indent: string): string {
  const pad = `${indent}  `;
  const fields: string[] = [`table_name: ${rubyString(request.tableName)},`];
  if (request.indexName) fields.push(`index_name: ${rubyString(request.indexName)},`);
  if (request.key) fields.push(`key: ${renderValueMap(request.key, pad)},`);
  if (request.item) fields.push(`item: ${renderValueMap(request.item, pad)},`);
  if (request.keyConditionExpression)
    fields.push(`key_condition_expression: ${rubyString(request.keyConditionExpression)},`);
  if (request.updateExpression)
    fields.push(`update_expression: ${rubyString(request.updateExpression)},`);
  if (request.conditionExpression)
    fields.push(`condition_expression: ${rubyString(request.conditionExpression)},`);
  if (request.filterExpression)
    fields.push(`filter_expression: ${rubyString(request.filterExpression)},`);
  if (request.projectionExpression)
    fields.push(`projection_expression: ${rubyString(request.projectionExpression)},`);
  if (request.names)
    fields.push(`expression_attribute_names: ${renderNameMap(request.names, pad)},`);
  if (request.typedValues)
    fields.push(`expression_attribute_values: ${renderValueMap(request.typedValues, pad)},`);
  if (request.limit !== undefined) fields.push(`limit: ${request.limit},`);
  if (request.consistentRead) fields.push('consistent_read: true,');
  if (request.scanIndexForward === false) fields.push('scan_index_forward: false,');
  if (request.exclusiveStartKey)
    fields.push(`exclusive_start_key: ${renderValueMap(request.exclusiveStartKey, pad)},`);
  const lines = fields.map((f) => `${pad}${f}`);
  return ['{', ...lines, `${indent}}`].join('\n');
}

/** Emit the bare `response = client.…(…)` call for a canonical request. */
export function emitRuby(request: CanonicalRequest): string {
  return `response = client.${CLIENT_METHOD_BY_OP[request.operation]}(${renderRubyParams(request, '')})`;
}
