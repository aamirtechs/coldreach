-- CreateTable
CREATE TABLE "CallLeadList" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallLeadList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "listId" TEXT,
    "serviceSlug" TEXT NOT NULL DEFAULT 'wordpress-speed',
    "temperature" TEXT NOT NULL DEFAULT 'WARM',
    "leadScore" INTEGER,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "website" TEXT,
    "city" TEXT,
    "state" TEXT,
    "timezone" TEXT,
    "decisionMaker" TEXT,
    "namePronunciation" TEXT,
    "fields" JSONB NOT NULL,
    "verifyStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifyNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastCallAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallLead_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CallLog" ADD COLUMN "callLeadId" TEXT;

-- CreateIndex
CREATE INDEX "CallLeadList_workspaceId_createdAt_idx" ON "CallLeadList"("workspaceId", "createdAt");
CREATE INDEX "CallLead_workspaceId_createdAt_idx" ON "CallLead"("workspaceId", "createdAt");
CREATE INDEX "CallLead_workspaceId_listId_idx" ON "CallLead"("workspaceId", "listId");
CREATE INDEX "CallLead_workspaceId_temperature_idx" ON "CallLead"("workspaceId", "temperature");

-- AddForeignKey
ALTER TABLE "CallLeadList" ADD CONSTRAINT "CallLeadList_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLead" ADD CONSTRAINT "CallLead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLead" ADD CONSTRAINT "CallLead_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CallLeadList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_callLeadId_fkey" FOREIGN KEY ("callLeadId") REFERENCES "CallLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
