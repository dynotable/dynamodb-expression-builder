// .NET (AWSSDK.DynamoDBv2) emitter — canonical request → a `new <Op>Request
// { … }` object initializer for the low-level `AmazonDynamoDBClient`. Like
// java.ts/go.ts, C# has no literal mapping 1:1 onto the AV wire shape, so the
// request renders FIELD BY FIELD (the cli.ts model): AttributeValue maps become
// `Dictionary<string, AttributeValue>` initializers of `new AttributeValue
// { … }` values, the name map stays `Dictionary<string, string>`, and scalars
// are plain property assignments. Pure source rendering; imports no SDK.
//
// BINARY: `AttributeValue.B` is a `MemoryStream`, not the base64 string the
// wire/CLI form uses — decode at the emitted program's runtime via
// `new MemoryStream(Convert.FromBase64String("…"))`.
//
// BOOL: the current AWSSDK.DynamoDBv2 `BOOL` setter flips `IsBOOLSet`, so an
// explicit `BOOL = false` serializes correctly (pinned by a test fixture).

import {typedMapToAvMap} from './marshal';
import type {AttributeValue} from './marshal';
import type {CanonicalRequest, DdbOperation, TypedValue} from '../types';

/** Operation → the `Amazon.DynamoDBv2.Model` request class. */
const REQUEST_CLASS_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'GetItemRequest',
  Query: 'QueryRequest',
  Scan: 'ScanRequest',
  Update: 'UpdateItemRequest',
  Put: 'PutItemRequest',
  Delete: 'DeleteItemRequest'
};

/** Operation → the async `AmazonDynamoDBClient` method. */
const CLIENT_METHOD_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'GetItemAsync',
  Query: 'QueryAsync',
  Scan: 'ScanAsync',
  Update: 'UpdateItemAsync',
  Put: 'PutItemAsync',
  Delete: 'DeleteItemAsync'
};

/** The model request class name for an operation (`QueryRequest`, …). */
export function dotnetRequestClassName(operation: DdbOperation): string {
  return REQUEST_CLASS_BY_OP[operation];
}

/** The async client method name for an operation (`QueryAsync`, …). */
export function dotnetClientMethodName(operation: DdbOperation): string {
  return CLIENT_METHOD_BY_OP[operation];
}

/** C# string literal — `JSON.stringify` escapes are all valid C# escapes. */
function csString(value: string): string {
  return JSON.stringify(value);
}

/** C# expression decoding a base64 `B` member to the `MemoryStream` the client needs. */
function csBinary(base64: string): string {
  return `new MemoryStream(Convert.FromBase64String(${csString(base64)}))`;
}

/** Render one wire AttributeValue as a `new AttributeValue { … }` initializer. */
export function renderCsAv(av: AttributeValue): string {
  if ('S' in av) return `new AttributeValue { S = ${csString(av.S)} }`;
  if ('N' in av) return `new AttributeValue { N = ${csString(av.N)} }`;
  if ('B' in av) return `new AttributeValue { B = ${csBinary(av.B)} }`;
  if ('BOOL' in av) return `new AttributeValue { BOOL = ${av.BOOL} }`;
  if ('SS' in av)
    return `new AttributeValue { SS = new List<string> { ${av.SS.map(csString).join(', ')} } }`;
  if ('NS' in av)
    return `new AttributeValue { NS = new List<string> { ${av.NS.map(csString).join(', ')} } }`;
  if ('BS' in av)
    return `new AttributeValue { BS = new List<MemoryStream> { ${av.BS.map(csBinary).join(', ')} } }`;
  return 'new AttributeValue { NULL = true }';
}

/** Render a typed map as a `Dictionary<string, AttributeValue>` initializer. */
export function renderCsAvMap(map: Record<string, TypedValue>, indent: string): string {
  const inner = `${indent}    `;
  const entries = Object.entries(typedMapToAvMap(map)).map(
    ([name, av]) => `${inner}[${csString(name)}] = ${renderCsAv(av)},`
  );
  return `new Dictionary<string, AttributeValue>\n${indent}{\n${entries.join('\n')}\n${indent}}`;
}

/** Render the plain string name map (`ExpressionAttributeNames`). */
function renderCsNameMap(map: Record<string, string>, indent: string): string {
  const inner = `${indent}    `;
  const entries = Object.entries(map).map(
    ([alias, name]) => `${inner}[${csString(alias)}] = ${csString(name)},`
  );
  return `new Dictionary<string, string>\n${indent}{\n${entries.join('\n')}\n${indent}}`;
}

/**
 * Render the `new <Op>Request { … }` object initializer, one property per line
 * at `indent + 4` spaces. Exported for the query-builder program emitter, which
 * wraps the same initializer in a runnable program (client init + await send +
 * pagination loop).
 */
export function renderCsRequest(request: CanonicalRequest, indent: string): string {
  const pad = `${indent}    `;
  const props: string[] = [`TableName = ${csString(request.tableName)},`];
  if (request.indexName) props.push(`IndexName = ${csString(request.indexName)},`);
  if (request.key) props.push(`Key = ${renderCsAvMap(request.key, pad)},`);
  if (request.item) props.push(`Item = ${renderCsAvMap(request.item, pad)},`);
  if (request.keyConditionExpression)
    props.push(`KeyConditionExpression = ${csString(request.keyConditionExpression)},`);
  if (request.updateExpression)
    props.push(`UpdateExpression = ${csString(request.updateExpression)},`);
  if (request.conditionExpression)
    props.push(`ConditionExpression = ${csString(request.conditionExpression)},`);
  if (request.filterExpression)
    props.push(`FilterExpression = ${csString(request.filterExpression)},`);
  if (request.projectionExpression)
    props.push(`ProjectionExpression = ${csString(request.projectionExpression)},`);
  if (request.names)
    props.push(`ExpressionAttributeNames = ${renderCsNameMap(request.names, pad)},`);
  if (request.typedValues)
    props.push(`ExpressionAttributeValues = ${renderCsAvMap(request.typedValues, pad)},`);
  if (request.limit !== undefined) props.push(`Limit = ${request.limit},`);
  if (request.consistentRead) props.push('ConsistentRead = true,');
  if (request.scanIndexForward === false) props.push('ScanIndexForward = false,');
  if (request.exclusiveStartKey)
    props.push(`ExclusiveStartKey = ${renderCsAvMap(request.exclusiveStartKey, pad)},`);
  const lines = props.map((p) => `${pad}${p}`);
  return [
    `new ${REQUEST_CLASS_BY_OP[request.operation]}`,
    `${indent}{`,
    ...lines,
    `${indent}}`
  ].join('\n');
}

/** Emit the bare `new <Op>Request { … }` snippet for a canonical request. */
export function emitDotnet(request: CanonicalRequest): string {
  return renderCsRequest(request, '');
}
