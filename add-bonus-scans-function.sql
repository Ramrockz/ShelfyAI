-- Atomic bonus_scans adjustment for user_settings.
--
-- bonus_scans is a single integer with no ledger. A read-then-write from a
-- serverless function (the original pattern in stripe-webhook.js's
-- handleScanPackPurchase, and the scan-consumption decrement in
-- api/extract-receipt.js / api/extract-url.js) can double-spend or lose a
-- credit if two requests for the same user race. A plain UPDATE is atomic
-- at the row level in Postgres, so do the read-modify-write there instead
-- of in application code.
--
-- p_delta is positive to add scans (purchase) or negative to consume one
-- (a scan past the plan limit). GREATEST(...,0) keeps it from going
-- negative regardless of how many concurrent decrements land.
CREATE OR REPLACE FUNCTION adjust_bonus_scans(p_user_id UUID, p_delta INTEGER)
RETURNS INTEGER AS $$
DECLARE
  new_value INTEGER;
BEGIN
  UPDATE user_settings
  SET bonus_scans = GREATEST(COALESCE(bonus_scans, 0) + p_delta, 0)
  WHERE user_id = p_user_id
  RETURNING bonus_scans INTO new_value;

  RETURN new_value;
END;
$$ LANGUAGE plpgsql;
