-- Run this in Supabase's SQL Editor.
-- Master email opt-out, separate from the in-app/push notification toggles
-- (notifications_enabled, ai_limit_notifications, etc.) -- those gate
-- in-app/push alerts, this gates every actual email sent via Resend.
-- Checked by every email-sending endpoint (see api/send-first-item-email.js)
-- before calling the Resend API; set by either the "Unsubscribe from all
-- emails" toggle in Settings > Notifications, or the {{unsubscribe_url}}
-- link in any email template (api/unsubscribe.js).

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS unsubscribed_all_emails BOOLEAN DEFAULT false;

COMMENT ON COLUMN user_settings.unsubscribed_all_emails IS
  'True means the account opted out of every ShelfyAI email (not in-app/push notifications). Checked before every Resend send.';
