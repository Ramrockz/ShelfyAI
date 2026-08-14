-- Add expiring_soon_notifications column to user_settings table
-- This column stores whether users want to be notified (in-app + push) when an item is within 7 days of its expiration date

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS expiring_soon_notifications BOOLEAN NOT NULL DEFAULT true;

-- Update existing rows to have the default value
UPDATE user_settings
SET expiring_soon_notifications = true
WHERE expiring_soon_notifications IS NULL;
