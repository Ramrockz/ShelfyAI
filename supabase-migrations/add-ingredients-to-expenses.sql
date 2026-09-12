-- Add ingredients column to expenses table to track which ingredients were affected
-- Run this in Supabase SQL Editor

-- Add ingredients column if it doesn't exist
-- This will store an array of {ingredient_id, quantity_added, unit} objects
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expenses' AND column_name = 'ingredients'
  ) THEN
    ALTER TABLE expenses ADD COLUMN ingredients JSONB;
    RAISE NOTICE 'Added ingredients column to expenses table';
  ELSE
    RAISE NOTICE 'ingredients column already exists in expenses table';
  END IF;
END $$;

-- Create index on ingredients for faster queries
CREATE INDEX IF NOT EXISTS idx_expenses_ingredients ON expenses USING GIN (ingredients);

-- Example of how ingredients should be stored:
-- ingredients: [
--   {
--     "ingredient_id": "uuid-here",
--     "ingredient_name": "Flour",
--     "quantity_added": 100,
--     "unit": "kg"
--   },
--   {
--     "ingredient_id": "uuid-here-2",
--     "ingredient_name": "Sugar",
--     "quantity_added": 50,
--     "unit": "kg"
--   }
-- ]

COMMENT ON COLUMN expenses.ingredients IS 'Array of ingredients affected by this expense with quantity added and unit';

-- Verify the changes
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'expenses' 
ORDER BY ordinal_position;
