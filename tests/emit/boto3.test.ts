import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {emitBoto3} from '../../src/emit/boto3';
import type {BuilderConfig} from '../../src/types';

describe('emitBoto3 — low-level client method + kwargs per operation', () => {
  it('Query (begins_with range + between filter) → client.query', () => {
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
    const out = emitBoto3(buildRequest(config));
    expect(out).toContain('import boto3');
    expect(out).toContain('client = boto3.client("dynamodb")');
    expect(out).toContain('response = client.query(');
    expect(out).toContain('    TableName="Events",');
    expect(out).toContain(
      '    KeyConditionExpression="#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)",'
    );
    expect(out).toContain(
      '    FilterExpression="#filter0 BETWEEN :filterValue0 AND :filterValue0_2",'
    );
    // AVs are tag-driven Python dicts
    expect(out).toContain(
      '    ExpressionAttributeValues={":hashKeyValue": {"S": "TENANT#1"}, ":rangeKeyValue": {"S": "LOG#"}, ":filterValue0": {"N": "18"}, ":filterValue0_2": {"N": "65"}},'
    );
  });

  it('Scan (contains + exists) → client.scan, exists binds no value', () => {
    const out = emitBoto3(
      buildRequest({
        operation: 'Scan',
        tableName: 'Users',
        filters: [
          {field: 'name', operator: 'contains', type: 'S', value: 'ann'},
          {field: 'email', operator: 'exists', type: 'S', value: ''}
        ]
      })
    );
    expect(out).toContain('response = client.scan(');
    expect(out).toContain(
      '    FilterExpression="contains(#filter0, :filterValue0) AND attribute_exists(#filter1)",'
    );
    expect(out).toContain('    ExpressionAttributeValues={":filterValue0": {"S": "ann"}},');
  });

  it('Update (SET-increment + REMOVE + ADD-set + DELETE-set) → client.update_item', () => {
    const out = emitBoto3(
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
    );
    expect(out).toContain('response = client.update_item(');
    expect(out).toContain('    Key={"pk": {"S": "C#1"}},');
    expect(out).toContain(
      '    UpdateExpression="SET #upd0 = #upd0 + :updValue0 REMOVE #upd1 ADD #upd2 :updValue2 DELETE #upd3 :updValue3",'
    );
    expect(out).toContain(
      '    ExpressionAttributeValues={":updValue0": {"N": "1"}, ":updValue2": {"NS": ["1", "2"]}, ":updValue3": {"SS": ["admin"]}},'
    );
  });

  it('conditional Delete → client.delete_item with Key + ConditionExpression; BOOL → False', () => {
    const out = emitBoto3(
      buildRequest({
        operation: 'Delete',
        tableName: 'Users',
        key: [{field: 'pk', type: 'S', value: 'U#1'}],
        conditions: [{field: 'locked', operator: '=', type: 'BOOL', value: 'false'}]
      })
    );
    expect(out).toContain('response = client.delete_item(');
    expect(out).toContain('    Key={"pk": {"S": "U#1"}},');
    expect(out).toContain('    ConditionExpression="#cond0 = :condValue0",');
    expect(out).toContain('    ExpressionAttributeValues={":condValue0": {"BOOL": False}},');
  });

  it('GetItem → client.get_item, Key only', () => {
    const out = emitBoto3(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'S', value: 'U#1'}]
      })
    );
    expect(out).toContain('response = client.get_item(');
    expect(out).toContain('    TableName="T",');
    expect(out).toContain('    Key={"k": {"S": "U#1"}},');
    expect(out).not.toContain('ExpressionAttributeValues');
  });

  it('Put → client.put_item with a tag-driven Item (BOOL True, NULL, B as base64-decoded bytes)', () => {
    const out = emitBoto3(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [
          {field: 'blob', type: 'B', value: 'aGVsbG8='},
          {field: 'flag', type: 'BOOL', value: 'true'},
          {field: 'gone', type: 'NULL', value: ''}
        ]
      })
    );
    expect(out).toContain('response = client.put_item(');
    // the low-level client wants bytes for `B`, not a base64 str → b64decode + import
    expect(out).toContain('import base64');
    expect(out).toContain(
      '    Item={"blob": {"B": base64.b64decode("aGVsbG8=")}, "flag": {"BOOL": True}, "gone": {"NULL": True}},'
    );
  });

  it('binary set (BS) → each member base64-decoded inside the {"BS": [...]} wrapper', () => {
    const out = emitBoto3(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [{field: 'blobs', type: 'BS', value: '', values: ['YQ==', 'Yg==']}]
      })
    );
    expect(out).toContain('import base64');
    expect(out).toContain(
      '    Item={"blobs": {"BS": [base64.b64decode("YQ=="), base64.b64decode("Yg==")]}},'
    );
  });

  it('no `import base64` when the request carries no binary value', () => {
    const out = emitBoto3(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'S', value: 'U#1'}]
      })
    );
    expect(out).not.toContain('import base64');
  });
});

describe('emitBoto3 — the tag drives marshalling', () => {
  it('the SAME input "5" tagged N vs S → {"N": "5"} vs {"S": "5"}', () => {
    const n = emitBoto3(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'N', value: '5'}]
      })
    );
    const s = emitBoto3(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'S', value: '5'}]
      })
    );
    expect(n).toContain('    Key={"k": {"N": "5"}},');
    expect(s).toContain('    Key={"k": {"S": "5"}},');
  });

  it('a string value with a double quote is escaped (valid Python literal)', () => {
    const out = emitBoto3(
      buildRequest({
        operation: 'Scan',
        tableName: 'T',
        filters: [{field: 'q', operator: '=', type: 'S', value: 'say "hi"'}]
      })
    );
    expect(out).toContain(
      '    ExpressionAttributeValues={":filterValue0": {"S": "say \\"hi\\""}},'
    );
  });
});
