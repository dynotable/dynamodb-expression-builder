import {describe, expect, it} from 'vitest';
import {emitQueryProgram} from '../src/program';
import type {QueryToolConfig} from '../src/program';

// The query-builder program emitters: the differentiator vs the expression
// tool is that the output is a RUNNABLE program (imports + client init + send
// + optional LastEvaluatedKey loop), not the bare command literal.

const QUERY: QueryToolConfig = {
  operation: 'Query',
  tableName: 'Orders',
  hashKey: {field: 'pk', type: 'S', value: 'USER#1'},
  rangeKey: {field: 'sk', type: 'S', operator: 'begins_with', value: 'ORDER#'},
  limit: 25
};

function code(config: QueryToolConfig, format: Parameters<typeof emitQueryProgram>[1]): string {
  const result = emitQueryProgram(config, format);
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.code;
}

describe('emitQueryProgram — SDK v3', () => {
  it('single request: import + client + await send + Items log', () => {
    const out = code(QUERY, 'sdk');
    expect(out).toContain(
      'import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";'
    );
    expect(out).toContain('const client = new DynamoDBClient({});');
    expect(out).toContain('await client.send(');
    expect(out).toContain('new QueryCommand(');
    expect(out).toContain('"Limit": 25');
    expect(out).toContain('console.log(response.Items);');
    expect(out).not.toContain('do {'); // no loop unless paginate
  });

  it('paginate: do/while loop on LastEvaluatedKey, params without ExclusiveStartKey', () => {
    const out = code({...QUERY, paginate: true}, 'sdk');
    expect(out).toContain('const params = {');
    expect(out).toContain('let lastEvaluatedKey;');
    expect(out).toContain('do {');
    expect(out).toContain('new QueryCommand({ ...params, ExclusiveStartKey: lastEvaluatedKey })');
    expect(out).toContain('} while (lastEvaluatedKey);');
    expect(out).toContain('items.push(...(page.Items ?? []));');
    // The loop owns the key — the params literal must not carry one.
    expect(out).not.toContain('"ExclusiveStartKey":');
  });

  it('paginate + manual resume point seeds the loop variable', () => {
    const out = code(
      {...QUERY, paginate: true, exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]},
      'sdk'
    );
    expect(out).toContain('let lastEvaluatedKey = {');
    expect(out).toContain('"S": "USER#1"');
    expect(out).not.toContain('"ExclusiveStartKey":');
  });

  it('Scan uses ScanCommand', () => {
    const out = code({operation: 'Scan', tableName: 'Orders'}, 'sdk');
    expect(out).toContain('new ScanCommand(');
    expect(out).toContain('ScanCommand } from "@aws-sdk/client-dynamodb"');
  });
});

describe('emitQueryProgram — CLI', () => {
  it('single request opts out of auto-pagination with --no-paginate', () => {
    const out = code(QUERY, 'cli');
    expect(out).toContain('aws dynamodb query');
    expect(out.trimEnd().endsWith('--no-paginate')).toBe(true);
  });

  it('paginate keeps the CLI default and says so in a comment', () => {
    const out = code({...QUERY, paginate: true}, 'cli');
    expect(out.split('\n')[0]).toContain('auto-paginates');
    expect(out).not.toContain('--no-paginate');
  });
});

describe('emitQueryProgram — boto3', () => {
  it('single request: params dict + **params call + Items print', () => {
    const out = code(QUERY, 'boto3');
    expect(out).toContain('import boto3');
    expect(out).toContain('params = {');
    expect(out).toContain('"Limit": 25,');
    expect(out).toContain('response = client.query(**params)');
    expect(out).toContain('print(response["Items"])');
    expect(out).not.toContain('while True:');
  });

  it('paginate: while-loop follows LastEvaluatedKey through the same dict', () => {
    const out = code({...QUERY, paginate: true}, 'boto3');
    expect(out).toContain('while True:');
    expect(out).toContain('items.extend(response["Items"])');
    expect(out).toContain('if "LastEvaluatedKey" not in response:');
    expect(out).toContain('params["ExclusiveStartKey"] = response["LastEvaluatedKey"]');
  });

  it('a manual resume point rides in the params dict', () => {
    const out = code(
      {...QUERY, paginate: true, exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]},
      'boto3'
    );
    expect(out).toContain('"ExclusiveStartKey": {"pk": {"S": "USER#1"}},');
  });
});

