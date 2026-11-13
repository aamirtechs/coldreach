-- v1.24.0: per-workspace hourly send cap. When set, the send
-- worker measures the workspace's per-domain hourly send count
-- against this ceiling instead of the platform default, so a
-- workspace whose mail host allows less than the default can
-- stay under its own host's limit. Nullable: null keeps the
-- platform default behaviour.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "hourlySendCap" INTEGER;
