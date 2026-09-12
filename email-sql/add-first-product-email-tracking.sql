-- Run this in Supabase's SQL Editor.
-- Needed for the "you built your first product" welcome email
-- (emails/first-product-created.html, to be sent from
-- api/send-first-product-email.js) to send exactly once per account instead
-- of on every product/recipe a user creates.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS first_product_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN user_settings.first_product_email_sent_at IS
  'Set once the "you built your first product" welcome email has been sent for this account. NULL means not yet sent.';
