-- Records what was actually ordered when a reorder is placed, so the
-- dashboard's Pending Deliveries panel can show a real quantity and
-- supplier name instead of just "something is on the way". Populated by
-- placeReorder() in ingredient-detail.html; read by operations.html's
-- loadInboundStatus(). Not cleared on delivery/cancel -- harmless since
-- both are only ever read while reorder_pending is true, and always
-- overwritten the next time a reorder is placed.

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS reorder_quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS reorder_supplier_id UUID REFERENCES suppliers(id);
