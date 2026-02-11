/**
 * Test 06 — Data Type Mappings
 *
 * Verifies that all three type-mapping layers produce correct and consistent
 * results for every supported PostgreSQL / Drizzle ORM data type:
 *
 *   1. mapPostgresType  — DB introspection → internal type
 *   2. normalizeType    — normalises types for diff comparison
 *   3. _columnTypeSQL   — internal type → SQL DDL output
 *
 * Also tests that unknown / unmapped types fall through gracefully.
 */

import { SchemaDiffGenerator } from '../src/generate.mjs';
import { suite, assert, eq, includes, summary } from './helpers.mjs';

function makeGenerator() {
  const gen = new SchemaDiffGenerator({
    config: {
      schemaDir: '/tmp',
      migrationsDir: '/tmp/migrations',
      masterChangelog: '/tmp/cl.xml',
      diff: {},
    },
  });
  gen.config = gen._configOverride;
  gen.options = { ...gen.config.diff };
  return gen;
}

const gen = makeGenerator();

// ═══════════════════════════════════════════════════════════════════
// mapPostgresType — DB → internal
// ═══════════════════════════════════════════════════════════════════

suite('mapPostgresType — numeric types');
eq(gen.mapPostgresType('integer', null).type, 'integer', 'integer');
eq(gen.mapPostgresType('bigint', null).type, 'bigint', 'bigint');
eq(gen.mapPostgresType('smallint', null).type, 'smallint', 'smallint');
eq(gen.mapPostgresType('numeric', null).type, 'numeric', 'numeric');
eq(gen.mapPostgresType('real', null).type, 'real', 'real');
eq(gen.mapPostgresType('double precision', null).type, 'doublePrecision', 'double precision');

suite('mapPostgresType — string types');
eq(gen.mapPostgresType('character varying', null).type, 'varchar', 'character varying → varchar');
eq(gen.mapPostgresType('character', null).type, 'char', 'character → char');
eq(gen.mapPostgresType('text', null).type, 'text', 'text');

suite('mapPostgresType — boolean');
eq(gen.mapPostgresType('boolean', null).type, 'boolean', 'boolean');

suite('mapPostgresType — date/time types');
eq(gen.mapPostgresType('timestamp without time zone', null).type, 'timestamp', 'timestamp without tz');
eq(gen.mapPostgresType('timestamp with time zone', null).type, 'timestamp', 'timestamp with tz');
eq(gen.mapPostgresType('date', null).type, 'date', 'date');
eq(gen.mapPostgresType('time without time zone', null).type, 'time', 'time without tz');
eq(gen.mapPostgresType('time with time zone', null).type, 'time', 'time with tz');
eq(gen.mapPostgresType('interval', null).type, 'interval', 'interval');

suite('mapPostgresType — JSON types');
eq(gen.mapPostgresType('json', null).type, 'json', 'json');
eq(gen.mapPostgresType('jsonb', null).type, 'jsonb', 'jsonb');

suite('mapPostgresType — binary / UUID');
eq(gen.mapPostgresType('uuid', null).type, 'uuid', 'uuid');
eq(gen.mapPostgresType('bytea', null).type, 'bytea', 'bytea');

suite('mapPostgresType — network types');
eq(gen.mapPostgresType('inet', null).type, 'inet', 'inet');
eq(gen.mapPostgresType('cidr', null).type, 'cidr', 'cidr');
eq(gen.mapPostgresType('macaddr', null).type, 'macaddr', 'macaddr');
eq(gen.mapPostgresType('macaddr8', null).type, 'macaddr8', 'macaddr8');

suite('mapPostgresType — geometric types');
eq(gen.mapPostgresType('point', null).type, 'point', 'point');
eq(gen.mapPostgresType('line', null).type, 'line', 'line');

suite('mapPostgresType — USER-DEFINED / enums');
eq(gen.mapPostgresType('USER-DEFINED', 'order_status').type, 'varchar', 'user-defined → varchar');
eq(gen.mapPostgresType('USER-DEFINED', 'order_status').enumName, 'order_status', 'preserves enum name');

suite('mapPostgresType — arrays');
{
  const result = gen.mapPostgresType('ARRAY', '_text');
  eq(result.type, 'text', 'array base type extracted');
  eq(result.isArray, true, 'isArray flag set');
}
{
  const result = gen.mapPostgresType('ARRAY', '_int4');
  eq(result.isArray, true, 'int4 array isArray');
}

suite('mapPostgresType — unknown types fall through');
{
  const result = gen.mapPostgresType('tsvector', null);
  eq(result.type, 'tsvector', 'tsvector passed through as-is');
  eq(result.isArray, false, 'not array');
}
{
  const result = gen.mapPostgresType('money', null);
  eq(result.type, 'money', 'money passed through as-is');
}

