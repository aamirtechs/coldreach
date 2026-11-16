-- Platform settings (v1.36.0): key/value rows for platform-wide
-- feature switches set from the admin panel.
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
