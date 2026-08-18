import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {emitCli} from '../../src/emit/cli';
import type {BuilderConfig} from '../../src/types';

describe('emitCli — subcommand + flags per operation', () => {
  it('Query (begins_with range + between filter) → query with both expressions', () => {
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
    const out = emitCli(buildRequest(config));
    expect(out).toContain('aws dynamodb query');
    expect(out).toContain(
      `--key-condition-expression '#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)'`
    );
    expect(out).toContain(
      `--filter-expression '#filter0 BETWEEN :filterValue0 AND :filterValue0_2'`
    );
    expect(out).toContain(
      `--expression-attribute-values '{":hashKeyValue":{"S":"TENANT#1"},":rangeKeyValue":{"S":"LOG#"},":filterValue0":{"N":"18"},":filterValue0_2":{"N":"65"}}'`
    );
    // every line but the first is continued with a trailing backslash
    const lines = out.split('\n');
    expect(lines[0]).toBe('aws dynamodb query \\');
    expect(lines.at(-1)?.endsWith('\\')).toBe(false);
  });

  it('Scan (contains + exists) → exists binds no value', () => {
    const out = emitCli(
      buildRequest({
        operation: 'Scan',
        tableName: 'Users',
        filters: [
          {field: 'name', operator: 'contains', type: 'S', value: 'ann'},
          {field: 'email', operator: 'exists', type: 'S', value: ''}
        ]
      })
    );
    expect(out).toContain('aws dynamodb scan');
    expect(out).toContain(
      `--filter-expression 'contains(#filter0, :filterValue0) AND attribute_exists(#filter1)'`
    );
    expect(out).toContain(`--expression-attribute-values '{":filterValue0":{"S":"ann"}}'`);
  });

  it('Update (SET-increment + REMOVE + ADD-set + DELETE-set) → update-item', () => {
    const out = emitCli(
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
    expect(out).toContain('aws dynamodb update-item');
    expect(out).toContain(`--key '{"pk":{"S":"C#1"}}'`);
    expect(out).toContain(
      `--update-expression 'SET #upd0 = #upd0 + :updValue0 REMOVE #upd1 ADD #upd2 :updValue2 DELETE #upd3 :updValue3'`
    );
    expect(out).toContain(
      `--expression-attribute-values '{":updValue0":{"N":"1"},":updValue2":{"NS":["1","2"]},":updValue3":{"SS":["admin"]}}'`
    );
  });

  it('conditional Delete → delete-item with --key + --condition-expression', () => {
    const out = emitCli(
      buildRequest({
        operation: 'Delete',
        tableName: 'Users',
        key: [{field: 'pk', type: 'S', value: 'U#1'}],
        conditions: [{field: 'locked', operator: '=', type: 'BOOL', value: 'false'}]
      })
    );
    expect(out).toContain('aws dynamodb delete-item');
    expect(out).toContain(`--key '{"pk":{"S":"U#1"}}'`);
    expect(out).toContain(`--condition-expression '#cond0 = :condValue0'`);
    expect(out).toContain(`--expression-attribute-values '{":condValue0":{"BOOL":false}}'`);
  });

  it('GetItem → get-item, --key only', () => {
    const out = emitCli(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'S', value: 'U#1'}]
      })
    );
    expect(out).toBe(
      `aws dynamodb get-item \\\n  --table-name 'T' \\\n  --key '{"k":{"S":"U#1"}}'`
    );
  });
});

describe('emitCli — the tag drives marshalling', () => {
  it('the SAME input "5" tagged N vs S → {"N":"5"} vs {"S":"5"}', () => {
    const n = emitCli(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'N', value: '5'}]
      })
    );
    const s = emitCli(
      buildRequest({
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'k', type: 'S', value: '5'}]
      })
    );
    expect(n).toContain(`--key '{"k":{"N":"5"}}'`);
    expect(s).toContain(`--key '{"k":{"S":"5"}}'`);
  });

  it('B tag → {"B":"<base64>"} (the base64 string verbatim, not {"S"})', () => {
    const out = emitCli(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [{field: 'blob', type: 'B', value: 'aGVsbG8='}]
      })
    );
    expect(out).toContain(`--item '{"blob":{"B":"aGVsbG8="}}'`);
  });

  it('NULL tag → {"NULL":true}', () => {
    const out = emitCli(
      buildRequest({
        operation: 'Put',
        tableName: 'T',
        item: [{field: 'gone', type: 'NULL', value: ''}]
      })
    );
    expect(out).toContain(`--item '{"gone":{"NULL":true}}'`);
  });
});

describe('emitCli — shell safety', () => {
  it('a value with a single quote and a space is single-quote-escaped (`\\x27\\\\\\x27\\x27`)', () => {
    const out = emitCli(
      buildRequest({
        operation: 'Scan',
        tableName: 'T',
        filters: [{field: 'name', operator: '=', type: 'S', value: "O'Brien me"}]
      })
    );
    // the inner `'` becomes the POSIX `'\''` sequence; the arg stays one token
    expect(out).toContain(
      `--expression-attribute-values '{":filterValue0":{"S":"O'\\''Brien me"}}'`
    );
  });

  it('a table name with a quote is escaped too', () => {
    const out = emitCli(buildRequest({operation: 'Scan', tableName: "Bob's"}));
    expect(out).toContain(`--table-name 'Bob'\\''s'`);
  });
});
