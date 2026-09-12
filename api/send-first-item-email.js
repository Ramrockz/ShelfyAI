// Called client-side right after a successful ingredient save (see
// ingredients.html's saveIngredient() and expenses.html's
// saveQuickIngredient()) whenever the client's own count suggests this was
// the user's first-ever item. That client-side check is just an optimization
// to avoid calling this on every single item -- the actual "is this really
// their first, and have we already emailed them" decision is made here,
// server-side, against the database, so a stale client count or a duplicate
// call can never send the email twice or send it on item #2.
//
// Needs RESEND_API_KEY (Vercel env var) and the
// email-sql/add-first-item-email-tracking.sql migration run in Supabase
// (user_settings.first_item_email_sent_at) before this does anything.
//
// The actual email content lives in Resend's own dashboard-published
// template (id below), not in emails/first-item-created.html -- that file
// is kept only as the source-of-truth copy that was used to build the
// Resend template, since Resend has no way to sync from a checked-in HTML
// file. If the wording ever needs to change, edit both.
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || 'ShelfyAI <hello@shelfyai.com>';

// Resend's own published template, referenced by its alias/slug (Resend's
// `template.id` field accepts either the UUID or the alias) -- named
// "first-product-created" in the Resend dashboard, but its actual
// content/purpose is this item-created trigger (a pre-existing naming
// mismatch on Resend's side, confirmed with the user -- not a bug here).
const RESEND_TEMPLATE_ID = 'first-product-created';

// No DOM available server-side (unlike the app's own client-side
// escapeHtml() helpers), so this is the plain string version -- item
// names/attribute values are user input, injected into the email via
// Resend's template variables below.
function escapeHtmlServer(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Same convention as the app's own attribute badges (expenses.html's
// receipt-mapping cards, ingredient-detail.html, etc.) -- just the values,
// joined by " · ", no key names shown. Empty/missing attributes (a manual
// item added without any, though the New Item form normally requires at
// least one) render as nothing rather than an empty "()" .
function formatAttributesSuffix(attrs) {
  if (!attrs || typeof attrs !== 'object') return '';
  const values = Object.values(attrs).map((v) => String(v == null ? '' : v).trim()).filter(Boolean);
  if (!values.length) return '';
  return ` <span style="color:#64748b; font-weight:400;">(${values.map(escapeHtmlServer).join(' · ')})</span>`;
}

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

    const itemName = typeof req.body?.itemName === 'string' ? req.body.itemName.slice(0, 200) : 'your first item';
    const itemAttributes = req.body?.itemAttributes && typeof req.body.itemAttributes === 'object' ? req.body.itemAttributes : null;

    // Source of truth for "has this already been sent" -- never trust the
    // client to only call this once.
    const { data: settings } = await supabaseAdmin
      .from('user_settings')
      .select('first_item_email_sent_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (settings?.first_item_email_sent_at) {
      return res.status(200).json({ sent: false, reason: 'already_sent' });
    }

    // Source of truth for "is this actually their first item" -- a client
    // relying on its own in-memory cache could be wrong (another tab, a
    // stale page, a CSV import racing a manual add).
    const { count, error: countError } = await supabaseAdmin
      .from('ingredients')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', user.id);
    if (countError) throw countError;
    if ((count || 0) !== 1) {
      return res.status(200).json({ sent: false, reason: 'not_first_item' });
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured -- skipping first-item email');
      return res.status(200).json({ sent: false, reason: 'email_not_configured' });
    }

    // {{unsubscribe_url}} points at Settings for now -- there's no actual
    // unsubscribe/email-preference mechanism built yet, so this is a
    // placeholder destination, not a real opt-out. Needs a follow-up.
    //
    // Resend rejects a request that mixes `template` with `html`/`text`/
    // `react`, so the subject/body come entirely from the published
    // template -- only the variables it references are passed here.
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: user.email,
        template: {
          id: RESEND_TEMPLATE_ID,
          variables: {
            item_name: escapeHtmlServer(itemName),
            item_attributes_suffix: formatAttributesSuffix(itemAttributes),
            unsubscribe_url: 'https://www.shelfyai.com/settings'
          }
        }
      })
    });
    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      throw new Error(`Resend API error (${sendRes.status}): ${errBody}`);
    }

    // Marked sent even though the item count re-check above is the primary
    // guard -- this is the fast path for every subsequent call so it never
    // has to hit the ingredients table again for an account that's long
    // past its first item.
    //
    // upsert, not update: a brand-new account may not have a user_settings
    // row yet (it's created lazily -- see settings.html/onboarding-modal.js),
    // and .update() on a non-existent row silently affects zero rows with no
    // error, which left this column permanently null despite the email
    // having actually sent.
    await supabaseAdmin
      .from('user_settings')
      .upsert({ user_id: user.id, first_item_email_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

    return res.status(200).json({ sent: true });
  } catch (error) {
    console.error('Error sending first-item email:', error);
    return res.status(500).json({ error: error.message || 'Failed to send email' });
  }
};
