// Public API. Three layers, composable top to bottom:
//
//   1. Model     — TypedValue (the type-tag contract), FilterRow/KeyAttr/…,
//                  the operator registry.
//   2. Builders  — buildRequest (config → one CanonicalRequest), plus the
//                  focused compilers it dispatches to (filter/condition,
//                  key condition, update expression) for callers that want
//                  just one expression.
//   3. Emitters  — CanonicalRequest → code: JS SDK v3, AWS CLI, boto3,
//                  PartiQL, Java, Go, .NET, dynamodb-toolbox, and
//                  emitQueryProgram for a complete runnable Query/Scan
//                  program with a pagination loop.

export type {
  BuilderConfig,
  CanonicalRequest,
  DdbOperation,
  DdbScalarType,
  FilterRow,
  ItemAttr,
  KeyAttr,
  RangeKeyCondition,
  SetOperation,
  SetType,
  TypedValue,
  UpdateAction
} from './types';
export {elementType, isSetType, makeTypedValue, SET_TYPES} from './types';

export type {
  FilterDataType,
  FilterOperatorOption,
  OperatorDef,
  OperatorValue,
  WireFilterOperator
} from './operators';
export {
  FILTER_OPERATORS,
  getCompatibleComparisonOperators,
  getCompatibleFilterOperators,
  KEY_OPERATORS,
  OPERATOR_BY_VALUE
} from './operators';

export type {PredicateExpression, PredicatePrefix} from './filter-expressions';
export {buildFilterExpressions} from './filter-expressions';

export type {KeyConditionResult} from './key-command';
export {buildKeyConditionExpression, buildKeyMap} from './key-command';

export {buildRequest} from './build-request';

export type {UpdateExpressionResult} from './build-update-expression';
export {buildUpdateExpression} from './build-update-expression';

export type {AttributeValue} from './emit/marshal';
export {hasBinaryValue, typedMapToAvMap, typedValueToAv} from './emit/marshal';

export {buildSdkV3Params, emitSdkV3, renderJsValue, sdkV3CommandName} from './emit/sdk-v3';
export {emitCli} from './emit/cli';
export {boto3MethodName, emitBoto3, renderPyValue} from './emit/boto3';
export type {PartiqlResult} from './emit/partiql';
export {emitPartiql} from './emit/partiql';
export {emitJava, javaClientMethodName, javaRequestClassName} from './emit/java';
export {emitGo, goClientMethodName, goInputTypeName} from './emit/go';
export {dotnetClientMethodName, dotnetRequestClassName, emitDotnet} from './emit/dotnet';
export {emitDdbToolboxProgram} from './emit/ddbtoolbox';

export type {ProgramResult, QueryProgramFormat, QueryToolConfig} from './program';
export {emitQueryProgram} from './program';