// ═══════════════════════════════════════════════════════════════════
// normalizeType — type normalisation for comparison
// ═══════════════════════════════════════════════════════════════════

suite('normalizeType — PG long names → short names');
eq(gen.normalizeType('character varying'), 'varchar', 'character varying → varchar');
eq(gen.normalizeType('character'), 'char', 'character → char');
eq(gen.normalizeType('timestamp without time zone'), 'timestamp', 'timestamp without tz');
eq(gen.normalizeType('timestamp with time zone'), 'timestamptz', 'timestamp with tz');
eq(gen.normalizeType('time without time zone'), 'time', 'time without tz');
eq(gen.normalizeType('time with time zone'), 'timetz', 'time with tz');
eq(gen.normalizeType('double precision'), 'float8', 'double precision → float8');

suite('normalizeType — Drizzle names → PG short names');
eq(gen.normalizeType('integer'), 'int4', 'integer → int4');
eq(gen.normalizeType('bigint'), 'int8', 'bigint → int8');
eq(gen.normalizeType('smallint'), 'int2', 'smallint → int2');
eq(gen.normalizeType('boolean'), 'bool', 'boolean → bool');
eq(gen.normalizeType('serial'), 'int4', 'serial → int4');
eq(gen.normalizeType('bigserial'), 'int8', 'bigserial → int8');
eq(gen.normalizeType('smallserial'), 'int2', 'smallserial → int2');
eq(gen.normalizeType('doublePrecision'), 'float8', 'doublePrecision → float8');
eq(gen.normalizeType('real'), 'float4', 'real → float4');
eq(gen.normalizeType('decimal'), 'numeric', 'decimal → numeric');

suite('normalizeType — already-normalised types pass through');
eq(gen.normalizeType('varchar'), 'varchar', 'varchar unchanged');
eq(gen.normalizeType('text'), 'text', 'text unchanged');
eq(gen.normalizeType('jsonb'), 'jsonb', 'jsonb unchanged');
eq(gen.normalizeType('uuid'), 'uuid', 'uuid unchanged');
eq(gen.normalizeType('inet'), 'inet', 'inet unchanged');
eq(gen.normalizeType('interval'), 'interval', 'interval unchanged');

suite('normalizeType — unknown types lowercase and pass through');
eq(gen.normalizeType('TSVECTOR'), 'tsvector', 'TSVECTOR lowercased');
eq(gen.normalizeType('money'), 'money', 'money passed through');

// ═══════════════════════════════════════════════════════════════════
// _columnTypeSQL — internal type → SQL DDL
// ═══════════════════════════════════════════════════════════════════

suite('_columnTypeSQL — core types');
eq(gen._columnTypeSQL({ type: 'varchar' }), 'VARCHAR', 'varchar');
eq(gen._columnTypeSQL({ type: 'char' }), 'CHAR', 'char');
eq(gen._columnTypeSQL({ type: 'text' }), 'TEXT', 'text');
eq(gen._columnTypeSQL({ type: 'integer' }), 'INTEGER', 'integer');
eq(gen._columnTypeSQL({ type: 'serial' }), 'SERIAL', 'serial');
eq(gen._columnTypeSQL({ type: 'bigint' }), 'BIGINT', 'bigint');
eq(gen._columnTypeSQL({ type: 'bigserial' }), 'BIGSERIAL', 'bigserial');
eq(gen._columnTypeSQL({ type: 'smallint' }), 'SMALLINT', 'smallint');
eq(gen._columnTypeSQL({ type: 'smallserial' }), 'SMALLSERIAL', 'smallserial');
eq(gen._columnTypeSQL({ type: 'boolean' }), 'BOOLEAN', 'boolean');
eq(gen._columnTypeSQL({ type: 'numeric' }), 'NUMERIC', 'numeric');
eq(gen._columnTypeSQL({ type: 'real' }), 'REAL', 'real');
eq(gen._columnTypeSQL({ type: 'doublePrecision' }), 'DOUBLE PRECISION', 'doublePrecision');

suite('_columnTypeSQL — date/time types');
eq(gen._columnTypeSQL({ type: 'timestamp' }), 'TIMESTAMP', 'timestamp');
eq(gen._columnTypeSQL({ type: 'date' }), 'DATE', 'date');
eq(gen._columnTypeSQL({ type: 'time' }), 'TIME', 'time');
eq(gen._columnTypeSQL({ type: 'interval' }), 'INTERVAL', 'interval');

