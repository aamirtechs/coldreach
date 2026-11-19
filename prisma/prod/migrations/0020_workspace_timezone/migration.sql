-- Workspace timezone (v1.42.0): daily counters roll over at midnight in this zone.
ALTER TABLE "Workspace" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
