-- Run this in Supabase's SQL Editor.
-- Needed for the "you've hit your monthly AI scan limit" email
-- (emails/ai-limit-reached.html, to be sent from
-- api/send-ai-limit-email.js) to send exactly once per reset period.
--
-- Unlike the "first ever X" emails (email-sql/add-first-time-email-tracking.sql),
-- this limit resets every month -- so instead of a plain "sent or not"
-- timestamp, this stores WHICH month it was last sent for ('YYYY-MM', same
-- shape ai_usage_tracking already keys by). The endpoint only needs to
-- compare this against the current year-month to know whether this
-- month's email has gone out yet, with no separate "reset" step required
-- when the month rolls over.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS ai_limit_email_sent_month TEXT;

COMMENT ON COLUMN user_settings.ai_limit_email_sent_month IS
  'Year-month ("YYYY-MM") the "AI scan limit reached" email was last sent for. NULL or a past month means this month''s email has not been sent yet.';
