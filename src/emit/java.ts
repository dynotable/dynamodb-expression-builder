// AWS SDK for Java v2 emitter — canonical request → a `<Op>Request.builder()…
// .build()` expression for `software.amazon.awssdk:dynamodb` (the low-level
// client). Unlike JS/Python, Java has no literal that maps 1:1 onto the AV wire
// shape, so the request is rendered FIELD BY FIELD (the cli.ts model, not the
// sdk-v3/boto3 generic literal walk): AttributeValue maps (`Key`/`Item`/
// `ExpressionAttributeValues`/`ExclusiveStartKey`) become `Map.ofEntries` of
// `AttributeValue.builder()` chains, the name map stays a plain `Map.ofEntries`
// of strings, and scalars become builder setters. Pure source rendering; imports
// no SDK.
//
// BINARY: the low-level Java client wants `SdkBytes` for `B`/`BS` members, not
// the base64 string the wire/CLI form uses — decode at the emitted program's
// runtime via `SdkBytes.fromByteArray(Base64.getDecoder().decode("…"))`.
//
// `Map.ofEntries` (not `Map.of`) uniformly: `Map.of` caps at 10 key/value pairs
// and a request can carry more expression values than that.

import {typedMapToAvMap} from './marshal';
import type {AttributeValue} from './marshal';
import type {CanonicalRequest, DdbOperation, TypedValue} from '../types';

/** Operation → the `software.amazon.awssdk.services.dynamodb.model` request class. */
const REQUEST_CLASS_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'GetItemRequest',
  Query: 'QueryRequest',
  Scan: 'ScanRequest',
  Update: 'UpdateItemRequest',
  Put: 'PutItemRequest',
  Delete: 'DeleteItemRequest'
};

/** Operation → the `DynamoDbClient` method. */
const CLIENT_METHOD_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'getItem',
  Query: 'query',
  Scan: 'scan',
  Update: 'updateItem',
  Put: 'putItem',
  Delete: 'deleteItem'
};

/** The model request class name for an operation (`QueryRequest`, …). */
export function javaRequestClassName(operation: DdbOperation): string {
  return REQUEST_CLASS_BY_OP[operation];
}

/** The `DynamoDbClient` method name for an operation (`query`, …). */
export function javaClientMethodName(operation: DdbOperation): string {
  return CLIENT_METHOD_BY_OP[operation];
}

/** Java string literal — `JSON.stringify` escapes are all valid Java escapes. */
function javaString(value: string): string {
  return JSON.stringify(value);
}

/** Java expression decoding a base64 `B` member to the `SdkBytes` the client needs. */
function javaBinary(base64: string): string {
  return `SdkBytes.fromByteArray(Base64.getDecoder().decode(${javaString(base64)}))`;
}

/** Render one wire AttributeValue as an `AttributeValue.builder()…build()` chain. */
export function renderJavaAv(av: AttributeValue): string {
  if ('S' in av) return `AttributeValue.builder().s(${javaString(av.S)}).build()`;
  if ('N' in av) return `AttributeValue.builder().n(${javaString(av.N)}).build()`;
  if ('B' in av) return `AttributeValue.builder().b(${javaBinary(av.B)}).build()`;
  if ('BOOL' in av) return `AttributeValue.builder().bool(${av.BOOL}).build()`;
  if ('SS' in av) return `AttributeValue.builder().ss(${av.SS.map(javaString).join(', ')}).build()`;
  if ('NS' in av) return `AttributeValue.builder().ns(${av.NS.map(javaString).join(', ')}).build()`;
  if ('BS' in av) return `AttributeValue.builder().bs(${av.BS.map(javaBinary).join(', ')}).build()`;
  return 'AttributeValue.builder().nul(true).build()';
}

/** Render a typed map as `Map.ofEntries(Map.entry(name, <AV builder>), …)`. */
export function renderJavaAvMap(map: Record<string, TypedValue>, indent: string): string {
  const inner = `${indent}    `;
  const entries = Object.entries(typedMapToAvMap(map)).map(
    ([name, av]) => `${inner}Map.entry(${javaString(name)}, ${renderJavaAv(av)})`
  );
  return `Map.ofEntries(\n${entries.join(',\n')}\n${indent})`;
}

/** Render the plain string name map (`ExpressionAttributeNames`). */
function renderJavaNameMap(map: Record<string, string>, indent: string): string {
  const inner = `${indent}    `;
  const entries = Object.entries(map).map(
    ([alias, name]) => `${inner}Map.entry(${javaString(alias)}, ${javaString(name)})`
  );
  return `Map.ofEntries(\n${entries.join(',\n')}\n${indent})`;
}

/**
 * Render the `<Op>Request.builder()…build()` expression, each setter on its own
 * line at `indent + 4` spaces. Exported for the query-builder program emitter,
 * which wraps the same expression in a runnable class (client init + send +
 * pagination loop); `extraSetters` lets it append loop-owned setters (e.g.
 * `.exclusiveStartKey(lastEvaluatedKey)`) before `.build()`.
 */
export function renderJavaRequestBuilder(
  request: CanonicalRequest,
  indent: string,
  extraSetters: string[] = []
): string {
  const pad = `${indent}    `;
  const setters: string[] = [`.tableName(${javaString(request.tableName)})`];
  if (request.indexName) setters.push(`.indexName(${javaString(request.indexName)})`);
  if (request.key) setters.push(`.key(${renderJavaAvMap(request.key, pad)})`);
  if (request.item) setters.push(`.item(${renderJavaAvMap(request.item, pad)})`);
  if (request.keyConditionExpression)
    setters.push(`.keyConditionExpression(${javaString(request.keyConditionExpression)})`);
  if (request.updateExpression)
    setters.push(`.updateExpression(${javaString(request.updateExpression)})`);
  if (request.conditionExpression)
    setters.push(`.conditionExpression(${javaString(request.conditionExpression)})`);
  if (request.filterExpression)
    setters.push(`.filterExpression(${javaString(request.filterExpression)})`);
  if (request.projectionExpression)
    setters.push(`.projectionExpression(${javaString(request.projectionExpression)})`);
  if (request.names)
    setters.push(`.expressionAttributeNames(${renderJavaNameMap(request.names, pad)})`);
  if (request.typedValues)
    setters.push(`.expressionAttributeValues(${renderJavaAvMap(request.typedValues, pad)})`);
  if (request.limit !== undefined) setters.push(`.limit(${request.limit})`);
  if (request.consistentRead) setters.push('.consistentRead(true)');
  if (request.scanIndexForward === false) setters.push('.scanIndexForward(false)');
  if (request.exclusiveStartKey)
    setters.push(`.exclusiveStartKey(${renderJavaAvMap(request.exclusiveStartKey, pad)})`);
  const lines = [...setters, ...extraSetters, '.build()'].map((s) => `${pad}${s}`);
  return [`${REQUEST_CLASS_BY_OP[request.operation]}.builder()`, ...lines].join('\n');
}

/** Emit the bare `<Op>Request.builder()…build()` snippet for a canonical request. */
export function emitJava(request: CanonicalRequest): string {
  return renderJavaRequestBuilder(request, '');
}
