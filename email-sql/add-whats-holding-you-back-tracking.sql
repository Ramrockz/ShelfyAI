-- Run this once in Supabase's SQL Editor.
-- whats-holding-you-back.html was written but never wired up -- see
-- api/send-whats-holding-you-back.js for the cron that sends it. Same
-- send-exactly-once-per-account pattern as every other one-time email here,
-- just cron-triggered (registration date == most recent login date, still
-- true 3 days after signup) instead of action-triggered.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS whats_holding_you_back_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN user_settings.whats_holding_you_back_sent_at IS
  'Set once the "what''s holding you back" re-engagement email has been sent for this account. NULL means not yet sent.';
