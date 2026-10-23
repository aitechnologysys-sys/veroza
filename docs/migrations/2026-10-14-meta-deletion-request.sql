-- CreateEnum
CREATE TYPE "MetaApp" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'THREADS');

-- CreateEnum
CREATE TYPE "MetaCallbackType" AS ENUM ('DEAUTHORIZE', 'DATA_DELETION');

-- CreateEnum
CREATE TYPE "MetaDeletionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNMATCHED');

-- CreateTable
CREATE TABLE "MetaDeletionRequest" (
    "id" TEXT NOT NULL,
    "confirmationCode" TEXT NOT NULL,
    "callbackType" "MetaCallbackType" NOT NULL,
    "metaApp" "MetaApp" NOT NULL,
    "metaUserId" TEXT NOT NULL,
    "status" "MetaDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "matchedTargets" TEXT,
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MetaDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaDeletionRequest_confirmationCode_key" ON "MetaDeletionRequest"("confirmationCode");

-- CreateIndex
CREATE INDEX "MetaDeletionRequest_metaApp_metaUserId_idx" ON "MetaDeletionRequest"("metaApp", "metaUserId");

-- CreateIndex
CREATE INDEX "MetaDeletionRequest_status_idx" ON "MetaDeletionRequest"("status");

