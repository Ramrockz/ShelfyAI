-- Add welcome_notification_sent column to user_settings table
-- Tracks whether the one-time "getting started" notification (linking to
-- the docs/tutorials page) has already been created for this user, so it
-- is never recreated after the user deletes it.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS welcome_notification_sent BOOLEAN NOT NULL DEFAULT false;

-- Update existing rows to have the default value
UPDATE user_settings
SET welcome_notification_sent = false
WHERE welcome_notification_sent IS NULL;
