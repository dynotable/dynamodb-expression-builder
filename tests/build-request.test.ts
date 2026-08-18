import {describe, expect, it} from 'vitest';
import {buildRequest} from '../src/build-request';
import type {BuilderConfig} from '../src/types';

describe('buildRequest — per-operation canonical output', () => {
  it('GetItem → typed Key map only, no expressions/values/projection', () => {
    const config: BuilderConfig = {
      operation: 'GetItem',
      tableName: 'Users',
      key: [
        {field: 'pk', type: 'S', value: 'USER#1'},
        {field: 'sk', type: 'N', value: '5'}
      ]
    };
    const r = buildRequest(config);
    expect(r.key).toEqual({
      pk: {type: 'S', value: 'USER#1'},
      sk: {type: 'N', value: '5'}
    });
    expect(r.keyConditionExpression).toBeUndefined();
    expect(r.filterExpression).toBeUndefined();
    expect(r.names).toBeUndefined();
    expect(r.typedValues).toBeUndefined();
    expect(r.config).toBe(config);
  });

  it('GetItem with projection → `#`-aliased ProjectionExpression', () => {
    const r = buildRequest({
      operation: 'GetItem',
      tableName: 'Users',
      key: [{field: 'pk', type: 'S', value: 'USER#1'}],
      projection: ['name', 'status']
    });
    expect(r.projectionExpression).toBe('#proj0, #proj1');
    expect(r.names).toEqual({'#proj0': 'name', '#proj1': 'status'});
    // projection has no values → ExpressionAttributeValues omitted
    expect(r.typedValues).toBeUndefined();
  });

  it('Query → KeyConditionExpression with hash + range + key values', () => {
    const r = buildRequest({
      operation: 'Query',
      tableName: 'Events',
      hashKey: {field: 'pk', type: 'S', value: 'TENANT#1'},
      rangeKey: {
        field: 'ts',
        type: 'N',
        operator: 'between',
        value: '100',
        value2: '200'
      }
    });
    expect(r.keyConditionExpression).toBe(
      '#hashKey = :hashKeyValue AND #rangeKey BETWEEN :rangeKeyValue AND :rangeKeyValue2'
    );
    expect(r.names).toEqual({'#hashKey': 'pk', '#rangeKey': 'ts'});
    expect(r.typedValues).toEqual({
      ':hashKeyValue': {type: 'S', value: 'TENANT#1'},
      ':rangeKeyValue': {type: 'N', value: '100'},
      ':rangeKeyValue2': {type: 'N', value: '200'}
    });
    expect(r.filterExpression).toBeUndefined();
  });

  it('Scan → FilterExpression only, no key', () => {
    const r = buildRequest({
      operation: 'Scan',
      tableName: 'Users',
      filters: [
        {field: 'age', operator: '>', type: 'N', value: '18'},
        {field: 'active', operator: '=', type: 'BOOL', value: 'true'}
      ]
    });
    expect(r.filterExpression).toBe('#filter0 > :filterValue0 AND #filter1 = :filterValue1');
    expect(r.names).toEqual({'#filter0': 'age', '#filter1': 'active'});
    expect(r.typedValues).toEqual({
      ':filterValue0': {type: 'N', value: '18'},
      ':filterValue1': {type: 'BOOL', value: 'true'}
    });
    expect(r.keyConditionExpression).toBeUndefined();
    expect(r.key).toBeUndefined();
  });

  it('Update → Key map + UpdateExpression + ConditionExpression', () => {
    const r = buildRequest({
      operation: 'Update',
      tableName: 'Counters',
      key: [{field: 'pk', type: 'S', value: 'C#1'}],
      updates: [
        {
          kind: 'SET',
          field: 'views',
          setOp: 'add',
          value: {type: 'N', value: '1'}
        }
      ],
      conditions: [{field: 'version', operator: '=', type: 'N', value: '7'}]
    });
    expect(r.key).toEqual({pk: {type: 'S', value: 'C#1'}});
    expect(r.updateExpression).toBe('SET #upd0 = #upd0 + :updValue0');
    expect(r.conditionExpression).toBe('#cond0 = :condValue0');
    expect(r.names).toEqual({'#upd0': 'views', '#cond0': 'version'});
    expect(r.typedValues).toEqual({
      ':updValue0': {type: 'N', value: '1'},
      ':condValue0': {type: 'N', value: '7'}
    });
  });

  it('Put → typed item map + ConditionExpression', () => {
    const r = buildRequest({
      operation: 'Put',
      tableName: 'Users',
      item: [
        {field: 'pk', type: 'S', value: 'USER#9'},
        {field: 'tags', type: 'SS', value: '', values: ['a', 'b']}
      ],
      conditions: [{field: 'pk', operator: 'not_exists', type: 'S', value: ''}]
    });
    expect(r.item).toEqual({
      pk: {type: 'S', value: 'USER#9'},
      tags: {type: 'SS', value: '', values: ['a', 'b']}
    });
    expect(r.conditionExpression).toBe('attribute_not_exists(#cond0)');
  });

  it('Delete → Key map + ConditionExpression', () => {
    const r = buildRequest({
      operation: 'Delete',
      tableName: 'Users',
      key: [{field: 'pk', type: 'S', value: 'USER#1'}],
      conditions: [{field: 'locked', operator: '=', type: 'BOOL', value: 'false'}]
    });
    expect(r.key).toEqual({pk: {type: 'S', value: 'USER#1'}});
    expect(r.conditionExpression).toBe('#cond0 = :condValue0');
    expect(r.typedValues).toEqual({
      ':condValue0': {type: 'BOOL', value: 'false'}
    });
  });
});

