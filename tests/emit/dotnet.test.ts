import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {dotnetClientMethodName, dotnetRequestClassName, emitDotnet} from '../../src/emit/dotnet';
import type {BuilderConfig} from '../../src/types';

describe('emitDotnet — request object initializer per operation', () => {
  it('Query (begins_with range + between filter) → new QueryRequest', () => {
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
    const out = emitDotnet(buildRequest(config));
    expect(out).toContain('new QueryRequest');
    expect(out).toContain('    TableName = "Events",');
    expect(out).toContain(
      '    KeyConditionExpression = "#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)",'
    );
    expect(out).toContain(
      '    FilterExpression = "#filter0 BETWEEN :filterValue0 AND :filterValue0_2",'
    );
    expect(out).toContain('    ExpressionAttributeValues = new Dictionary<string, AttributeValue>');
    expect(out).toContain('        [":hashKeyValue"] = new AttributeValue { S = "TENANT#1" },');
    expect(out).toContain('        [":filterValue0"] = new AttributeValue { N = "18" },');
  });

  it('Scan (contains + exists) → new ScanRequest, name map is Dictionary<string, string>', () => {
    const out = emitDotnet(
      buildRequest({
        operation: 'Scan',
        tableName: 'Users',
        filters: [
          {field: 'name', operator: 'contains', type: 'S', value: 'ann'},
          {field: 'email', operator: 'exists', type: 'S', value: ''}
        ]
      })
    );
    expect(out).toContain('new ScanRequest');
    expect(out).toContain('    ExpressionAttributeNames = new Dictionary<string, string>');
    expect(out).toContain('        ["#filter0"] = "name",');
    expect(out).toContain(
      '    FilterExpression = "contains(#filter0, :filterValue0) AND attribute_exists(#filter1)",'
    );
  });

  it('Update (SET + ADD set) → new UpdateItemRequest with Key + update expression', () => {
    const out = emitDotnet(
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
    expect(out).toContain('new UpdateItemRequest');
    expect(out).toContain('        ["pk"] = new AttributeValue { S = "C#1" },');
    expect(out).toContain(
      '    UpdateExpression = "SET #upd0 = #upd0 + :updValue0 ADD #upd1 :updValue1",'
    );
    expect(out).toContain(
      '        [":updValue1"] = new AttributeValue { NS = new List<string> { "1", "2" } },'
    );
  });

  it('conditional Delete → BOOL false renders explicitly (IsBOOLSet auto-set)', () => {
    const out = emitDotnet(
      buildRequest({
        operation: 'Delete',
        tableName: 'Users',
        key: [{field: 'pk', type: 'S', value: 'U#1'}],
        conditions: [{field: 'locked', operator: '=', type: 'BOOL', value: 'false'}]
      })
    );
    expect(out).toContain('new DeleteItemRequest');
    expect(out).toContain('        [":condValue0"] = new AttributeValue { BOOL = false },');
  });

  it('Put with binary + NULL → MemoryStream base64 decode + NULL = true', () => {
    const out = emitDotnet(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [
          {field: 'blob', type: 'B', value: 'aGVsbG8='},
          {field: 'gone', type: 'NULL', value: ''}
        ]
      })
    );
    expect(out).toContain(
      'new AttributeValue { B = new MemoryStream(Convert.FromBase64String("aGVsbG8=")) },'
    );
    expect(out).toContain('new AttributeValue { NULL = true },');
  });

  it('binary set (BS) → List<MemoryStream> of decoded members', () => {
    const out = emitDotnet(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [{field: 'blobs', type: 'BS', value: '', values: ['YQ==', 'Yg==']}]
      })
    );
    expect(out).toContain(
      'BS = new List<MemoryStream> { new MemoryStream(Convert.FromBase64String("YQ==")), new MemoryStream(Convert.FromBase64String("Yg==")) }'
    );
  });

  it('read options: Limit + ConsistentRead + descending + GSI + ExclusiveStartKey', () => {
    const out = emitDotnet(
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
    expect(out).toContain('    IndexName = "gsi1",');
    expect(out).toContain('    Limit = 25,');
    expect(out).toContain('    ConsistentRead = true,');
    expect(out).toContain('    ScanIndexForward = false,');
    expect(out).toContain('    ExclusiveStartKey = new Dictionary<string, AttributeValue>');
  });

  it('GetItem → new GetItemRequest, Key only', () => {
    const out = emitDotnet(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'S', value: 'U#1'}]
      })
    );
    expect(out).toContain('new GetItemRequest');
    expect(out).toContain('    Key = new Dictionary<string, AttributeValue>');
    expect(out).not.toContain('ExpressionAttributeValues');
  });
});

describe('emitDotnet — tag-driven marshalling + escaping', () => {
  it('the SAME input "5" tagged N vs S → N = "5" vs S = "5"', () => {
    const key = (type: 'N' | 'S') =>
      emitDotnet(
        buildRequest({operation: 'GetItem', tableName: 'T', key: [{field: 'k', type, value: '5'}]})
      );
    expect(key('N')).toContain('new AttributeValue { N = "5" }');
    expect(key('S')).toContain('new AttributeValue { S = "5" }');
  });

  it('a string value with a double quote is escaped (valid C# literal)', () => {
    const out = emitDotnet(
      buildRequest({
        operation: 'Scan',
        tableName: 'T',
        filters: [{field: 'q', operator: '=', type: 'S', value: 'say "hi"'}]
      })
    );
    expect(out).toContain('new AttributeValue { S = "say \\"hi\\"" }');
  });
});

describe('name maps', () => {
  it('dotnetRequestClassName / dotnetClientMethodName cover the operations', () => {
    expect(dotnetRequestClassName('Query')).toBe('QueryRequest');
    expect(dotnetRequestClassName('Update')).toBe('UpdateItemRequest');
    expect(dotnetClientMethodName('Scan')).toBe('ScanAsync');
    expect(dotnetClientMethodName('Put')).toBe('PutItemAsync');
  });
});
