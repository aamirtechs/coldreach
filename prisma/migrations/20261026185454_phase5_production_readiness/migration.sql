-- CreateIndex
CREATE INDEX "EmailEvent_workspaceId_createdAt_idx" ON "EmailEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Enrollment_campaignId_status_nextSendAt_idx" ON "Enrollment"("campaignId", "status", "nextSendAt");

-- CreateIndex
CREATE INDEX "Thread_workspaceId_status_updatedAt_idx" ON "Thread"("workspaceId", "status", "updatedAt");
