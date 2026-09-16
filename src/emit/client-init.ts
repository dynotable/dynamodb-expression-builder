// Client CONSTRUCTION helpers, as opposed to the per-emitter request/params
// rendering next door. Only the pieces more than one emitter needs live here —
// the JS `new DynamoDBClient(...)` options literal is written by the SDK v3,
// DocumentClient and dynamodb-toolbox programs alike, and PHP and Ruby quote a
// region into the same single-quoted string grammar. Single-use client lines
// (boto3's `region_name=`, Kotlin's `fromEnvironment { … }`, …) stay beside the
// header that emits them.

/**
 * The options literal for a JS `new DynamoDBClient(<here>)`. An absent region
 * keeps the empty-config form, which resolves the region from the environment
 * exactly as the SDK's own quickstarts do.
 * @param region The AWS region the snippet should pin, when one is known.
 * @returns `'{}'`, or `'{ region: "eu-west-1" }'`.
 */
export function jsClientOptions(region?: string): string {
  return region === undefined ? '{}' : `{ region: ${JSON.stringify(region)} }`;
}

/**
 * Wrap a value in a single-quoted string literal. PHP and Ruby share the same
 * single-quote grammar (only `\` and `'` are escapes), so one helper serves
 * both emitters.
 * @param value The raw value.
 * @returns The quoted literal, inner quotes and backslashes escaped.
 */
export function singleQuoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
