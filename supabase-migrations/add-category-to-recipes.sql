ALTER TABLE recipes ADD COLUMN IF NOT EXISTS category TEXT;
CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
