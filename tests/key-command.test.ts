import {describe, expect, it} from 'vitest';
import {buildKeyConditionExpression, buildKeyMap} from '../src/key-command';
import type {KeyAttr, RangeKeyCondition} from '../src/types';

const hash: KeyAttr = {field: 'pk', type: 'S', value: 'USER#1'};

describe('buildKeyConditionExpression', () => {
  it('hash key only → `#hashKey = :hashKeyValue`', () => {
    const r = buildKeyConditionExpression(hash);
    expect(r.expression).toBe('#hashKey = :hashKeyValue');
    expect(r.names).toEqual({'#hashKey': 'pk'});
    expect(r.typedValues).toEqual({
      ':hashKeyValue': {type: 'S', value: 'USER#1'}
    });
  });

  it('composite S-hash + N-range with `>` captures both types', () => {
    const range: RangeKeyCondition = {
      field: 'createdAt',
      type: 'N',
      operator: '>',
      value: '1700000000'
    };
    const r = buildKeyConditionExpression(hash, range);
    expect(r.expression).toBe('#hashKey = :hashKeyValue AND #rangeKey > :rangeKeyValue');
    expect(r.names).toEqual({'#hashKey': 'pk', '#rangeKey': 'createdAt'});
    expect(r.typedValues).toEqual({
      ':hashKeyValue': {type: 'S', value: 'USER#1'},
      ':rangeKeyValue': {type: 'N', value: '1700000000'}
    });
  });

  it('range begins_with → function form', () => {
    const r = buildKeyConditionExpression(hash, {
      field: 'sk',
      type: 'S',
      operator: 'begins_with',
      value: 'ORDER#'
    });
    expect(r.expression).toBe(
      '#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)'
    );
    expect(r.typedValues[':rangeKeyValue']).toEqual({
      type: 'S',
      value: 'ORDER#'
    });
  });

  it('range between → two range placeholders', () => {
    const r = buildKeyConditionExpression(hash, {
      field: 'createdAt',
      type: 'N',
      operator: 'between',
      value: '100',
      value2: '200'
    });
    expect(r.expression).toBe(
      '#hashKey = :hashKeyValue AND #rangeKey BETWEEN :rangeKeyValue AND :rangeKeyValue2'
    );
    expect(r.typedValues[':rangeKeyValue2']).toEqual({
      type: 'N',
      value: '200'
    });
  });

  it('fails loud on a non-key range operator rather than emitting a malformed expression', () => {
    // a range-key row carries an operator from the full set; `contains` is not
    // key-eligible and must throw, not silently produce `#rangeKey undefined :…`
    expect(() =>
      buildKeyConditionExpression(hash, {
        field: 'sk',
        type: 'S',
        operator: 'contains',
        value: 'x'
      })
    ).toThrow(/not key-eligible/);
  });

  it('aliases do not collide with filter/cond prefixes', () => {
    const r = buildKeyConditionExpression(hash, {
      field: 'sk',
      type: 'N',
      operator: '<',
      value: '5'
    });
    const aliases = Object.keys(r.names);
    expect(aliases).toEqual(['#hashKey', '#rangeKey']);
    expect(aliases.some((a) => a.startsWith('#filter') || a.startsWith('#cond'))).toBe(false);
  });
});

describe('buildKeyMap — typed Key map for GetItem/Update/Delete', () => {
  it('composite S-hash + N-range → real-name → typed-value map', () => {
    const map = buildKeyMap([
      {field: 'pk', type: 'S', value: 'USER#1'},
      {field: 'sk', type: 'N', value: '42'}
    ]);
    expect(map).toEqual({
      pk: {type: 'S', value: 'USER#1'},
      sk: {type: 'N', value: '42'}
    });
  });
});