describe('emitQueryProgram — PartiQL', () => {
  it('emits the statement when expressible (no Limit set)', () => {
    const result = emitQueryProgram({...QUERY, limit: undefined}, 'partiql');
    expect(result).toEqual({ok: true, code: expect.stringContaining('SELECT *')});
  });

  it('degrades honestly on the API-parameter knobs', () => {
    const result = emitQueryProgram(QUERY, 'partiql'); // has limit: 25
    expect(result).toEqual({ok: false, reason: expect.stringContaining('Limit')});
  });
});

describe('emitQueryProgram — Java (AWS SDK for Java v2)', () => {
  it('single request: imports + client + request builder + send', () => {
    const out = code(QUERY, 'java');
    expect(out).toContain('import software.amazon.awssdk.services.dynamodb.DynamoDbClient;');
    expect(out).toContain('import software.amazon.awssdk.services.dynamodb.model.QueryRequest;');
    expect(out).toContain('import software.amazon.awssdk.services.dynamodb.model.QueryResponse;');
    expect(out).toContain('DynamoDbClient client = DynamoDbClient.create();');
    expect(out).toContain('QueryRequest request = QueryRequest.builder()');
    expect(out).toContain('.limit(25)');
    expect(out).toContain('QueryResponse response = client.query(request);');
    expect(out).toContain('System.out.println(response.items());');
    expect(out).not.toContain('do {');
  });

  it('paginate: do/while on lastEvaluatedKey, loop owns .exclusiveStartKey', () => {
    const out = code({...QUERY, paginate: true}, 'java');
    expect(out).toContain('import java.util.ArrayList;');
    expect(out).toContain('List<Map<String, AttributeValue>> items = new ArrayList<>();');
    expect(out).toContain('Map<String, AttributeValue> lastEvaluatedKey = null;');
    expect(out).toContain('.exclusiveStartKey(lastEvaluatedKey)');
    expect(out).toContain(
      'lastEvaluatedKey = response.hasLastEvaluatedKey() ? response.lastEvaluatedKey() : null;'
    );
    expect(out).toContain('} while (lastEvaluatedKey != null);');
  });

  it('paginate + manual resume point seeds the loop variable, request carries no start key', () => {
    const out = code(
      {...QUERY, paginate: true, exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]},
      'java'
    );
    expect(out).toContain('Map<String, AttributeValue> lastEvaluatedKey = Map.ofEntries(');
    // exactly one .exclusiveStartKey — the loop's, not the request's own
    expect(out.match(/\.exclusiveStartKey\(/g)).toHaveLength(1);
    expect(out).toContain('.exclusiveStartKey(lastEvaluatedKey)');
  });

  it('Scan uses ScanRequest/ScanResponse + client.scan', () => {
    const out = code({operation: 'Scan', tableName: 'Orders'}, 'java');
    expect(out).toContain('ScanRequest request = ScanRequest.builder()');
    expect(out).toContain('ScanResponse response = client.scan(request);');
  });
});

describe('emitQueryProgram — Go (aws-sdk-go-v2)', () => {
  it('single request: package main + config load + client + typed input + send', () => {
    const out = code(QUERY, 'go');
    expect(out).toContain('package main');
    expect(out).toContain('"github.com/aws/aws-sdk-go-v2/config"');
    expect(out).toContain('"github.com/aws/aws-sdk-go-v2/service/dynamodb"');
    expect(out).toContain('"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"');
    expect(out).toContain('cfg, err := config.LoadDefaultConfig(context.TODO())');
    expect(out).toContain('client := dynamodb.NewFromConfig(cfg)');
    expect(out).toContain('input := &dynamodb.QueryInput{');
    expect(out).toContain('Limit: aws.Int32(25),');
    expect(out).toContain('response, err := client.Query(context.TODO(), input)');
    expect(out).toContain('fmt.Println(response.Items)');
    expect(out).not.toContain('Paginator');
  });

  it('paginate: native NewQueryPaginator loop', () => {
    const out = code({...QUERY, paginate: true}, 'go');
    expect(out).toContain('paginator := dynamodb.NewQueryPaginator(client, input)');
    expect(out).toContain('for paginator.HasMorePages() {');
    expect(out).toContain('page, err := paginator.NextPage(context.TODO())');
    expect(out).toContain('items = append(items, page.Items...)');
  });

  it('paginate Scan uses NewScanPaginator; resume point rides in the input', () => {
    const out = code(
      {
        operation: 'Scan',
        tableName: 'Orders',
        paginate: true,
        exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]
      },
      'go'
    );
    expect(out).toContain('paginator := dynamodb.NewScanPaginator(client, input)');
    expect(out).toContain('ExclusiveStartKey: map[string]types.AttributeValue{');
  });
});

