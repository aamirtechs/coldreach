-- Platform settings (v1.36.0): key/value rows for platform-wide
-- feature switches set from the admin panel.
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);
