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
// add-first-item-email-tracking.sql migration run in Supabase
// (user_settings.first_item_email_sent_at) before this does anything.
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || 'ShelfyAI <hello@shelfyai.com>';
const TEMPLATE_URL = 'https://www.shelfyai.com/email-templates/first-item-added.html';

function fillTemplate(html, vars) {
  return html.replace(/{{\s*(\w+)\s*}}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

// Pulls the <title> tag's text as the subject line, same convention as the
// "Subject:" comment at the top of the template file itself -- keeps the
// actual subject in one human-editable place instead of hardcoded here too.
function extractSubject(html, fallback) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : fallback;
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

    const templateRes = await fetch(TEMPLATE_URL);
    if (!templateRes.ok) throw new Error(`Failed to load email template: ${templateRes.status}`);
    const rawHtml = await templateRes.text();

    const firstName = (user.user_metadata?.name || user.email.split('@')[0] || 'there').trim();
    const html = fillTemplate(rawHtml, {
      first_name: firstName,
      item_name: itemName,
      app_url: 'https://www.shelfyai.com/ingredients',
      recipes_url: 'https://www.shelfyai.com/recipes',
      support_email: 'support@shelfyai.com'
    });
    const subject = extractSubject(rawHtml, "You added your first item — here's what's next");

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: user.email, subject, html })
    });
    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      throw new Error(`Resend API error (${sendRes.status}): ${errBody}`);
    }

    // Marked sent even though the item count re-check above is the primary
    // guard -- this is the fast path for every subsequent call so it never
    // has to hit the ingredients table again for an account that's long
    // past its first item.
    await supabaseAdmin
      .from('user_settings')
      .update({ first_item_email_sent_at: new Date().toISOString() })
      .eq('user_id', user.id);

    return res.status(200).json({ sent: true });
  } catch (error) {
    console.error('Error sending first-item email:', error);
    return res.status(500).json({ error: error.message || 'Failed to send email' });
  }
};
