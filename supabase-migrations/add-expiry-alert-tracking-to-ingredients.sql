-- Tracks whether an ingredient has already triggered its one-time "item
-- expired" notification (in-app + push), so api/send-expiry-notifications.js
-- only alerts once per item instead of every day it stays expired.
-- Cleared back to NULL by ingredients.html/ingredient-detail.html whenever
-- expiration_date is edited, so fixing/extending the date re-arms the alert.
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS expiry_alert_sent_at TIMESTAMP WITH TIME ZONE;
