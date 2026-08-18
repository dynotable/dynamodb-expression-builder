import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {buildSdkV3Params, emitSdkV3} from '../../src/emit/sdk-v3';
import type {BuilderConfig} from '../../src/types';

/** Eval the `{...}` argument of a `new XCommand({...})` snippet as a JS value. */
function parseCommandLiteral(code: string): {
  command: string;
  params: Record<string, any>;
} {
  const open = code.indexOf('(');
  const command = code
    .slice(0, open)
    .replace(/^new\s+/, '')
    .trim();
  const literal = code.slice(open + 1, code.lastIndexOf(')'));
  // JSON is a subset of JS object-literal syntax; if a value held an unescaped
  // quote the snippet wouldn't parse and this would throw.
  const params = new Function(`return (${literal})`)() as Record<string, any>;
  return {command, params};
}

describe('emitSdkV3 — command name + parseable literal per operation', () => {
  it('Query (begins_with range + between/contains filters) → QueryCommand, AVs tag-driven', () => {
    const config: BuilderConfig = {
      operation: 'Query',
      tableName: 'Events',
      hashKey: {field: 'pk', type: 'S', value: 'TENANT#1'},
      rangeKey: {
        field: 'sk',
        type: 'S',
        operator: 'begins_with',
        value: 'LOG#'
      },
      filters: [
        {
          field: 'age',
          operator: 'between',
          type: 'N',
          value: '18',
          value2: '65'
        }
      ]
    };
    const {command, params} = parseCommandLiteral(emitSdkV3(buildRequest(config)));
    expect(command).toBe('QueryCommand');
    expect(params.TableName).toBe('Events');
    expect(params.KeyConditionExpression).toBe(
      '#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)'
    );
    expect(params.FilterExpression).toBe('#filter0 BETWEEN :filterValue0 AND :filterValue0_2');
    // every AV built from its tag (S for keys, N for the numeric bounds)
    expect(params.ExpressionAttributeValues).toEqual({
      ':hashKeyValue': {S: 'TENANT#1'},
      ':rangeKeyValue': {S: 'LOG#'},
      ':filterValue0': {N: '18'},
      ':filterValue0_2': {N: '65'}
    });
  });

  it('Scan (contains + exists) → ScanCommand; exists binds no value', () => {
    const {command, params} = parseCommandLiteral(
      emitSdkV3(
        buildRequest({
          operation: 'Scan',
          tableName: 'Users',
          filters: [
            {field: 'name', operator: 'contains', type: 'S', value: 'ann'},
            {field: 'email', operator: 'exists', type: 'S', value: ''}
          ]
        })
      )
    );
    expect(command).toBe('ScanCommand');
    expect(params.FilterExpression).toBe(
      'contains(#filter0, :filterValue0) AND attribute_exists(#filter1)'
    );
    expect(params.ExpressionAttributeValues).toEqual({
      ':filterValue0': {S: 'ann'}
    });
  });

  it('Update (SET-increment + REMOVE + ADD-set + DELETE-set) → UpdateItemCommand', () => {
    const {command, params} = parseCommandLiteral(
      emitSdkV3(
        buildRequest({
          operation: 'Update',
          tableName: 'Counters',
          key: [{field: 'pk', type: 'S', value: 'C#1'}],
          updates: [
            {
              kind: 'SET',
              field: 'views',
              setOp: 'add',
              value: {type: 'N', value: '1'}
            },
            {kind: 'REMOVE', field: 'tmp'},
            {
              kind: 'ADD',
              field: 'tags',
              value: {type: 'NS', value: '', values: ['1', '2']}
            },
            {
              kind: 'DELETE',
              field: 'roles',
              value: {type: 'SS', value: '', values: ['admin']}
            }
          ]
        })
      )
    );
    expect(command).toBe('UpdateItemCommand');
    expect(params.Key).toEqual({pk: {S: 'C#1'}});
    expect(params.UpdateExpression).toBe(
      'SET #upd0 = #upd0 + :updValue0 REMOVE #upd1 ADD #upd2 :updValue2 DELETE #upd3 :updValue3'
    );
    expect(params.ExpressionAttributeValues).toEqual({
      ':updValue0': {N: '1'},
      ':updValue2': {NS: ['1', '2']},
      ':updValue3': {SS: ['admin']}
    });
  });

  it('conditional Delete → DeleteItemCommand with Key + ConditionExpression', () => {
    const {command, params} = parseCommandLiteral(
      emitSdkV3(
        buildRequest({
          operation: 'Delete',
          tableName: 'Users',
          key: [{field: 'pk', type: 'S', value: 'U#1'}],
          conditions: [{field: 'locked', operator: '=', type: 'BOOL', value: 'false'}]
        })
      )
    );
    expect(command).toBe('DeleteItemCommand');
    expect(params.Key).toEqual({pk: {S: 'U#1'}});
    expect(params.ConditionExpression).toBe('#cond0 = :condValue0');
    expect(params.ExpressionAttributeValues).toEqual({
      ':condValue0': {BOOL: false}
    });
  });

  it('GetItem → GetItemCommand, Key only (no expressions/values)', () => {
    const {command, params} = parseCommandLiteral(
      emitSdkV3(
        buildRequest({
          operation: 'GetItem',
          tableName: 'Users',
          key: [{field: 'pk', type: 'S', value: 'U#1'}]
        })
      )
    );
    expect(command).toBe('GetItemCommand');
    expect(params.Key).toEqual({pk: {S: 'U#1'}});
    expect(params.ExpressionAttributeValues).toBeUndefined();
    expect(params.FilterExpression).toBeUndefined();
  });
});

