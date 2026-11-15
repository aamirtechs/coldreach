-- Subscription keys (v1.32.0). One key grants one paid plan for a
-- fixed number of days when redeemed; only the code hash is stored.
CREATE TABLE "SubscriptionKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'UNUSED',
    "note" TEXT,
    "createdByUserId" TEXT,
    "redeemedByWorkspaceId" TEXT,
    "redeemedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionKey_redeemedByWorkspaceId_fkey" FOREIGN KEY ("redeemedByWorkspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SubscriptionKey_codeHash_key" ON "SubscriptionKey"("codeHash");
CREATE INDEX "SubscriptionKey_status_idx" ON "SubscriptionKey"("status");
CREATE INDEX "SubscriptionKey_redeemedByWorkspaceId_idx" ON "SubscriptionKey"("redeemedByWorkspaceId");
