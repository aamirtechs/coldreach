-- Per-campaign follow-up open gate toggle (v1.27.0). Default true
-- preserves the behaviour every existing campaign already runs.
ALTER TABLE "Campaign" ADD COLUMN "requireOpenForFollowUps" BOOLEAN NOT NULL DEFAULT true;