describe('emitSdkV3 / buildSdkV3Params — the tag drives marshalling', () => {
  it('the SAME input "5" tagged N vs S → {N:"5"} vs {S:"5"}', () => {
    const asN = buildSdkV3Params(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'N', value: '5'}]
      })
    );
    const asS = buildSdkV3Params(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'S', value: '5'}]
      })
    );
    expect(asN.Key).toEqual({k: {N: '5'}});
    expect(asS.Key).toEqual({k: {S: '5'}});
  });

  it('B/BOOL/NS/NULL tags → their AttributeValue shapes (B is base64 verbatim)', () => {
    const params = buildSdkV3Params(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [
          {field: 'blob', type: 'B', value: 'aGVsbG8='},
          {field: 'flag', type: 'BOOL', value: 'true'},
          {field: 'nums', type: 'NS', value: '', values: ['1', '2']},
          {field: 'gone', type: 'NULL', value: ''}
        ]
      })
    );
    expect(params.Item).toEqual({
      blob: {B: 'aGVsbG8='},
      flag: {BOOL: true},
      nums: {NS: ['1', '2']},
      gone: {NULL: true}
    });
  });

  it('B/BS render as runnable Uint8Array expressions (low-level client needs bytes, not base64)', () => {
    const code = emitSdkV3(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [
          {field: 'blob', type: 'B', value: 'aGVsbG8='}, // "hello"
          {field: 'blobs', type: 'BS', value: '', values: ['YQ==']} // "a"
        ]
      })
    );
    // base64, NOT a Uint8Array, would be silently wrong on the wire
    expect(code).toContain('Uint8Array.from(atob("aGVsbG8="), (c) => c.charCodeAt(0))');
    // and the rendered expression actually evals to the right bytes
    const {params} = parseCommandLiteral(code);
    expect(Array.from(params.Item.blob.B as Uint8Array)).toEqual([104, 101, 108, 108, 111]);
    expect(Array.from(params.Item.blobs.BS[0] as Uint8Array)).toEqual([97]);
  });

  it('a value with a quote stays parseable (no unescaped " breaks the literal)', () => {
    const {params} = parseCommandLiteral(
      emitSdkV3(
        buildRequest({
          operation: 'Scan',
          tableName: 'T',
          filters: [{field: 'q', operator: '=', type: 'S', value: 'say "hi"'}]
        })
      )
    );
    expect(params.ExpressionAttributeValues[':filterValue0']).toEqual({
      S: 'say "hi"'
    });
  });
});
