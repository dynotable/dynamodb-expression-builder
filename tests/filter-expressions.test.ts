import {describe, expect, it} from 'vitest';
import {buildFilterExpressions} from '../src/filter-expressions';
import type {FilterRow} from '../src/types';

const row = (over: Partial<FilterRow>): FilterRow => ({
  field: 'status',
  operator: '=',
  type: 'S',
  value: 'active',
  ...over
});

describe('buildFilterExpressions — per-operator expression + typed capture', () => {
  it('returns null for an empty row list', () => {
    expect(buildFilterExpressions([], 'filter')).toBeNull();
  });

  it('EQ → `#filter0 = :filterValue0` with captured S type', () => {
    const r = buildFilterExpressions([row({})], 'filter')!;
    expect(r.expression).toBe('#filter0 = :filterValue0');
    expect(r.names).toEqual({'#filter0': 'status'});
    expect(r.typedValues).toEqual({
      ':filterValue0': {type: 'S', value: 'active'}
    });
  });

  it('begins_with → function form, captures the value type', () => {
    const r = buildFilterExpressions(
      [row({field: 'sk', operator: 'begins_with', value: 'USER#'})],
      'filter'
    )!;
    expect(r.expression).toBe('begins_with(#filter0, :filterValue0)');
    expect(r.typedValues[':filterValue0']).toEqual({
      type: 'S',
      value: 'USER#'
    });
  });

  it('between → two placeholders, both typed N', () => {
    const r = buildFilterExpressions(
      [
        row({
          field: 'age',
          operator: 'between',
          type: 'N',
          value: '18',
          value2: '65'
        })
      ],
      'filter'
    )!;
    expect(r.expression).toBe('#filter0 BETWEEN :filterValue0 AND :filterValue0_2');
    expect(r.typedValues).toEqual({
      ':filterValue0': {type: 'N', value: '18'},
      ':filterValue0_2': {type: 'N', value: '65'}
    });
  });

  it('in → one placeholder per member, each typed', () => {
    const r = buildFilterExpressions(
      [
        row({
          field: 'tier',
          operator: 'in',
          type: 'S',
          value: '',
          values: ['gold', 'silver']
        })
      ],
      'filter'
    )!;
    expect(r.expression).toBe('#filter0 IN (:filterValue0_0, :filterValue0_1)');
    expect(r.typedValues).toEqual({
      ':filterValue0_0': {type: 'S', value: 'gold'},
      ':filterValue0_1': {type: 'S', value: 'silver'}
    });
  });

  it('in with no members fails loud (never emits IN ())', () => {
    expect(() =>
      buildFilterExpressions(
        [
          row({
            field: 'tier',
            operator: 'in',
            type: 'S',
            value: '',
            values: []
          })
        ],
        'filter'
      )
    ).toThrow(/at least one value/);
  });

  it('exists / not_exists → no value captured', () => {
    const r = buildFilterExpressions(
      [row({field: 'a', operator: 'exists'}), row({field: 'b', operator: 'not_exists'})],
      'filter'
    )!;
    expect(r.expression).toBe('attribute_exists(#filter0) AND attribute_not_exists(#filter1)');
    expect(r.typedValues).toEqual({});
  });

  it('contains / size / type render their function forms', () => {
    expect(buildFilterExpressions([row({operator: 'contains'})], 'filter')!.expression).toBe(
      'contains(#filter0, :filterValue0)'
    );
    expect(
      buildFilterExpressions([row({operator: 'size_gt', type: 'SS', value: '2'})], 'filter')!
        .expression
    ).toBe('size(#filter0) > :filterValue0');
    expect(
      buildFilterExpressions([row({operator: 'type_ne', value: 'S'})], 'filter')!.expression
    ).toBe('NOT attribute_type(#filter0, :filterValue0)');
  });

  it('contains on a set attribute marshals a SCALAR element operand (not a set)', () => {
    // contains(path, operand) needs a scalar operand even on an SS attribute;
    // marshalling `{SS:[…]}` here would be rejected by DynamoDB.
    const r = buildFilterExpressions(
      [row({field: 'tags', operator: 'contains', type: 'SS', value: 'vip'})],
      'filter'
    )!;
    expect(r.expression).toBe('contains(#filter0, :filterValue0)');
    expect(r.typedValues[':filterValue0']).toEqual({type: 'S', value: 'vip'});
  });

  it('joins multiple rows with AND, incrementing the index', () => {
    const r = buildFilterExpressions(
      [row({field: 'a', value: 'x'}), row({field: 'b', value: 'y'})],
      'filter'
    )!;
    expect(r.expression).toBe('#filter0 = :filterValue0 AND #filter1 = :filterValue1');
  });
});

describe('prefix namespacing — filter vs cond never collide', () => {
  it('the same field/op under both prefixes produces disjoint placeholders', () => {
    const filter = buildFilterExpressions(
      [row({field: 'k', operator: 'in', value: '', values: ['a', 'b']})],
      'filter'
    )!;
    const cond = buildFilterExpressions(
      [row({field: 'k', operator: 'in', value: '', values: ['a', 'b']})],
      'cond'
    )!;

    expect(filter.expression).toBe('#filter0 IN (:filterValue0_0, :filterValue0_1)');
    expect(cond.expression).toBe('#cond0 IN (:condValue0_0, :condValue0_1)');

    const merged = {...filter.typedValues, ...cond.typedValues};
    // No placeholder from one side overwrote the other.
    expect(Object.keys(merged)).toHaveLength(4);
    expect({...filter.names, ...cond.names}).toEqual({
      '#filter0': 'k',
      '#cond0': 'k'
    });
  });
});

describe('not_contains — the negated function call', () => {
  it('compiles to NOT contains(...) with the scalar element-type operand', () => {
    const result = buildFilterExpressions(
      [{field: 'tags', operator: 'not_contains', type: 'SS', value: 'legacy'}],
      'filter'
    );
    expect(result?.expression).toBe('NOT contains(#filter0, :filterValue0)');
    expect(result?.typedValues[':filterValue0']).toEqual({type: 'S', value: 'legacy'});
  });
});
