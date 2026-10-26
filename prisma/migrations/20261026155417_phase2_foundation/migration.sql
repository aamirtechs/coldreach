-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "lastError" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "senderAddress" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "senderName" TEXT;

-- CreateTable
CREATE TABLE "CampaignAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "sendingAccountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignAccount_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignAccount_sendingAccountId_fkey" FOREIGN KEY ("sendingAccountId") REFERENCES "SendingAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "leadListId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "windowStart" TEXT NOT NULL DEFAULT '09:00',
    "windowEnd" TEXT NOT NULL DEFAULT '17:00',
    "businessDaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Campaign_leadListId_fkey" FOREIGN KEY ("leadListId") REFERENCES "LeadList" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Campaign" ("businessDaysOnly", "createdAt", "id", "name", "status", "timezone", "updatedAt", "windowEnd", "windowStart", "workspaceId") SELECT "businessDaysOnly", "createdAt", "id", "name", "status", "timezone", "updatedAt", "windowEnd", "windowStart", "workspaceId" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE INDEX "Campaign_workspaceId_status_idx" ON "Campaign"("workspaceId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CampaignAccount_campaignId_idx" ON "CampaignAccount"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignAccount_campaignId_sendingAccountId_key" ON "CampaignAccount"("campaignId", "sendingAccountId");
