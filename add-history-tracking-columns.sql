-- Add tracking columns to ingredient_history table
-- These columns track the reason for quantity changes and reference information

ALTER TABLE ingredient_history 
ADD COLUMN IF NOT EXISTS reason VARCHAR(50),
ADD COLUMN IF NOT EXISTS reference_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS reference_text TEXT;

-- Add comments to document the columns
COMMENT ON COLUMN ingredient_history.reason IS 'Reason for quantity change: manual, order, expense, or restock';
COMMENT ON COLUMN ingredient_history.reference_id IS 'ID reference for the change (e.g., sale_id, expense_id)';
COMMENT ON COLUMN ingredient_history.reference_text IS 'Human-readable reference text (e.g., Order #123, Manual adjustment)';
