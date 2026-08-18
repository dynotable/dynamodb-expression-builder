// DynamoDB operator registry — every comparison/function operator the builder
// understands, with its wire form, argument arity, and the attribute types it
// applies to. Pure logic, dependency-free, browser-safe (`WireFilterOperator`
// is defined here rather than imported from an SDK type so the package never
// drags the `@aws-sdk/client-dynamodb` tail).
//
// This registry is the canonical home — the DynoTable app and web tools consume
// it from this package.

/**
 * Wire-format (uppercase) operator union. INLINED copy of the app's
 * `WireFilterOperator` (`src/schemas/dynamodb-schemas.ts`).
 */
export type WireFilterOperator =
  | 'EQ'
  | 'NE'
  | 'GT'
  | 'GE'
  | 'LT'
  | 'LE'
  | 'CONTAINS'
  | 'NOT_CONTAINS'
  | 'BEGINS_WITH'
  | 'BETWEEN'
  | 'IN'
  | 'EXISTS'
  | 'NOT_EXISTS'
  | 'SIZE_EQ'
  | 'SIZE_NE'
  | 'SIZE_LT'
  | 'SIZE_LE'
  | 'SIZE_GT'
  | 'SIZE_GE'
  | 'TYPE_EQ'
  | 'TYPE_NE';

/**
 * Data types the compat map reasons about. `L`/`M` are included even though the
 * tool's Type selector doesn't expose them — they keep the compat table a
 * faithful port of the app's (where indexed columns can report List/Map).
 */
export type FilterDataType = 'S' | 'N' | 'B' | 'SS' | 'NS' | 'BS' | 'BOOL' | 'NULL' | 'L' | 'M';

/**
 * Single source-of-truth row for an operator. One row per operator; consumers
 * read the metadata they need (wire form, value-shape gates, key/scan type
 * compatibility).
 */
export type OperatorDef = {
  readonly value: string;
  readonly label: string;
  readonly symbol: string;
  readonly wireForm: WireFilterOperator;
  /** false → no RHS value (`exists`, `not_exists`). */
  readonly requiresValue: boolean;
  /** true → needs a second RHS value (`between` only). */
  readonly requiresValue2: boolean;
  /** true → type field is optional / defaults to `S` (`exists`, `size_*`). */
  readonly typeOptional: boolean;
  /** Key-eligible types. `[]` → scan-only, rejected by KeyConditionExpression. */
  readonly keyAllowedTypes: ReadonlyArray<'S' | 'N' | 'B'>;
  /** Scan-eligible types. Non-empty. */
  readonly scanAllowedTypes: readonly FilterDataType[];
};

const ALL_SCAN_TYPES = [
  'S',
  'N',
  'B',
  'SS',
  'NS',
  'BS',
  'BOOL',
  'NULL',
  'L',
  'M'
] as const satisfies readonly FilterDataType[];
const COLLECTION_TYPES = ['SS', 'NS', 'BS', 'L', 'M'] as const satisfies readonly FilterDataType[];

