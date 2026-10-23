# Database migrations

Where we deliberately diverge from upstream Postiz, and the procedure that
replaces what we removed.

## The divergence

Upstream's production entrypoint synchronises the schema on every start:

```jsonc
// upstream
"pm2-run": "pm2 delete all || true && pnpm run prisma-db-push && pnpm run --parallel pm2 && pm2 logs"
```

`prisma-db-push` runs `prisma db push --accept-data-loss`. Two consequences we
are not willing to carry in production:

1. **Every container restart rewrites the schema.** Any drift between the live
   database and `schema.prisma` is resolved in favour of the file, and
   `--accept-data-loss` means columns and tables are dropped without a prompt.
2. **Rolling back the application rolls back the schema.** Deploying an older
   image starts it against a newer database, and the push drops whatever that
   image's schema does not know about. A rollback could therefore destroy the
   `MetaDeletionRequest` audit trail — records we are legally obliged to keep.

Our `pm2-run` starts the processes and nothing else:

```jsonc
"pm2-run": "pm2 delete all || true && pnpm run --parallel pm2 && pm2 logs"
```

The Prisma client is still generated: the root `postinstall` runs
`prisma-generate`, which happens during `pnpm install` in the image build
(`Dockerfile.dev:25`). Removing the push does not leave the app without a
client.

## Why not Prisma Migrate

`prisma migrate` needs a migration history, and this repository has never had
one — there is no `migrations/` directory and every schema change to date was
applied with `db push`. Adopting Migrate would mean baselining the production
database first, which is its own risky change. Until that is done deliberately,
schema changes are reviewed SQL.

## Applying a schema change in production

1. **Write the change** in `schema.prisma`.

2. **Generate the SQL** by diffing against the last released schema:

   ```bash
   prisma migrate diff \
     --from-schema-datamodel <previous schema.prisma> \
     --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma \
     --script > docs/migrations/<date>-<name>.sql
   ```

3. **Check it against the live database** before deploying. This is the gate —
   it prints exactly what the live schema is missing, including drift that the
   file-to-file diff cannot see:

   ```bash
   pnpm migrate:diff        # uses $DATABASE_URL
   ```

   Only additive statements (`CREATE TABLE`, `CREATE TYPE`, `CREATE INDEX`,
   `ALTER TABLE ... ADD COLUMN`) are safe to apply unattended. Any `DROP`
   means the live schema has drifted — stop and investigate.

4. **Back up**, then apply:

   ```bash
   pnpm migrate:apply docs/migrations/<date>-<name>.sql
   ```

5. **Deploy** the application image.

## Rollback

Because startup no longer touches the schema, rolling the application back is
just redeploying the previous image. The database keeps the newer schema, which
is safe for additive changes: the older code ignores tables and columns it does
not know about.

Only reverse a schema change if you have decided the data is genuinely
disposable, and then with a reviewed `DROP` of its own.

## Development

`db push` is still the right tool locally, and `pnpm prisma-db-push` is
unchanged. `pnpm pm2-run:with-db-push` reproduces the old start-and-sync
behaviour for a disposable environment or a first-time self-hosted install
where the schema does not exist yet.
