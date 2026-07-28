ALTER TABLE recipes ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES recipes(id) ON DELETE SET NULL;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_recipes_parent_id ON recipes(parent_id);
CREATE INDEX IF NOT EXISTS idx_recipes_attributes ON recipes USING gin(attributes);
