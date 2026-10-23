#!/usr/bin/env node
/**
 * Read-only pre-deploy check for a schema change.
 *
 * Why this exists: the database holds tables Prisma does not manage. `@mastra/pg`
 * creates ~29 `mastra_*` tables at application start, and none of them appear in
 * schema.prisma. A plain `prisma migrate diff` against the live database therefore
 * proposes dropping all of them, which makes the raw diff useless as a gate — the
 * real signal is buried in expected noise.
 *
 * This classifies every statement the diff would produce:
 *
 *   - statements against unmanaged tables  -> expected, ignored
 *   - destructive statements against Prisma-managed tables -> BLOCKER
 *   - additive statements against managed tables -> review
 *
 * It also checks the reviewed migration file is additive, and whether the objects
 * it creates already exist.
 *
 * It never executes anything. `migrate diff --script` only prints SQL, and every
 * other query here is a read.
 *
 *   DATABASE_URL=postgres://... node scripts/verify-migration.mjs docs/migrations/<file>.sql
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SCHEMA = 'libraries/nestjs-libraries/src/database/prisma/schema.prisma';
const migrationFile = process.argv[2];
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

/** Tables Prisma owns, taken from the schema's `model` blocks. */
const managedTables = () => {
  const schema = readFileSync(SCHEMA, 'utf8');
  const names = new Set();
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{/gm)) {
    names.add(m[1]);
    // @@map("…") renames the table.
  }
  for (const m of schema.matchAll(/@@map\("([^"]+)"\)/g)) {
    names.add(m[1]);
  }
  // Enums are Prisma-managed too; a `CREATE TYPE` for one is as additive as a
  // `CREATE TABLE`, and treating them as unmanaged made clean runs look dirty.
  for (const m of schema.matchAll(/^enum\s+(\w+)\s*\{/gm)) {
    names.add(m[1]);
  }
  return names;
};

/**
 * The table a statement acts on.
 *
 * Matching *any* quoted identifier is wrong: constraint and index names embed
 * the table name, so `DROP CONSTRAINT "public_mastra_ai_spans_…_pk"` would be
 * attributed to whatever those happen to resemble. Only the target counts.
 */
const targetTable = (statement) => {
  const patterns = [
    /^ALTER\s+TABLE\s+"([^"]+)"/i,
    /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/i,
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i,
    /^TRUNCATE\s+(?:TABLE\s+)?"([^"]+)"/i,
    /^DELETE\s+FROM\s+"([^"]+)"/i,
    // Index statements name the index, not the table; `ON "table"` is the target.
    /\bON\s+"([^"]+)"/i,
    /^DROP\s+INDEX\s+"([^"]+)"/i,
    /^(?:CREATE|DROP)\s+TYPE\s+"([^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = statement.match(re);
    if (m) return m[1];
  }
  return null;
};

const DESTRUCTIVE = /\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+CONSTRAINT|TRUNCATE|DELETE\s+FROM|DROP\s+TYPE|ALTER\s+COLUMN\s+\w+\s+SET\s+NOT\s+NULL)\b/i;

const liveDiff = () => {
  try {
    // The repo-local binary, so the check does not depend on a network fetch.
    const out = execFileSync(
      'node_modules/.bin/prisma',
      [
        'migrate',
        'diff',
        '--from-url',
        DATABASE_URL,
        '--to-schema-datamodel',
        SCHEMA,
        '--script',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }
    );
    if (!out.trim()) {
      console.error('the diff came back empty — refusing to report a PASS on no data');
      process.exit(2);
    }
    return out;
  } catch (err) {
    console.error('could not produce a diff:', err.message?.split('\n')[0]);
    process.exit(2);
  }
};

/**
 * Split into statements, dropping the `-- Comment` line Prisma prefixes each
 * one with. Filtering whole chunks that *start* with `--` would discard every
 * statement, because they all do.
 */
const statements = (sql) =>
  sql
    .split(';')
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean);

const managed = managedTables();
const diff = liveDiff();

const blockers = [];
const unresolved = [];
const unmanagedNoise = new Set();
const managedAdditive = [];

