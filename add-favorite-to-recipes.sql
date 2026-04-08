-- Add is_favorite column to recipes table
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;

-- Create index for faster favorite queries
CREATE INDEX IF NOT EXISTS idx_recipes_is_favorite ON recipes(profile_id, is_favorite);