describe('emitQueryProgram — .NET (AWSSDK.DynamoDBv2)', () => {
  it('single request: usings + client + object initializer + await send', () => {
    const out = code(QUERY, 'dotnet');
    expect(out).toContain('using Amazon.DynamoDBv2;');
    expect(out).toContain('using Amazon.DynamoDBv2.Model;');
    expect(out).toContain('var client = new AmazonDynamoDBClient();');
    expect(out).toContain('var request = new QueryRequest');
    expect(out).toContain('    Limit = 25,');
    expect(out).toContain('var response = await client.QueryAsync(request);');
    expect(out).not.toContain('do');
  });

  it('paginate: do/while on LastEvaluatedKey.Count, loop owns ExclusiveStartKey', () => {
    const out = code({...QUERY, paginate: true}, 'dotnet');
    expect(out).toContain('var items = new List<Dictionary<string, AttributeValue>>();');
    expect(out).toContain('Dictionary<string, AttributeValue> lastEvaluatedKey = null;');
    expect(out).toContain('    request.ExclusiveStartKey = lastEvaluatedKey;');
    expect(out).toContain('} while (lastEvaluatedKey != null && lastEvaluatedKey.Count > 0);');
    // The rendered request literal must not carry its own ExclusiveStartKey.
    expect(out).not.toContain('    ExclusiveStartKey = new Dictionary');
  });

  it('paginate + manual resume point seeds the loop variable', () => {
    const out = code(
      {...QUERY, paginate: true, exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]},
      'dotnet'
    );
    expect(out).toContain(
      'Dictionary<string, AttributeValue> lastEvaluatedKey = new Dictionary<string, AttributeValue>'
    );
    expect(out).toContain('["pk"] = new AttributeValue { S = "USER#1" },');
  });

  it('Scan uses ScanRequest + ScanAsync', () => {
    const out = code({operation: 'Scan', tableName: 'Orders'}, 'dotnet');
    expect(out).toContain('var request = new ScanRequest');
    expect(out).toContain('await client.ScanAsync(request);');
  });
});

