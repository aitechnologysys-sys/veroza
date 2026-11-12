-- Upstream sync step 2: Postiz v2.24.0 schema changes.
-- Generated 2026-11-07 with:
--   pnpm dlx prisma@6.5.0 migrate diff --from-schema-datamodel <schema before step 2> \
--     --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --script
-- NOT APPLIED ANYWHERE YET. Follow docs/database-migrations.md (migrate:diff
-- against the live DB first, back up, then migrate:apply).
--
-- Review notes:
-- * Additive: 39 new tables (mostly mastra_* agent memory, Clipping /
--   ClippingClip), 57 indexes, new nullable or defaulted columns.
-- * Subscription.provider TEXT NOT NULL DEFAULT 'stripe': every existing row
--   becomes 'stripe', which is correct (all live subscriptions are Stripe;
--   Polar is parked and has no rows).
-- * Not purely additive, but no data loss: OAuthApp.organizationId and
--   OAuthApp.clientSecret become nullable (dynamic client registration for
--   MCP OAuth), and the OAuthApp -> Organization foreign key is re-created
--   with ON DELETE SET NULL.
-- * ALTER TYPE "Provider" ADD VALUE 'APPLE' (Sign in with Apple). Postgres
--   cannot use a new enum value inside the transaction that adds it; nothing
--   below uses it, so this is safe in one transaction.
-- * Postaryx (2026-11-12): every mastra_* statement (37 tables, 51 indexes,
--   the mastra_ai_spans columns and primary key) was REMOVED from this file.
--   Mastra (@mastra/pg PostgresStore) owns those tables: it creates and
--   upgrades them itself when the backend starts (CREATE TABLE / ADD COLUMN /
--   CREATE INDEX IF NOT EXISTS), and production already had older versions of
--   most of them, which made this file fail. App code never reads them through
--   Prisma. Until the new image has started once, `prisma migrate diff` shows
--   mastra_* differences; those are expected.
-- * No DROP TABLE, no DROP COLUMN.

-- AlterEnum
ALTER TYPE "Provider" ADD VALUE 'APPLE';

-- DropForeignKey
ALTER TABLE "OAuthApp" DROP CONSTRAINT "OAuthApp_organizationId_fkey";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ready';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'stripe';

-- AlterTable
ALTER TABLE "OAuthApp" ADD COLUMN     "dynamic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "redirectUris" TEXT,
ADD COLUMN     "tokenEndpointAuthMethod" TEXT,
ALTER COLUMN "organizationId" DROP NOT NULL,
ALTER COLUMN "clientSecret" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OAuthAuthorization" ADD COLUMN     "codeChallenge" TEXT,
ADD COLUMN     "codeChallengeMethod" TEXT,
ADD COLUMN     "redirectUri" TEXT;

-- CreateTable
CREATE TABLE "Clipping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'analysing',
    "error" TEXT,
    "title" TEXT,
    "thumbnail" TEXT,
    "duration" INTEGER,
    "maxClips" INTEGER NOT NULL DEFAULT 5,
    "fit" TEXT NOT NULL DEFAULT 'blur',
    "integrations" TEXT NOT NULL,
    "creditsId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clipping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClippingClip" (
    "id" TEXT NOT NULL,
    "clippingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "start" DOUBLE PRECISION NOT NULL,
    "end" DOUBLE PRECISION NOT NULL,
    "trimStart" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "mediaId" TEXT,
    "path" TEXT,
    "thumbnail" TEXT,
    "draftedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClippingClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Clipping_organizationId_idx" ON "Clipping"("organizationId");

-- CreateIndex
CREATE INDEX "Clipping_deletedAt_idx" ON "Clipping"("deletedAt");

-- CreateIndex
CREATE INDEX "ClippingClip_clippingId_idx" ON "ClippingClip"("clippingId");

-- CreateIndex
CREATE INDEX "Organization_deletedAt_idx" ON "Organization"("deletedAt");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "OAuthApp_dynamic_idx" ON "OAuthApp"("dynamic");

-- AddForeignKey
ALTER TABLE "Clipping" ADD CONSTRAINT "Clipping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClippingClip" ADD CONSTRAINT "ClippingClip_clippingId_fkey" FOREIGN KEY ("clippingId") REFERENCES "Clipping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthApp" ADD CONSTRAINT "OAuthApp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
