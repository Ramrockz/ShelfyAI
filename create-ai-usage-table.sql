-- Create AI usage tracking table
CREATE TABLE IF NOT EXISTS ai_usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  ingredient_count INTEGER DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  expense_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Enable RLS
ALTER TABLE ai_usage_tracking ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own usage
CREATE POLICY "Users can view own usage"
  ON ai_usage_tracking
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own usage
CREATE POLICY "Users can insert own usage"
  ON ai_usage_tracking
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own usage
CREATE POLICY "Users can update own usage"
  ON ai_usage_tracking
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ai_usage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function
CREATE TRIGGER ai_usage_updated_at
  BEFORE UPDATE ON ai_usage_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_usage_updated_at();

-- Function to get or create today's usage record
CREATE OR REPLACE FUNCTION get_or_create_usage(p_user_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  date DATE,
  ingredient_count INTEGER,
  order_count INTEGER,
  expense_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  INSERT INTO ai_usage_tracking (user_id, date)
  VALUES (p_user_id, p_date)
  ON CONFLICT (user_id, date) DO UPDATE SET user_id = p_user_id
  RETURNING ai_usage_tracking.id, ai_usage_tracking.user_id, ai_usage_tracking.date, 
            ai_usage_tracking.ingredient_count, ai_usage_tracking.order_count, 
            ai_usage_tracking.expense_count;
END;
$$ LANGUAGE plpgsql;

-- Function to increment ingredient usage
CREATE OR REPLACE FUNCTION increment_ingredient_usage(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO ai_usage_tracking (user_id, date, ingredient_count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date) DO UPDATE 
  SET ingredient_count = ai_usage_tracking.ingredient_count + 1,
      updated_at = NOW();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to increment order usage
CREATE OR REPLACE FUNCTION increment_order_usage(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO ai_usage_tracking (user_id, date, order_count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date) DO UPDATE 
  SET order_count = ai_usage_tracking.order_count + 1,
      updated_at = NOW();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to increment expense usage
CREATE OR REPLACE FUNCTION increment_expense_usage(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO ai_usage_tracking (user_id, date, expense_count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date) DO UPDATE 
  SET expense_count = ai_usage_tracking.expense_count + 1,
      updated_at = NOW();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create index for performance
CREATE INDEX idx_ai_usage_user_date ON ai_usage_tracking(user_id, date);
