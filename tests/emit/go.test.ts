import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {emitGo, goClientMethodName, goInputTypeName, goUsesTypes} from '../../src/emit/go';
import type {BuilderConfig} from '../../src/types';

describe('emitGo — input composite literal per operation', () => {
  it('Query (begins_with range + between filter) → &dynamodb.QueryInput', () => {
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
    const out = emitGo(buildRequest(config));
    expect(out).toContain('&dynamodb.QueryInput{');
    expect(out).toContain('\tTableName: aws.String("Events"),');
    expect(out).toContain(
      '\tKeyConditionExpression: aws.String("#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)"),'
    );
    expect(out).toContain(
      '\tFilterExpression: aws.String("#filter0 BETWEEN :filterValue0 AND :filterValue0_2"),'
    );
    expect(out).toContain('\tExpressionAttributeValues: map[string]types.AttributeValue{');
    expect(out).toContain('\t\t":hashKeyValue": &types.AttributeValueMemberS{Value: "TENANT#1"},');
    expect(out).toContain('\t\t":filterValue0": &types.AttributeValueMemberN{Value: "18"},');
    expect(out.trimEnd().endsWith('}')).toBe(true);
  });

  it('Scan (contains + exists) → &dynamodb.ScanInput, name map is map[string]string', () => {
    const out = emitGo(
      buildRequest({
        operation: 'Scan',
        tableName: 'Users',
        filters: [
          {field: 'name', operator: 'contains', type: 'S', value: 'ann'},
          {field: 'email', operator: 'exists', type: 'S', value: ''}
        ]
      })
    );
    expect(out).toContain('&dynamodb.ScanInput{');
    expect(out).toContain('\tExpressionAttributeNames: map[string]string{');
    expect(out).toContain('\t\t"#filter0": "name",');
    expect(out).toContain(
      '\tFilterExpression: aws.String("contains(#filter0, :filterValue0) AND attribute_exists(#filter1)"),'
    );
  });

  it('Update (SET + DELETE set) → &dynamodb.UpdateItemInput with Key + sets', () => {
    const out = emitGo(
      buildRequest({
        operation: 'Update',
        tableName: 'Counters',
        key: [{field: 'pk', type: 'S', value: 'C#1'}],
        updates: [
          {kind: 'SET', field: 'views', setOp: 'add', value: {type: 'N', value: '1'}},
          {kind: 'DELETE', field: 'roles', value: {type: 'SS', value: '', values: ['admin']}}
        ]
      })
    );
    expect(out).toContain('&dynamodb.UpdateItemInput{');
    expect(out).toContain('\t\t"pk": &types.AttributeValueMemberS{Value: "C#1"},');
    expect(out).toContain(
      '\tUpdateExpression: aws.String("SET #upd0 = #upd0 + :updValue0 DELETE #upd1 :updValue1"),'
    );
    expect(out).toContain(
      '\t\t":updValue1": &types.AttributeValueMemberSS{Value: []string{"admin"}},'
    );
  });

  it('conditional Delete → BOOL false renders Value: false', () => {
    const out = emitGo(
      buildRequest({
        operation: 'Delete',
        tableName: 'Users',
        key: [{field: 'pk', type: 'S', value: 'U#1'}],
        conditions: [{field: 'locked', operator: '=', type: 'BOOL', value: 'false'}]
      })
    );
    expect(out).toContain('&dynamodb.DeleteItemInput{');
    expect(out).toContain('\t\t":condValue0": &types.AttributeValueMemberBOOL{Value: false},');
  });

  it('Put with binary + NULL → emit-time-decoded []byte literal + NULL member', () => {
    const out = emitGo(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [
          {field: 'blob', type: 'B', value: 'aGVsbG8='}, // "hello"
          {field: 'gone', type: 'NULL', value: ''}
        ]
      })
    );
    expect(out).toContain(
      '&types.AttributeValueMemberB{Value: []byte{0x68, 0x65, 0x6c, 0x6c, 0x6f}},'
    );
    expect(out).toContain('&types.AttributeValueMemberNULL{Value: true},');
  });

  it('binary set (BS) → [][]byte of decoded members', () => {
    const out = emitGo(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [{field: 'blobs', type: 'BS', value: '', values: ['YQ==', 'Yg==']}]
      })
    );
    expect(out).toContain(
      '&types.AttributeValueMemberBS{Value: [][]byte{[]byte{0x61}, []byte{0x62}}},'
    );
  });

  it('invalid base64 in a B value fails loud at emit time', () => {
    expect(() =>
      emitGo(
        buildRequest({
          operation: 'Put',
          tableName: 'T',
          item: [{field: 'blob', type: 'B', value: '!!!not-base64!!!'}]
        })
      )
    ).toThrow(/invalid base64/);
  });

  it('read options: Limit + ConsistentRead + descending + GSI + ExclusiveStartKey', () => {
    const out = emitGo(
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
    expect(out).toContain('\tIndexName: aws.String("gsi1"),');
    expect(out).toContain('\tLimit: aws.Int32(25),');
    expect(out).toContain('\tConsistentRead: aws.Bool(true),');
    expect(out).toContain('\tScanIndexForward: aws.Bool(false),');
    expect(out).toContain('\tExclusiveStartKey: map[string]types.AttributeValue{');
  });
});

describe('emitGo — tag-driven marshalling + escaping', () => {
  it('the SAME input "5" tagged N vs S → MemberN vs MemberS', () => {
    const key = (type: 'N' | 'S') =>
      emitGo(
        buildRequest({operation: 'GetItem', tableName: 'T', key: [{field: 'k', type, value: '5'}]})
      );
    expect(key('N')).toContain('&types.AttributeValueMemberN{Value: "5"}');
    expect(key('S')).toContain('&types.AttributeValueMemberS{Value: "5"}');
  });

  it('a string value with a double quote is escaped (valid Go literal)', () => {
    const out = emitGo(
      buildRequest({
        operation: 'Scan',
        tableName: 'T',
        filters: [{field: 'q', operator: '=', type: 'S', value: 'say "hi"'}]
      })
    );
    expect(out).toContain('&types.AttributeValueMemberS{Value: "say \\"hi\\""}');
  });
});

describe('helpers', () => {
  it('goInputTypeName / goClientMethodName cover the operations', () => {
    expect(goInputTypeName('Query')).toBe('QueryInput');
    expect(goInputTypeName('Update')).toBe('UpdateItemInput');
    expect(goClientMethodName('Scan')).toBe('Scan');
    expect(goClientMethodName('GetItem')).toBe('GetItem');
  });

  it('goUsesTypes is true only when an AV map is present', () => {
    expect(
      goUsesTypes(
        buildRequest({
          operation: 'Scan',
          tableName: 'T',
          filters: [{field: 'a', operator: 'exists', type: 'S', value: ''}]
        })
      )
    ).toBe(false);
    expect(
      goUsesTypes(
        buildRequest({
          operation: 'GetItem',
          tableName: 'T',
          key: [{field: 'k', type: 'S', value: 'x'}]
        })
      )
    ).toBe(true);
  });
});
