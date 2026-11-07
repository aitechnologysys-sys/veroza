-- Upstream sync step 4: Postiz upstream/main at 5a131eb0 (v2.25.2, v2.25.3 and 56 later commits).
-- Generated 2026-11-07 with:
--   pnpm dlx prisma@6.5.0 migrate diff --from-schema-datamodel <schema before step 4> \
--     --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --script
-- NOT APPLIED ANYWHERE YET. Apply AFTER 2026-11-07-upstream-v2.24.0.sql and
-- 2026-11-07-upstream-v2.25.1.sql, and follow docs/database-migrations.md
-- (migrate:diff against the live DB first, back up, then migrate:apply).
--
-- Review notes:
-- * Purely additive: one nullable column (User.timezoneName, the IANA zone the
--   browser reports) and 5 indexes (post list / calendar queries,
--   notifications, the errors page, OAuth login lookup).
-- * CREATE INDEX locks writes to the table while it builds. Post is the
--   largest table; on a big production table consider running these two Post
--   statements as CREATE INDEX CONCURRENTLY outside a transaction instead.
-- * No DROP, no type change, no NOT NULL without default.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timezoneName" TEXT;

-- CreateIndex
CREATE INDEX "User_providerId_providerName_idx" ON "User"("providerId", "providerName");

-- CreateIndex
CREATE INDEX "Post_publishDate_state_deletedAt_parentPostId_integrationId_idx" ON "Post"("publishDate", "state", "deletedAt", "parentPostId", "integrationId", "organizationId", "creationMethod");

-- CreateIndex
CREATE INDEX "Post_organizationId_publishDate_idx" ON "Post"("organizationId", "publishDate");

-- CreateIndex
CREATE INDEX "Notifications_organizationId_createdAt_deletedAt_idx" ON "Notifications"("organizationId", "createdAt", "deletedAt");

-- CreateIndex
CREATE INDEX "Errors_createdAt_platform_idx" ON "Errors"("createdAt", "platform");
