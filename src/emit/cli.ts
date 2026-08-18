// AWS CLI emitter — canonical request → an `aws dynamodb <op>` command. Every
// `--key`/`--item`/`--expression-attribute-values` payload is DynamoDB-JSON
// built from the type tag (see ./marshal — `"5"` tagged N → `{"N":"5"}`, base64
// tagged B → `{"B":"<base64>"}`), NOT inferred from the runtime value. The
// marshalling is SDK-free, so — unlike the converter — this needs no client-only
// dynamic import; the AWS SDK never enters any bundle.
//
// Every flag value is wrapped in single quotes and made shell-safe (an inner `'`
// becomes `'\''`), so expressions with spaces and string values containing
// quotes paste cleanly into a POSIX shell.

import {typedMapToAvMap} from './marshal';
import type {CanonicalRequest, DdbOperation} from '../types';

/** Operation → the `aws dynamodb` subcommand. */
const SUBCOMMAND_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'get-item',
  Query: 'query',
  Scan: 'scan',
  Update: 'update-item',
  Put: 'put-item',
  Delete: 'delete-item'
};

/** Wrap a value in a POSIX single-quoted string, escaping inner single quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Compact DynamoDB-JSON for a typed map (no whitespace → a tight shell arg). */
function avJson(map: Record<string, unknown>): string {
  return JSON.stringify(map);
}

/** Emit the multi-line `aws dynamodb <op>` command for a canonical request. */
export function emitCli(request: CanonicalRequest): string {
  // Value-less boolean flags carry `null`.
  const flags: Array<[string, string | null]> = [['--table-name', request.tableName]];
  if (request.indexName) flags.push(['--index-name', request.indexName]);
  if (request.key) flags.push(['--key', avJson(typedMapToAvMap(request.key))]);
  if (request.item) flags.push(['--item', avJson(typedMapToAvMap(request.item))]);
  if (request.keyConditionExpression)
    flags.push(['--key-condition-expression', request.keyConditionExpression]);
  if (request.updateExpression) flags.push(['--update-expression', request.updateExpression]);
  if (request.conditionExpression)
    flags.push(['--condition-expression', request.conditionExpression]);
  if (request.filterExpression) flags.push(['--filter-expression', request.filterExpression]);
  if (request.projectionExpression)
    flags.push(['--projection-expression', request.projectionExpression]);
  if (request.names) flags.push(['--expression-attribute-names', avJson(request.names)]);
  if (request.typedValues)
    flags.push(['--expression-attribute-values', avJson(typedMapToAvMap(request.typedValues))]);
  // Request-level read options. The CLI auto-paginates query/scan, so the raw
  // API pagination params are replaced by its own controls (verified against
  // the `aws dynamodb query` v2 reference): `Limit` maps to `--page-size` (the
  // per-call Limit), and there is NO `--exclusive-start-key` — resuming uses
  // the opaque `--starting-token` from a previous run's NextToken, which we
  // can't derive from a typed key map. That case gets an honest comment.
  if (request.consistentRead) flags.push(['--consistent-read', null]);
  if (request.scanIndexForward === false) flags.push(['--no-scan-index-forward', null]);
  if (request.limit !== undefined) flags.push(['--page-size', String(request.limit)]);

  const comments = request.exclusiveStartKey
    ? [
        '# The AWS CLI has no --exclusive-start-key: resume a paginated run with',
        "# --starting-token <NextToken from the previous run's output> instead."
      ]
    : [];
  const head = `aws dynamodb ${SUBCOMMAND_BY_OP[request.operation]}`;
  const lines = flags.map(([flag, value]) =>
    value === null ? `  ${flag}` : `  ${flag} ${shellQuote(value)}`
  );
  const command = [head, ...lines].join(' \\\n');
  return comments.length > 0 ? [...comments, command].join('\n') : command;
}
