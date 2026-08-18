import {describe, expect, it} from 'vitest';
import {buildRequest} from '../../src/build-request';
import {emitPartiql} from '../../src/emit/partiql';
import type {PartiqlResult} from '../../src/emit/partiql';
import type {BuilderConfig} from '../../src/types';

/** Assert ok and return the statement (narrows the union for the test body). */
function stmt(result: ReturnType<typeof emitPartiql>): string {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.statement;
}

describe('emitPartiql — expressible operations', () => {
  it('Query (begins_with range + between filter) → SELECT with key + filter in WHERE', () => {
    const config: BuilderConfig = {
      operation: 'Query',
      tableName: 'Events',
      hashKey: {field: 'pk', type: 'S', value: 'TENANT#1'},
      rangeKey: {
        field: 'sk',
        type: 'S',
        operator: 'begins_with',
        value: 'LOG#'
      },
      filters: [
        {
          field: 'age',
          operator: 'between',
          type: 'N',
          value: '18',
          value2: '65'
        }
      ]
    };
    expect(stmt(emitPartiql(buildRequest(config)))).toBe(
      `SELECT *
FROM "Events"
WHERE "pk" = 'TENANT#1'
  AND begins_with("sk", 'LOG#')
  AND "age" BETWEEN 18 AND 65`
    );
  });

  it('Query on an index with a projection → FROM "T"."idx", SELECT attrs', () => {
    const out = stmt(
      emitPartiql(
        buildRequest({
          operation: 'Query',
          tableName: 'Events',
          indexName: 'gsi1',
          hashKey: {field: 'pk', type: 'S', value: 'A'},
          projection: ['id', 'name']
        })
      )
    );
    expect(out).toBe(
      `SELECT "id", "name"
FROM "Events"."gsi1"
WHERE "pk" = 'A'`
    );
  });

  it('Scan with a non-key filter → filter lands in WHERE (not dropped)', () => {
    const out = stmt(
      emitPartiql(
        buildRequest({
          operation: 'Scan',
          tableName: 'Users',
          filters: [{field: 'active', operator: '=', type: 'BOOL', value: 'true'}]
        })
      )
    );
    expect(out).toBe(`SELECT *
FROM "Users"
WHERE "active" = true`);
  });

  it('Scan with no filters → no WHERE clause', () => {
    const out = stmt(emitPartiql(buildRequest({operation: 'Scan', tableName: 'Users'})));
    expect(out).toBe(`SELECT *
FROM "Users"`);
  });

  it('GetItem → SELECT * WHERE full key', () => {
    const out = stmt(
      emitPartiql(
        buildRequest({
          operation: 'GetItem',
          tableName: 'T',
          key: [
            {field: 'pk', type: 'S', value: 'U#1'},
            {field: 'sk', type: 'N', value: '7'}
          ]
        })
      )
    );
    expect(out).toBe(`SELECT *
FROM "T"
WHERE "pk" = 'U#1'
  AND "sk" = 7`);
  });

  it('Update (SET-assign + REMOVE) → UPDATE … WHERE key', () => {
    const out = stmt(
      emitPartiql(
        buildRequest({
          operation: 'Update',
          tableName: 'Counters',
          key: [{field: 'pk', type: 'S', value: 'C#1'}],
          updates: [
            {
              kind: 'SET',
              field: 'name',
              setOp: 'assign',
              value: {type: 'S', value: 'bob'}
            },
            {kind: 'REMOVE', field: 'tmp'}
          ]
        })
      )
    );
    expect(out).toBe(
      `UPDATE "Counters"
SET "name" = 'bob'
REMOVE "tmp"
WHERE "pk" = 'C#1'`
    );
  });

  it('Delete → DELETE FROM … WHERE full key', () => {
    const out = stmt(
      emitPartiql(
        buildRequest({
          operation: 'Delete',
          tableName: 'T',
          key: [{field: 'pk', type: 'S', value: 'U#1'}]
        })
      )
    );
    expect(out).toBe(`DELETE FROM "T"
WHERE "pk" = 'U#1'`);
  });

  it('Put → INSERT INTO … VALUE {…}', () => {
    const out = stmt(
      emitPartiql(
        buildRequest({
          operation: 'Put',
          tableName: 'T',
          item: [
            {field: 'pk', type: 'S', value: 'U#1'},
            {field: 'count', type: 'N', value: '5'},
            {field: 'active', type: 'BOOL', value: 'true'}
          ]
        })
      )
    );
    expect(out).toBe(`INSERT INTO "T" VALUE {'pk': 'U#1', 'count': 5, 'active': true}`);
  });
});

describe('emitPartiql — contains on a set attribute', () => {
  it('marshals a scalar element literal (expressible, not degraded)', () => {
    const out = stmt(
      emitPartiql(
        buildRequest({
          operation: 'Scan',
          tableName: 'T',
          filters: [{field: 'tags', operator: 'contains', type: 'SS', value: 'vip'}]
        })
      )
    );
    expect(out).toBe(`SELECT *
FROM "T"
WHERE contains("tags", 'vip')`);
  });
});

describe('emitPartiql — literal escaping', () => {
  it("O'Brien → single quotes doubled", () => {
    const out = stmt(
      emitPartiql(
        buildRequest({
          operation: 'Scan',
          tableName: 'T',
          filters: [{field: 'name', operator: '=', type: 'S', value: "O'Brien"}]
        })
      )
    );
    expect(out).toBe(`SELECT *
FROM "T"
WHERE "name" = 'O''Brien'`);
  });
});

