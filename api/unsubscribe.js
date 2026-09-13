// The {{unsubscribe_url}} target used by every email template. A plain GET
// (email unsubscribe links are clicked, never submitted as a form, and
// mail clients won't attach an auth token) that sets
// user_settings.unsubscribed_all_emails -- see
// email-sql/add-unsubscribed-all-emails.sql. Every email-sending endpoint
// checks that flag before calling Resend (see api/send-first-item-email.js).
//
// Only covers ShelfyAI's own templates sent via Resend -- Stripe sends its
// own payment receipts/invoices directly and has no idea this flag exists,
// so those keep arriving regardless. Don't imply otherwise in any UI copy.
//
// No login required by design (same reasoning as any real unsubscribe
// link), so this can't check "is this really you" the way an authenticated
// endpoint would -- the user id in the URL is the only thing gating it.
// That's the accepted trade-off for a one-click unsubscribe: a Supabase
// UUID isn't guessable, so the worst case is someone else with the exact
// link turning your emails back on/off, not a real account compromise.
// Re-subscribing is always available from Settings > Notifications too.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function page(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;min-height:100vh;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="420" cellpadding="0" cellspacing="0" style="width:420px;max-width:100%;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:36px 32px;text-align:center;">
          <tr><td>
            <img src="https://www.shelfyai.com/favicon-512.png" width="40" height="40" alt="ShelfyAI" style="display:block;margin:0 auto 20px;border-radius:10px;">
            <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${title}</h1>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">${message}</p>
            <a href="https://www.shelfyai.com/settings" style="display:inline-block;margin-top:24px;color:#06b6d4;font-size:14px;font-weight:600;text-decoration:none;">Go to Settings</a>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const uid = typeof req.query?.uid === 'string' ? req.query.uid : null;
  if (!uid) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(page('Link incomplete', 'This unsubscribe link is missing some information. You can still manage email preferences from Settings.'));
  }

  try {
    const { error } = await supabaseAdmin
      .from('user_settings')
      .upsert({ user_id: uid, unsubscribed_all_emails: true }, { onConflict: 'user_id' });
    if (error) throw error;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(page(
      "You're unsubscribed",
      "You won't receive any more emails from ShelfyAI, like welcome messages and tips. Payment receipts from Stripe are sent separately and aren't affected. Changed your mind? You can turn this back on any time from Settings."
    ));
  } catch (error) {
    console.error('Error processing unsubscribe:', error);
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(page('Something went wrong', "We couldn't process this unsubscribe request. Please try again from Settings, or contact support if it keeps happening."));
  }
};
