import {describe, expect, it} from 'vitest';
import {buildRequest} from '../src/build-request';
import {emitBoto3} from '../src/emit/boto3';
import {emitCli} from '../src/emit/cli';
import {emitPartiql} from '../src/emit/partiql';
import {buildSdkV3Params} from '../src/emit/sdk-v3';
import type {BuilderConfig} from '../src/types';

// The request-level Query/Scan read options (Limit / ScanIndexForward /
// ConsistentRead / ExclusiveStartKey) added for the query-builder tool. All
// ADDITIVE: a config without them must emit byte-identical output (pinned
// project-wide by scripts/build-code-examples.test.ts), so these tests only
// cover the new fields' carry-through and each emitter's handling.

const QUERY: BuilderConfig = {
  operation: 'Query',
  tableName: 'Orders',
  hashKey: {field: 'pk', type: 'S', value: 'USER#1'}
};

describe('buildRequest — read options carry-through', () => {
  it('Query carries limit/consistentRead/scanIndexForward:false/exclusiveStartKey', () => {
    const request = buildRequest({
      ...QUERY,
      limit: 25,
      consistentRead: true,
      scanIndexForward: false,
      exclusiveStartKey: [
        {field: 'pk', type: 'S', value: 'USER#1'},
        {field: 'sk', type: 'S', value: 'ORDER#41'}
      ]
    });
    expect(request.limit).toBe(25);
    expect(request.consistentRead).toBe(true);
    expect(request.scanIndexForward).toBe(false);
    expect(request.exclusiveStartKey).toEqual({
      pk: {type: 'S', value: 'USER#1'},
      sk: {type: 'S', value: 'ORDER#41'}
    });
  });

  it('the DynamoDB defaults are omitted, not emitted (true forward order, false consistency)', () => {
    const request = buildRequest({...QUERY, scanIndexForward: true, consistentRead: false});
    expect(request.scanIndexForward).toBeUndefined();
    expect(request.consistentRead).toBeUndefined();
  });

  it('Scan carries limit but never scanIndexForward (Query-only param)', () => {
    const request = buildRequest({
      operation: 'Scan',
      tableName: 'Orders',
      limit: 10,
      scanIndexForward: false
    });
    expect(request.limit).toBe(10);
    expect(request.scanIndexForward).toBeUndefined();
  });

  it('GetItem carries consistentRead but no limit', () => {
    const request = buildRequest({
      operation: 'GetItem',
      tableName: 'Orders',
      key: [{field: 'pk', type: 'S', value: 'USER#1'}],
      consistentRead: true,
      limit: 5
    });
    expect(request.consistentRead).toBe(true);
    expect(request.limit).toBeUndefined();
  });

  it('fails loud on a non-positive or non-integer limit', () => {
    expect(() => buildRequest({...QUERY, limit: 0})).toThrow('Limit must be a positive integer');
    expect(() => buildRequest({...QUERY, limit: 2.5})).toThrow('Limit must be a positive integer');
  });

  it('an empty exclusiveStartKey list is omitted', () => {
    const request = buildRequest({...QUERY, exclusiveStartKey: []});
    expect(request.exclusiveStartKey).toBeUndefined();
  });
});

describe('SDK v3 / boto3 params — read options', () => {
  it('maps to Limit/ConsistentRead/ScanIndexForward/ExclusiveStartKey', () => {
    const params = buildSdkV3Params(
      buildRequest({
        ...QUERY,
        limit: 25,
        consistentRead: true,
        scanIndexForward: false,
        exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]
      })
    );
    expect(params.Limit).toBe(25);
    expect(params.ConsistentRead).toBe(true);
    expect(params.ScanIndexForward).toBe(false);
    expect(params.ExclusiveStartKey).toEqual({pk: {S: 'USER#1'}});
  });

  it('boto3 renders them as Python kwargs (True/False literals)', () => {
    const out = emitBoto3(
      buildRequest({...QUERY, limit: 25, consistentRead: true, scanIndexForward: false})
    );
    expect(out).toContain('Limit=25,');
    expect(out).toContain('ConsistentRead=True,');
    expect(out).toContain('ScanIndexForward=False,');
  });
});

describe('CLI — read options', () => {
  it('emits --consistent-read / --no-scan-index-forward / --page-size', () => {
    const out = emitCli(
      buildRequest({...QUERY, limit: 25, consistentRead: true, scanIndexForward: false})
    );
    expect(out).toContain('--consistent-read');
    expect(out).toContain('--no-scan-index-forward');
    // The CLI auto-paginates: the API Limit is its per-call --page-size.
    expect(out).toContain(`--page-size '25'`);
    expect(out).not.toContain('--limit');
  });

  it('has no --exclusive-start-key — an honest --starting-token comment instead', () => {
    const out = emitCli(
      buildRequest({...QUERY, exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]})
    );
    // No flag LINE (the honest comment mentions the name; the command must not).
    expect(out.split('\n').some((l) => l.trimStart().startsWith('--exclusive-start-key'))).toBe(
      false
    );
    expect(out).toContain('# The AWS CLI has no --exclusive-start-key');
    expect(out).toContain('--starting-token');
    // Comments precede the command — the shell command itself stays intact.
    expect(out.split('\n').findIndex((l) => l.startsWith('aws dynamodb'))).toBe(2);
  });
});

describe('PartiQL — read options degrade honestly (API params, not statement text)', () => {
  it('Limit degrades', () => {
    const result = emitPartiql(buildRequest({...QUERY, limit: 25}));
    expect(result).toEqual({ok: false, reason: expect.stringContaining('Limit')});
  });

  it('ConsistentRead degrades', () => {
    const result = emitPartiql(buildRequest({...QUERY, consistentRead: true}));
    expect(result).toEqual({ok: false, reason: expect.stringContaining('ConsistentRead')});
  });

  it('ExclusiveStartKey degrades (NextToken is opaque)', () => {
    const result = emitPartiql(
      buildRequest({...QUERY, exclusiveStartKey: [{field: 'pk', type: 'S', value: 'USER#1'}]})
    );
    expect(result).toEqual({ok: false, reason: expect.stringContaining('NextToken')});
  });

  it('descending WITH a sort-key condition → ORDER BY <sort key> DESC', () => {
    const result = emitPartiql(
      buildRequest({
        ...QUERY,
        rangeKey: {field: 'sk', type: 'S', operator: 'begins_with', value: 'ORDER#'},
        scanIndexForward: false
      })
    );
    expect(result).toEqual({
      ok: true,
      statement: expect.stringContaining('ORDER BY "sk" DESC')
    });
  });

  it('descending WITHOUT a sort-key condition degrades (sort key unknown)', () => {
    const result = emitPartiql(buildRequest({...QUERY, scanIndexForward: false}));
    expect(result).toEqual({ok: false, reason: expect.stringContaining('sort key')});
  });
});

// (The Zod BuilderConfigSchema round-trip lives with the URL-state layer in the
// DynoTable web repo — the schema is a consumer of this package's types, not
// part of it.)
