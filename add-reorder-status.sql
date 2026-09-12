-- Add reorder_pending column to ingredients table
-- This tracks whether an ingredient has been reordered but not yet received

ALTER TABLE ingredients 
ADD COLUMN IF NOT EXISTS reorder_pending BOOLEAN DEFAULT FALSE;

-- Add comment to document the column
COMMENT ON COLUMN ingredients.reorder_pending IS 'Indicates if ingredient has been reordered and is pending receipt';
