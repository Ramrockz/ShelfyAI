-- Migration script to add 'refunded' status to sales table
-- Run this in Supabase SQL Editor

-- Drop the existing constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'sales_status_check' AND table_name = 'sales'
  ) THEN
    ALTER TABLE sales DROP CONSTRAINT sales_status_check;
    RAISE NOTICE 'Dropped existing status check constraint';
  ELSE
    RAISE NOTICE 'status check constraint does not exist';
  END IF;
END $$;

-- Add new constraint with 'refunded' included
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'sales_status_check' AND table_name = 'sales'
  ) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_status_check 
      CHECK (status IN ('processed', 'fulfilled', 'shipped', 'refunded'));
    RAISE NOTICE 'Added updated status check constraint with refunded';
  ELSE
    RAISE NOTICE 'status check constraint already exists';
  END IF;
END $$;

-- Verify the changes
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'sales_status_check';