describe('emitQueryProgram — dynamodb-toolbox (v2)', () => {
  it('single request: schema-first Table + build(QueryCommand).query().options().send()', () => {
    const out = code(QUERY, 'ddbtoolbox');
    expect(out).toContain('import { Table } from "dynamodb-toolbox/table";');
    expect(out).toContain("import { QueryCommand } from 'dynamodb-toolbox/table/actions/query';");
    expect(out).toContain(
      'const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));'
    );
    // base-table Query knows its real key schema
    expect(out).toContain('const table = new Table({');
    expect(out).toContain('  name: "Orders",');
    expect(out).toContain('  partitionKey: { name: "pk", type: \'string\' },');
    expect(out).toContain('  sortKey: { name: "sk", type: \'string\' },');
    // the fluent build → query → options → send chain
    expect(out).toContain('.build(QueryCommand)');
    expect(out).toContain('.query({ partition: "USER#1", range: { beginsWith: "ORDER#" } })');
    expect(out).toContain('.options({ limit: 25 })');
    expect(out).toContain('.send();');
    expect(out).toContain('console.log(response.Items);');
    expect(out).not.toContain('do {'); // no loop unless paginate
  });

  it('paginate: do/while owns exclusiveStartKey, seeded undefined', () => {
    const out = code({...QUERY, paginate: true}, 'ddbtoolbox');
    expect(out).toContain('let exclusiveStartKey;');
    expect(out).toContain('do {');
    expect(out).toContain('.options({ limit: 25, exclusiveStartKey })');
    expect(out).toContain('items.push(...(response.Items ?? []));');
    expect(out).toContain('exclusiveStartKey = response.LastEvaluatedKey;');
    expect(out).toContain('} while (exclusiveStartKey);');
  });

  it('paginate + manual resume point seeds the loop variable natively', () => {
    const out = code(
      {...QUERY, paginate: true, exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]},
      'ddbtoolbox'
    );
    expect(out).toContain('let exclusiveStartKey = { "pk": "USER#1" };');
  });

  it('Scan uses ScanCommand with no .query(), stamps a placeholder key + TODO', () => {
    const out = code({operation: 'Scan', tableName: 'Orders'}, 'ddbtoolbox');
    expect(out).toContain("import { ScanCommand } from 'dynamodb-toolbox/table/actions/scan';");
    expect(out).toContain('.build(ScanCommand)');
    expect(out).not.toContain('.query(');
    // Scan doesn't know the table's key schema from the request alone
    expect(out).toContain("partitionKey: { name: 'PK', type: 'string' }");
    expect(out).toContain('// TODO');
  });

  it('GSI query declares the index + placeholder base key (request key is the GSI)', () => {
    const out = code(
      {
        operation: 'Query',
        tableName: 'Orders',
        indexName: 'gsi1',
        hashKey: {field: 'gsiPk', type: 'S', value: 'STATUS#OPEN'}
      },
      'ddbtoolbox'
    );
    expect(out).toContain('indexes: {');
    expect(out).toContain('"gsi1": {');
    expect(out).toContain("type: 'global',");
    expect(out).toContain('index: "gsi1"');
    // the base PK is unknown, so it's a placeholder
    expect(out).toContain("partitionKey: { name: 'PK', type: 'string' }");
  });

  it('Scan emits the REAL base key schema (not the placeholder) when baseKeySchema is supplied', () => {
    const out = code(
      {
        operation: 'Scan',
        tableName: 'Orders',
        baseKeySchema: {hashKey: {field: 'pk', type: 'S'}, rangeKey: {field: 'sk', type: 'N'}}
      },
      'ddbtoolbox'
    );
    expect(out).toContain('.build(ScanCommand)');
    expect(out).toContain('  partitionKey: { name: "pk", type: \'string\' },');
    expect(out).toContain('  sortKey: { name: "sk", type: \'number\' },');
    expect(out).not.toContain('// TODO');
    expect(out).not.toContain("name: 'PK'");
  });

  it('GSI query emits the real base key schema for the table AND the GSI keys in indexes', () => {
    const out = code(
      {
        operation: 'Query',
        tableName: 'Orders',
        indexName: 'gsi1',
        hashKey: {field: 'gsiPk', type: 'S', value: 'STATUS#OPEN'},
        baseKeySchema: {hashKey: {field: 'pk', type: 'S'}, rangeKey: {field: 'sk', type: 'S'}}
      },
      'ddbtoolbox'
    );
    // Base table carries its real schema, not the placeholder…
    expect(out).toContain('  partitionKey: { name: "pk", type: \'string\' },');
    expect(out).toContain('  sortKey: { name: "sk", type: \'string\' },');
    expect(out).not.toContain('// TODO');
    // …and the GSI block still carries the index key.
    expect(out).toContain('"gsi1": {');
    expect(out).toContain('partitionKey: { name: "gsiPk", type: \'string\' },');
    expect(out).toContain('index: "gsi1"');
  });

  it('values are NATIVE (bare number, real Set) and filters use the condition DSL', () => {
    const out = code(
      {
        operation: 'Query',
        tableName: 'Orders',
        hashKey: {field: 'pk', type: 'S', value: 'USER#1'},
        filters: [
          {field: 'age', operator: '>=', type: 'N', value: '18'},
          {field: 'name', operator: 'begins_with', type: 'S', value: 'A'},
          {field: 'role', operator: 'in', type: 'S', value: '', values: ['admin', 'user']}
        ]
      },
      'ddbtoolbox'
    );
    // N renders as a bare number literal, not a string
    expect(out).toContain('{ attr: "age", gte: 18 }');
    expect(out).toContain('{ attr: "name", beginsWith: "A" }');
    expect(out).toContain('{ attr: "role", in: ["admin", "user"] }');
    // several filters compose under `and`
    expect(out).toContain('and: [');
  });

  it('descending + consistent + projection map to reverse/consistent/attributes', () => {
    const out = code(
      {
        operation: 'Query',
        tableName: 'Orders',
        hashKey: {field: 'pk', type: 'S', value: 'USER#1'},
        scanIndexForward: false,
        consistentRead: true,
        projection: ['id', 'total']
      },
      'ddbtoolbox'
    );
    expect(out).toContain('reverse: true');
    expect(out).toContain('consistent: true');
    expect(out).toContain('attributes: ["id", "total"]');
  });
});

describe('emitQueryProgram — guards', () => {
  it('rejects non-read operations (programmer error, fail loud)', () => {
    expect(() => emitQueryProgram({operation: 'Update', tableName: 'Orders'}, 'sdk')).toThrow(
      'Query and Scan'
    );
  });

  it('propagates buildRequest errors (Query without a hash key)', () => {
    expect(() => emitQueryProgram({operation: 'Query', tableName: 'Orders'}, 'sdk')).toThrow(
      'Query requires a hash key'
    );
  });
});
