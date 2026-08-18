// Query/Scan program emitters — request → a complete runnable program.
//
// SCOPE SPLIT vs the bare emitters (deliberate):
// the expression tool emits the bare command LITERAL (`new QueryCommand({...})`)
// for all six operations — its subject is expression syntax. THIS module's
// subject is the complete Query/Scan REQUEST: it composes the same
// `CanonicalRequest` through the shared `buildRequest` seam, then wraps the
// existing emitters into a RUNNABLE program — imports + client init + send +
// (optionally) the LastEvaluatedKey pagination loop — the shape a developer
// pastes into a file and runs. No emitter logic is duplicated: params rendering
// is delegated to the exported sdk-v3/boto3 literal renderers, the CLI command
// comes from `emitCli` verbatim, and PartiQL reuses `emitPartiql`'s honest
// degradation.

import {buildRequest} from './build-request';
import {emitCli} from './emit/cli';
import {emitPartiql} from './emit/partiql';
import {boto3MethodName, renderPyValue} from './emit/boto3';
import {buildSdkV3Params, renderJsValue, sdkV3CommandName} from './emit/sdk-v3';
import {hasBinaryValue} from './emit/marshal';
import {
  javaClientMethodName,
  javaRequestClassName,
  renderJavaAvMap,
  renderJavaRequestBuilder
} from './emit/java';
import {
  goClientMethodName,
  goInputTypeName,
  goUsesTypes,
  renderGoInput
} from './emit/go';
import {dotnetClientMethodName, renderCsAvMap, renderCsRequest} from './emit/dotnet';
import {emitDdbToolboxProgram} from './emit/ddbtoolbox';
import {renderRustBuilder, rustUsesAttributeValue, rustUsesBlob} from './emit/rust';
import {docClientCommandName, renderDocClientParams} from './emit/docclient';
import {kotlinClientMethodName, renderKotlinBuilder} from './emit/kotlin';
import {phpClientMethodName, renderPhpParams} from './emit/php';
import {renderRubyParams, rubyClientMethodName} from './emit/ruby';
import type {BuilderConfig, CanonicalRequest} from './types';

/**
 * The query tool's whole state: a Query/Scan {@link BuilderConfig} plus the one
 * PROGRAM-level knob the request itself doesn't carry — whether the emitted
 * code loops on `LastEvaluatedKey` to fetch every page.
 */
export interface QueryToolConfig extends BuilderConfig {
  /** Emit the fetch-all-pages pagination loop (default: single request). */
  paginate?: boolean;
}

export type QueryProgramFormat =
  | 'sdk'
  | 'docclient'
  | 'cli'
  | 'boto3'
  | 'partiql'
  | 'java'
  | 'go'
  | 'dotnet'
  | 'rust'
  | 'kotlin'
  | 'php'
  | 'ruby'
  | 'ddbtoolbox';

/** A runnable program, or an honest reason the format can't express it. */
export type ProgramResult = {ok: true; code: string} | {ok: false; reason: string};

/**
 * Emit the runnable program for a Query/Scan config in the given format.
 * Throws on a non-read operation (the widget never produces one — programmer
 * error, mirroring `buildRequest`'s fail-loud posture) and propagates
 * `buildRequest`'s build errors (e.g. a Query without a hash key) for the
 * caller to surface as a note.
 */
export function emitQueryProgram(
  config: QueryToolConfig,
  format: QueryProgramFormat
): ProgramResult {
  if (config.operation !== 'Query' && config.operation !== 'Scan') {
    throw new Error('the query builder emits Query and Scan programs only');
  }
  const request = buildRequest(config);
  switch (format) {
    case 'sdk':
      return {ok: true, code: emitSdkProgram(request, config.paginate === true)};
    case 'cli':
      return {ok: true, code: emitCliProgram(request, config.paginate === true)};
    case 'boto3':
      return {ok: true, code: emitBoto3Program(request, config.paginate === true)};
    case 'partiql': {
      const result = emitPartiql(request);
      return result.ok ? {ok: true, code: result.statement} : result;
    }
    case 'java':
      return {ok: true, code: emitJavaProgram(request, config.paginate === true)};
    case 'go':
      return {ok: true, code: emitGoProgram(request, config.paginate === true)};
    case 'dotnet':
      return {ok: true, code: emitDotnetProgram(request, config.paginate === true)};
    case 'rust':
      return {ok: true, code: emitRustProgram(request, config.paginate === true)};
    case 'docclient':
      return {ok: true, code: emitDocClientProgram(request, config.paginate === true)};
    case 'kotlin':
      return {ok: true, code: emitKotlinProgram(request, config.paginate === true)};
    case 'php':
      return {ok: true, code: emitPhpProgram(request, config.paginate === true)};
    case 'ruby':
      return {ok: true, code: emitRubyProgram(request, config.paginate === true)};
    case 'ddbtoolbox':
      return {ok: true, code: emitDdbToolboxProgram(request, config.paginate === true)};
  }
}

