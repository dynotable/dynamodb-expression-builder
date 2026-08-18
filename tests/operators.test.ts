import {describe, expect, it} from 'vitest';
import {
  FILTER_OPERATORS,
  OPERATOR_BY_VALUE,
  getCompatibleComparisonOperators,
  getCompatibleFilterOperators
} from '../src/operators';

const values = (ops: readonly {value: string}[]) => ops.map((o) => o.value);

describe('getCompatibleComparisonOperators — key operator gating', () => {
  it('S key allows exactly = and begins_with (golden)', () => {
    expect(values(getCompatibleComparisonOperators('S'))).toEqual(['=', 'begins_with']);
  });

  it('N key includes the range operators and excludes begins_with', () => {
    const ops = values(getCompatibleComparisonOperators('N'));
    expect(ops).toEqual(['=', '<', '<=', '>', '>=', 'between']);
    expect(ops).not.toContain('begins_with');
  });

  it('B key allows = and begins_with', () => {
    expect(values(getCompatibleComparisonOperators('B'))).toEqual(['=', 'begins_with']);
  });

  it('undefined type returns the full key-eligible set', () => {
    const ops = values(getCompatibleComparisonOperators(undefined));
    expect(ops).toEqual(['=', '<', '<=', '>', '>=', 'begins_with', 'between']);
  });
});

describe('operator metadata', () => {
  it('requiresValue2 is true only for between', () => {
    const needsTwo = FILTER_OPERATORS.filter((o) => o.requiresValue2).map((o) => o.value);
    expect(needsTwo).toEqual(['between']);
  });

  it('exists / not_exists require no value', () => {
    expect(OPERATOR_BY_VALUE['exists'].requiresValue).toBe(false);
    expect(OPERATOR_BY_VALUE['not_exists'].requiresValue).toBe(false);
  });

  it('maps lowercase value to its wire form', () => {
    expect(OPERATOR_BY_VALUE['begins_with'].wireForm).toBe('BEGINS_WITH');
    expect(OPERATOR_BY_VALUE['between'].wireForm).toBe('BETWEEN');
  });
});

describe('getCompatibleFilterOperators — scan operator gating', () => {
  it('N excludes begins_with and contains, includes the comparisons', () => {
    const ops = values(getCompatibleFilterOperators('N'));
    expect(ops).toContain('<');
    expect(ops).toContain('between');
    expect(ops).toContain('in');
    expect(ops).not.toContain('begins_with');
    expect(ops).not.toContain('contains');
  });

  it('SS exposes contains/size but not the numeric comparisons', () => {
    const ops = values(getCompatibleFilterOperators('SS'));
    expect(ops).toContain('contains');
    expect(ops).toContain('size_eq');
    expect(ops).not.toContain('<');
  });

  it('undefined returns every operator', () => {
    expect(getCompatibleFilterOperators(undefined)).toHaveLength(FILTER_OPERATORS.length);
  });
});
