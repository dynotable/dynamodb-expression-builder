// AWS SDK v3 emitter — canonical request → a `new <Op>Command({...})` snippet
// for `@aws-sdk/client-dynamodb` (the low-level client; NOT lib-dynamodb's
// DocumentClient, which isn't a dep). The low-level command takes AttributeValue
// maps, so `Key`/`Item`/`ExpressionAttributeValues` are tag-driven AVs.
//
// The params object is rendered as a JS object literal (a near-superset of JSON),
// so the emitted snippet is always parseable JS (the test evals it, which catches
// an unescaped quote in a user value). We render it ourselves rather than via
// `JSON.stringify` because `B`/`BS` members must be a `Uint8Array` (the low-level
// `AttributeValue.B` type), NOT the base64 string the wire/CLI form uses — a
// base64 *string* there is double-encoded and stores the wrong bytes. Strings
// still go through `JSON.stringify` for escaping. This emitter is pure and imports
// no SDK; it only renders source text.

import {typedMapToAvMap} from './marshal';
import type {CanonicalRequest, DdbOperation} from '../types';

/** Operation → the `@aws-sdk/client-dynamodb` command class name. */
const COMMAND_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'GetItemCommand',
  Query: 'QueryCommand',
  Scan: 'ScanCommand',
  Update: 'UpdateItemCommand',
  Put: 'PutItemCommand',
  Delete: 'DeleteItemCommand'
};

/** Build the command params object (key order matches typical SDK usage). */
export function buildSdkV3Params(request: CanonicalRequest): Record<string, unknown> {
  const p: Record<string, unknown> = {TableName: request.tableName};
  if (request.indexName) p.IndexName = request.indexName;
  if (request.key) p.Key = typedMapToAvMap(request.key);
  if (request.item) p.Item = typedMapToAvMap(request.item);
  if (request.keyConditionExpression) p.KeyConditionExpression = request.keyConditionExpression;
  if (request.updateExpression) p.UpdateExpression = request.updateExpression;
  if (request.conditionExpression) p.ConditionExpression = request.conditionExpression;
  if (request.filterExpression) p.FilterExpression = request.filterExpression;
  if (request.projectionExpression) p.ProjectionExpression = request.projectionExpression;
  if (request.names) p.ExpressionAttributeNames = request.names;
  if (request.typedValues) p.ExpressionAttributeValues = typedMapToAvMap(request.typedValues);
  // Request-level read options (Query/Scan/GetItem) — additive: absent on every
  // config that predates them, so existing snippets are byte-identical.
  if (request.limit !== undefined) p.Limit = request.limit;
  if (request.consistentRead) p.ConsistentRead = true;
  if (request.scanIndexForward === false) p.ScanIndexForward = false;
  if (request.exclusiveStartKey) p.ExclusiveStartKey = typedMapToAvMap(request.exclusiveStartKey);
  return p;
}

/** JS expression decoding a base64 `B` member to the `Uint8Array` the client needs. */
function jsBinary(base64: string): string {
  return `Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0))`;
}

/**
 * Render a value as a pretty-printed (2-space) JS object literal, mirroring
 * `JSON.stringify(v, null, 2)` except that a `B`/`BS` AttributeValue member is
 * emitted as a `Uint8Array` expression rather than a base64 string.
 */
function jsLiteral(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => inner + jsLiteral(v, indent + 1));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([k, v]) => {
      const key = JSON.stringify(k);
      if (k === 'B' && typeof v === 'string') return `${inner}${key}: ${jsBinary(v)}`;
      if (k === 'BS' && Array.isArray(v)) return `${inner}${key}: [${v.map(jsBinary).join(', ')}]`;
      return `${inner}${key}: ${jsLiteral(v, indent + 1)}`;
    });
    return `{\n${lines.join(',\n')}\n${pad}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value); // boolean / number
}

/** Emit the `new <Op>Command({...})` source snippet for a canonical request. */
export function emitSdkV3(request: CanonicalRequest): string {
  const command = COMMAND_BY_OP[request.operation];
  const params = jsLiteral(buildSdkV3Params(request), 0);
  return `new ${command}(${params})`;
}

/** The `@aws-sdk/client-dynamodb` command class name for an operation. */
export function sdkV3CommandName(operation: DdbOperation): string {
  return COMMAND_BY_OP[operation];
}

/**
 * Render an arbitrary params value as the same pretty-printed JS literal
 * `emitSdkV3` embeds (B/BS members as `Uint8Array` expressions). Exported for
 * the query-builder program emitter, which composes its own statements around
 * the literal (client init + pagination loop) instead of a bare `new Command`.
 */
export function renderJsValue(value: unknown, indent = 0): string {
  return jsLiteral(value, indent);
}
