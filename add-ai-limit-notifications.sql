-- Add ai_limit_notifications column to user_settings table
-- This column stores whether users want to receive notifications when they reach their daily AI extraction limit

ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS ai_limit_notifications BOOLEAN NOT NULL DEFAULT true;

-- Update existing rows to have the default value
UPDATE user_settings 
SET ai_limit_notifications = true 
WHERE ai_limit_notifications IS NULL;
