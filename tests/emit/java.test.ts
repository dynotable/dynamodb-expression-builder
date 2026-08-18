import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {emitJava, javaClientMethodName, javaRequestClassName} from '../../src/emit/java';
import type {BuilderConfig} from '../../src/types';

describe('emitJava — request builder per operation', () => {
  it('Query (begins_with range + between filter) → QueryRequest.builder()', () => {
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
    const out = emitJava(buildRequest(config));
    expect(out).toContain('QueryRequest.builder()');
    expect(out).toContain('    .tableName("Events")');
    expect(out).toContain(
      '    .keyConditionExpression("#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)")'
    );
    expect(out).toContain(
      '    .filterExpression("#filter0 BETWEEN :filterValue0 AND :filterValue0_2")'
    );
    // typed AVs render as builder chains inside Map.ofEntries
    expect(out).toContain(
      '        Map.entry(":hashKeyValue", AttributeValue.builder().s("TENANT#1").build()),'
    );
    expect(out).toContain(
      '        Map.entry(":filterValue0", AttributeValue.builder().n("18").build()),'
    );
    expect(out.trimEnd().endsWith('.build()')).toBe(true);
  });

  it('Scan (contains + exists) → ScanRequest, exists binds no value', () => {
    const out = emitJava(
      buildRequest({
        operation: 'Scan',
        tableName: 'Users',
        filters: [
          {field: 'name', operator: 'contains', type: 'S', value: 'ann'},
          {field: 'email', operator: 'exists', type: 'S', value: ''}
        ]
      })
    );
    expect(out).toContain('ScanRequest.builder()');
    expect(out).toContain(
      '    .filterExpression("contains(#filter0, :filterValue0) AND attribute_exists(#filter1)")'
    );
    expect(out).toContain(
      '        Map.entry(":filterValue0", AttributeValue.builder().s("ann").build())'
    );
    expect(out).not.toContain(':filterValue1');
  });

  it('Update (SET + ADD set) → UpdateItemRequest with Key + update expression', () => {
    const out = emitJava(
      buildRequest({
        operation: 'Update',
        tableName: 'Counters',
        key: [{field: 'pk', type: 'S', value: 'C#1'}],
        updates: [
          {kind: 'SET', field: 'views', setOp: 'add', value: {type: 'N', value: '1'}},
          {kind: 'ADD', field: 'tags', value: {type: 'NS', value: '', values: ['1', '2']}}
        ]
      })
    );
    expect(out).toContain('UpdateItemRequest.builder()');
    expect(out).toContain('Map.entry("pk", AttributeValue.builder().s("C#1").build())');
    expect(out).toContain(
      '    .updateExpression("SET #upd0 = #upd0 + :updValue0 ADD #upd1 :updValue1")'
    );
    expect(out).toContain('Map.entry(":updValue1", AttributeValue.builder().ns("1", "2").build())');
  });

  it('conditional Delete → DeleteItemRequest; BOOL false renders .bool(false)', () => {
    const out = emitJava(
      buildRequest({
        operation: 'Delete',
        tableName: 'Users',
        key: [{field: 'pk', type: 'S', value: 'U#1'}],
        conditions: [{field: 'locked', operator: '=', type: 'BOOL', value: 'false'}]
      })
    );
    expect(out).toContain('DeleteItemRequest.builder()');
    expect(out).toContain('    .conditionExpression("#cond0 = :condValue0")');
    expect(out).toContain('Map.entry(":condValue0", AttributeValue.builder().bool(false).build())');
  });

  it('Put with binary + NULL → SdkBytes base64 decode + .nul(true)', () => {
    const out = emitJava(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [
          {field: 'blob', type: 'B', value: 'aGVsbG8='},
          {field: 'gone', type: 'NULL', value: ''}
        ]
      })
    );
    expect(out).toContain('PutItemRequest.builder()');
    expect(out).toContain(
      'AttributeValue.builder().b(SdkBytes.fromByteArray(Base64.getDecoder().decode("aGVsbG8="))).build()'
    );
    expect(out).toContain('AttributeValue.builder().nul(true).build()');
  });

  it('binary set (BS) → each member decoded to SdkBytes', () => {
    const out = emitJava(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [{field: 'blobs', type: 'BS', value: '', values: ['YQ==', 'Yg==']}]
      })
    );
    expect(out).toContain(
      '.bs(SdkBytes.fromByteArray(Base64.getDecoder().decode("YQ==")), SdkBytes.fromByteArray(Base64.getDecoder().decode("Yg==")))'
    );
  });

  it('read options: Limit + ConsistentRead + descending + GSI + ExclusiveStartKey', () => {
    const out = emitJava(
      buildRequest({
        operation: 'Query',
        tableName: 'Events',
        indexName: 'gsi1',
        hashKey: {field: 'pk', type: 'S', value: 'A'},
        limit: 25,
        consistentRead: true,
        scanIndexForward: false,
        exclusiveStartKey: [{field: 'pk', type: 'S', value: 'A'}]
      })
    );
    expect(out).toContain('    .indexName("gsi1")');
    expect(out).toContain('    .limit(25)');
    expect(out).toContain('    .consistentRead(true)');
    expect(out).toContain('    .scanIndexForward(false)');
    expect(out).toContain('    .exclusiveStartKey(Map.ofEntries(');
  });

  it('GetItem → GetItemRequest, Key only', () => {
    const out = emitJava(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'S', value: 'U#1'}]
      })
    );
    expect(out).toContain('GetItemRequest.builder()');
    expect(out).toContain('    .key(Map.ofEntries(');
    expect(out).not.toContain('expressionAttributeValues');
  });
});

describe('emitJava — the tag drives marshalling; strings escape as Java literals', () => {
  it('the SAME input "5" tagged N vs S → .n("5") vs .s("5")', () => {
    const key = (type: 'N' | 'S') =>
      emitJava(
        buildRequest({operation: 'GetItem', tableName: 'T', key: [{field: 'k', type, value: '5'}]})
      );
    expect(key('N')).toContain('AttributeValue.builder().n("5").build()');
    expect(key('S')).toContain('AttributeValue.builder().s("5").build()');
  });

  it('a string value with a double quote is escaped (valid Java literal)', () => {
    const out = emitJava(
      buildRequest({
        operation: 'Scan',
        tableName: 'T',
        filters: [{field: 'q', operator: '=', type: 'S', value: 'say "hi"'}]
      })
    );
    expect(out).toContain('AttributeValue.builder().s("say \\"hi\\"").build()');
  });
});

describe('name maps', () => {
  it('javaRequestClassName / javaClientMethodName cover every operation', () => {
    expect(javaRequestClassName('Query')).toBe('QueryRequest');
    expect(javaRequestClassName('Update')).toBe('UpdateItemRequest');
    expect(javaClientMethodName('Scan')).toBe('scan');
    expect(javaClientMethodName('Put')).toBe('putItem');
  });
});
