-- CreateTable
CREATE TABLE "CallScript" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "objectionNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CallScript_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT,
    "scriptId" TEXT,
    "disposition" TEXT NOT NULL,
    "notes" TEXT,
    "durationSeconds" INTEGER,
    "followUpAt" DATETIME,
    "calledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CallLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CallLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CallLog_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "CallScript" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CallScript_workspaceId_createdAt_idx" ON "CallScript"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_workspaceId_calledAt_idx" ON "CallLog"("workspaceId", "calledAt");

-- CreateIndex
CREATE INDEX "CallLog_workspaceId_followUpAt_idx" ON "CallLog"("workspaceId", "followUpAt");

