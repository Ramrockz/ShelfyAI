-- Per-item opt-out from the dashboard's low/out-of-stock restock alerts.
-- Setting this does NOT affect the Low/Out badges shown on the item
-- itself elsewhere in the app -- it only excludes the item from the
-- dashboard's "Needs Restocking" list, counts, and health bar (see
-- _renderInventoryStatus in operations.html).

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS alert_disabled BOOLEAN NOT NULL DEFAULT false;
