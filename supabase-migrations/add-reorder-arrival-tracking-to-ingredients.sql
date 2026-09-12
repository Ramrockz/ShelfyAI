-- Tracks whether a pending reorder has already triggered its one-time
-- "arrives today" notification (in-app + push), so
-- api/send-reorder-arrival-notifications.js only alerts once per reorder
-- instead of every day until it's confirmed received. Cleared back to NULL
-- by reorder-modal.js's placeReorder() whenever a NEW reorder is placed for
-- an ingredient, so the next delivery re-arms the alert.
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS reorder_arrival_alert_sent_at TIMESTAMP WITH TIME ZONE;
