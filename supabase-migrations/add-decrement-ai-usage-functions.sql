-- Refund a scan's usage count when the user discards a scanned result
-- without saving anything (mirrors increment_ingredient_usage/
-- increment_order_usage/increment_expense_usage in create-ai-usage-table.sql).
-- The scan itself (the paid AgentQL call) already happened by the time
-- these run -- this only gives back what the user's remaining monthly
-- quota looks like, as a courtesy for a scan they ended up not using.
-- GREATEST(0, ...) prevents ever going negative; the WHERE clause means a
-- missing row (shouldn't happen -- a row is created the moment the scan
-- was counted) is a safe no-op rather than an error.
--
-- No new RLS policy needed: these functions are plain (not SECURITY
-- DEFINER), so they run with the caller's own privileges -- the existing
-- "Users can update own usage" policy (auth.uid() = user_id) on
-- ai_usage_tracking already governs the UPDATE below, the same way it
-- already governs increment_*_usage's INSERT ... ON CONFLICT DO UPDATE.

CREATE OR REPLACE FUNCTION decrement_ingredient_usage(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE ai_usage_tracking
  SET ingredient_count = GREATEST(0, ingredient_count - 1),
      updated_at = NOW()
  WHERE user_id = p_user_id AND date = CURRENT_DATE;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_order_usage(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE ai_usage_tracking
  SET order_count = GREATEST(0, order_count - 1),
      updated_at = NOW()
  WHERE user_id = p_user_id AND date = CURRENT_DATE;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_expense_usage(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE ai_usage_tracking
  SET expense_count = GREATEST(0, expense_count - 1),
      updated_at = NOW()
  WHERE user_id = p_user_id AND date = CURRENT_DATE;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
