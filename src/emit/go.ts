// aws-sdk-go-v2 emitter — canonical request → a `&dynamodb.<Op>Input{…}`
// composite literal for `github.com/aws/aws-sdk-go-v2/service/dynamodb`. Like
// java.ts, Go has no literal mapping 1:1 onto the AV wire shape, so the request
// renders FIELD BY FIELD (the cli.ts model): AttributeValue maps become
// `map[string]types.AttributeValue` of `&types.AttributeValueMember*` values,
// the name map stays `map[string]string`, and pointer scalars go through the
// `aws.String`/`aws.Int32`/`aws.Bool` helpers. Pure source rendering; imports
// no SDK. Go convention: tabs for indentation.
//
// BINARY: `AttributeValueMemberB.Value` is `[]byte`. A bare composite literal
// has nowhere to hoist an error-handled `base64.StdEncoding.DecodeString`, so
// the base64 is decoded AT EMIT TIME into an explicit `[]byte{0x…}` literal —
// deterministic, runnable, no error-handling noise. Invalid base64 fails loud
// here (mirroring buildRequest's posture) instead of emitting broken Go.

import {typedMapToAvMap} from './marshal';
import type {AttributeValue} from './marshal';
import type {CanonicalRequest, DdbOperation, TypedValue} from '../types';

/** Operation → the `dynamodb.<Op>Input` struct name. */
const INPUT_TYPE_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'GetItemInput',
  Query: 'QueryInput',
  Scan: 'ScanInput',
  Update: 'UpdateItemInput',
  Put: 'PutItemInput',
  Delete: 'DeleteItemInput'
};

/** Operation → the `dynamodb.Client` method. */
const CLIENT_METHOD_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'GetItem',
  Query: 'Query',
  Scan: 'Scan',
  Update: 'UpdateItem',
  Put: 'PutItem',
  Delete: 'DeleteItem'
};

/** The `dynamodb.<Op>Input` struct name for an operation. */
export function goInputTypeName(operation: DdbOperation): string {
  return INPUT_TYPE_BY_OP[operation];
}

/** The `dynamodb.Client` method name for an operation. */
export function goClientMethodName(operation: DdbOperation): string {
  return CLIENT_METHOD_BY_OP[operation];
}

/** Go string literal — `JSON.stringify` escapes are all valid Go escapes. */
function goString(value: string): string {
  return JSON.stringify(value);
}

/** Decode canonical base64 into a Go `[]byte{0x…}` literal (fail-loud on bad input). */
function goBytes(base64: string): string {
  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new Error(`invalid base64 in a binary (B/BS) value: ${base64}`);
  }
  const bytes = Array.from(raw, (c) => `0x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return `[]byte{${bytes.join(', ')}}`;
}

/** Render one wire AttributeValue as a `&types.AttributeValueMember*` literal. */
export function renderGoAv(av: AttributeValue): string {
  if ('S' in av) return `&types.AttributeValueMemberS{Value: ${goString(av.S)}}`;
  if ('N' in av) return `&types.AttributeValueMemberN{Value: ${goString(av.N)}}`;
  if ('B' in av) return `&types.AttributeValueMemberB{Value: ${goBytes(av.B)}}`;
  if ('BOOL' in av) return `&types.AttributeValueMemberBOOL{Value: ${av.BOOL}}`;
  if ('SS' in av)
    return `&types.AttributeValueMemberSS{Value: []string{${av.SS.map(goString).join(', ')}}}`;
  if ('NS' in av)
    return `&types.AttributeValueMemberNS{Value: []string{${av.NS.map(goString).join(', ')}}}`;
  if ('BS' in av)
    return `&types.AttributeValueMemberBS{Value: [][]byte{${av.BS.map(goBytes).join(', ')}}}`;
  return '&types.AttributeValueMemberNULL{Value: true}';
}

/** Render a typed map as a `map[string]types.AttributeValue{…}` literal. */
export function renderGoAvMap(map: Record<string, TypedValue>, indent: string): string {
  const inner = `${indent}\t`;
  const entries = Object.entries(typedMapToAvMap(map)).map(
    ([name, av]) => `${inner}${goString(name)}: ${renderGoAv(av)},`
  );
  return `map[string]types.AttributeValue{\n${entries.join('\n')}\n${indent}}`;
}

/** Render the plain string name map (`ExpressionAttributeNames`). */
function renderGoNameMap(map: Record<string, string>, indent: string): string {
  const inner = `${indent}\t`;
  const entries = Object.entries(map).map(
    ([alias, name]) => `${inner}${goString(alias)}: ${goString(name)},`
  );
  return `map[string]string{\n${entries.join('\n')}\n${indent}}`;
}

/**
 * Render the `&dynamodb.<Op>Input{…}` composite literal, one field per line at
 * `indent + \t`. Exported for the query-builder program emitter, which wraps
 * the same literal in a runnable `main.go` (config load + client + paginator).
 */
export function renderGoInput(request: CanonicalRequest, indent: string): string {
  const pad = `${indent}\t`;
  const fields: string[] = [`TableName: aws.String(${goString(request.tableName)}),`];
  if (request.indexName) fields.push(`IndexName: aws.String(${goString(request.indexName)}),`);
  if (request.key) fields.push(`Key: ${renderGoAvMap(request.key, pad)},`);
  if (request.item) fields.push(`Item: ${renderGoAvMap(request.item, pad)},`);
  if (request.keyConditionExpression)
    fields.push(`KeyConditionExpression: aws.String(${goString(request.keyConditionExpression)}),`);
  if (request.updateExpression)
    fields.push(`UpdateExpression: aws.String(${goString(request.updateExpression)}),`);
  if (request.conditionExpression)
    fields.push(`ConditionExpression: aws.String(${goString(request.conditionExpression)}),`);
  if (request.filterExpression)
    fields.push(`FilterExpression: aws.String(${goString(request.filterExpression)}),`);
  if (request.projectionExpression)
    fields.push(`ProjectionExpression: aws.String(${goString(request.projectionExpression)}),`);
  if (request.names)
    fields.push(`ExpressionAttributeNames: ${renderGoNameMap(request.names, pad)},`);
  if (request.typedValues)
    fields.push(`ExpressionAttributeValues: ${renderGoAvMap(request.typedValues, pad)},`);
  if (request.limit !== undefined) fields.push(`Limit: aws.Int32(${request.limit}),`);
  if (request.consistentRead) fields.push('ConsistentRead: aws.Bool(true),');
  if (request.scanIndexForward === false) fields.push('ScanIndexForward: aws.Bool(false),');
  if (request.exclusiveStartKey)
    fields.push(`ExclusiveStartKey: ${renderGoAvMap(request.exclusiveStartKey, pad)},`);
  const lines = fields.map((f) => `${pad}${f}`);
  return [`&dynamodb.${INPUT_TYPE_BY_OP[request.operation]}{`, ...lines, `${indent}}`].join('\n');
}

/**
 * Does this request render any `types.AttributeValue` (AV map)? Drives the
 * `dynamodb/types` import in the program emitter.
 */
export function goUsesTypes(request: CanonicalRequest): boolean {
  return (
    request.key !== undefined ||
    request.item !== undefined ||
    request.typedValues !== undefined ||
    request.exclusiveStartKey !== undefined
  );
}

/** Emit the bare `&dynamodb.<Op>Input{…}` snippet for a canonical request. */
export function emitGo(request: CanonicalRequest): string {
  return renderGoInput(request, '');
}
