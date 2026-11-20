-- CreateTable
CREATE TABLE "CallScript" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "objectionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT,
    "scriptId" TEXT,
    "disposition" TEXT NOT NULL,
    "notes" TEXT,
    "durationSeconds" INTEGER,
    "followUpAt" TIMESTAMP(3),
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallScript_workspaceId_createdAt_idx" ON "CallScript"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CallLog_workspaceId_calledAt_idx" ON "CallLog"("workspaceId", "calledAt");

-- CreateIndex
CREATE INDEX "CallLog_workspaceId_followUpAt_idx" ON "CallLog"("workspaceId", "followUpAt");

-- AddForeignKey
ALTER TABLE "CallScript" ADD CONSTRAINT "CallScript_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "CallScript"("id") ON DELETE SET NULL ON UPDATE CASCADE;

