// Filter / condition expression compiler. Three design points worth knowing:
//
//  (a) a `prefix` param ('filter' | 'cond') namespaces the name alias, value
//      placeholder, AND each `IN` member, so one request's FilterExpression and
//      ConditionExpression placeholders never collide.
//  (b) the UI passes the lowercase operator value (`'='`, `'begins_with'`); we
//      map it to its wire form via OPERATOR_BY_VALUE before switching (the app
//      switched on an already-uppercased wire op).
//  (c) values are captured as TYPED values (`{type,value}` from the row's type
//      tag), not raw — the type tag is what drives marshalling downstream.
//
// CROSS-REPO SYNC: the operator → expression mappings mirror the app's switch.

import {OPERATOR_BY_VALUE} from './operators';
import type {WireFilterOperator} from './operators';
import {elementType, makeTypedValue} from './types';
import type {FilterRow, TypedValue} from './types';

/** Namespacing prefix so filter and condition placeholders never collide. */
export type PredicatePrefix = 'filter' | 'cond';

export interface PredicateExpression {
  expression: string;
  names: Record<string, string>;
  typedValues: Record<string, TypedValue>;
}

/**
 * Compile a list of predicate rows into one `… AND …` expression plus the
 * fresh names/typedValues maps it references. Returns null for an empty list.
 * Callers (buildRequest) merge the maps; this function never mutates shared
 * state.
 */
export function buildFilterExpressions(
  rows: FilterRow[],
  prefix: PredicatePrefix
): PredicateExpression | null {
  if (rows.length === 0) return null;
  const names: Record<string, string> = {};
  const typedValues: Record<string, TypedValue> = {};
  const expressions = rows.map((row, index) => buildOne(row, index, prefix, names, typedValues));
  return {expression: expressions.join(' AND '), names, typedValues};
}

function buildOne(
  row: FilterRow,
  index: number,
  prefix: PredicatePrefix,
  names: Record<string, string>,
  typedValues: Record<string, TypedValue>
): string {
  const wire: WireFilterOperator = OPERATOR_BY_VALUE[row.operator].wireForm;

  const nameRef = `#${prefix}${index}`;
  names[nameRef] = row.field;
  const valueRef = `:${prefix}Value${index}`;
  const valueRef2 = `:${prefix}Value${index}_2`;

  switch (wire) {
    case 'EQ':
      typedValues[valueRef] = single(row);
      return `${nameRef} = ${valueRef}`;
    case 'NE':
      typedValues[valueRef] = single(row);
      return `${nameRef} <> ${valueRef}`;
    case 'GT':
      typedValues[valueRef] = single(row);
      return `${nameRef} > ${valueRef}`;
    case 'GE':
      typedValues[valueRef] = single(row);
      return `${nameRef} >= ${valueRef}`;
    case 'LT':
      typedValues[valueRef] = single(row);
      return `${nameRef} < ${valueRef}`;
    case 'LE':
      typedValues[valueRef] = single(row);
      return `${nameRef} <= ${valueRef}`;
    case 'CONTAINS':
      // contains(path, operand) takes a SCALAR operand even on a set attribute
      // (membership test) — marshal the element type, never `{SS:[…]}`. The app
      // gates the *attribute* type and keeps the operand scalar; this web tool
      // conflates type tags, so normalise here (departure beyond (c) above).
      typedValues[valueRef] = makeTypedValue(elementType(row.type), row.value);
      return `contains(${nameRef}, ${valueRef})`;
    case 'NOT_CONTAINS':
      // Same scalar-operand rule as CONTAINS; DynamoDB has no not_contains
      // function, so the wire form is the negated function call.
      typedValues[valueRef] = makeTypedValue(elementType(row.type), row.value);
      return `NOT contains(${nameRef}, ${valueRef})`;
    case 'BEGINS_WITH':
      typedValues[valueRef] = single(row);
      return `begins_with(${nameRef}, ${valueRef})`;
    case 'BETWEEN':
      typedValues[valueRef] = makeTypedValue(row.type, row.value);
      typedValues[valueRef2] = makeTypedValue(row.type, row.value2 ?? '');
      return `${nameRef} BETWEEN ${valueRef} AND ${valueRef2}`;
    case 'IN': {
      const members = row.values ?? (row.value ? [row.value] : []);
      // Fail loud on an empty member list — `IN ()` is invalid in every format.
      // (Web-tool departure: the app never compiles a partial row.)
      if (members.length === 0) {
        throw new Error(`IN on "${row.field}" requires at least one value`);
      }
      const refs = members.map((member, i) => {
        const ref = `:${prefix}Value${index}_${i}`;
        typedValues[ref] = makeTypedValue(row.type, member);
        return ref;
      });
      return `${nameRef} IN (${refs.join(', ')})`;
    }
    case 'EXISTS':
      return `attribute_exists(${nameRef})`;
    case 'NOT_EXISTS':
      return `attribute_not_exists(${nameRef})`;
    case 'SIZE_EQ':
      typedValues[valueRef] = single(row);
      return `size(${nameRef}) = ${valueRef}`;
    case 'SIZE_NE':
      typedValues[valueRef] = single(row);
      return `size(${nameRef}) <> ${valueRef}`;
    case 'SIZE_LT':
      typedValues[valueRef] = single(row);
      return `size(${nameRef}) < ${valueRef}`;
    case 'SIZE_LE':
      typedValues[valueRef] = single(row);
      return `size(${nameRef}) <= ${valueRef}`;
    case 'SIZE_GT':
      typedValues[valueRef] = single(row);
      return `size(${nameRef}) > ${valueRef}`;
    case 'SIZE_GE':
      typedValues[valueRef] = single(row);
      return `size(${nameRef}) >= ${valueRef}`;
    case 'TYPE_EQ':
      typedValues[valueRef] = single(row);
      return `attribute_type(${nameRef}, ${valueRef})`;
    case 'TYPE_NE':
      typedValues[valueRef] = single(row);
      return `NOT attribute_type(${nameRef}, ${valueRef})`;
  }
}

/** Capture the row's single RHS value as a typed value (set- or scalar-aware). */
function single(row: FilterRow): TypedValue {
  return makeTypedValue(row.type, row.value, row.values);
}
