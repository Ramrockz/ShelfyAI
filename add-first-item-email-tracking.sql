-- Run this in Supabase's SQL Editor.
-- Needed for the new "you added your first item" welcome email
-- (email-templates/first-item-added.html, sent from
-- api/send-first-item-email.js) to send exactly once per account instead
-- of on every item a brand-new user adds while getting their inventory
-- set up.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS first_item_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN user_settings.first_item_email_sent_at IS
  'Set once the "you added your first item" welcome email has been sent for this account. NULL means not yet sent.';