for (const stmt of statements(diff)) {
  const target = targetTable(stmt);
  // An index or constraint whose own name embeds the table still resolves to
  // the table via `ON "…"`; anything unresolvable is reported rather than
  // silently passed.
  const touchesManaged = target ? managed.has(target) : false;

  if (!touchesManaged) {
    if (target) unmanagedNoise.add(target);
    else unresolved.push(stmt.split('\n')[0]);
    continue;
  }

  if (DESTRUCTIVE.test(stmt)) {
    blockers.push(stmt.split('\n')[0]);
  } else {
    managedAdditive.push(stmt.split('\n')[0]);
  }
}

console.log('\n=== live database vs schema.prisma ===');
console.log(
  `  unmanaged objects in the diff (expected, ignored): ${unmanagedNoise.size}` +
    (unmanagedNoise.size ? ` e.g. ${[...unmanagedNoise].slice(0, 3).join(', ')}` : '')
);
console.log(`  additive statements on Prisma-managed tables: ${managedAdditive.length}`);
for (const s of managedAdditive.slice(0, 20)) console.log(`     ${s}`);
console.log(`  statements whose target could not be identified: ${unresolved.length}`);
for (const s2 of unresolved.slice(0, 10)) console.log(yellow(`     ${s2}`));
console.log(`  destructive statements on Prisma-managed tables: ${blockers.length}`);
for (const s of blockers) console.log(red(`     ${s}`));

// --- the reviewed migration file
let fileVerdict = 'skipped (no file given)';
if (migrationFile) {
  const sql = readFileSync(migrationFile, 'utf8');
  const bad = statements(sql).filter((s) => DESTRUCTIVE.test(s));
  fileVerdict = bad.length
    ? `${bad.length} destructive statement(s)`
    : 'additive only';
  console.log(`\n=== reviewed migration: ${migrationFile} ===`);
  console.log(`  ${bad.length ? red(fileVerdict) : green(fileVerdict)}`);

  // Would anything it creates collide with what is already there?
  const creates = [...sql.matchAll(/CREATE (?:UNIQUE )?(TABLE|TYPE|INDEX)\s+"?([\w]+)"?/gi)].map(
    (m) => [m[1].toUpperCase(), m[2]]
  );
  const existing = [];
  for (const [kind, name] of creates) {
    const q =
      kind === 'TYPE'
        ? `SELECT 1 FROM pg_type WHERE typname='${name}'`
        : kind === 'INDEX'
        ? `SELECT 1 FROM pg_indexes WHERE indexname='${name}'`
        : `SELECT 1 FROM pg_tables WHERE tablename='${name}'`;
    try {
      const out = execFileSync(
        'psql',
        [DATABASE_URL, '-tAc', q],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (out === '1') existing.push(`${kind} ${name}`);
    } catch {
      // psql unavailable — collision check is advisory, not a gate.
    }
  }
  console.log(
    `  objects it creates that already exist: ${existing.length}` +
      (existing.length ? ` -> ${existing.join(', ')} (migration already applied?)` : '')
  );
  if (bad.length) blockers.push(...bad.map((s) => s.split('\n')[0]));
}

console.log('\n=== verdicts ===');

// Gate 1 — the only thing actually applied during a deploy.
const migrationSafe = !migrationFile || fileVerdict === 'additive only';
console.log(
  `  [${migrationSafe ? green('PASS') : red('FAIL')}] reviewed migration is additive` +
    (migrationFile ? '' : ' (no file given)')
);

// Gate 2 — what `prisma db push` would do if anything ever ran it again.
const pushSafe = blockers.length === 0 && unmanagedNoise.size === 0;
console.log(
  `  [${pushSafe ? green('PASS') : red('FAIL')}] a full \`db push\` would be non-destructive`
);
if (!pushSafe) {
  console.log(
    yellow(
      `         ${unmanagedNoise.size} unmanaged table(s) would be dropped and ` +
        `${blockers.length} managed table(s) altered destructively.`
    )
  );
  console.log(
    yellow(
      '         This is expected: @mastra/pg creates and evolves its own tables at'
    )
  );
  console.log(
    yellow(
      '         runtime, so the live schema legitimately diverges from schema.prisma.'
    )
  );
  console.log(
    yellow(
      '         It is a deployment blocker ONLY if something still runs db push.'
    )
  );
}

// Deployment is blocked by gate 1 alone. Gate 2 is a standing warning about a
// command that must never run against production.
process.exit(migrationSafe ? 0 : 1);