// ── AWS SDK v3 ──────────────────────────────────────────────────────────────

function emitSdkProgram(request: CanonicalRequest, paginate: boolean): string {
  const command = sdkV3CommandName(request.operation);
  const header = [
    `import { DynamoDBClient, ${command} } from "@aws-sdk/client-dynamodb";`,
    '',
    'const client = new DynamoDBClient({});',
    ''
  ];

  if (!paginate) {
    const params = renderJsValue(buildSdkV3Params(request), 1);
    return [
      ...header,
      'const response = await client.send(',
      `  new ${command}(${params})`,
      ');',
      '',
      'console.log(response.Items);'
    ].join('\n');
  }

  // The loop owns ExclusiveStartKey: it starts from the manual resume point
  // (when one was configured) and follows LastEvaluatedKey until exhausted, so
  // the rendered params object must NOT carry its own ExclusiveStartKey.
  const {ExclusiveStartKey: startKey, ...params} = buildSdkV3Params(request);
  const seed = startKey === undefined ? ';' : ` = ${renderJsValue(startKey)};`;
  return [
    ...header,
    `const params = ${renderJsValue(params)};`,
    '',
    'const items = [];',
    `let lastEvaluatedKey${seed}`,
    'do {',
    '  const page = await client.send(',
    `    new ${command}({ ...params, ExclusiveStartKey: lastEvaluatedKey })`,
    '  );',
    '  items.push(...(page.Items ?? []));',
    '  lastEvaluatedKey = page.LastEvaluatedKey;',
    '} while (lastEvaluatedKey);',
    '',
    'console.log(items);'
  ].join('\n');
}

// ── AWS CLI ─────────────────────────────────────────────────────────────────

function emitCliProgram(request: CanonicalRequest, paginate: boolean): string {
  const command = emitCli(request);
  if (paginate) {
    // Fetch-all is the CLI's DEFAULT: it follows LastEvaluatedKey itself and
    // merges the pages, so the loop the SDK programs spell out is implicit.
    return [
      '# The AWS CLI auto-paginates: it follows LastEvaluatedKey and merges all pages.',
      command
    ].join('\n');
  }
  // A single request means opting OUT of the CLI's auto-pagination.
  return `${command} \\\n  --no-paginate`;
}

// ── boto3 ───────────────────────────────────────────────────────────────────

function emitBoto3Program(request: CanonicalRequest, paginate: boolean): string {
  const method = boto3MethodName(request.operation);
  const params = buildSdkV3Params(request);
  const imports = hasBinaryValue(request) ? ['import base64', 'import boto3'] : ['import boto3'];
  const paramLines = Object.entries(params).map(
    ([key, value]) => `    ${JSON.stringify(key)}: ${renderPyValue(value)},`
  );
  const header = [...imports, '', 'client = boto3.client("dynamodb")', ''];

  if (!paginate) {
    return [
      ...header,
      'params = {',
      ...paramLines,
      '}',
      '',
      `response = client.${method}(**params)`,
      '',
      'print(response["Items"])'
    ].join('\n');
  }

  // The manual resume point (when configured) is already in `params` as
  // ExclusiveStartKey; the loop then overwrites it page by page — the same
  // dict drives every iteration.
  return [
    ...header,
    'params = {',
    ...paramLines,
    '}',
    '',
    'items = []',
    'while True:',
    `    response = client.${method}(**params)`,
    '    items.extend(response["Items"])',
    '    if "LastEvaluatedKey" not in response:',
    '        break',
    '    params["ExclusiveStartKey"] = response["LastEvaluatedKey"]',
    '',
    'print(items)'
  ].join('\n');
}

// ── Java (AWS SDK for Java v2) ──────────────────────────────────────────────

