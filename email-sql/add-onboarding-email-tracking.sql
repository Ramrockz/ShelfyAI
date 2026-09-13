-- Run this once in Supabase's SQL Editor.
-- Onboarding was explicitly called out in add-first-time-email-tracking.sql
-- as NOT fitting that batch's "first ever X" milestone pattern (it's tied to
-- the account itself, not a data milestone) and as having no endpoint/
-- trigger built yet -- see api/send-onboarding-email.js for that.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS onboarding_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN user_settings.onboarding_email_sent_at IS
  'Set once the onboarding/welcome email has been sent for this account. NULL means not yet sent.';
