import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {emitDdbToolboxProgram, renderNativeValue} from '../../src/emit/ddbtoolbox';
import type {BuilderConfig, TypedValue} from '../../src/types';

// dynamodb-toolbox (v2) is SCHEMA-FIRST and abstracts expressions away, so it is
// a PROGRAM-only target (no bare command literal). These tests pin the two
// things the program test doesn't fully exercise: the NATIVE value marshalling
// (the DocumentClient does the AttributeValue work) and the condition DSL for
// every filter operator the widget can emit.

function queryWith(partial: Partial<BuilderConfig>): string {
  const config: BuilderConfig = {
    operation: 'Query',
    tableName: 'T',
    hashKey: {field: 'pk', type: 'S', value: 'P#1'},
    ...partial
  };
  return emitDdbToolboxProgram(buildRequest(config), false);
}

describe('renderNativeValue — the DocumentClient marshals, so values are native JS', () => {
  const render = (tv: TypedValue) => renderNativeValue(tv);

  it('S → quoted string, N → bare number, BOOL → boolean, NULL → null', () => {
    expect(render({type: 'S', value: 'hi'})).toBe('"hi"');
    expect(render({type: 'N', value: '42'})).toBe('42');
    expect(render({type: 'BOOL', value: 'true'})).toBe('true');
    expect(render({type: 'BOOL', value: 'false'})).toBe('false');
    expect(render({type: 'NULL', value: ''})).toBe('null');
  });

  it('B → Uint8Array decode of the base64', () => {
    expect(render({type: 'B', value: 'aGVsbG8='})).toBe(
      'Uint8Array.from(atob("aGVsbG8="), (c) => c.charCodeAt(0))'
    );
  });

  it('SS/NS → real Set with quoted / bare members', () => {
    expect(render({type: 'SS', value: '', values: ['a', 'b']})).toBe('new Set(["a", "b"])');
    expect(render({type: 'NS', value: '', values: ['1', '2']})).toBe('new Set([1, 2])');
  });

  it('BS → Set of decoded Uint8Arrays', () => {
    expect(render({type: 'BS', value: '', values: ['YQ==']})).toBe(
      'new Set([Uint8Array.from(atob("YQ=="), (c) => c.charCodeAt(0))])'
    );
  });
});

describe('condition DSL — one object per operator', () => {
  it('comparators map to eq/ne/lt/lte/gt/gte', () => {
    expect(queryWith({filters: [{field: 'a', operator: '=', type: 'S', value: 'x'}]})).toContain(
      '{ attr: "a", eq: "x" }'
    );
    expect(queryWith({filters: [{field: 'a', operator: '<>', type: 'N', value: '3'}]})).toContain(
      '{ attr: "a", ne: 3 }'
    );
    expect(queryWith({filters: [{field: 'a', operator: '<=', type: 'N', value: '3'}]})).toContain(
      '{ attr: "a", lte: 3 }'
    );
  });

  it('exists / not_exists → { exists: true|false } with no value', () => {
    expect(
      queryWith({filters: [{field: 'a', operator: 'exists', type: 'S', value: ''}]})
    ).toContain('{ attr: "a", exists: true }');
    expect(
      queryWith({filters: [{field: 'a', operator: 'not_exists', type: 'S', value: ''}]})
    ).toContain('{ attr: "a", exists: false }');
  });

  it('contains / begins_with / between', () => {
    expect(
      queryWith({filters: [{field: 'a', operator: 'contains', type: 'S', value: 'z'}]})
    ).toContain('{ attr: "a", contains: "z" }');
    expect(
      queryWith({filters: [{field: 'a', operator: 'begins_with', type: 'S', value: 'z'}]})
    ).toContain('{ attr: "a", beginsWith: "z" }');
    expect(
      queryWith({
        filters: [{field: 'a', operator: 'between', type: 'N', value: '1', value2: '9'}]
      })
    ).toContain('{ attr: "a", between: [1, 9] }');
  });

  it('type_eq → { type }; type_ne degrades to { not: { type } }', () => {
    expect(
      queryWith({filters: [{field: 'a', operator: 'type_eq', type: 'S', value: 'S'}]})
    ).toContain('{ attr: "a", type: "S" }');
    expect(
      queryWith({filters: [{field: 'a', operator: 'type_ne', type: 'S', value: 'S'}]})
    ).toContain('{ not: { attr: "a", type: "S" } }');
  });

  it('size_* → { size: attr, <cmp>: n }', () => {
    expect(
      queryWith({filters: [{field: 'a', operator: 'size_gt', type: 'N', value: '3'}]})
    ).toContain('{ size: "a", gt: 3 }');
    expect(
      queryWith({filters: [{field: 'a', operator: 'size_eq', type: 'N', value: '0'}]})
    ).toContain('{ size: "a", eq: 0 }');
  });
});

describe('range key conditions', () => {
  it('begins_with / between / comparator forms', () => {
    expect(
      queryWith({rangeKey: {field: 'sk', type: 'S', operator: 'begins_with', value: 'A#'}})
    ).toContain('range: { beginsWith: "A#" }');
    expect(
      queryWith({
        rangeKey: {field: 'sk', type: 'N', operator: 'between', value: '1', value2: '9'}
      })
    ).toContain('range: { between: [1, 9] }');
    expect(queryWith({rangeKey: {field: 'sk', type: 'N', operator: '>=', value: '5'}})).toContain(
      'range: { gte: 5 }'
    );
  });
});
