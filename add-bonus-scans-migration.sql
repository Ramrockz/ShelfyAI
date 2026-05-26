-- Add bonus_scans column to user_settings
-- Run this once in your Supabase SQL editor
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS bonus_scans INTEGER DEFAULT 0 NOT NULL;
