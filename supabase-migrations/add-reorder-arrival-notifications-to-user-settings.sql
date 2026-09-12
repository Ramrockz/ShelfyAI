-- Add reorder_arrival_notifications column to user_settings table
-- This column stores whether users want to be notified (in-app + push) when a pending reorder is expected to arrive today

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS reorder_arrival_notifications BOOLEAN NOT NULL DEFAULT true;

-- Update existing rows to have the default value
UPDATE user_settings
SET reorder_arrival_notifications = true
WHERE reorder_arrival_notifications IS NULL;
