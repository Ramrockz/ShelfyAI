-- Migration script to add tracking_number column to sales table
-- Run this in Supabase SQL Editor

-- Add tracking_number column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales' AND column_name = 'tracking_number'
  ) THEN
    ALTER TABLE sales ADD COLUMN tracking_number TEXT;
    RAISE NOTICE 'Added tracking_number column';
  ELSE
    RAISE NOTICE 'tracking_number column already exists';
  END IF;
END $$;

-- Create index for faster tracking number lookups
CREATE INDEX IF NOT EXISTS idx_sales_tracking_number ON sales(tracking_number);

-- Add comment to document the column
COMMENT ON COLUMN sales.tracking_number IS 'Shipping tracking number (e.g., UPS, FedEx, USPS tracking number)';

-- Verify the changes
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'sales' 
ORDER BY ordinal_position;