/** Build a request and assert PartiQL refuses it with a reason mentioning `needle`. */
function expectNotExpressible(config: BuilderConfig, needle: string): void {
  const result: PartiqlResult = emitPartiql(buildRequest(config));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected notExpressible');
  expect(result.reason).toMatch(needle);
}

describe('emitPartiql — honest degradation (reason asserted per case)', () => {
  it('a conditional Put has no INSERT form', () => {
    expectNotExpressible(
      {
        operation: 'Put',
        tableName: 'T',
        item: [{field: 'pk', type: 'S', value: 'U#1'}],
        conditions: [{field: 'pk', operator: 'not_exists', type: 'S', value: ''}]
      },
      'conditional Put'
    );
  });

  it('an ADD update', () => {
    expectNotExpressible(
      {
        operation: 'Update',
        tableName: 'T',
        key: [{field: 'pk', type: 'S', value: 'C#1'}],
        updates: [
          {
            kind: 'ADD',
            field: 'tags',
            value: {type: 'NS', value: '', values: ['1']}
          }
        ]
      },
      'ADD'
    );
  });

  it('a set DELETE update', () => {
    expectNotExpressible(
      {
        operation: 'Update',
        tableName: 'T',
        key: [{field: 'pk', type: 'S', value: 'C#1'}],
        updates: [
          {
            kind: 'DELETE',
            field: 'roles',
            value: {type: 'SS', value: '', values: ['admin']}
          }
        ]
      },
      'DELETE'
    );
  });

  it('an atomic-counter SET idiom (add) — PartiQL has no arithmetic', () => {
    expectNotExpressible(
      {
        operation: 'Update',
        tableName: 'T',
        key: [{field: 'pk', type: 'S', value: 'C#1'}],
        updates: [
          {
            kind: 'SET',
            field: 'views',
            setOp: 'add',
            value: {type: 'N', value: '1'}
          }
        ]
      },
      'atomic counter'
    );
  });

  it('an atomic-counter SET idiom (subtract) — PartiQL has no arithmetic', () => {
    expectNotExpressible(
      {
        operation: 'Update',
        tableName: 'T',
        key: [{field: 'pk', type: 'S', value: 'C#1'}],
        updates: [
          {
            kind: 'SET',
            field: 'views',
            setOp: 'subtract',
            value: {type: 'N', value: '1'}
          }
        ]
      },
      'atomic counter'
    );
  });

  it('an if_not_exists SET idiom', () => {
    expectNotExpressible(
      {
        operation: 'Update',
        tableName: 'T',
        key: [{field: 'pk', type: 'S', value: 'C#1'}],
        updates: [
          {
            kind: 'SET',
            field: 'created',
            setOp: 'if_not_exists',
            value: {type: 'N', value: '1'}
          }
        ]
      },
      'if_not_exists'
    );
  });

  it('a list_append SET idiom', () => {
    expectNotExpressible(
      {
        operation: 'Update',
        tableName: 'T',
        key: [{field: 'pk', type: 'S', value: 'C#1'}],
        updates: [
          {
            kind: 'SET',
            field: 'log',
            setOp: 'list_append',
            value: {type: 'S', value: 'x'}
          }
        ]
      },
      'list_append'
    );
  });

  it('a size() filter comparison', () => {
    expectNotExpressible(
      {
        operation: 'Scan',
        tableName: 'T',
        filters: [{field: 'tags', operator: 'size_gt', type: 'SS', value: '3'}]
      },
      'size'
    );
  });

  it('a binary (B) value has no PartiQL literal form', () => {
    expectNotExpressible(
      {
        operation: 'GetItem',
        tableName: 'T',
        key: [{field: 'pk', type: 'B', value: 'aGVsbG8='}]
      },
      'binary'
    );
  });

  it('a set-typed value has no PartiQL literal form', () => {
    expectNotExpressible(
      {
        operation: 'Put',
        tableName: 'T',
        item: [{field: 'tags', type: 'SS', value: '', values: ['a', 'b']}]
      },
      'set-typed'
    );
  });

  it('a non-numeric N value degrades instead of inlining altered SQL', () => {
    // Regression: a bare N literal would inline verbatim, silently altering the
    // statement (e.g. `"age" = 1 OR 1=1`). Must degrade honestly.
    expectNotExpressible(
      {
        operation: 'Scan',
        tableName: 'T',
        filters: [{field: 'age', operator: '=', type: 'N', value: '1 OR 1=1'}]
      },
      'non-numeric N'
    );
  });

  it('a Delete with a condition but no primary key degrades', () => {
    // Regression: buildDelete must mirror buildUpdate — a condition-only WHERE
    // would emit a key-less DELETE that DynamoDB rejects.
    expectNotExpressible(
      {
        operation: 'Delete',
        tableName: 'T',
        conditions: [{field: 'status', operator: '=', type: 'S', value: 'archived'}]
      },
      'primary key'
    );
  });

  it('a GetItem with no key degrades instead of emitting a full scan', () => {
    // Regression: a key-less GetItem must NOT become `SELECT * FROM "T"` — that
    // is a table scan masquerading as a point read.
    expectNotExpressible({operation: 'GetItem', tableName: 'T'}, 'primary key');
  });
});