export const FILTER_OPERATORS = [
  {
    value: '=',
    label: 'Equals (=)',
    symbol: '=',
    wireForm: 'EQ',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: ['S', 'N', 'B'],
    scanAllowedTypes: ALL_SCAN_TYPES
  },
  {
    value: '<>',
    label: 'Not Equals (≠)',
    symbol: '≠',
    wireForm: 'NE',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: [],
    scanAllowedTypes: ALL_SCAN_TYPES
  },
  {
    value: '<',
    label: 'Less Than (<)',
    symbol: '<',
    wireForm: 'LT',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: ['N'],
    scanAllowedTypes: ['N']
  },
  {
    value: '<=',
    label: 'Less Than or Equal (≤)',
    symbol: '≤',
    wireForm: 'LE',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: ['N'],
    scanAllowedTypes: ['N']
  },
  {
    value: '>',
    label: 'Greater Than (>)',
    symbol: '>',
    wireForm: 'GT',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: ['N'],
    scanAllowedTypes: ['N']
  },
  {
    value: '>=',
    label: 'Greater Than or Equal (≥)',
    symbol: '≥',
    wireForm: 'GE',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: ['N'],
    scanAllowedTypes: ['N']
  },
  {
    value: 'contains',
    label: 'Contains',
    symbol: '∋',
    wireForm: 'CONTAINS',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: [],
    scanAllowedTypes: ['S', 'B', 'SS', 'NS', 'BS', 'L']
  },
  {
    value: 'not_contains',
    label: 'Not Contains',
    symbol: '∌',
    wireForm: 'NOT_CONTAINS',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: [],
    scanAllowedTypes: ['S', 'B', 'SS', 'NS', 'BS', 'L']
  },
  {
    value: 'begins_with',
    label: 'Begins With',
    symbol: '^',
    wireForm: 'BEGINS_WITH',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: ['S', 'B'],
    scanAllowedTypes: ['S', 'B']
  },
  {
    value: 'between',
    label: 'Between',
    symbol: '↔',
    wireForm: 'BETWEEN',
    requiresValue: true,
    requiresValue2: true,
    typeOptional: false,
    keyAllowedTypes: ['N'],
    scanAllowedTypes: ['N']
  },
  {
    value: 'in',
    label: 'In',
    symbol: '∈',
    wireForm: 'IN',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: [],
    scanAllowedTypes: ['S', 'N']
  },
  {
    value: 'exists',
    label: 'Attribute Exists',
    symbol: '∃',
    wireForm: 'EXISTS',
    requiresValue: false,
    requiresValue2: false,
    typeOptional: true,
    keyAllowedTypes: [],
    scanAllowedTypes: ALL_SCAN_TYPES
  },
  {
    value: 'not_exists',
    label: 'Attribute Not Exists',
    symbol: '∄',
    wireForm: 'NOT_EXISTS',
    requiresValue: false,
    requiresValue2: false,
    typeOptional: true,
    keyAllowedTypes: [],
    scanAllowedTypes: ALL_SCAN_TYPES
  },
  {
    value: 'size_eq',
    label: 'Size Equals',
    symbol: 'size =',
    wireForm: 'SIZE_EQ',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: true,
    keyAllowedTypes: [],
    scanAllowedTypes: COLLECTION_TYPES
  },
  {
    value: 'size_ne',
    label: 'Size Not Equals',
    symbol: 'size ≠',
    wireForm: 'SIZE_NE',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: true,
    keyAllowedTypes: [],
    scanAllowedTypes: COLLECTION_TYPES
  },
  {
    value: 'size_lt',
    label: 'Size Less Than',
    symbol: 'size <',
    wireForm: 'SIZE_LT',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: true,
    keyAllowedTypes: [],
    scanAllowedTypes: COLLECTION_TYPES
  },
  {
    value: 'size_le',
    label: 'Size Less Than or Equal',
    symbol: 'size ≤',
    wireForm: 'SIZE_LE',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: true,
    keyAllowedTypes: [],
    scanAllowedTypes: COLLECTION_TYPES
  },
  {
    value: 'size_gt',
    label: 'Size Greater Than',
    symbol: 'size >',
    wireForm: 'SIZE_GT',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: true,
    keyAllowedTypes: [],
    scanAllowedTypes: COLLECTION_TYPES
  },
  {
    value: 'size_ge',
    label: 'Size Greater Than or Equal',
    symbol: 'size ≥',
    wireForm: 'SIZE_GE',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: true,
    keyAllowedTypes: [],
    scanAllowedTypes: COLLECTION_TYPES
  },
  {
    value: 'type_eq',
    label: 'Type Equals',
    symbol: 'type =',
    wireForm: 'TYPE_EQ',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: [],
    scanAllowedTypes: ALL_SCAN_TYPES
  },
  {
    value: 'type_ne',
    label: 'Type Not Equals',
    symbol: 'type ≠',
    wireForm: 'TYPE_NE',
    requiresValue: true,
    requiresValue2: false,
    typeOptional: false,
    keyAllowedTypes: [],
    scanAllowedTypes: ALL_SCAN_TYPES
  }
] as const satisfies readonly OperatorDef[];

/** Tightened union of every operator's lowercase internal value. */
export type OperatorValue = (typeof FILTER_OPERATORS)[number]['value'];

/**
 * O(1) registry lookup. Loose-keyed (`Record<string, OperatorDef>`) so boundary
 * callers must guard `if (!def)` — the runtime value is `undefined` for unknown
 * keys.
 */
export const OPERATOR_BY_VALUE: Readonly<Record<string, OperatorDef>> = Object.fromEntries(
  FILTER_OPERATORS.map((op) => [op.value, op])
);

/** Key-eligible operators (KeyConditionExpression compatible). */
export const KEY_OPERATORS: readonly OperatorDef[] = FILTER_OPERATORS.filter(
  (op) => op.keyAllowedTypes.length > 0
);

export type FilterOperatorOption = (typeof FILTER_OPERATORS)[number];

/**
 * Operators applicable to a scan value of the given type. Undefined type → full
 * list. Filters/conditions use this.
 */
export function getCompatibleFilterOperators(
  type: FilterDataType | undefined
): readonly FilterOperatorOption[] {
  if (!type) return FILTER_OPERATORS;
  return FILTER_OPERATORS.filter((op) =>
    (op.scanAllowedTypes as readonly FilterDataType[]).includes(type)
  );
}

/**
 * Key-eligible operators compatible with the given key type. Undefined → full
 * key list. Range-key UI uses this (type-gated: N gets `<`/`between`, S/B get
 * `begins_with`, all keys get `=`).
 */
export function getCompatibleComparisonOperators(
  type: 'S' | 'N' | 'B' | undefined
): readonly OperatorDef[] {
  if (!type) return KEY_OPERATORS;
  return KEY_OPERATORS.filter((op) => (op.keyAllowedTypes as readonly string[]).includes(type));
}
