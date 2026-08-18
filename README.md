# dynamodb-expression-builder

DynamoDB expression builder and code generator. Build update, condition, filter and key condition expressions with automatic `ExpressionAttributeNames` / `ExpressionAttributeValues` aliasing — then emit the whole request as runnable code for the JavaScript SDK v3 (low-level or DocumentClient), AWS CLI, boto3 (Python), Java, Go, .NET, Rust, Kotlin, PHP, Ruby, PartiQL or [dynamodb-toolbox](https://github.com/dynamodb-toolbox/dynamodb-toolbox). Zero dependencies.

Hand-writing DynamoDB expressions means juggling three coupled structures — the expression string, the `#name` aliases (mandatory whenever an attribute name is one of DynamoDB's 573 reserved words), and the typed `:value` placeholders — and keeping them consistent across every operation. The AWS SDKs for [Go](https://docs.aws.amazon.com/sdk-for-go/) and [Java](https://docs.aws.amazon.com/sdk-for-java/) ship expression builders for this; the JavaScript SDK v3 [does not](https://github.com/aws/aws-sdk-js-v3/issues/3165). This package is that builder, plus something the official ones don't do in any language: code generation, so one structured request becomes a paste-ready command in whichever SDK your team actually runs.

Values are **type-tagged** (`S`/`N`/`B`/`BOOL`/`SS`/`NS`/`BS`/`NULL`), never inferred from JavaScript runtime types — `marshall('5')` would silently write a string where you meant a number; a tag can't.

## Install

```sh
npm install dynamodb-expression-builder
```

ESM and CJS, browser-safe, no dependencies.

## Thirty seconds

```ts
import {buildRequest, emitSdkV3, emitCli, emitBoto3} from 'dynamodb-expression-builder';

const request = buildRequest({
  operation: 'Query',
  tableName: 'orders',
  hashKey: {field: 'customerId', type: 'S', value: 'CUST#42'},
  rangeKey: {field: 'orderDate', type: 'S', operator: 'begins_with', value: '2026-08'},
  filters: [{field: 'status', type: 'S', operator: '=', value: 'shipped'}]
});

emitSdkV3(request);
// new QueryCommand({
//   "TableName": "orders",
//   "KeyConditionExpression": "#hashKey = :hashKeyValue AND begins_with(#rangeKey, :rangeKeyValue)",
//   "FilterExpression": "#filter0 = :filterValue0",
//   "ExpressionAttributeNames": {
//     "#hashKey": "customerId",
//     "#rangeKey": "orderDate",
//     "#filter0": "status"
//   },
//   "ExpressionAttributeValues": {
//     ":hashKeyValue": { "S": "CUST#42" },
//     ":rangeKeyValue": { "S": "2026-08" },
//     ":filterValue0": { "S": "shipped" }
//   }
// })
```

The same `request` feeds every emitter — `emitCli(request)` gives the `aws dynamodb query \ …` command, `emitBoto3(request)` the Python, `emitJava` / `emitGo` / `emitDotnet` / `emitRust` / `emitKotlin` / `emitPhp` the typed AttributeValue constructors for those SDKs, `emitDocClient` / `emitRuby` the native-value shapes their SDKs marshal themselves, and `emitPartiql(request)` the equivalent `SELECT` statement (or an honest `{ok: false, reason}` where PartiQL can't express the request).

Update expressions compile from a list of actions:

```ts
import {buildUpdateExpression, makeTypedValue} from 'dynamodb-expression-builder';

buildUpdateExpression([
  {kind: 'SET', field: 'status', setOp: 'assign', value: makeTypedValue('S', 'shipped')},
  {kind: 'ADD', field: 'loginCount', value: makeTypedValue('N', '1')},
  {kind: 'REMOVE', field: 'legacyFlag'}
]);
// {
//   expression: 'SET #upd0 = :updValue0 REMOVE #upd2 ADD #upd1 :updValue1',
//   names: {'#upd0': 'status', '#upd1': 'loginCount', '#upd2': 'legacyFlag'},
//   typedValues: {':updValue0': {type: 'S', value: 'shipped'}, ':updValue1': {type: 'N', value: '1'}}
// }
```

SET idioms are first-class: `assign`, `if_not_exists`, atomic counters (`add`/`subtract`), `list_append`/`list_prepend`, plus `REMOVE` (including list elements by index) and `ADD`/`DELETE` for numbers and sets.

And `emitQueryProgram(config, format)` wraps a Query/Scan request into a complete runnable program — client setup, the request, and a `LastEvaluatedKey` pagination loop — with `format` one of `'sdk' | 'docclient' | 'cli' | 'boto3' | 'partiql' | 'java' | 'go' | 'dotnet' | 'rust' | 'kotlin' | 'php' | 'ruby' | 'ddbtoolbox'` — each paginated program uses its SDK's own idiom (`paginateQuery`, `into_paginator()`, `queryPaginated` flows, `getPaginator`, pageable responses).

## API

Three layers, each usable on its own:

| Layer    | Exports                                                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model    | `TypedValue`, `makeTypedValue`, `FilterRow`, `KeyAttr`, `RangeKeyCondition`, `UpdateAction`, the `FILTER_OPERATORS` registry + per-type compatibility helpers                       |
| Builders | `buildRequest(config)` → one `CanonicalRequest` for any of GetItem/Query/Scan/Update/Put/Delete · `buildFilterExpressions` · `buildKeyConditionExpression` · `buildUpdateExpression` |
| Emitters | `emitSdkV3` · `emitDocClient` · `emitCli` · `emitBoto3` · `emitJava` · `emitGo` · `emitDotnet` · `emitRust` · `emitKotlin` · `emitPhp` · `emitRuby` · `emitPartiql` · `emitDdbToolboxProgram` · `emitQueryProgram` · `typedMapToAvMap` (tag-driven marshal) |

Placeholder namespaces never collide: keys use `#hashKey`/`#rangeKey`, filters `#filter{i}`, conditions `#cond{i}`, updates `#upd{i}` — one request can carry a key condition, a filter, a write condition and an update expression simultaneously.

Honest degradation is a design rule: emitters return `{ok: false, reason}` (PartiQL for unsupported constructs, program emission where a target can't express the request) instead of emitting code that looks right and isn't.

## Build one in the browser

The same engine powers two interactive tools: the [DynamoDB expression builder](https://dynotable.com/tools/dynamodb-expression-builder) (expression syntax for all six operations) and the [DynamoDB query builder](https://dynotable.com/tools/dynamodb-query-builder) (complete Query/Scan requests with the pagination loop). Reserved-word aliasing is the same problem our [dynamodb-reserved-words](https://github.com/dynotable/dynamodb-reserved-words) package solves as data.

## License

MIT © [DynoTable](https://dynotable.com)
