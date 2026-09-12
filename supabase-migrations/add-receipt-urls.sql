-- Add receipt_url column to expenses table (single receipt, for backward compatibility)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- Add receipt_url column to sales table (single receipt, for backward compatibility)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- Add receipt_urls column to expenses table (supports multiple receipts as JSON array)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_urls JSONB;

-- Add receipt_urls column to sales table (supports multiple receipts as JSON array)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_urls JSONB;

-- Create indexes for better performance when querying receipt URLs
CREATE INDEX IF NOT EXISTS idx_expenses_receipt_urls ON expenses USING GIN (receipt_urls);
CREATE INDEX IF NOT EXISTS idx_sales_receipt_urls ON sales USING GIN (receipt_urls);

-- Note: The UI will check receipt_urls first, then fall back to receipt_url if needed
-- Both columns are kept for backward compatibility
