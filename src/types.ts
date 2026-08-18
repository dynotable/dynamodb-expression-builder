// Shared model for the DynamoDB expression builder.
//
// THE typed-value contract: every value a user enters (filter RHS, condition,
// key, Put item attr, update value) carries an explicit DynamoDB **type tag**.
// A stateless web tool can't infer S-vs-N from a text box, and the emitters
// (SDK v3 / CLI / boto3 / PartiQL) build the AttributeValue from the tag, never
// from the JS runtime type — `marshall("5")` would wrongly yield `{S}`; a
// base64 string would yield `{S}` not `{B}`. This module is the single source
// of truth all later builders/emitters/state consume; define it before them.

import type {OperatorValue} from './operators';

/**
 * Value type tags the tool exposes. Mirrors the app's filter Type selector
 * minus `L`/`M` (no nested List/Map in v1 — see docs/plans/…expression-builder).
 */
export type DdbScalarType = 'S' | 'N' | 'B' | 'BOOL' | 'SS' | 'NS' | 'BS' | 'NULL';

/** The set-typed tags, which carry members in `values` rather than `value`. */
export const SET_TYPES = ['SS', 'NS', 'BS'] as const;
export type SetType = (typeof SET_TYPES)[number];

export function isSetType(type: DdbScalarType): type is SetType {
  return type === 'SS' || type === 'NS' || type === 'BS';
}

/**
 * The scalar element type of a set tag (SS→S, NS→N, BS→B); identity for every
 * scalar. `contains(path, operand)` takes a SCALAR operand even when `path` is a
 * set (it tests membership), so the set-typed tag must marshal its ELEMENT type
 * there — never `{SS:[…]}`, which DynamoDB rejects.
 */
export function elementType(type: DdbScalarType): DdbScalarType {
  switch (type) {
    case 'SS':
      return 'S';
    case 'NS':
      return 'N';
    case 'BS':
      return 'B';
    default:
      return type;
  }
}

/**
 * A value carried with its DynamoDB type tag. `value` holds the scalar string
 * representation (S text; N numeric string; B base64; BOOL `'true'`/`'false'`;
 * NULL unused). `values` holds the members of a set type (SS/NS/BS). Exactly
 * one is meaningful per `type`; emitters branch on the tag, not the runtime.
 */
export interface TypedValue {
  type: DdbScalarType;
  value: string;
  /** Members for set types (SS/NS/BS). Undefined for scalars. */
  values?: string[];
}

/**
 * Build a {@link TypedValue} from a tag + raw entry. Set types take an explicit
 * member array (falling back to the single `value` as one member); scalars take
 * the string; NULL ignores the payload.
 */
export function makeTypedValue(type: DdbScalarType, value: string, values?: string[]): TypedValue {
  if (isSetType(type)) {
    return {type, value: '', values: values ?? (value ? [value] : [])};
  }
  if (type === 'NULL') return {type, value: ''};
  return {type, value};
}

/**
 * A filter (Scan/Query) or condition (Update/Put/Delete) predicate row, as the
 * bespoke UI emits it. `operator` is the lowercase internal value from
 * `operators.ts` (`'='`, `'begins_with'`, …); the builder maps it to its wire
 * form before compiling. `type` tags the RHS value(s).
 */
export interface FilterRow {
  field: string;
  operator: OperatorValue;
  type: DdbScalarType;
  /** RHS scalar (unused for `exists`/`not_exists`; first bound for `between`). */
  value: string;
  /** Second bound for `between`. */
  value2?: string;
  /** Members for `in` (and set-typed single comparisons). */
  values?: string[];
}

/** A primary-key attribute (GetItem/Delete Key map; Query hash key). */
export interface KeyAttr {
  field: string;
  /** Keys are always scalar S/N/B, but typed as the full union for reuse. */
  type: DdbScalarType;
  value: string;
}

/** Query range-key condition (a key-eligible operator + value[s]). */
export interface RangeKeyCondition {
  field: string;
  type: DdbScalarType;
  operator: OperatorValue;
  value: string;
  /** Second bound for `between`. */
  value2?: string;
}

/** A Put item attribute carrying its type tag. */
export interface ItemAttr {
  field: string;
  type: DdbScalarType;
  value: string;
  /** Members for set types. */
  values?: string[];
}

/** SET-clause idioms (the only action kind with sub-modes). */
export type SetOperation =
  | 'assign' // #a = :v
  | 'if_not_exists' // #a = if_not_exists(#a, :v)
  | 'add' // #a = #a + :n  (atomic counter)
  | 'subtract' // #a = #a - :n
  | 'list_append' // #a = list_append(#a, :v)
  | 'list_prepend'; // #a = list_append(:v, #a)

