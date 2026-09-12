-- Create expenses table for tracking business expenses
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  expense_date DATE NOT NULL,
  vendor TEXT,
  category TEXT,
  receipt_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_expenses_profile_id ON expenses(profile_id);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);

-- Enable Row Level Security
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own expenses"
  ON expenses
  FOR SELECT
  TO authenticated
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert their own expenses"
  ON expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update their own expenses"
  ON expenses
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can delete their own expenses"
  ON expenses
  FOR DELETE
  TO authenticated
  USING (auth.uid() = profile_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_expenses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_expenses_timestamp
  BEFORE UPDATE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_expenses_updated_at();
