-- CreateTable: holder_profiles
-- Off-chain profile for a wallet holder. Created on first authenticated GET /profile.

CREATE TABLE "holder_profiles" (
    "wallet_address"             TEXT NOT NULL,
    "display_name"               TEXT,
    "email"                      TEXT,
    "locale"                     TEXT DEFAULT 'en',
    "notification_preferences"   JSONB DEFAULT '{}',
    "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holder_profiles_pkey" PRIMARY KEY ("wallet_address")
);