suite('_columnTypeSQL — JSON / binary / UUID');
eq(gen._columnTypeSQL({ type: 'json' }), 'JSON', 'json');
eq(gen._columnTypeSQL({ type: 'jsonb' }), 'JSONB', 'jsonb');
eq(gen._columnTypeSQL({ type: 'uuid' }), 'UUID', 'uuid');
eq(gen._columnTypeSQL({ type: 'bytea' }), 'BYTEA', 'bytea');

suite('_columnTypeSQL — network types');
eq(gen._columnTypeSQL({ type: 'inet' }), 'INET', 'inet');
eq(gen._columnTypeSQL({ type: 'cidr' }), 'CIDR', 'cidr');
eq(gen._columnTypeSQL({ type: 'macaddr' }), 'MACADDR', 'macaddr');
eq(gen._columnTypeSQL({ type: 'macaddr8' }), 'MACADDR8', 'macaddr8');

suite('_columnTypeSQL — geometric types');
eq(gen._columnTypeSQL({ type: 'point' }), 'POINT', 'point');
eq(gen._columnTypeSQL({ type: 'line' }), 'LINE', 'line');

suite('_columnTypeSQL — vector (pgvector)');
eq(gen._columnTypeSQL({ type: 'vector' }), 'VECTOR', 'vector');

suite('_columnTypeSQL — varchar with length');
eq(gen._columnTypeSQL({ type: 'varchar', args: 'length: 255' }), 'VARCHAR(255)', 'varchar(255)');
eq(gen._columnTypeSQL({ type: 'varchar', args: 'length: 50' }), 'VARCHAR(50)', 'varchar(50)');

suite('_columnTypeSQL — array suffix');
eq(gen._columnTypeSQL({ type: 'text', isArray: true }), 'TEXT[]', 'text[]');
eq(gen._columnTypeSQL({ type: 'integer', isArray: true }), 'INTEGER[]', 'integer[]');
eq(gen._columnTypeSQL({ type: 'jsonb', isArray: true }), 'JSONB[]', 'jsonb[]');

suite('_columnTypeSQL — enum mapped to varchar');
eq(gen._columnTypeSQL({ type: 'varchar', enumName: 'order_status' }), 'VARCHAR', 'enum → VARCHAR');

suite('_columnTypeSQL — unknown types uppercased');
eq(gen._columnTypeSQL({ type: 'tsvector' }), 'TSVECTOR', 'tsvector → TSVECTOR');
eq(gen._columnTypeSQL({ type: 'money' }), 'MONEY', 'money → MONEY');

// ═══════════════════════════════════════════════════════════════════
// Round-trip: mapPostgresType → normalizeType consistency
// ═══════════════════════════════════════════════════════════════════

suite('Round-trip — DB type through mapPostgresType + normalizeType matches Drizzle normalised');
{
  // A Drizzle schema says `integer(...)` → AST parses as type 'integer'
  // DB reports `integer` → mapPostgresType → 'integer'
  // Both go through normalizeType and should match
  const pairs = [
    ['integer', 'integer'],
    ['bigint', 'bigint'],
    ['smallint', 'smallint'],
    ['boolean', 'boolean'],
    ['text', 'text'],
    ['character varying', 'varchar'],
    ['numeric', 'numeric'],
    ['uuid', 'uuid'],
    ['jsonb', 'jsonb'],
    ['json', 'json'],
    ['date', 'date'],
    ['bytea', 'bytea'],
    ['inet', 'inet'],
    ['interval', 'interval'],
  ];

  for (const [pgType, drizzleType] of pairs) {
    const fromDb = gen.normalizeType(gen.mapPostgresType(pgType, null).type);
    const fromDrizzle = gen.normalizeType(drizzleType);
    eq(fromDb, fromDrizzle, `${pgType} ↔ ${drizzleType} round-trip`);
  }
}

suite('Round-trip — double precision / doublePrecision');
{
  const fromDb = gen.normalizeType(gen.mapPostgresType('double precision', null).type);
  const fromDrizzle = gen.normalizeType('doublePrecision');
  eq(fromDb, fromDrizzle, 'double precision ↔ doublePrecision');
}

suite('Round-trip — real');
{
  const fromDb = gen.normalizeType(gen.mapPostgresType('real', null).type);
  const fromDrizzle = gen.normalizeType('real');
  eq(fromDb, fromDrizzle, 'real ↔ real');
}

suite('Round-trip — serial variants normalise to base integer types');
{
  eq(gen.normalizeType('serial'), gen.normalizeType('integer'), 'serial == integer');
  eq(gen.normalizeType('bigserial'), gen.normalizeType('bigint'), 'bigserial == bigint');
  eq(gen.normalizeType('smallserial'), gen.normalizeType('smallint'), 'smallserial == smallint');
}

// ═══════════════════════════════════════════════════════════════════

summary();
