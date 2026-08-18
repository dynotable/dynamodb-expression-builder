// aws-sdk-kotlin emitter — canonical request → the SDK's DSL-builder call
// (`client.query { … }`). Kotlin's SDK takes every field as a property inside
// the builder lambda, with AttributeValue sealed-class constructors
// (`AttributeValue.S("…")`, `.N`, `.Bool`, `.Ss(listOf(…))`) — so the request
// renders as assignments, maps via `mapOf("k" to v)`. Pure source rendering;
// imports no SDK.
//
// BINARY: `AttributeValue.B` takes a `ByteArray`; the canonical base64 decodes
// at emit time into `byteArrayOf(0x…)` (fail-loud on bad input, mirroring
// go.ts/rust.ts).

import {typedMapToAvMap} from './marshal';
import type {AttributeValue} from './marshal';
import type {CanonicalRequest, DdbOperation, TypedValue} from '../types';

/** Operation → the `DynamoDbClient` suspend function. */
const CLIENT_METHOD_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'getItem',
  Query: 'query',
  Scan: 'scan',
  Update: 'updateItem',
  Put: 'putItem',
  Delete: 'deleteItem'
};

/** The client method name (camelCase) for an operation. */
export function kotlinClientMethodName(operation: DdbOperation): string {
  return CLIENT_METHOD_BY_OP[operation];
}

/** Kotlin string literal — JSON escapes are valid Kotlin escapes, plus `$` must
 *  be escaped (string templates). */
function ktString(value: string): string {
  return JSON.stringify(value).replace(/\$/g, '\\$');
}

/** Decode canonical base64 into a `byteArrayOf(0x…)` literal (fail-loud). */
function ktBytes(base64: string): string {
  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new Error(`invalid base64 in a binary (B/BS) value: ${base64}`);
  }
  const bytes = Array.from(raw, (c) => `0x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return `byteArrayOf(${bytes.join(', ')})`;
}

/** Render one wire AttributeValue as an `AttributeValue.…` constructor. */
export function renderKotlinAv(av: AttributeValue): string {
  if ('S' in av) return `AttributeValue.S(${ktString(av.S)})`;
  if ('N' in av) return `AttributeValue.N(${ktString(av.N)})`;
  if ('B' in av) return `AttributeValue.B(${ktBytes(av.B)})`;
  if ('BOOL' in av) return `AttributeValue.Bool(${av.BOOL})`;
  if ('SS' in av) return `AttributeValue.Ss(listOf(${av.SS.map(ktString).join(', ')}))`;
  if ('NS' in av) return `AttributeValue.Ns(listOf(${av.NS.map(ktString).join(', ')}))`;
  if ('BS' in av) return `AttributeValue.Bs(listOf(${av.BS.map(ktBytes).join(', ')}))`;
  return 'AttributeValue.Null(true)';
}

/** Render a typed map as `mapOf("k" to AttributeValue.…)`, one entry per line. */
function renderAvMap(map: Record<string, TypedValue>, indent: string): string {
  const inner = `${indent}    `;
  const entries = Object.entries(typedMapToAvMap(map)).map(
    ([name, av]) => `${inner}${ktString(name)} to ${renderKotlinAv(av)},`
  );
  return `mapOf(\n${entries.join('\n')}\n${indent})`;
}

/** Render the plain string map (`expressionAttributeNames`). */
function renderNameMap(map: Record<string, string>, indent: string): string {
  const inner = `${indent}    `;
  const entries = Object.entries(map).map(
    ([alias, name]) => `${inner}${ktString(alias)} to ${ktString(name)},`
  );
  return `mapOf(\n${entries.join('\n')}\n${indent})`;
}

/**
 * Render the builder-lambda body — one property assignment per line at
 * `indent`. Exported for the program emitter, which wraps the same body in
 * either the plain suspend call or the `Paginated` flow variant.
 */
export function renderKotlinBuilder(request: CanonicalRequest, indent: string): string[] {
  const lines: string[] = [`${indent}tableName = ${ktString(request.tableName)}`];
  if (request.indexName) lines.push(`${indent}indexName = ${ktString(request.indexName)}`);
  if (request.key) lines.push(`${indent}key = ${renderAvMap(request.key, indent)}`);
  if (request.item) lines.push(`${indent}item = ${renderAvMap(request.item, indent)}`);
  if (request.keyConditionExpression)
    lines.push(`${indent}keyConditionExpression = ${ktString(request.keyConditionExpression)}`);
  if (request.updateExpression)
    lines.push(`${indent}updateExpression = ${ktString(request.updateExpression)}`);
  if (request.conditionExpression)
    lines.push(`${indent}conditionExpression = ${ktString(request.conditionExpression)}`);
  if (request.filterExpression)
    lines.push(`${indent}filterExpression = ${ktString(request.filterExpression)}`);
  if (request.projectionExpression)
    lines.push(`${indent}projectionExpression = ${ktString(request.projectionExpression)}`);
  if (request.names) lines.push(`${indent}expressionAttributeNames = ${renderNameMap(request.names, indent)}`);
  if (request.typedValues)
    lines.push(`${indent}expressionAttributeValues = ${renderAvMap(request.typedValues, indent)}`);
  if (request.limit !== undefined) lines.push(`${indent}limit = ${request.limit}`);
  if (request.consistentRead) lines.push(`${indent}consistentRead = true`);
  if (request.scanIndexForward === false) lines.push(`${indent}scanIndexForward = false`);
  if (request.exclusiveStartKey)
    lines.push(`${indent}exclusiveStartKey = ${renderAvMap(request.exclusiveStartKey, indent)}`);
  return lines;
}

/** Emit the bare `val response = client.…{ … }` call for a canonical request. */
export function emitKotlin(request: CanonicalRequest): string {
  return [
    `val response = client.${CLIENT_METHOD_BY_OP[request.operation]} {`,
    ...renderKotlinBuilder(request, '    '),
    '}'
  ].join('\n');
}
