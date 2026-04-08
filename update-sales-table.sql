-- Migration script to add customer and custom_attributes columns to existing sales table
-- Run this in Supabase SQL Editor if the sales table already exists

-- Add customer column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales' AND column_name = 'customer'
  ) THEN
    ALTER TABLE sales ADD COLUMN customer TEXT;
    RAISE NOTICE 'Added customer column';
  ELSE
    RAISE NOTICE 'customer column already exists';
  END IF;
END $$;

-- Add custom_attributes column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales' AND column_name = 'custom_attributes'
  ) THEN
    ALTER TABLE sales ADD COLUMN custom_attributes JSONB;
    RAISE NOTICE 'Added custom_attributes column';
  ELSE
    RAISE NOTICE 'custom_attributes column already exists';
  END IF;
END $$;

-- Create index on customer if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer);

-- Verify the changes
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sales' 
ORDER BY ordinal_position;
