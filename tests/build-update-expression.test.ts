import {describe, expect, it} from 'vitest';
import {buildUpdateExpression} from '../src/build-update-expression';
import type {TypedValue, UpdateAction} from '../src/types';

const n = (value: string): TypedValue => ({type: 'N', value});
const s = (value: string): TypedValue => ({type: 'S', value});
const ns = (...values: string[]): TypedValue => ({
  type: 'NS',
  value: '',
  values
});
const ss = (...values: string[]): TypedValue => ({
  type: 'SS',
  value: '',
  values
});

describe('buildUpdateExpression — clause compilation', () => {
  it('returns null for an empty action list', () => {
    expect(buildUpdateExpression([])).toBeNull();
  });

  it('plain SET assign → `#a = :v` with captured type', () => {
    const r = buildUpdateExpression([
      {kind: 'SET', field: 'status', setOp: 'assign', value: s('active')}
    ])!;
    expect(r.expression).toBe('SET #upd0 = :updValue0');
    expect(r.names).toEqual({'#upd0': 'status'});
    expect(r.typedValues).toEqual({
      ':updValue0': {type: 'S', value: 'active'}
    });
  });

  it('defaults a SET with no setOp to assign', () => {
    const r = buildUpdateExpression([{kind: 'SET', field: 'x', value: s('y')}])!;
    expect(r.expression).toBe('SET #upd0 = :updValue0');
  });

  it('atomic counter uses the SAME alias on both sides (#a = #a + :n)', () => {
    const r = buildUpdateExpression([{kind: 'SET', field: 'views', setOp: 'add', value: n('1')}])!;
    expect(r.expression).toBe('SET #upd0 = #upd0 + :updValue0');
    expect(r.typedValues).toEqual({':updValue0': {type: 'N', value: '1'}});
  });

  it('subtract → `#a = #a - :n`', () => {
    const r = buildUpdateExpression([
      {kind: 'SET', field: 'credits', setOp: 'subtract', value: n('5')}
    ])!;
    expect(r.expression).toBe('SET #upd0 = #upd0 - :updValue0');
  });

  it('if_not_exists wraps the same alias', () => {
    const r = buildUpdateExpression([
      {
        kind: 'SET',
        field: 'created',
        setOp: 'if_not_exists',
        value: n('1700')
      }
    ])!;
    expect(r.expression).toBe('SET #upd0 = if_not_exists(#upd0, :updValue0)');
  });

  it('list_append append vs prepend differ ONLY in operand order', () => {
    const append = buildUpdateExpression([
      {kind: 'SET', field: 'tags', setOp: 'list_append', value: s('new')}
    ])!;
    const prepend = buildUpdateExpression([
      {kind: 'SET', field: 'tags', setOp: 'list_prepend', value: s('new')}
    ])!;
    expect(append.expression).toBe('SET #upd0 = list_append(#upd0, :updValue0)');
    expect(prepend.expression).toBe('SET #upd0 = list_append(:updValue0, #upd0)');
  });

  it('REMOVE plain attribute → just the alias, no value', () => {
    const r = buildUpdateExpression([{kind: 'REMOVE', field: 'obsolete'}])!;
    expect(r.expression).toBe('REMOVE #upd0');
    expect(r.typedValues).toEqual({});
  });

  it('REMOVE a list element → `#a[2]`', () => {
    const r = buildUpdateExpression([{kind: 'REMOVE', field: 'items', index: 2}])!;
    expect(r.expression).toBe('REMOVE #upd0[2]');
    expect(r.typedValues).toEqual({});
  });

  it('REMOVE index 0 is honored (not treated as missing)', () => {
    const r = buildUpdateExpression([{kind: 'REMOVE', field: 'items', index: 0}])!;
    expect(r.expression).toBe('REMOVE #upd0[0]');
  });

  it('ADD number → `ADD #a :n` with N type', () => {
    const r = buildUpdateExpression([{kind: 'ADD', field: 'score', value: n('10')}])!;
    expect(r.expression).toBe('ADD #upd0 :updValue0');
    expect(r.typedValues).toEqual({':updValue0': {type: 'N', value: '10'}});
  });

  it('ADD set → `ADD #a :s` with NS type (number-vs-set distinction)', () => {
    const r = buildUpdateExpression([{kind: 'ADD', field: 'colors', value: ns('1', '2')}])!;
    expect(r.expression).toBe('ADD #upd0 :updValue0');
    expect(r.typedValues[':updValue0']).toEqual({
      type: 'NS',
      value: '',
      values: ['1', '2']
    });
  });

  it('DELETE set → `DELETE #a :s`', () => {
    const r = buildUpdateExpression([{kind: 'DELETE', field: 'tags', value: ss('legacy')}])!;
    expect(r.expression).toBe('DELETE #upd0 :updValue0');
    expect(r.typedValues[':updValue0']).toEqual({
      type: 'SS',
      value: '',
      values: ['legacy']
    });
  });
});