function emitJavaProgram(request: CanonicalRequest, paginate: boolean): string {
  const requestClass = javaRequestClassName(request.operation);
  const responseClass = requestClass.replace(/Request$/, 'Response');
  const method = javaClientMethodName(request.operation);
  const binary = hasBinaryValue(request);
  // Paginate always types `lastEvaluatedKey` as Map<String, AttributeValue>,
  // so those imports are needed even when the request itself carries no AV map.
  const usesAvMap =
    paginate ||
    request.key !== undefined ||
    request.typedValues !== undefined ||
    request.exclusiveStartKey !== undefined;
  const javaUtil = [
    ...(paginate ? ['java.util.ArrayList', 'java.util.List'] : []),
    ...(binary ? ['java.util.Base64'] : []),
    ...(usesAvMap || request.names ? ['java.util.Map'] : [])
  ];
  const sdk = [
    ...(binary ? ['software.amazon.awssdk.core.SdkBytes'] : []),
    'software.amazon.awssdk.services.dynamodb.DynamoDbClient',
    ...(usesAvMap ? ['software.amazon.awssdk.services.dynamodb.model.AttributeValue'] : []),
    `software.amazon.awssdk.services.dynamodb.model.${requestClass}`,
    `software.amazon.awssdk.services.dynamodb.model.${responseClass}`
  ];
  const header = [
    ...[...javaUtil, ...sdk].map((i) => `import ${i};`),
    '',
    'public class Main {',
    '    public static void main(String[] args) {',
    '        DynamoDbClient client = DynamoDbClient.create();',
    ''
  ];
  const footer = ['    }', '}'];

  if (!paginate) {
    return [
      ...header,
      `        ${requestClass} request = ${renderJavaRequestBuilder(request, '        ')};`,
      '',
      `        ${responseClass} response = client.${method}(request);`,
      '        System.out.println(response.items());',
      ...footer
    ].join('\n');
  }

  // The loop owns ExclusiveStartKey: strip it from the rendered request and
  // seed the loop variable from the manual resume point (when configured).
  const {exclusiveStartKey: startKey, ...rest} = request;
  const stripped: CanonicalRequest = {...rest, config: request.config};
  const seed =
    startKey === undefined
      ? '        Map<String, AttributeValue> lastEvaluatedKey = null;'
      : `        Map<String, AttributeValue> lastEvaluatedKey = ${renderJavaAvMap(startKey, '        ')};`;
  return [
    ...header,
    '        List<Map<String, AttributeValue>> items = new ArrayList<>();',
    seed,
    '        do {',
    `            ${requestClass} request = ${renderJavaRequestBuilder(stripped, '            ', [
      '.exclusiveStartKey(lastEvaluatedKey)'
    ])};`,
    `            ${responseClass} response = client.${method}(request);`,
    '            items.addAll(response.items());',
    '            lastEvaluatedKey = response.hasLastEvaluatedKey() ? response.lastEvaluatedKey() : null;',
    '        } while (lastEvaluatedKey != null);',
    '',
    '        System.out.println(items);',
    ...footer
  ].join('\n');
}

// ── Go (aws-sdk-go-v2) ──────────────────────────────────────────────────────

function emitGoProgram(request: CanonicalRequest, paginate: boolean): string {
  const inputType = goInputTypeName(request.operation);
  const method = goClientMethodName(request.operation);
  // The paginator accumulator is typed map[string]types.AttributeValue, so
  // paginate needs the types import even when the input carries no AV map.
  const usesTypes = goUsesTypes(request) || paginate;
  const imports = [
    '\t"context"',
    '\t"fmt"',
    '\t"log"',
    '',
    '\t"github.com/aws/aws-sdk-go-v2/aws"',
    '\t"github.com/aws/aws-sdk-go-v2/config"',
    '\t"github.com/aws/aws-sdk-go-v2/service/dynamodb"',
    ...(usesTypes ? ['\t"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"'] : [])
  ];
  const header = [
    'package main',
    '',
    'import (',
    ...imports,
    ')',
    '',
    'func main() {',
    '\tcfg, err := config.LoadDefaultConfig(context.TODO())',
    '\tif err != nil {',
    '\t\tlog.Fatal(err)',
    '\t}',
    '\tclient := dynamodb.NewFromConfig(cfg)',
    '',
    `\tinput := ${renderGoInput(request, '\t')}`,
    ''
  ];

  if (!paginate) {
    return [
      ...header,
      `\tresponse, err := client.${method}(context.TODO(), input)`,
      '\tif err != nil {',
      '\t\tlog.Fatal(err)',
      '\t}',
      '\tfmt.Println(response.Items)',
      '}'
    ].join('\n');
  }

  // The paginator starts from the input's ExclusiveStartKey (when configured)
  // and follows LastEvaluatedKey itself.
  return [
    ...header,
    `\tpaginator := dynamodb.New${inputType.replace(/Input$/, '')}Paginator(client, input)`,
    '',
    '\tvar items []map[string]types.AttributeValue',
    '\tfor paginator.HasMorePages() {',
    '\t\tpage, err := paginator.NextPage(context.TODO())',
    '\t\tif err != nil {',
    '\t\t\tlog.Fatal(err)',
    '\t\t}',
    '\t\titems = append(items, page.Items...)',
    '\t}',
    '\tfmt.Println(items)',
    '}'
  ].join('\n');
}

