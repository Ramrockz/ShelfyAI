-- Tracks whether the subscription-cancelled-winback email has been sent for
-- the current cancellation cycle. Set when the winback cron (see the GET
-- branch of api/stripe-webhook.js) sends the email; cleared back to NULL by
-- the webhook whenever cancel_at_period_end goes false again (resubscribe,
-- or un-cancel), so a future cancellation cycle can trigger it again.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS winback_email_sent_at TIMESTAMPTZ;