describe('buildUpdateExpression — combined clause ordering + placeholder uniqueness', () => {
  it('groups into canonical SET … REMOVE … ADD … DELETE … regardless of input order', () => {
    const actions: UpdateAction[] = [
      {kind: 'DELETE', field: 'tags', value: ss('old')},
      {kind: 'ADD', field: 'views', value: n('1')},
      {kind: 'REMOVE', field: 'tmp'},
      {kind: 'SET', field: 'status', setOp: 'assign', value: s('done')}
    ];
    const r = buildUpdateExpression(actions)!;
    expect(r.expression).toBe(
      'SET #upd3 = :updValue3 REMOVE #upd2 ADD #upd1 :updValue1 DELETE #upd0 :updValue0'
    );
  });

  it('multiple actions in one clause join with commas, placeholders stay unique', () => {
    const r = buildUpdateExpression([
      {kind: 'SET', field: 'a', setOp: 'assign', value: s('1')},
      {kind: 'SET', field: 'b', setOp: 'add', value: n('2')}
    ])!;
    expect(r.expression).toBe('SET #upd0 = :updValue0, #upd1 = #upd1 + :updValue1');
    expect(r.names).toEqual({'#upd0': 'a', '#upd1': 'b'});
    expect(Object.keys(r.typedValues)).toEqual([':updValue0', ':updValue1']);
  });

  it('a full SET-increment + REMOVE + ADD + DELETE compiles end to end', () => {
    const r = buildUpdateExpression([
      {kind: 'SET', field: 'updatedAt', setOp: 'assign', value: n('1700')},
      {kind: 'SET', field: 'count', setOp: 'add', value: n('1')},
      {kind: 'REMOVE', field: 'draft'},
      {kind: 'ADD', field: 'visitors', value: ns('42')},
      {kind: 'DELETE', field: 'flags', value: ss('beta')}
    ])!;
    expect(r.expression).toBe(
      'SET #upd0 = :updValue0, #upd1 = #upd1 + :updValue1 ' +
        'REMOVE #upd2 ADD #upd3 :updValue3 DELETE #upd4 :updValue4'
    );
    expect(r.names).toEqual({
      '#upd0': 'updatedAt',
      '#upd1': 'count',
      '#upd2': 'draft',
      '#upd3': 'visitors',
      '#upd4': 'flags'
    });
  });

  it('reserved words ride through the alias — no raw attribute name in the expression', () => {
    const r = buildUpdateExpression([
      {kind: 'SET', field: 'status', setOp: 'assign', value: s('x')},
      {kind: 'REMOVE', field: 'size'}
    ])!;
    expect(r.expression).not.toMatch(/\bstatus\b/);
    expect(r.expression).not.toMatch(/\bsize\b/);
    expect(r.names['#upd0']).toBe('status');
    expect(r.names['#upd1']).toBe('size');
  });
});

describe('buildUpdateExpression — fail loud', () => {
  it('throws when a value-bearing action is missing its value', () => {
    expect(() => buildUpdateExpression([{kind: 'ADD', field: 'x'}])).toThrow(/requires a value/);
    expect(() => buildUpdateExpression([{kind: 'SET', field: 'x', setOp: 'assign'}])).toThrow(
      /requires a value/
    );
  });
});
