import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {emitDocClient} from '../../src/emit/docclient';
import {emitKotlin, renderKotlinAv} from '../../src/emit/kotlin';
import {emitPhp, renderPhpAv} from '../../src/emit/php';
import {emitRuby, renderRubyValue} from '../../src/emit/ruby';
import {emitQueryProgram} from '../../src/program';
import type {QueryProgramFormat} from '../../src/program';
import type {BuilderConfig} from '../../src/types';

const QUERY: BuilderConfig = {
  operation: 'Query',
  tableName: 'orders',
  hashKey: {field: 'customerId', type: 'S', value: 'CUST#42'},
  rangeKey: {field: 'orderDate', type: 'S', operator: 'begins_with', value: '2026-08'},
  filters: [{field: 'total', type: 'N', operator: '>', value: '100'}]
};

describe('emitDocClient — native values, identical expressions', () => {
  it('Query → QueryCommand with native ExpressionAttributeValues', () => {
    const out = emitDocClient(buildRequest(QUERY));
    expect(out).toContain('new QueryCommand({');
    expect(out).toContain(
      '  KeyConditionExpression: "#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)",'
    );
    // native values: bare number for N, plain string for S — no {S:}/{N:} tags
    expect(out).toContain('":filterValue0": 100,');
    expect(out).toContain('":hashKeyValue": "CUST#42",');
    expect(out).not.toContain('{"S":');
  });

  it('sets render as real Set, GetItem key stays native', () => {
    const out = emitDocClient(
      buildRequest({
        operation: 'Put',
        tableName: 'users',
        item: [
          {field: 'pk', type: 'S', value: 'U#1'},
          {field: 'roles', type: 'SS', value: '', values: ['admin', 'owner']}
        ]
      })
    );
    expect(out).toContain('new PutCommand({');
    expect(out).toContain('"roles": new Set(["admin", "owner"]),');
  });
});

describe('emitPhp — wire-shaped array literals', () => {
  it('Query → $client->query([...]) with nested AV arrays', () => {
    const out = emitPhp(buildRequest(QUERY));
    expect(out).toContain('$response = $client->query([');
    expect(out).toContain(
      "    'KeyConditionExpression' => '#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)',"
    );
    expect(out).toContain("        ':hashKeyValue' => ['S' => 'CUST#42'],");
    expect(out).toContain("        ':filterValue0' => ['N' => '100'],");
  });

  it('renders every wire variant incl. binary via base64_decode', () => {
    expect(renderPhpAv({S: "o'brien"})).toBe("['S' => 'o\\'brien']");
    expect(renderPhpAv({BOOL: false})).toBe("['BOOL' => false]");
    expect(renderPhpAv({NULL: true})).toBe("['NULL' => true]");
    expect(renderPhpAv({B: 'AQI='})).toBe("['B' => base64_decode('AQI=')]");
    expect(renderPhpAv({NS: ['1', '2']})).toBe("['NS' => ['1', '2']]");
  });
});

describe('emitRuby — native values, snake_case params', () => {
  it('Query → client.query(...) with plain values', () => {
    const out = emitRuby(buildRequest(QUERY));
    expect(out).toContain('response = client.query({');
    expect(out).toContain(
      "  key_condition_expression: '#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)',"
    );
    expect(out).toContain("    ':hashKeyValue' => 'CUST#42',");
    expect(out).toContain("    ':filterValue0' => 100,");
  });

  it('renders sets, nil and binary natively', () => {
    expect(renderRubyValue({type: 'SS', value: '', values: ['a']})).toBe("Set.new(['a'])");
    expect(renderRubyValue({type: 'NS', value: '', values: ['1', '2']})).toBe('Set.new([1, 2])');
    expect(renderRubyValue({type: 'NULL', value: ''})).toBe('nil');
    expect(renderRubyValue({type: 'B', value: 'AQI='})).toBe("Base64.decode64('AQI=')");
  });
});

describe('emitKotlin — DSL builder + sealed AttributeValue', () => {
  it('Query → client.query { ... } with AttributeValue constructors', () => {
    const out = emitKotlin(buildRequest(QUERY));
    expect(out).toContain('val response = client.query {');
    expect(out).toContain(
      '    keyConditionExpression = "#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)"'
    );
    expect(out).toContain('":hashKeyValue" to AttributeValue.S("CUST#42"),');
    expect(out).toContain('":filterValue0" to AttributeValue.N("100"),');
    expect(out.trimEnd().endsWith('}')).toBe(true);
  });

  it('escapes $ (string templates) and renders binary as byteArrayOf', () => {
    expect(renderKotlinAv({S: 'a$b'})).toBe('AttributeValue.S("a\\$b")');
    expect(renderKotlinAv({B: 'AQI='})).toBe('AttributeValue.B(byteArrayOf(0x01, 0x02))');
    expect(renderKotlinAv({SS: ['x']})).toBe('AttributeValue.Ss(listOf("x"))');
    expect(renderKotlinAv({NULL: true})).toBe('AttributeValue.Null(true)');
  });
});

describe('emitQueryProgram — the four new formats, one-shot and paginated', () => {
  const cases: Array<{format: QueryProgramFormat; oneShot: string[]; paginated: string[]}> = [
    {
      format: 'docclient',
      oneShot: ['DynamoDBDocumentClient.from(new DynamoDBClient({}));', 'await client.send('],
      paginated: ['paginateQuery(', 'for await (const page of paginator) {']
    },
    {
      format: 'kotlin',
      oneShot: ['suspend fun main() {', 'DynamoDbClient.fromEnvironment().use { client ->'],
      paginated: ['client.queryPaginated {', '.collect { item -> println(item) }']
    },
    {
      format: 'php',
      oneShot: ['<?php', 'new DynamoDbClient(', '$response = $client->query(['],
      paginated: ["$pages = $client->getPaginator('Query', [", 'foreach ($pages as $page) {']
    },
    {
      format: 'ruby',
      oneShot: ["require 'aws-sdk-dynamodb'", 'response = client.query({'],
      paginated: ['response.each do |page|', 'puts page.items']
    }
  ];

  for (const c of cases) {
    it(`${c.format}: one-shot program has client setup + call`, () => {
      const result = emitQueryProgram(QUERY, c.format);
      expect(result.ok).toBe(true);
      const code = result.ok ? result.code : '';
      for (const needle of c.oneShot) expect(code).toContain(needle);
    });

    it(`${c.format}: paginated program follows LastEvaluatedKey`, () => {
      const result = emitQueryProgram({...QUERY, paginate: true}, c.format);
      expect(result.ok).toBe(true);
      const code = result.ok ? result.code : '';
      for (const needle of c.paginated) expect(code).toContain(needle);
    });
  }

  it('docclient Scan paginates with paginateScan', () => {
    const result = emitQueryProgram({operation: 'Scan', tableName: 'orders', paginate: true}, 'docclient');
    expect(result.ok).toBe(true);
    expect(result.ok ? result.code : '').toContain('paginateScan(');
  });

  it('ruby program requires set/base64 only when the request uses them', () => {
    const plain = emitQueryProgram(QUERY, 'ruby');
    expect(plain.ok && plain.code).not.toContain("require 'set'");
    const withSet = emitQueryProgram(
      {
        operation: 'Scan',
        tableName: 'users',
        filters: [{field: 'roles', type: 'SS', operator: '=', value: '', values: ['admin']}]
      },
      'ruby'
    );
    expect(withSet.ok && withSet.code).toContain("require 'set'");
  });
});
