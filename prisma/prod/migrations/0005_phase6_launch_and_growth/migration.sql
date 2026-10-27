-- CreateEnum
CREATE TYPE "LeadVerificationStatus" AS ENUM ('UNKNOWN', 'VALID', 'RISKY', 'INVALID');

-- AlterTable
ALTER TABLE "SendingAccount" ADD COLUMN     "warmupEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warmupStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "verificationDetail" JSONB,
ADD COLUMN     "verificationStatus" "LeadVerificationStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CrmConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "encryptedCredentials" TEXT,
    "externalAccountId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmConnection_workspaceId_idx" ON "CrmConnection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmConnection_workspaceId_provider_key" ON "CrmConnection"("workspaceId", "provider");

-- AddForeignKey
ALTER TABLE "CrmConnection" ADD CONSTRAINT "CrmConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

