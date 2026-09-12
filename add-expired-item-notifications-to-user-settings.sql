-- Add expired_item_notifications column to user_settings table
-- This column stores whether users want to be notified (in-app + push) when an item's expiration date has passed

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS expired_item_notifications BOOLEAN NOT NULL DEFAULT true;

-- Update existing rows to have the default value
UPDATE user_settings
SET expired_item_notifications = true
WHERE expired_item_notifications IS NULL;