// ── Rust (aws-sdk-dynamodb) ─────────────────────────────────────────────────

function emitRustProgram(request: CanonicalRequest, paginate: boolean): string {
  const usesAv = rustUsesAttributeValue(request);
  const usesBlob = rustUsesBlob(request);
  const imports = [
    '// Cargo.toml: aws-config, aws-sdk-dynamodb, tokio (features = ["full"])',
    'use aws_sdk_dynamodb::Client;',
    ...(usesAv ? ['use aws_sdk_dynamodb::types::AttributeValue;'] : []),
    ...(usesBlob ? ['use aws_sdk_dynamodb::primitives::Blob;'] : [])
  ];
  const header = [
    ...imports,
    '',
    '#[tokio::main]',
    'async fn main() -> Result<(), aws_sdk_dynamodb::Error> {',
    '    let config = aws_config::load_from_env().await;',
    '    let client = Client::new(&config);',
    ''
  ];
  const builder = renderRustBuilder(request, '        ');

  if (!paginate) {
    return [
      ...header,
      '    let response = client',
      ...builder,
      '        .send()',
      '        .await?;',
      '    println!("{:?}", response.items());',
      '',
      '    Ok(())',
      '}'
    ].join('\n');
  }

  // `into_paginator().items()` follows LastEvaluatedKey itself, starting from
  // the builder's ExclusiveStartKey when one is configured.
  return [
    ...header,
    '    let mut items = client',
    ...builder,
    '        .into_paginator()',
    '        .items()',
    '        .send();',
    '',
    '    while let Some(item) = items.next().await {',
    '        println!("{:?}", item?);',
    '    }',
    '',
    '    Ok(())',
    '}'
  ].join('\n');
}

// ── DocumentClient (@aws-sdk/lib-dynamodb) ──────────────────────────────────

function emitDocClientProgram(request: CanonicalRequest, paginate: boolean): string {
  const command = docClientCommandName(request.operation);
  const params = renderDocClientParams(request, '');
  if (!paginate) {
    return [
      'import { DynamoDBClient } from "@aws-sdk/client-dynamodb";',
      `import { DynamoDBDocumentClient, ${command} } from "@aws-sdk/lib-dynamodb";`,
      '',
      'const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));',
      '',
      'const response = await client.send(',
      `  new ${command}(${renderDocClientParams(request, '  ')})`,
      ');',
      '',
      'console.log(response.Items);'
    ].join('\n');
  }
  const paginator = request.operation === 'Scan' ? 'paginateScan' : 'paginateQuery';
  return [
    'import { DynamoDBClient } from "@aws-sdk/client-dynamodb";',
    `import { DynamoDBDocumentClient, ${paginator} } from "@aws-sdk/lib-dynamodb";`,
    '',
    'const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));',
    '',
    `const paginator = ${paginator}(`,
    '  { client },',
    `  ${renderDocClientParams(request, '  ')}`,
    ');',
    '',
    'for await (const page of paginator) {',
    '  console.log(page.Items);',
    '}'
  ].join('\n');
}

// ── Kotlin (aws-sdk-kotlin) ─────────────────────────────────────────────────

function emitKotlinProgram(request: CanonicalRequest, paginate: boolean): string {
  const method = kotlinClientMethodName(request.operation);
  const header = [
    'import aws.sdk.kotlin.services.dynamodb.DynamoDbClient',
    'import aws.sdk.kotlin.services.dynamodb.model.AttributeValue',
    ...(paginate
      ? [
          `import aws.sdk.kotlin.services.dynamodb.paginators.${method}Paginated`,
          'import aws.sdk.kotlin.services.dynamodb.paginators.items',
          'import kotlinx.coroutines.flow.collect'
        ]
      : []),
    '',
    'suspend fun main() {',
    '    DynamoDbClient.fromEnvironment().use { client ->'
  ];
  const body = renderKotlinBuilder(request, '            ');
  if (!paginate) {
    return [
      ...header,
      `        val response = client.${method} {`,
      ...body,
      '        }',
      '        println(response.items)',
      '    }',
      '}'
    ].join('\n');
  }
  return [
    ...header,
    `        client.${method}Paginated {`,
    ...body,
    '        }',
    '            .items()',
    '            .collect { item -> println(item) }',
    '    }',
    '}'
  ].join('\n');
}

