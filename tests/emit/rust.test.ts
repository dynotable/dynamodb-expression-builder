import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {emitRust, renderRustAv, rustClientMethodName} from '../../src/emit/rust';
import {emitQueryProgram} from '../../src/program';
import type {BuilderConfig} from '../../src/types';

describe('emitRust — fluent builder chain per operation', () => {
  it('Query (begins_with range + filter) → client.query() chain', () => {
    const config: BuilderConfig = {
      operation: 'Query',
      tableName: 'Events',
      hashKey: {field: 'pk', type: 'S', value: 'TENANT#1'},
      rangeKey: {field: 'sk', type: 'S', operator: 'begins_with', value: 'LOG#'},
      filters: [{field: 'age', operator: 'between', type: 'N', value: '18', value2: '65'}]
    };
    const out = emitRust(buildRequest(config));
    expect(out).toContain('let response = client');
    expect(out).toContain('    .query()');
    expect(out).toContain('    .table_name("Events")');
    expect(out).toContain(
      '    .key_condition_expression("#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)")'
    );
    expect(out).toContain(
      '    .filter_expression("#filter0 BETWEEN :filterValue0 AND :filterValue0_2")'
    );
    expect(out).toContain('    .expression_attribute_names("#hashKey", "pk")');
    expect(out).toContain(
      '    .expression_attribute_values(":hashKeyValue", AttributeValue::S("TENANT#1".to_string()))'
    );
    expect(out).toContain(
      '    .expression_attribute_values(":filterValue0", AttributeValue::N("18".to_string()))'
    );
    expect(out.endsWith('    .send()\n    .await?;')).toBe(true);
  });

  it('GetItem → one .key(name, av) call per key attribute', () => {
    const out = emitRust(
      buildRequest({
        operation: 'GetItem',
        tableName: 'orders',
        key: [
          {field: 'pk', type: 'S', value: 'USER#1'},
          {field: 'sk', type: 'N', value: '42'}
        ]
      })
    );
    expect(out).toContain('    .get_item()');
    expect(out).toContain('    .key("pk", AttributeValue::S("USER#1".to_string()))');
    expect(out).toContain('    .key("sk", AttributeValue::N("42".to_string()))');
  });

  it('Update → update_expression + per-entry values', () => {
    const out = emitRust(
      buildRequest({
        operation: 'Update',
        tableName: 'users',
        key: [{field: 'pk', type: 'S', value: 'USER#1'}],
        updates: [
          {kind: 'SET', field: 'status', setOp: 'assign', value: {type: 'S', value: 'active'}}
        ]
      })
    );
    expect(out).toContain('    .update_item()');
    expect(out).toContain('    .update_expression("SET #upd0 = :updValue0")');
    expect(out).toContain(
      '    .expression_attribute_values(":updValue0", AttributeValue::S("active".to_string()))'
    );
  });

  it('read options carry through (limit / consistent_read / scan_index_forward / ESK)', () => {
    const out = emitRust(
      buildRequest({
        operation: 'Query',
        tableName: 'orders',
        hashKey: {field: 'pk', type: 'S', value: 'USER#1'},
        limit: 25,
        consistentRead: true,
        scanIndexForward: false,
        exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]
      })
    );
    expect(out).toContain('    .limit(25)');
    expect(out).toContain('    .consistent_read(true)');
    expect(out).toContain('    .scan_index_forward(false)');
    expect(out).toContain('    .exclusive_start_key("pk", AttributeValue::S("USER#1".to_string()))');
  });
});

describe('renderRustAv — the eight wire variants', () => {
  it('renders scalars, sets and binary', () => {
    expect(renderRustAv({S: 'a'})).toBe('AttributeValue::S("a".to_string())');
    expect(renderRustAv({N: '1.5'})).toBe('AttributeValue::N("1.5".to_string())');
    expect(renderRustAv({BOOL: true})).toBe('AttributeValue::Bool(true)');
    expect(renderRustAv({NULL: true})).toBe('AttributeValue::Null(true)');
    expect(renderRustAv({SS: ['a', 'b']})).toBe(
      'AttributeValue::Ss(vec!["a".to_string(), "b".to_string()])'
    );
    expect(renderRustAv({NS: ['1']})).toBe('AttributeValue::Ns(vec!["1".to_string()])');
    // "AQI=" is base64 for 0x01 0x02
    expect(renderRustAv({B: 'AQI='})).toBe('AttributeValue::B(Blob::new(vec![0x01, 0x02]))');
    expect(renderRustAv({BS: ['AQI=']})).toBe(
      'AttributeValue::Bs(vec![Blob::new(vec![0x01, 0x02])])'
    );
  });

  it('escapes JSON-only escapes into valid Rust', () => {
    // \f and \b are not Rust escapes; \uXXXX must be \u{XXXX}
    expect(renderRustAv({S: 'a\fb\bc'})).toBe(
      'AttributeValue::S("a\\u{000c}b\\u{0008}c".to_string())'
    );
  });

  it('fails loud on invalid base64 rather than emitting broken Rust', () => {
    expect(() => renderRustAv({B: '!!not-base64!!'})).toThrow(/invalid base64/);
  });
});

describe('rustClientMethodName', () => {
  it('maps every operation to its snake_case client method', () => {
    expect(rustClientMethodName('GetItem')).toBe('get_item');
    expect(rustClientMethodName('Query')).toBe('query');
    expect(rustClientMethodName('Scan')).toBe('scan');
    expect(rustClientMethodName('Update')).toBe('update_item');
    expect(rustClientMethodName('Put')).toBe('put_item');
    expect(rustClientMethodName('Delete')).toBe('delete_item');
  });
});

describe("emitQueryProgram — 'rust' format", () => {
  const QUERY: BuilderConfig = {
    operation: 'Query',
    tableName: 'orders',
    hashKey: {field: 'pk', type: 'S', value: 'USER#1'}
  };

  it('one-shot program: tokio main + send().await?', () => {
    const result = emitQueryProgram(QUERY, 'rust');
    expect(result.ok).toBe(true);
    const code = result.ok ? result.code : '';
    expect(code).toContain('use aws_sdk_dynamodb::Client;');
    expect(code).toContain('use aws_sdk_dynamodb::types::AttributeValue;');
    expect(code).toContain('#[tokio::main]');
    expect(code).toContain('async fn main() -> Result<(), aws_sdk_dynamodb::Error> {');
    expect(code).toContain('        .send()');
    expect(code).toContain('    println!("{:?}", response.items());');
    expect(code).toContain('    Ok(())');
    // No binary in this request — no Blob import.
    expect(code).not.toContain('Blob');
  });

  it('paginated program: into_paginator().items() stream', () => {
    const result = emitQueryProgram({...QUERY, paginate: true}, 'rust');
    expect(result.ok).toBe(true);
    const code = result.ok ? result.code : '';
    expect(code).toContain('        .into_paginator()');
    expect(code).toContain('        .items()');
    expect(code).toContain('    while let Some(item) = items.next().await {');
    expect(code).not.toContain('.await?;');
  });

  it('Scan without values imports no AttributeValue', () => {
    const result = emitQueryProgram({operation: 'Scan', tableName: 'orders'}, 'rust');
    expect(result.ok).toBe(true);
    const code = result.ok ? result.code : '';
    expect(code).toContain('        .scan()');
    expect(code).not.toContain('use aws_sdk_dynamodb::types::AttributeValue;');
  });
});
