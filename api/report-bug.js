// Called from the "Report a bug" menu item injected globally in auth.js
// (initUserMenu()/openReportBugModal()). Sends the report to
// inventory@shelfyai.com with the reporting user's own email set as
// reply-to (Resend requires `from` to be an address on a domain verified
// with them, so it can't literally send as the user -- reply-to gets the
// same practical result: replying from inbox goes straight to them).
//
// Needs RESEND_API_KEY (Vercel env var).
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const BUG_REPORT_TO = 'inventory@shelfyai.com';
// Must be an address on a domain verified in the Resend dashboard -- unlike
// send-first-item-email.js's template send, there's no published template
// here to fall back to a configured default sender, so this can't be left
// unset.
const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || 'ShelfyAI <no-reply@shelfyai.com>';

function escapeHtmlServer(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

    // Trust the token for who's reporting -- never the client body -- but the
    // report text itself is free-form user input.
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 5000) : '';
    if (!text) {
      return res.status(400).json({ error: 'Please describe the issue.' });
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured -- cannot send bug report');
      return res.status(500).json({ error: 'Email is not configured on this server.' });
    }

    const pageUrl = typeof req.body?.pageUrl === 'string' ? req.body.pageUrl.slice(0, 500) : '';
    const escapedText = escapeHtmlServer(text).replace(/\n/g, '<br>');

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: BUG_REPORT_TO,
        reply_to: user.email,
        subject: `Bug report from ${user.email}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;">
            <p><strong>From:</strong> ${escapeHtmlServer(user.email)} (user id ${escapeHtmlServer(user.id)})</p>
            ${pageUrl ? `<p><strong>Page:</strong> ${escapeHtmlServer(pageUrl)}</p>` : ''}
            <p><strong>Report:</strong></p>
            <p>${escapedText}</p>
          </div>`,
        text: `From: ${user.email} (user id ${user.id})\n${pageUrl ? `Page: ${pageUrl}\n` : ''}\nReport:\n${text}`
      })
    });
    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      throw new Error(`Resend API error (${sendRes.status}): ${errBody}`);
    }

    console.log(`Bug report sent from ${user.email} (${user.id})`);
    return res.status(200).json({ sent: true });
  } catch (error) {
    console.error('Error sending bug report:', error);
    return res.status(500).json({ error: error.message || 'Failed to send report' });
  }
};
