// aws-sdk-php emitter — canonical request → a `$client-><op>([...])` call for
// the low-level `Aws\DynamoDb\DynamoDbClient`. PHP's associative arrays mirror
// the JSON wire shape one-to-one, so the AttributeValue maps render as nested
// `['S' => '…']` literals directly from the wire AVs — no marshalling layer,
// no Marshaler dependency in the emitted code.
//
// BINARY: the low-level PHP client sends `B` values as raw bytes; the canonical
// base64 renders as `base64_decode('…')` so the emitted code is runnable and
// the payload stays readable in review.

import {typedMapToAvMap} from './marshal';
import type {AttributeValue} from './marshal';
import type {CanonicalRequest, DdbOperation, TypedValue} from '../types';

/** Operation → the `DynamoDbClient` method. */
const CLIENT_METHOD_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'getItem',
  Query: 'query',
  Scan: 'scan',
  Update: 'updateItem',
  Put: 'putItem',
  Delete: 'deleteItem'
};

/** The client method name (camelCase) for an operation. */
export function phpClientMethodName(operation: DdbOperation): string {
  return CLIENT_METHOD_BY_OP[operation];
}

/** PHP single-quoted string — only `\` and `'` need escaping. */
function phpString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Render one wire AttributeValue as a nested `['TAG' => …]` literal. */
export function renderPhpAv(av: AttributeValue): string {
  if ('S' in av) return `['S' => ${phpString(av.S)}]`;
  if ('N' in av) return `['N' => ${phpString(av.N)}]`;
  if ('B' in av) return `['B' => base64_decode(${phpString(av.B)})]`;
  if ('BOOL' in av) return `['BOOL' => ${av.BOOL}]`;
  if ('SS' in av) return `['SS' => [${av.SS.map(phpString).join(', ')}]]`;
  if ('NS' in av) return `['NS' => [${av.NS.map(phpString).join(', ')}]]`;
  if ('BS' in av)
    return `['BS' => [${av.BS.map((b) => `base64_decode(${phpString(b)})`).join(', ')}]]`;
  return "['NULL' => true]";
}

/** Render a typed map as a PHP array of AV literals, one entry per line. */
function renderAvMap(map: Record<string, TypedValue>, indent: string): string {
  const inner = `${indent}    `;
  const entries = Object.entries(typedMapToAvMap(map)).map(
    ([name, av]) => `${inner}${phpString(name)} => ${renderPhpAv(av)},`
  );
  return `[\n${entries.join('\n')}\n${indent}]`;
}

/** Render the plain string map (`ExpressionAttributeNames`). */
function renderNameMap(map: Record<string, string>, indent: string): string {
  const inner = `${indent}    `;
  const entries = Object.entries(map).map(
    ([alias, name]) => `${inner}${phpString(alias)} => ${phpString(name)},`
  );
  return `[\n${entries.join('\n')}\n${indent}]`;
}

/**
 * Render the request array literal, one field per line at `indent + 4`.
 * Exported for the program emitter.
 */
export function renderPhpParams(request: CanonicalRequest, indent: string): string {
  const pad = `${indent}    `;
  const fields: string[] = [`'TableName' => ${phpString(request.tableName)},`];
  if (request.indexName) fields.push(`'IndexName' => ${phpString(request.indexName)},`);
  if (request.key) fields.push(`'Key' => ${renderAvMap(request.key, pad)},`);
  if (request.item) fields.push(`'Item' => ${renderAvMap(request.item, pad)},`);
  if (request.keyConditionExpression)
    fields.push(`'KeyConditionExpression' => ${phpString(request.keyConditionExpression)},`);
  if (request.updateExpression)
    fields.push(`'UpdateExpression' => ${phpString(request.updateExpression)},`);
  if (request.conditionExpression)
    fields.push(`'ConditionExpression' => ${phpString(request.conditionExpression)},`);
  if (request.filterExpression)
    fields.push(`'FilterExpression' => ${phpString(request.filterExpression)},`);
  if (request.projectionExpression)
    fields.push(`'ProjectionExpression' => ${phpString(request.projectionExpression)},`);
  if (request.names)
    fields.push(`'ExpressionAttributeNames' => ${renderNameMap(request.names, pad)},`);
  if (request.typedValues)
    fields.push(`'ExpressionAttributeValues' => ${renderAvMap(request.typedValues, pad)},`);
  if (request.limit !== undefined) fields.push(`'Limit' => ${request.limit},`);
  if (request.consistentRead) fields.push("'ConsistentRead' => true,");
  if (request.scanIndexForward === false) fields.push("'ScanIndexForward' => false,");
  if (request.exclusiveStartKey)
    fields.push(`'ExclusiveStartKey' => ${renderAvMap(request.exclusiveStartKey, pad)},`);
  const lines = fields.map((f) => `${pad}${f}`);
  return ['[', ...lines, `${indent}]`].join('\n');
}

/** Emit the bare `$response = $client->…([…]);` call for a canonical request. */
export function emitPhp(request: CanonicalRequest): string {
  return `$response = $client->${CLIENT_METHOD_BY_OP[request.operation]}(${renderPhpParams(request, '')});`;
}
