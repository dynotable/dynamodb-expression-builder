// Key handling — KeyConditionExpression assembly plus the plain typed Key map,
// free of any `@aws-sdk/lib-dynamodb` `*CommandInput` types. Two shapes:
//
//  - buildKeyConditionExpression: Query's `#hashKey = :hashKeyValue [AND …]`
//    with the app's fixed reserved-word-safe aliases (`#hashKey`/`#rangeKey`,
//    distinct from the `filter`/`cond`/`upd` prefixes so they never collide).
//  - buildKeyMap: the plain typed Key map (GetItem/Update/Delete) — real
//    attribute names → typed values, no expression, no placeholders.
//
// Both capture each value's DynamoDB type tag.
//
// CROSS-REPO SYNC: the alias names + range-operator mapping mirror the app.

import {OPERATOR_BY_VALUE} from './operators';
import {makeTypedValue} from './types';
import type {KeyAttr, RangeKeyCondition, TypedValue} from './types';

export interface KeyConditionResult {
  expression: string;
  names: Record<string, string>;
  typedValues: Record<string, TypedValue>;
}

/**
 * Build a Query KeyConditionExpression from a hash key (always EQ) plus an
 * optional range-key condition. Captures value types.
 */
export function buildKeyConditionExpression(
  hashKey: KeyAttr,
  rangeKey?: RangeKeyCondition
): KeyConditionResult {
  const names: Record<string, string> = {'#hashKey': hashKey.field};
  const typedValues: Record<string, TypedValue> = {
    ':hashKeyValue': makeTypedValue(hashKey.type, hashKey.value)
  };
  let expression = '#hashKey = :hashKeyValue';

  if (rangeKey) {
    names['#rangeKey'] = rangeKey.field;
    const wire = OPERATOR_BY_VALUE[rangeKey.operator].wireForm;

    if (wire === 'BETWEEN') {
      typedValues[':rangeKeyValue'] = makeTypedValue(rangeKey.type, rangeKey.value);
      typedValues[':rangeKeyValue2'] = makeTypedValue(rangeKey.type, rangeKey.value2 ?? '');
      expression += ' AND #rangeKey BETWEEN :rangeKeyValue AND :rangeKeyValue2';
    } else if (wire === 'BEGINS_WITH') {
      typedValues[':rangeKeyValue'] = makeTypedValue(rangeKey.type, rangeKey.value);
      expression += ' AND begins_with(#rangeKey, :rangeKeyValue)';
    } else {
      const symbol = SYMBOL_BY_WIRE[wire];
      if (!symbol) {
        throw new Error(`Operator ${rangeKey.operator} is not key-eligible`);
      }
      typedValues[':rangeKeyValue'] = makeTypedValue(rangeKey.type, rangeKey.value);
      expression += ` AND #rangeKey ${symbol} :rangeKeyValue`;
    }
  }

  return {expression, names, typedValues};
}

/**
 * Comparison symbols for the simple key operators. Partial on purpose: a
 * range-key row carries an `OperatorValue` from the full set, so a non-key
 * operator (e.g. `contains`) can reach here at runtime — the lookup returns
 * undefined and the caller throws rather than emitting a malformed expression.
 */
const SYMBOL_BY_WIRE: Partial<Record<string, string>> = {
  EQ: '=',
  GT: '>',
  GE: '>=',
  LT: '<',
  LE: '<='
};

/**
 * Build the plain typed Key map (GetItem/Update/Delete) — real attribute names
 * mapped to typed values, no expression placeholders.
 */
export function buildKeyMap(keys: KeyAttr[]): Record<string, TypedValue> {
  const map: Record<string, TypedValue> = {};
  for (const k of keys) {
    map[k.field] = makeTypedValue(k.type, k.value);
  }
  return map;
}
