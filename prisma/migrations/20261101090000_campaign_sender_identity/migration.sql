-- v1.12.0: per-campaign sender identity. senderName overrides the
-- sending account's From display name for that campaign's sends, and
-- senderName / companyName compose the sign-off block when the
-- campaign has no signatureText of its own. Both nullable: null keeps
-- the previous account and workspace fallback behaviour.

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "senderName" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "companyName" TEXT;
