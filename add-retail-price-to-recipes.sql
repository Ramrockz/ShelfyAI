-- Add retail_price column to recipes table
-- This migration adds a retail_price field to store the selling price of recipes
-- For existing recipes, it will calculate retail_price as cost * 1.6 (60% markup)

-- Add the retail_price column
ALTER TABLE recipes
ADD COLUMN IF NOT EXISTS retail_price DECIMAL(10, 2);

-- Update existing recipes to set retail_price based on cost
-- If retail_price is null, set it to cost * 1.6 (default 60% markup)
UPDATE recipes
SET retail_price = CASE 
  WHEN retail_price IS NULL AND cost IS NOT NULL THEN cost * 1.6
  ELSE retail_price
END;

-- Create an index on retail_price for faster queries
CREATE INDEX IF NOT EXISTS idx_recipes_retail_price ON recipes(retail_price);
