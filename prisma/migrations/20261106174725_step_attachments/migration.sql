-- v1.19.0: per-step campaign attachments. Bytes live in the database,
-- capped at 1 MB per file by src/lib/attachments.ts.

-- CreateTable
CREATE TABLE "StepAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StepAttachment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StepAttachment_workspaceId_idx" ON "StepAttachment"("workspaceId");

-- CreateIndex
CREATE INDEX "StepAttachment_campaignId_stepOrder_idx" ON "StepAttachment"("campaignId", "stepOrder");
