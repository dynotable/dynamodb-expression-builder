// Tag-driven AttributeValue marshalling — the shared core the SDK v3, CLI, and
// boto3 emitters all build their `{S}`/`{N}`/`{B}`/… payloads from.
//
// CRITICAL: the AttributeValue is built from the {@link TypedValue}'s **type
// tag**, never from the JS runtime type. This is the whole point of the typed-
// value contract: a stateless web tool can't infer S-vs-N from a text box, so
// `marshall("5")` (which would yield `{S:"5"}`) and `marshall(base64)` (which
// would yield `{S}` not `{B}`) are both wrong here. We therefore DON'T reuse
// `lib/tools/dynamodb-json.ts`'s `marshall` wrapper — it's runtime-type-driven
// and would mis-tag every value. Tag-driven marshalling needs no AWS SDK at all,
// so (unlike the converter) these emitters carry no SDK import and there's no
// SSR-bundle concern requiring a client-only dynamic import.
//
// `B`/`BS` values hold canonical base64 (the type tag's storage form). That IS
// the wire shape DynamoDB-JSON / the AWS CLI want, so the CLI emitter uses it
// verbatim. The SDK v3 and boto3 emitters target the LOW-LEVEL clients, whose
// `B` member is an in-language binary type (`Uint8Array` / Python `bytes`), not a
// base64 string — they decode this base64 at render time (see those emitters).

import type {CanonicalRequest, TypedValue} from '../types';

/** A single DynamoDB-JSON AttributeValue (the v1 scalar/set subset). */
export type AttributeValue =
  | {S: string}
  | {N: string}
  | {B: string}
  | {BOOL: boolean}
  | {SS: string[]}
  | {NS: string[]}
  | {BS: string[]}
  | {NULL: true};

/** Build an AttributeValue from a value's type tag (not its runtime type). */
export function typedValueToAv(tv: TypedValue): AttributeValue {
  switch (tv.type) {
    case 'S':
      return {S: tv.value};
    case 'N':
      return {N: tv.value};
    case 'B':
      return {B: tv.value}; // already base64
    case 'BOOL':
      return {BOOL: tv.value === 'true'};
    case 'SS':
      return {SS: tv.values ?? []};
    case 'NS':
      return {NS: tv.values ?? []};
    case 'BS':
      return {BS: tv.values ?? []};
    case 'NULL':
      return {NULL: true};
  }
}

/** Marshal a whole placeholder/attr map (`:v`→typed, or name→typed) to AVs. */
export function typedMapToAvMap(map: Record<string, TypedValue>): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const [key, tv] of Object.entries(map)) out[key] = typedValueToAv(tv);
  return out;
}

/**
 * Does this request carry any binary (`B`/`BS`) value? The SDK v3 / boto3
 * emitters use this to decide whether to emit binary-decoding (a `Uint8Array`
 * expression / an `import base64`).
 */
export function hasBinaryValue(request: CanonicalRequest): boolean {
  const maps = [request.key, request.item, request.typedValues, request.exclusiveStartKey];
  return maps.some(
    (map) =>
      map !== undefined && Object.values(map).some((tv) => tv.type === 'B' || tv.type === 'BS')
  );
}
