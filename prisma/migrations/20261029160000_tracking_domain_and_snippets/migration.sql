-- v1.11.0: custom tracking domain on the workspace, and inbox snippets.
-- CLICKED already exists in the EmailEventType enum, so click tracking
-- needs no enum change here.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "trackingDomain" TEXT;

-- CreateTable
CREATE TABLE "Snippet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Snippet_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Snippet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Snippet_workspaceId_createdAt_idx" ON "Snippet"("workspaceId", "createdAt");
