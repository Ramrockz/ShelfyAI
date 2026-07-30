-- Multi-supplier support for ingredients (reorder-17b feature).
-- Run once in the Supabase SQL Editor.
--
-- Existing ingredients only ever had a single vendor (source_url +
-- cost_per_unit + estimated_delivery). This adds a real supplier registry
-- so one ingredient can have several suppliers with their own price/lead
-- time/minimum-order-value, and "ship together" can find other ingredients
-- that share a supplier. There's no bulk backfill here — the app
-- materializes a first supplier row from an ingredient's existing
-- source_url/cost_per_unit/estimated_delivery the first time the reorder
-- screen opens for it (see materializeDefaultSupplier() in
-- ingredient-detail.html), so this migration only needs to create empty
-- tables + policies.

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL,
  store_id UUID,
  name TEXT NOT NULL,
  website_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingredient_suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL,
  price DECIMAL(10,2) DEFAULT 0,
  lead_time_days INTEGER,
  moq DECIMAL(10,2) DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,
  last_ordered_at DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_profile_id ON suppliers(profile_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_suppliers_ingredient_id ON ingredient_suppliers(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_suppliers_supplier_id ON ingredient_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_suppliers_profile_id ON ingredient_suppliers(profile_id);

-- update_updated_at_column() already exists (created alongside recipes/
-- expenses) — reused here rather than redefined.
DROP TRIGGER IF EXISTS update_suppliers_updated_at ON suppliers;
CREATE TRIGGER update_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ingredient_suppliers_updated_at ON ingredient_suppliers;
CREATE TRIGGER update_ingredient_suppliers_updated_at
  BEFORE UPDATE ON ingredient_suppliers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enable_read_access" ON suppliers;
DROP POLICY IF EXISTS "enable_insert_access" ON suppliers;
DROP POLICY IF EXISTS "enable_update_access" ON suppliers;
DROP POLICY IF EXISTS "enable_delete_access" ON suppliers;

CREATE POLICY "enable_read_access"
ON suppliers FOR SELECT
TO authenticated
USING (profile_id::text = (SELECT auth.uid()::text));

CREATE POLICY "enable_insert_access"
ON suppliers FOR INSERT
TO authenticated
WITH CHECK (profile_id::text = (SELECT auth.uid()::text));

CREATE POLICY "enable_update_access"
ON suppliers FOR UPDATE
TO authenticated
USING (profile_id::text = (SELECT auth.uid()::text))
WITH CHECK (profile_id::text = (SELECT auth.uid()::text));

CREATE POLICY "enable_delete_access"
ON suppliers FOR DELETE
TO authenticated
USING (profile_id::text = (SELECT auth.uid()::text));

DROP POLICY IF EXISTS "enable_read_access" ON ingredient_suppliers;
DROP POLICY IF EXISTS "enable_insert_access" ON ingredient_suppliers;
DROP POLICY IF EXISTS "enable_update_access" ON ingredient_suppliers;
DROP POLICY IF EXISTS "enable_delete_access" ON ingredient_suppliers;

CREATE POLICY "enable_read_access"
ON ingredient_suppliers FOR SELECT
TO authenticated
USING (profile_id::text = (SELECT auth.uid()::text));

CREATE POLICY "enable_insert_access"
ON ingredient_suppliers FOR INSERT
TO authenticated
WITH CHECK (profile_id::text = (SELECT auth.uid()::text));

CREATE POLICY "enable_update_access"
ON ingredient_suppliers FOR UPDATE
TO authenticated
USING (profile_id::text = (SELECT auth.uid()::text))
WITH CHECK (profile_id::text = (SELECT auth.uid()::text));

CREATE POLICY "enable_delete_access"
ON ingredient_suppliers FOR DELETE
TO authenticated
USING (profile_id::text = (SELECT auth.uid()::text));
