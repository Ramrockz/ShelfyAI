-- Create sales table for tracking revenue from orders
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sale_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  customer TEXT, -- Customer name
  source TEXT NOT NULL, -- e.g., "Amazon", "Website", "In-Store", "Manual Upload"
  items JSONB NOT NULL, -- Array of {name, quantity, price} objects
  total_quantity INTEGER NOT NULL DEFAULT 0,
  revenue DECIMAL(10, 2) NOT NULL,
  notes TEXT,
  order_reference TEXT, -- Optional order/transaction ID
  custom_attributes JSONB, -- Product attributes like {color, size, etc}
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_sales_profile_id ON sales(profile_id);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_source ON sales(source);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer);

-- Enable Row Level Security
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own sales"
  ON sales
  FOR SELECT
  TO authenticated
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert their own sales"
  ON sales
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update their own sales"
  ON sales
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can delete their own sales"
  ON sales
  FOR DELETE
  TO authenticated
  USING (auth.uid() = profile_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sales_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_sales_timestamp
  BEFORE UPDATE ON sales
  FOR EACH ROW
  EXECUTE FUNCTION update_sales_updated_at();