export type UpdateActionKind = 'SET' | 'REMOVE' | 'ADD' | 'DELETE';

/**
 * A single UpdateExpression action. `SET` carries a `setOp` idiom; `REMOVE`
 * targets an attribute (optionally a list element via `index`); `ADD`/`DELETE`
 * carry a number (ADD) or set (ADD/DELETE) value.
 */
export interface UpdateAction {
  kind: UpdateActionKind;
  field: string;
  /** SET only: which SET idiom. */
  setOp?: SetOperation;
  /** RHS value (SET except plain index removal; ADD; DELETE). */
  value?: TypedValue;
  /** List-element index for REMOVE (`#a[2]`). */
  index?: number;
}

/** The six operations the builder supports. */
export type DdbOperation = 'GetItem' | 'Query' | 'Scan' | 'Update' | 'Put' | 'Delete';

/**
 * The whole builder state — one config covering every operation. Sub-parts are
 * optional; `buildRequest` reads only the ones an operation uses (GetItem→key;
 * Query→hashKey[+rangeKey][+filters]; Scan→filters; Update→key+updates[+conditions];
 * Put→item[+conditions]; Delete→key[+conditions]). Serialised whole into the
 * single `state` URL param.
 */
export interface BuilderConfig {
  operation: DdbOperation;
  tableName: string;
  indexName?: string;
  /**
   * Base-table PK/SK NAMES + TYPES only (never values). Lets a Scan or GSI-query
   * emitter scaffold the table's REAL key schema instead of a `// TODO`
   * placeholder — the request's own key belongs to the GSI (or is absent for a
   * Scan), so the base schema must ride along separately. Absent when the base
   * schema isn't known (the stateless expression tool, or table info not yet
   * loaded); emitters fall back to the placeholder then.
   */
  baseKeySchema?: {
    hashKey: {field: string; type: DdbScalarType};
    rangeKey?: {field: string; type: DdbScalarType};
  };
  /** Query hash key (EQ). */
  hashKey?: KeyAttr;
  /** Query range key condition. */
  rangeKey?: RangeKeyCondition;
  /** GetItem/Update/Delete exact primary key attrs (hash[+range]). */
  key?: KeyAttr[];
  /** Scan/Query filter predicates. */
  filters?: FilterRow[];
  /** Update/Put/Delete write conditions. */
  conditions?: FilterRow[];
  /** Update actions. */
  updates?: UpdateAction[];
  /** Put item attributes. */
  item?: ItemAttr[];
  /** GetItem/Query/Scan projected attribute names. */
  projection?: string[];
  /** Query/Scan `Limit` — max items EVALUATED per request (positive integer). */
  limit?: number;
  /**
   * Query sort order. Only `false` (descending) is carried through — `true` is
   * the DynamoDB default, and emitting it would just be noise in the snippet.
   */
  scanIndexForward?: boolean;
  /** GetItem/Query/Scan strongly-consistent read (only `true` is carried). */
  consistentRead?: boolean;
  /**
   * Query/Scan resume point — the `LastEvaluatedKey` of a previous page, as
   * typed key attrs (hash[+range]). Compiled into `ExclusiveStartKey`.
   */
  exclusiveStartKey?: KeyAttr[];
}

/**
 * The canonical, fully-resolved request every emitter formats. Expression
 * strings reference `#`/`:` placeholders resolved by `names`/`typedValues`;
 * empty maps are omitted. `key`/`item` are direct name→value maps (no
 * placeholders). `config` is the raw model retained for PartiQL, which builds
 * literals rather than placeholders.
 */
export interface CanonicalRequest {
  operation: DdbOperation;
  tableName: string;
  indexName?: string;
  key?: Record<string, TypedValue>;
  item?: Record<string, TypedValue>;
  keyConditionExpression?: string;
  filterExpression?: string;
  updateExpression?: string;
  conditionExpression?: string;
  projectionExpression?: string;
  names?: Record<string, string>;
  typedValues?: Record<string, TypedValue>;
  /** Query/Scan `Limit` (positive integer; present only when set). */
  limit?: number;
  /** Present ONLY as `false` (descending Query) — the default `true` is omitted. */
  scanIndexForward?: boolean;
  /** Present ONLY as `true` (strongly-consistent read). */
  consistentRead?: boolean;
  /** Query/Scan resume point (typed name→value map, like `key`). */
  exclusiveStartKey?: Record<string, TypedValue>;
  config: BuilderConfig;
}
