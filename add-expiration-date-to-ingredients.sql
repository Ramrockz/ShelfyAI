-- Lets items with a shelf life (food, cosmetics, chemicals) surface an
-- "expiring soon"/"expired" badge and filter chip the same way min_stock
-- drives the existing low-stock badge/filter -- most businesses will
-- never set this, so it's treated as absent rather than requiring an
-- opt-in. Written by the New/Edit Item forms in ingredients.html and
-- ingredient-detail.html; read by getExpiryState() in ingredients.html
-- (badges, the "Expiring" chip, and its count/visibility).

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS expiration_date DATE;
