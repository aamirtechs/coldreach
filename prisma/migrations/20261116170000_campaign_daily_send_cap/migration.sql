-- Per-campaign daily send cap (v1.39.0): nullable, null means no cap.
ALTER TABLE "Campaign" ADD COLUMN "dailySendCap" INTEGER;
