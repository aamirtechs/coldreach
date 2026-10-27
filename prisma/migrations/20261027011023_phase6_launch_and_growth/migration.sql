-- CreateTable
CREATE TABLE "CrmConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "encryptedCredentials" TEXT,
    "externalAccountId" TEXT,
    "lastSyncAt" DATETIME,
    "lastSyncSummary" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CrmConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "listId" TEXT,
    "email" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "verificationDetail" JSONB,
    "verifiedAt" DATETIME,
    "tags" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Lead_listId_fkey" FOREIGN KEY ("listId") REFERENCES "LeadList" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Lead" ("createdAt", "email", "fields", "id", "listId", "status", "tags", "updatedAt", "workspaceId") SELECT "createdAt", "email", "fields", "id", "listId", "status", "tags", "updatedAt", "workspaceId" FROM "Lead";
DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
CREATE INDEX "Lead_workspaceId_status_idx" ON "Lead"("workspaceId", "status");
CREATE UNIQUE INDEX "Lead_workspaceId_email_key" ON "Lead"("workspaceId", "email");
CREATE TABLE "new_SendingAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "warmupStatus" TEXT NOT NULL DEFAULT 'OFF',
    "warmupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "warmupStartedAt" DATETIME,
    "credentialRef" TEXT,
    "encryptedCredentials" TEXT,
    "tokenExpiresAt" DATETIME,
    "lastSyncAt" DATETIME,
    "syncCursor" TEXT,
    "providerAccountId" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SendingAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SendingAccount" ("createdAt", "credentialRef", "dailyLimit", "displayName", "email", "encryptedCredentials", "id", "lastError", "lastSyncAt", "provider", "providerAccountId", "status", "syncCursor", "tokenExpiresAt", "updatedAt", "warmupStatus", "workspaceId") SELECT "createdAt", "credentialRef", "dailyLimit", "displayName", "email", "encryptedCredentials", "id", "lastError", "lastSyncAt", "provider", "providerAccountId", "status", "syncCursor", "tokenExpiresAt", "updatedAt", "warmupStatus", "workspaceId" FROM "SendingAccount";
DROP TABLE "SendingAccount";
ALTER TABLE "new_SendingAccount" RENAME TO "SendingAccount";
CREATE INDEX "SendingAccount_workspaceId_idx" ON "SendingAccount"("workspaceId");
CREATE UNIQUE INDEX "SendingAccount_workspaceId_email_key" ON "SendingAccount"("workspaceId", "email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CrmConnection_workspaceId_idx" ON "CrmConnection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmConnection_workspaceId_provider_key" ON "CrmConnection"("workspaceId", "provider");