describe('buildRequest — placeholder distinctness (collision regression)', () => {
  // No single DynamoDB op carries both a FilterExpression and a ConditionExpression,
  // but every merged map must keep cross-predicate placeholders distinct. These two
  // paths together exercise all five prefixes (hashKey/range, filter, cond, upd).

  it('Query keeps key-condition AND filter placeholders distinct', () => {
    const r = buildRequest({
      operation: 'Query',
      tableName: 'Events',
      hashKey: {field: 'pk', type: 'S', value: 'T#1'},
      rangeKey: {field: 'ts', type: 'N', operator: '>', value: '100'},
      filters: [{field: 'kind', operator: '=', type: 'S', value: 'click'}]
    });
    expect(r.keyConditionExpression).toBe(
      '#hashKey = :hashKeyValue AND #rangeKey > :rangeKeyValue'
    );
    expect(r.filterExpression).toBe('#filter0 = :filterValue0');
    // every placeholder key is unique across the merged maps
    expect(Object.keys(r.typedValues!).sort()).toEqual([
      ':filterValue0',
      ':hashKeyValue',
      ':rangeKeyValue'
    ]);
    expect(Object.keys(r.names!).sort()).toEqual(['#filter0', '#hashKey', '#rangeKey']);
  });

  it('Update keeps update AND condition placeholders distinct (IN on both sides too)', () => {
    const r = buildRequest({
      operation: 'Update',
      tableName: 'T',
      key: [{field: 'pk', type: 'S', value: 'X'}],
      updates: [
        {
          kind: 'SET',
          field: 'status',
          setOp: 'assign',
          value: {type: 'S', value: 'done'}
        }
      ],
      conditions: [
        {
          field: 'role',
          operator: 'in',
          type: 'S',
          value: '',
          values: ['admin', 'owner']
        }
      ]
    });
    expect(r.updateExpression).toBe('SET #upd0 = :updValue0');
    expect(r.conditionExpression).toBe('#cond0 IN (:condValue0_0, :condValue0_1)');
    expect(Object.keys(r.typedValues!).sort()).toEqual([
      ':condValue0_0',
      ':condValue0_1',
      ':updValue0'
    ]);
  });
});

describe('buildRequest — empty-map omission', () => {
  it('exists-only conditional Put omits ExpressionAttributeValues', () => {
    const r = buildRequest({
      operation: 'Put',
      tableName: 'Users',
      item: [{field: 'pk', type: 'S', value: 'USER#1'}],
      conditions: [{field: 'pk', operator: 'not_exists', type: 'S', value: ''}]
    });
    expect(r.conditionExpression).toBe('attribute_not_exists(#cond0)');
    expect(r.names).toEqual({'#cond0': 'pk'});
    // attribute_not_exists binds no value → no ExpressionAttributeValues
    expect(r.typedValues).toBeUndefined();
  });

  it('a no-filter Scan omits every expression/name/value map', () => {
    const r = buildRequest({operation: 'Scan', tableName: 'Users'});
    expect(r.filterExpression).toBeUndefined();
    expect(r.names).toBeUndefined();
    expect(r.typedValues).toBeUndefined();
    expect(r.key).toBeUndefined();
  });
});

describe('buildRequest — fail loud', () => {
  it('throws when a Query has no hash key', () => {
    expect(() => buildRequest({operation: 'Query', tableName: 'T'})).toThrow(/hash key/);
  });

  it('throws on an empty set value (DynamoDB rejects {SS:[]})', () => {
    // A user who picks a set type (SS/NS/BS) but leaves the members blank would
    // otherwise get a snippet emitting `{"SS":[]}`, which fails at runtime.
    expect(() =>
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [
          {field: 'pk', type: 'S', value: 'U#1'},
          {field: 'tags', type: 'SS', value: '', values: []}
        ]
      })
    ).toThrow(/at least one member/);
  });
});
