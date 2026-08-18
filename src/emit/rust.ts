// aws-sdk-rust emitter — canonical request → a fluent `client.<op>()…` builder
// chain for the `aws-sdk-dynamodb` crate. Rust's SDK has no struct-literal
// input shape at all: every field is a builder method, and the map-valued
// fields (Key / Item / ExpressionAttribute*) take ONE ENTRY PER CALL — so the
// request renders line-by-line by construction (the cli.ts model, taken
// further than Java/Go/.NET need to). Pure source rendering; imports no SDK.
//
// BINARY: `AttributeValue::B` wraps a `Blob`, built here from an explicit
// `vec![0x…]` literal decoded at emit time — deterministic, runnable, no
// error-handling noise; invalid base64 fails loud (mirroring go.ts).
//
// STRINGS: JSON escapes are ALMOST valid Rust escapes — `\b` and `\f` do not
// exist in Rust, and JSON's `\uXXXX` must become Rust's `\u{XXXX}` — so
// `rustString` post-processes `JSON.stringify` instead of trusting it (the
// difference from go.ts, where the JSON escape set is a subset).

import {typedMapToAvMap} from './marshal';
import type {AttributeValue} from './marshal';
import type {CanonicalRequest, DdbOperation, TypedValue} from '../types';

/** Operation → the `aws_sdk_dynamodb::Client` fluent method. */
const CLIENT_METHOD_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'get_item',
  Query: 'query',
  Scan: 'scan',
  Update: 'update_item',
  Put: 'put_item',
  Delete: 'delete_item'
};

/** The `Client` method name (snake_case) for an operation. */
export function rustClientMethodName(operation: DdbOperation): string {
  return CLIENT_METHOD_BY_OP[operation];
}

/** Rust string literal — JSON escapes with the three Rust-incompatible ones fixed. */
function rustString(value: string): string {
  return JSON.stringify(value)
    .replace(/\\b/g, '\\u{0008}')
    .replace(/\\f/g, '\\u{000c}')
    .replace(/\\u([0-9a-fA-F]{4})/g, '\\u{$1}');
}

/** `"…".to_string()` — the owned String the AttributeValue constructors take. */
function rustOwned(value: string): string {
  return `${rustString(value)}.to_string()`;
}

/** Decode canonical base64 into a `Blob::new(vec![0x…])` (fail-loud on bad input). */
function rustBlob(base64: string): string {
  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new Error(`invalid base64 in a binary (B/BS) value: ${base64}`);
  }
  const bytes = Array.from(raw, (c) => `0x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return `Blob::new(vec![${bytes.join(', ')}])`;
}

/** Render one wire AttributeValue as an `AttributeValue::…` constructor. */
export function renderRustAv(av: AttributeValue): string {
  if ('S' in av) return `AttributeValue::S(${rustOwned(av.S)})`;
  if ('N' in av) return `AttributeValue::N(${rustOwned(av.N)})`;
  if ('B' in av) return `AttributeValue::B(${rustBlob(av.B)})`;
  if ('BOOL' in av) return `AttributeValue::Bool(${av.BOOL})`;
  if ('SS' in av) return `AttributeValue::Ss(vec![${av.SS.map(rustOwned).join(', ')}])`;
  if ('NS' in av) return `AttributeValue::Ns(vec![${av.NS.map(rustOwned).join(', ')}])`;
  if ('BS' in av) return `AttributeValue::Bs(vec![${av.BS.map(rustBlob).join(', ')}])`;
  return 'AttributeValue::Null(true)';
}

/** One `.method(key, av)` line per entry of a typed map. */
function avEntryLines(method: string, map: Record<string, TypedValue>, indent: string): string[] {
  return Object.entries(typedMapToAvMap(map)).map(
    ([name, av]) => `${indent}.${method}(${rustString(name)}, ${renderRustAv(av)})`
  );
}

/**
 * Render the fluent builder chain for a request — every line at `indent`,
 * starting with `.{op}()` and ending BEFORE `.send()` so callers own the
 * terminal (the bare emitter awaits inline; the program emitter may hand the
 * chain to `into_paginator()` instead). Exported for the program emitter.
 */
export function renderRustBuilder(request: CanonicalRequest, indent: string): string[] {
  const lines: string[] = [`${indent}.${CLIENT_METHOD_BY_OP[request.operation]}()`];
  lines.push(`${indent}.table_name(${rustString(request.tableName)})`);
  if (request.indexName) lines.push(`${indent}.index_name(${rustString(request.indexName)})`);
  if (request.key) lines.push(...avEntryLines('key', request.key, indent));
  if (request.item) lines.push(...avEntryLines('item', request.item, indent));
  if (request.keyConditionExpression)
    lines.push(`${indent}.key_condition_expression(${rustString(request.keyConditionExpression)})`);
  if (request.updateExpression)
    lines.push(`${indent}.update_expression(${rustString(request.updateExpression)})`);
  if (request.conditionExpression)
    lines.push(`${indent}.condition_expression(${rustString(request.conditionExpression)})`);
  if (request.filterExpression)
    lines.push(`${indent}.filter_expression(${rustString(request.filterExpression)})`);
  if (request.projectionExpression)
    lines.push(`${indent}.projection_expression(${rustString(request.projectionExpression)})`);
  if (request.names) {
    lines.push(
      ...Object.entries(request.names).map(
        ([alias, name]) =>
          `${indent}.expression_attribute_names(${rustString(alias)}, ${rustString(name)})`
      )
    );
  }
  if (request.typedValues)
    lines.push(...avEntryLines('expression_attribute_values', request.typedValues, indent));
  if (request.limit !== undefined) lines.push(`${indent}.limit(${request.limit})`);
  if (request.consistentRead) lines.push(`${indent}.consistent_read(true)`);
  if (request.scanIndexForward === false) lines.push(`${indent}.scan_index_forward(false)`);
  if (request.exclusiveStartKey)
    lines.push(...avEntryLines('exclusive_start_key', request.exclusiveStartKey, indent));
  return lines;
}

/** Does this request build any `AttributeValue`? Drives the program emitter's imports. */
export function rustUsesAttributeValue(request: CanonicalRequest): boolean {
  return (
    request.key !== undefined ||
    request.item !== undefined ||
    request.typedValues !== undefined ||
    request.exclusiveStartKey !== undefined
  );
}

/** Does this request build any binary Blob? Drives the `primitives::Blob` import. */
export function rustUsesBlob(request: CanonicalRequest): boolean {
  const maps = [request.key, request.item, request.typedValues, request.exclusiveStartKey];
  return maps.some(
    (map) => map && Object.values(typedMapToAvMap(map)).some((av) => 'B' in av || 'BS' in av)
  );
}

/** Emit the bare fluent call for a canonical request (awaited, `?`-propagated). */
export function emitRust(request: CanonicalRequest): string {
  return [
    'let response = client',
    ...renderRustBuilder(request, '    '),
    '    .send()',
    '    .await?;'
  ].join('\n');
}
