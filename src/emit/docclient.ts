// DocumentClient emitter — canonical request → a `@aws-sdk/lib-dynamodb`
// command literal with NATIVE JavaScript values (the DocumentClient does the
// low-level AttributeValue marshalling itself): bare numbers for N, real `Set`s
// for SS/NS/BS, `Uint8Array` for B, plain objects/strings elsewhere. The
// expression strings and alias maps are IDENTICAL to the low-level shape — only
// the value side changes.
//
// Number caveat, stated rather than hidden: a DynamoDB N holds up to 38
// significant digits; a JS number holds 15-17. The N tag renders as a bare
// number literal (what DocumentClient users actually write) — a value outside
// double precision belongs on the low-level client, and the emitted literal
// would visibly round in review.

import {renderNativeValue} from './ddbtoolbox';
import type {CanonicalRequest, DdbOperation, TypedValue} from '../types';

/** Operation → the `@aws-sdk/lib-dynamodb` command class. */
const COMMAND_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'GetCommand',
  Query: 'QueryCommand',
  Scan: 'ScanCommand',
  Update: 'UpdateCommand',
  Put: 'PutCommand',
  Delete: 'DeleteCommand'
};

/** The lib-dynamodb command class name for an operation. */
export function docClientCommandName(operation: DdbOperation): string {
  return COMMAND_BY_OP[operation];
}

/** Render a typed map as a native-value object literal, one entry per line. */
function renderNativeMap(map: Record<string, TypedValue>, indent: string): string {
  const inner = `${indent}  `;
  const entries = Object.entries(map).map(
    ([name, tv]) => `${inner}${JSON.stringify(name)}: ${renderNativeValue(tv)},`
  );
  return `{\n${entries.join('\n')}\n${indent}}`;
}

/** Render the plain string map (`ExpressionAttributeNames`). */
function renderNameMap(map: Record<string, string>, indent: string): string {
  const inner = `${indent}  `;
  const entries = Object.entries(map).map(
    ([alias, name]) => `${inner}${JSON.stringify(alias)}: ${JSON.stringify(name)},`
  );
  return `{\n${entries.join('\n')}\n${indent}}`;
}

/**
 * Render the command's params object literal, one field per line at
 * `indent + 2`. Exported for the program emitter.
 */
export function renderDocClientParams(request: CanonicalRequest, indent: string): string {
  const pad = `${indent}  `;
  const fields: string[] = [`TableName: ${JSON.stringify(request.tableName)},`];
  if (request.indexName) fields.push(`IndexName: ${JSON.stringify(request.indexName)},`);
  if (request.key) fields.push(`Key: ${renderNativeMap(request.key, pad)},`);
  if (request.item) fields.push(`Item: ${renderNativeMap(request.item, pad)},`);
  if (request.keyConditionExpression)
    fields.push(`KeyConditionExpression: ${JSON.stringify(request.keyConditionExpression)},`);
  if (request.updateExpression)
    fields.push(`UpdateExpression: ${JSON.stringify(request.updateExpression)},`);
  if (request.conditionExpression)
    fields.push(`ConditionExpression: ${JSON.stringify(request.conditionExpression)},`);
  if (request.filterExpression)
    fields.push(`FilterExpression: ${JSON.stringify(request.filterExpression)},`);
  if (request.projectionExpression)
    fields.push(`ProjectionExpression: ${JSON.stringify(request.projectionExpression)},`);
  if (request.names) fields.push(`ExpressionAttributeNames: ${renderNameMap(request.names, pad)},`);
  if (request.typedValues)
    fields.push(`ExpressionAttributeValues: ${renderNativeMap(request.typedValues, pad)},`);
  if (request.limit !== undefined) fields.push(`Limit: ${request.limit},`);
  if (request.consistentRead) fields.push('ConsistentRead: true,');
  if (request.scanIndexForward === false) fields.push('ScanIndexForward: false,');
  if (request.exclusiveStartKey)
    fields.push(`ExclusiveStartKey: ${renderNativeMap(request.exclusiveStartKey, pad)},`);
  const lines = fields.map((f) => `${pad}${f}`);
  return ['{', ...lines, `${indent}}`].join('\n');
}

/** Emit the bare `new XCommand({…})` snippet with native values. */
export function emitDocClient(request: CanonicalRequest): string {
  return `new ${COMMAND_BY_OP[request.operation]}(${renderDocClientParams(request, '')})`;
}
