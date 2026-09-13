// Called client-side once per account, right after ensureProfileExists(user)
// resolves in auth.js's initUserMenu() (see the localStorage-gated call
// there) -- that client-side gate is just an optimization to avoid hitting
// this endpoint on every single page load once it's already been sent. The
// actual "has this account already gotten its onboarding email" decision is
// made here, server-side, against user_settings.onboarding_email_sent_at, so
// a cleared localStorage or a duplicate call can never send it twice.
//
// Unlike send-first-item-email.js, there's no secondary "is this really
// their first X" data check to make -- onboarding is tied to the account's
// existence, not a data milestone, so the sent_at flag alone is authoritative.
//
// Needs RESEND_API_KEY (Vercel env var) and
// email-sql/add-onboarding-email-tracking.sql (user_settings.
// onboarding_email_sent_at) run in Supabase before this does anything.
//
// The actual email content lives in Resend's own dashboard-published
// template (id below, assumed to match this file's name -- correct it here
// if the published alias differs), not in emails/onboarding.html -- that
// file is kept only as the source-of-truth copy used to build the Resend
// template, since Resend has no way to sync from a checked-in HTML file.
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Left unset by default so Resend falls back to the published template's own
// configured sender/reply-to instead of this endpoint silently overriding it.
const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || null;

const RESEND_TEMPLATE_ID = 'onboarding';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('onboarding_email_sent_at, unsubscribed_all_emails')
      .eq('user_id', user.id)
      .maybeSingle();
    if (settings?.onboarding_email_sent_at) {
      console.log(`onboarding email skipped for ${user.id}: already_sent at ${settings.onboarding_email_sent_at}`);
      return res.status(200).json({ sent: false, reason: 'already_sent' });
    }
    if (settings?.unsubscribed_all_emails) {
      console.log(`onboarding email skipped for ${user.id}: unsubscribed_all_emails`);
      return res.status(200).json({ sent: false, reason: 'unsubscribed' });
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured -- skipping onboarding email');
      return res.status(200).json({ sent: false, reason: 'email_not_configured' });
    }

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...(EMAIL_FROM ? { from: EMAIL_FROM } : {}),
        to: user.email,
        template: {
          id: RESEND_TEMPLATE_ID,
          variables: {
            unsubscribe_url: `https://www.shelfyai.com/api/unsubscribe?uid=${user.id}`
          }
        }
      })
    });
    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      throw new Error(`Resend API error (${sendRes.status}): ${errBody}`);
    }

    // upsert, not update: a brand-new account may not have a user_settings
    // row yet (created lazily -- see settings.html/onboarding-modal.js), and
    // .update() on a non-existent row silently affects zero rows with no
    // error, which would leave this column permanently null despite the
    // email having actually sent (same fix as send-first-item-email.js).
    await supabaseAdmin
      .from('user_settings')
      .upsert({ user_id: user.id, onboarding_email_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

    console.log(`onboarding email sent to ${user.email} (${user.id})`);
    return res.status(200).json({ sent: true });
  } catch (error) {
    console.error('Error sending onboarding email:', error);
    return res.status(500).json({ error: error.message || 'Failed to send email' });
  }
};
