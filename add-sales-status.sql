-- Migration script to add status column to sales table
-- Run this in Supabase SQL Editor

-- Add status column with default value 'processed'
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales' AND column_name = 'status'
  ) THEN
    ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'processed';
    RAISE NOTICE 'Added status column';
  ELSE
    RAISE NOTICE 'status column already exists';
  END IF;
END $$;

-- Add a check constraint to ensure status is one of the valid values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'sales_status_check' AND table_name = 'sales'
  ) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_status_check 
      CHECK (status IN ('processed', 'fulfilled', 'shipped'));
    RAISE NOTICE 'Added status check constraint';
  ELSE
    RAISE NOTICE 'status check constraint already exists';
  END IF;
END $$;

-- Create index on status for faster filtering
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

-- Verify the changes
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'sales' 
ORDER BY ordinal_position;
