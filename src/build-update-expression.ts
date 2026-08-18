// UpdateExpression compiler — SET / REMOVE / ADD / DELETE, the SET idioms
// (list_append, if_not_exists, arithmetic), atomic counters, and list-index
// removal. Compiles a list of {@link UpdateAction}s into a
// single `SET …, REMOVE … ADD … DELETE …` expression plus the fresh
// names/typedValues maps it references.
//
// Conventions matching the rest of the builder:
//  - placeholders are namespaced with the `upd` prefix (`#upd{i}` /
//    `:updValue{i}`), so update placeholders never collide with key
//    (`#hashKey`/…), filter (`#filter{i}`), or condition (`#cond{i}`) ones.
//  - the name alias goes through `#upd{i}` so reserved words are always safe.
//    Atomic counters and `if_not_exists`/`list_append` reuse the SAME `#upd{i}`
//    on both sides (`#upd0 = #upd0 + :updValue0`), which is what makes them
//    in-place updates rather than copies.
//  - each action's index in the *input* list is its placeholder suffix, so
//    placeholders stay globally unique even after the actions are regrouped by
//    clause kind for emission.
//  - values are captured as the TypedValue the action already carries; the type
//    tag drives marshalling downstream (an ADD `:n` tagged `N` vs a set tagged
//    `NS` marshal completely differently).

import type {TypedValue, UpdateAction} from './types';

export interface UpdateExpressionResult {
  expression: string;
  names: Record<string, string>;
  typedValues: Record<string, TypedValue>;
}

/** DynamoDB clause order. SET, REMOVE, ADD, DELETE — each emitted at most once. */
const CLAUSE_ORDER = ['SET', 'REMOVE', 'ADD', 'DELETE'] as const;

/**
 * Compile update actions into one UpdateExpression. Returns null for an empty
 * list. Callers (buildRequest) merge the returned maps; this never mutates
 * shared state. Actions are grouped by kind into the canonical
 * `SET … REMOVE … ADD … DELETE …` order while preserving each action's input
 * order within its clause.
 */
export function buildUpdateExpression(actions: UpdateAction[]): UpdateExpressionResult | null {
  if (actions.length === 0) return null;

  const names: Record<string, string> = {};
  const typedValues: Record<string, TypedValue> = {};
  const clauses: Record<string, string[]> = {
    SET: [],
    REMOVE: [],
    ADD: [],
    DELETE: []
  };

  actions.forEach((action, index) => {
    const nameRef = `#upd${index}`;
    names[nameRef] = action.field;
    const valueRef = `:updValue${index}`;

    switch (action.kind) {
      case 'SET':
        clauses.SET.push(compileSet(action, nameRef, valueRef, typedValues));
        break;
      case 'REMOVE':
        // No value for REMOVE; an optional list-element index targets `#a[2]`.
        clauses.REMOVE.push(action.index === undefined ? nameRef : `${nameRef}[${action.index}]`);
        break;
      case 'ADD':
        typedValues[valueRef] = requireValue(action);
        // `ADD #a :n` — atomic number add (N) or set union (NS/SS/BS).
        clauses.ADD.push(`${nameRef} ${valueRef}`);
        break;
      case 'DELETE':
        typedValues[valueRef] = requireValue(action);
        // `DELETE #a :s` — remove members from a set (NS/SS/BS).
        clauses.DELETE.push(`${nameRef} ${valueRef}`);
        break;
    }
  });

  const expression = CLAUSE_ORDER.filter((kind) => clauses[kind].length > 0)
    .map((kind) => `${kind} ${clauses[kind].join(', ')}`)
    .join(' ');

  return {expression, names, typedValues};
}

/** Compile one SET action's RHS per its idiom, capturing the typed value. */
function compileSet(
  action: UpdateAction,
  nameRef: string,
  valueRef: string,
  typedValues: Record<string, TypedValue>
): string {
  const value = requireValue(action);
  typedValues[valueRef] = value;
  switch (action.setOp ?? 'assign') {
    case 'assign':
      return `${nameRef} = ${valueRef}`;
    case 'if_not_exists':
      return `${nameRef} = if_not_exists(${nameRef}, ${valueRef})`;
    case 'add': // atomic counter — same alias both sides
      return `${nameRef} = ${nameRef} + ${valueRef}`;
    case 'subtract':
      return `${nameRef} = ${nameRef} - ${valueRef}`;
    case 'list_append': // append the new value to the tail
      return `${nameRef} = list_append(${nameRef}, ${valueRef})`;
    case 'list_prepend': // prepend — operand order is what flips it
      return `${nameRef} = list_append(${valueRef}, ${nameRef})`;
  }
}

/** Fail loud: a value-bearing action (SET/ADD/DELETE) must carry a value. */
function requireValue(action: UpdateAction): TypedValue {
  if (!action.value) {
    throw new Error(`Update action ${action.kind} on "${action.field}" requires a value`);
  }
  return action.value;
}
