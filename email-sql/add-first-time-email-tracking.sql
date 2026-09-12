-- Run this once in Supabase's SQL Editor.
-- Covers every "first time X happened" welcome/milestone email that follows
-- the same send-exactly-once-per-account pattern (see
-- api/send-first-item-email.js for the reference implementation): one
-- user_settings column per trigger, NULL until sent.
--
-- Not covered here on purpose -- these don't fit the same pattern:
--   - subscription-cancelled / subscribed-starter / subscribed-pro /
--     scan-pack-purchased / subscription-cancelled-winback: Stripe-webhook
--     driven, can legitimately fire more than once per account.
--   - onboarding / inactivity-reminder / data-export-ready / account-deleted:
--     not "first ever X" milestones (recurring, action-triggered, or
--     terminal), and have no endpoint/trigger built yet.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS first_item_email_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS first_product_email_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS first_order_email_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS first_expense_email_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS first_ai_order_match_email_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS first_reorder_marked_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN user_settings.first_item_email_sent_at IS
  'Set once the "you added your first item" welcome email has been sent for this account. NULL means not yet sent.';
COMMENT ON COLUMN user_settings.first_product_email_sent_at IS
  'Set once the "you built your first product" welcome email has been sent for this account. NULL means not yet sent.';
COMMENT ON COLUMN user_settings.first_order_email_sent_at IS
  'Set once the "you logged your first order" welcome email has been sent for this account. NULL means not yet sent.';
COMMENT ON COLUMN user_settings.first_expense_email_sent_at IS
  'Set once the "you logged your first expense" welcome email has been sent for this account. NULL means not yet sent.';
COMMENT ON COLUMN user_settings.first_ai_order_match_email_sent_at IS
  'Set once the "Shelfy matched your first order automatically" email has been sent for this account. NULL means not yet sent.';
COMMENT ON COLUMN user_settings.first_reorder_marked_email_sent_at IS
  'Set once the "your first reorder arrived" email has been sent for this account. NULL means not yet sent.';
