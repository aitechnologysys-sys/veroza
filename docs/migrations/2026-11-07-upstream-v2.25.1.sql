-- Upstream sync step 3: Postiz v2.25.1 schema changes (folds in v2.25.0).
-- Generated 2026-11-07 with:
--   pnpm dlx prisma@6.5.0 migrate diff --from-schema-datamodel <schema before step 3> \
--     --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --script
-- NOT APPLIED ANYWHERE YET. Apply AFTER 2026-11-07-upstream-v2.24.0.sql, and
-- follow docs/database-migrations.md (migrate:diff against the live DB first,
-- back up, then migrate:apply).
--
-- Review notes:
-- * Additive: Integration.customName (rename a channel in-app, original name
--   kept), Post.batchId (group schedules), Comments threading/anchoring columns
--   (parentId, displayName, anchorStart/End/Quote, resolvedAt), the new
--   OAuthSelfHostedAuthorization table (MCP self-hosted relay, only used when
--   MCP_SELF_HOSTED_RELAY=true), and 5 indexes. All new columns are nullable.
-- * Not purely additive, but no data loss: Comments.userId becomes nullable
--   (anonymous preview comments), and the Comments -> User foreign key is
--   re-created with ON DELETE SET NULL (it was RESTRICT). Existing rows are
--   untouched.
-- * No DROP TABLE, no DROP COLUMN, no type change, no NOT NULL without default.

-- DropForeignKey
ALTER TABLE "Comments" DROP CONSTRAINT "Comments_userId_fkey";

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "customName" TEXT;

-- AlterTable
ALTER TABLE "Comments" ADD COLUMN     "anchorEnd" INTEGER,
ADD COLUMN     "anchorQuote" TEXT,
ADD COLUMN     "anchorStart" INTEGER,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "OAuthSelfHostedAuthorization" (
    "id" TEXT NOT NULL,
    "oauthAppId" TEXT NOT NULL,
    "mcpUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "email" TEXT,
    "accessToken" TEXT,
    "authorizationCode" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeChallenge" TEXT,
    "codeChallengeMethod" TEXT,
    "redirectUri" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthSelfHostedAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OAuthSelfHostedAuthorization_accessToken_idx" ON "OAuthSelfHostedAuthorization"("accessToken");

-- CreateIndex
CREATE INDEX "OAuthSelfHostedAuthorization_authorizationCode_idx" ON "OAuthSelfHostedAuthorization"("authorizationCode");

-- CreateIndex
CREATE INDEX "OAuthSelfHostedAuthorization_oauthAppId_idx" ON "OAuthSelfHostedAuthorization"("oauthAppId");

-- CreateIndex
CREATE INDEX "UserOrganization_organizationId_idx" ON "UserOrganization"("organizationId");

-- CreateIndex
CREATE INDEX "Comments_parentId_idx" ON "Comments"("parentId");

-- CreateIndex
CREATE INDEX "Comments_resolvedAt_idx" ON "Comments"("resolvedAt");

-- CreateIndex
CREATE INDEX "Post_batchId_idx" ON "Post"("batchId");

-- AddForeignKey
ALTER TABLE "Comments" ADD CONSTRAINT "Comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comments" ADD CONSTRAINT "Comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthSelfHostedAuthorization" ADD CONSTRAINT "OAuthSelfHostedAuthorization_oauthAppId_fkey" FOREIGN KEY ("oauthAppId") REFERENCES "OAuthApp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
