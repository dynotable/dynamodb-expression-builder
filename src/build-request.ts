// Canonical request assembler — the seam that turns a whole {@link BuilderConfig}
// into the single {@link CanonicalRequest} every emitter (SDK v3 / CLI / boto3 /
// PartiQL) formats. It dispatches per operation and merges the names/typedValues
// each sub-builder returns:
//
//  GetItem → typed Key map (+ projection)
//  Query   → KeyConditionExpression (+ filter) (+ projection)
//  Scan    → filter (+ projection)
//  Update  → Key map + UpdateExpression (+ condition)
//  Put     → typed item map (+ condition)
//  Delete  → Key map (+ condition)
//
// The sub-builders already namespace their placeholders with distinct prefixes
// (`#hashKey`/`#rangeKey`, `#filter{i}`, `#cond{i}`, `#upd{i}`, and `#proj{i}`
// here), so the merge is a plain assign — no placeholder can collide. Empty
// names/typedValues/key/item maps are omitted so emitters don't emit empty
// `ExpressionAttributeNames`/`Values`. The raw `config` rides along for PartiQL,
// which builds literals rather than placeholders.

import {buildFilterExpressions} from './filter-expressions';
import {buildKeyConditionExpression, buildKeyMap} from './key-command';
import {buildUpdateExpression} from './build-update-expression';
import {isSetType, makeTypedValue} from './types';
import type {BuilderConfig, CanonicalRequest, ItemAttr, TypedValue} from './types';

/**
 * Assemble a {@link CanonicalRequest} from a builder config. Pure: reads only the
 * config sub-parts the operation uses, merges the sub-builders' maps, and omits
 * any map that ended up empty. Throws (fail loud) when a required part is missing
 * (a Query without a hash key) rather than emitting a malformed request.
 */
export function buildRequest(config: BuilderConfig): CanonicalRequest {
  const names: Record<string, string> = {};
  const typedValues: Record<string, TypedValue> = {};

  const request: CanonicalRequest = {
    operation: config.operation,
    tableName: config.tableName,
    config
  };
  if (config.indexName) request.indexName = config.indexName;

  switch (config.operation) {
    case 'GetItem':
      assignKey(request, config);
      applyProjection(request, config, names);
      if (config.consistentRead) request.consistentRead = true;
      break;

    case 'Query': {
      if (!config.hashKey) {
        throw new Error('Query requires a hash key');
      }
      const kc = buildKeyConditionExpression(config.hashKey, config.rangeKey);
      request.keyConditionExpression = kc.expression;
      Object.assign(names, kc.names);
      Object.assign(typedValues, kc.typedValues);
      applyFilter(request, config, names, typedValues);
      applyProjection(request, config, names);
      applyReadOptions(request, config);
      // ScanIndexForward is Query-only; carry only the non-default `false`.
      if (config.scanIndexForward === false) request.scanIndexForward = false;
      break;
    }

    case 'Scan':
      applyFilter(request, config, names, typedValues);
      applyProjection(request, config, names);
      applyReadOptions(request, config);
      break;

    case 'Update': {
      assignKey(request, config);
      const update = buildUpdateExpression(config.updates ?? []);
      if (update) {
        request.updateExpression = update.expression;
        Object.assign(names, update.names);
        Object.assign(typedValues, update.typedValues);
      }
      applyCondition(request, config, names, typedValues);
      break;
    }

    case 'Put': {
      const item = buildItemMap(config.item ?? []);
      if (Object.keys(item).length > 0) request.item = item;
      applyCondition(request, config, names, typedValues);
      break;
    }

    case 'Delete':
      assignKey(request, config);
      applyCondition(request, config, names, typedValues);
      break;
  }

  if (Object.keys(names).length > 0) request.names = names;
  if (Object.keys(typedValues).length > 0) request.typedValues = typedValues;
  assertNoEmptySets(request);
  return request;
}

/**
 * An empty set (`{SS:[]}`/`{NS:[]}`/`{BS:[]}`) is rejected by DynamoDB at runtime.
 * Catch it at build time — mirroring the empty-`IN` guard in filter-expressions —
 * so the tool never hands out a snippet that fails when run. PartiQL is emitted
 * from the same request (which `emit()` builds first), so this covers every format.
 */
function assertNoEmptySets(request: CanonicalRequest): void {
  for (const map of [request.key, request.item, request.typedValues, request.exclusiveStartKey]) {
    if (!map) continue;
    for (const tv of Object.values(map)) {
      if (isSetType(tv.type) && (tv.values?.length ?? 0) === 0) {
        throw new Error('a set value (SS/NS/BS) requires at least one member');
      }
    }
  }
}

/**
 * Attach the Query/Scan request-level read options: `Limit` (validated — a
 * non-positive/non-integer limit fails loud rather than emitting `Limit: 0`),
 * `ConsistentRead` (only `true` carried), and `ExclusiveStartKey` (typed key
 * map, omitted when empty). `ScanIndexForward` is handled at the Query call
 * site — it's Query-only.
 */
function applyReadOptions(request: CanonicalRequest, config: BuilderConfig): void {
  if (config.limit !== undefined) {
    if (!Number.isInteger(config.limit) || config.limit <= 0) {
      throw new Error('Limit must be a positive integer');
    }
    request.limit = config.limit;
  }
  if (config.consistentRead) request.consistentRead = true;
  const startKey = buildKeyMap(config.exclusiveStartKey ?? []);
  if (Object.keys(startKey).length > 0) request.exclusiveStartKey = startKey;
}

/** Attach the typed Key map (GetItem/Update/Delete), omitting it when empty. */
function assignKey(request: CanonicalRequest, config: BuilderConfig): void {
  const key = buildKeyMap(config.key ?? []);
  if (Object.keys(key).length > 0) request.key = key;
}

/** Compile filters into a FilterExpression + merge its maps (Query/Scan). */
function applyFilter(
  request: CanonicalRequest,
  config: BuilderConfig,
  names: Record<string, string>,
  typedValues: Record<string, TypedValue>
): void {
  const filter = buildFilterExpressions(config.filters ?? [], 'filter');
  if (!filter) return;
  request.filterExpression = filter.expression;
  Object.assign(names, filter.names);
  Object.assign(typedValues, filter.typedValues);
}

/** Compile conditions into a ConditionExpression + merge its maps (write ops). */
function applyCondition(
  request: CanonicalRequest,
  config: BuilderConfig,
  names: Record<string, string>,
  typedValues: Record<string, TypedValue>
): void {
  const condition = buildFilterExpressions(config.conditions ?? [], 'cond');
  if (!condition) return;
  request.conditionExpression = condition.expression;
  Object.assign(names, condition.names);
  Object.assign(typedValues, condition.typedValues);
}

/**
 * Build a `#`-aliased ProjectionExpression (read ops only). Each projected
 * attribute gets a fresh `#proj{i}` alias so reserved words are always safe and
 * the aliases never collide with key/filter prefixes.
 */
function applyProjection(
  request: CanonicalRequest,
  config: BuilderConfig,
  names: Record<string, string>
): void {
  const attrs = config.projection;
  if (!attrs || attrs.length === 0) return;
  const refs = attrs.map((attr, index) => {
    const ref = `#proj${index}`;
    names[ref] = attr;
    return ref;
  });
  request.projectionExpression = refs.join(', ');
}

/** Build the typed Put item map — real attribute names → typed values. */
function buildItemMap(items: ItemAttr[]): Record<string, TypedValue> {
  const map: Record<string, TypedValue> = {};
  for (const attr of items) {
    map[attr.field] = makeTypedValue(attr.type, attr.value, attr.values);
  }
  return map;
}
