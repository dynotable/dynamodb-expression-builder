// boto3 emitter — canonical request → a `boto3.client("dynamodb")` call. Uses the
// LOW-LEVEL client (not the resource/Table API) so the typed AttributeValue maps
// the canonical request carries survive verbatim — the resource API auto-marshals
// Python natives and would discard the type-tag contract (Decimal-vs-int,
// bytes-vs-str). It therefore shares the SDK v3 param shape exactly (PascalCase
// keys, tag-driven AV maps), so it REUSES `buildSdkV3Params`; only the rendering
// differs (Python literals — `True`/`False`/`None` — and kwargs call syntax).
// Pure source rendering; imports no SDK. Update REMOVE/ADD/DELETE come for free —
// they ride in the `UpdateExpression` string with no special-casing.
//
// BINARY: the low-level client wants Python `bytes` for `B`/`BS` members (see the
// put_item Request Syntax: `'B': b'bytes'`), NOT the base64 string the wire/CLI
// form uses. The shared AV map carries base64, so here we decode it inline with
// `base64.b64decode("…")` (and add the `import base64`) — a base64 *str* in a
// `B` slot would be double-encoded by botocore and store the wrong bytes.

import {buildSdkV3Params} from './sdk-v3';
import {hasBinaryValue} from './marshal';
import type {CanonicalRequest, DdbOperation} from '../types';

/** Operation → the low-level `boto3.client("dynamodb")` method. */
const METHOD_BY_OP: Record<DdbOperation, string> = {
  GetItem: 'get_item',
  Query: 'query',
  Scan: 'scan',
  Update: 'update_item',
  Put: 'put_item',
  Delete: 'delete_item'
};

/** Python expression decoding a base64 `B` member to the `bytes` the client needs. */
function pyBinary(base64: string): string {
  return `base64.b64decode(${JSON.stringify(base64)})`;
}

/**
 * Render a JS value (string / boolean / array / object — the shapes a param
 * object and its AttributeValue maps contain) as a Python literal. Strings reuse
 * `JSON.stringify`, whose escapes (`\"`, `\\`, `\n`, `\uXXXX`) are all valid
 * Python; booleans become `True`/`False`. A `B`/`BS` AttributeValue member is
 * rendered as `bytes` (base64-decoded), not a str.
 */
function pyLiteral(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => {
      if (k === 'B' && typeof v === 'string') return `${JSON.stringify(k)}: ${pyBinary(v)}`;
      if (k === 'BS' && Array.isArray(v))
        return `${JSON.stringify(k)}: [${v.map(pyBinary).join(', ')}]`;
      return `${JSON.stringify(k)}: ${pyLiteral(v)}`;
    });
    return `{${entries.join(', ')}}`;
  }
  return 'None';
}

/**
 * Render a params value as the same Python literal `emitBoto3` embeds
 * (`True`/`False`/`None`, B/BS as `base64.b64decode(...)`). Exported for the
 * query-builder program emitter, which renders a `params` dict for its
 * LastEvaluatedKey pagination loop.
 */
export function renderPyValue(value: unknown): string {
  return pyLiteral(value);
}

/** The low-level boto3 client method name for an operation. */
export function boto3MethodName(operation: DdbOperation): string {
  return METHOD_BY_OP[operation];
}

/** Emit the runnable boto3 snippet (client + method call) for a canonical request. */
export function emitBoto3(request: CanonicalRequest): string {
  const params = buildSdkV3Params(request);
  const method = METHOD_BY_OP[request.operation];
  const kwargs = Object.entries(params).map(([key, value]) => `    ${key}=${pyLiteral(value)},`);
  const imports = hasBinaryValue(request) ? ['import base64', 'import boto3'] : ['import boto3'];
  return [
    ...imports,
    '',
    'client = boto3.client("dynamodb")',
    '',
    `response = client.${method}(`,
    ...kwargs,
    ')'
  ].join('\n');
}