// ── PHP (aws-sdk-php) ───────────────────────────────────────────────────────

function emitPhpProgram(request: CanonicalRequest, paginate: boolean): string {
  const method = phpClientMethodName(request.operation);
  const header = [
    '<?php',
    '',
    "require 'vendor/autoload.php';",
    '',
    'use Aws\\DynamoDb\\DynamoDbClient;',
    '',
    "$client = new DynamoDbClient(['region' => 'us-east-1', 'version' => 'latest']);",
    ''
  ];
  if (!paginate) {
    return [
      ...header,
      `$response = $client->${method}(${renderPhpParams(request, '')});`,
      '',
      "print_r($response['Items']);"
    ].join('\n');
  }
  // getPaginator follows LastEvaluatedKey itself; the operation name is the
  // API operation (PascalCase), not the client method.
  const operation = request.operation === 'Scan' ? 'Scan' : 'Query';
  return [
    ...header,
    `$pages = $client->getPaginator('${operation}', ${renderPhpParams(request, '')});`,
    '',
    'foreach ($pages as $page) {',
    "    print_r($page['Items']);",
    '}'
  ].join('\n');
}

// ── Ruby (aws-sdk-dynamodb v3) ──────────────────────────────────────────────

function emitRubyProgram(request: CanonicalRequest, paginate: boolean): string {
  const method = rubyClientMethodName(request.operation);
  const usesSets = /Set\.new\(/.test(renderRubyParams(request, ''));
  const usesBase64 = /Base64\.decode64\(/.test(renderRubyParams(request, ''));
  const header = [
    "require 'aws-sdk-dynamodb'",
    ...(usesSets ? ["require 'set'"] : []),
    ...(usesBase64 ? ["require 'base64'"] : []),
    '',
    'client = Aws::DynamoDB::Client.new',
    ''
  ];
  if (!paginate) {
    return [
      ...header,
      `response = client.${method}(${renderRubyParams(request, '')})`,
      '',
      'puts response.items'
    ].join('\n');
  }
  // The Ruby SDK's response is pageable: `.each` follows LastEvaluatedKey.
  return [
    ...header,
    `response = client.${method}(${renderRubyParams(request, '')})`,
    '',
    'response.each do |page|',
    '  puts page.items',
    'end'
  ].join('\n');
}

// ── .NET (AWSSDK.DynamoDBv2) ────────────────────────────────────────────────

function emitDotnetProgram(request: CanonicalRequest, paginate: boolean): string {
  const method = dotnetClientMethodName(request.operation);
  const binary = hasBinaryValue(request);
  // Dictionary/List appear for any map field, and always in the paginate loop.
  const usesCollections =
    paginate ||
    request.key !== undefined ||
    request.names !== undefined ||
    request.typedValues !== undefined ||
    request.exclusiveStartKey !== undefined;
  const header = [
    'using System;',
    ...(usesCollections ? ['using System.Collections.Generic;'] : []),
    ...(binary ? ['using System.IO;'] : []),
    'using Amazon.DynamoDBv2;',
    'using Amazon.DynamoDBv2.Model;',
    '',
    'var client = new AmazonDynamoDBClient();',
    ''
  ];

  if (!paginate) {
    return [
      ...header,
      `var request = ${renderCsRequest(request, '')};`,
      '',
      `var response = await client.${method}(request);`,
      'Console.WriteLine(response.Items.Count);'
    ].join('\n');
  }

  // The loop owns ExclusiveStartKey: strip it from the rendered request and
  // seed the loop variable from the manual resume point (when configured).
  const {exclusiveStartKey: startKey, ...rest} = request;
  const stripped: CanonicalRequest = {...rest, config: request.config};
  const seed =
    startKey === undefined
      ? 'Dictionary<string, AttributeValue> lastEvaluatedKey = null;'
      : `Dictionary<string, AttributeValue> lastEvaluatedKey = ${renderCsAvMap(startKey, '')};`;
  return [
    ...header,
    `var request = ${renderCsRequest(stripped, '')};`,
    '',
    'var items = new List<Dictionary<string, AttributeValue>>();',
    seed,
    'do',
    '{',
    '    request.ExclusiveStartKey = lastEvaluatedKey;',
    `    var response = await client.${method}(request);`,
    '    items.AddRange(response.Items);',
    '    lastEvaluatedKey = response.LastEvaluatedKey;',
    '} while (lastEvaluatedKey != null && lastEvaluatedKey.Count > 0);',
    '',
    'Console.WriteLine(items.Count);'
  ].join('\n');
}
