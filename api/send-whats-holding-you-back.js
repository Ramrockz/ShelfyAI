// Triggered daily by Vercel Cron (see vercel.json). One-time re-engagement
// nudge for accounts that signed up but never really came back: their most
// recent login is still the same calendar day as signup, and that signup
// happened at least MIN_DAYS_SINCE_SIGNUP days ago. Distinct from
// inactivity-reminder.html, which targets accounts that DID return at some
// point and then went quiet -- separate audience/tone, see
// emails/whats-holding-you-back.html's own header comment.
//
// auth.users isn't queryable through the public schema/PostgREST, so this
// uses the Supabase Admin API's listUsers() (service-role only) to read
// created_at/last_sign_in_at directly -- no extra column needed for that
// part. user_settings.whats_holding_you_back_sent_at (see
// email-sql/add-whats-holding-you-back-tracking.sql) still tracks "have we
// already sent this," same as every other one-time email, and
// unsubscribed_all_emails (add-unsubscribed-all-emails.sql) is checked the
// same way too.
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || 'ShelfyAI <noreply@shelfyai.com>';
const REPLY_TO = 'inventory@shelfyai.com';
const MIN_DAYS_SINCE_SIGNUP = 3;

function sameCalendarDay(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

// listUsers() is paginated (max perPage is 1000) -- loop until a short page
// comes back rather than assuming everything fits in one call.
async function listAllUsers() {
  const users = [];
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) break;
    page++;
  }
  return users;
}

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const cutoff = new Date(Date.now() - MIN_DAYS_SINCE_SIGNUP * 86400000);

    const allUsers = await listAllUsers();
    const candidates = allUsers.filter((u) => {
      if (!u.email) return false;
      const createdAt = new Date(u.created_at);
      if (createdAt > cutoff) return false; // hasn't hit the 3-day mark yet
      // No last_sign_in_at at all means they never came back for a second
      // session either -- same as it matching signup day exactly.
      const lastSignIn = u.last_sign_in_at ? new Date(u.last_sign_in_at) : createdAt;
      return sameCalendarDay(createdAt, lastSignIn);
    });

    if (!candidates.length) {
      return res.status(200).json({ sent: 0, checked: allUsers.length, candidates: 0 });
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured -- skipping whats-holding-you-back send');
      return res.status(200).json({ sent: 0, reason: 'email_not_configured' });
    }

    const { data: settingsRows, error: settingsError } = await supabaseAdmin
      .from('user_settings')
      .select('user_id, whats_holding_you_back_sent_at, unsubscribed_all_emails')
      .in('user_id', candidates.map((u) => u.id));
    if (settingsError) throw settingsError;
    const settingsByUser = new Map((settingsRows || []).map((s) => [s.user_id, s]));

    let sent = 0;
    for (const user of candidates) {
      const settings = settingsByUser.get(user.id);
      if (settings?.whats_holding_you_back_sent_at || settings?.unsubscribed_all_emails) continue;

      // Published Resend template alias is "follow-up" (not this checked-in
      // file's name, emails/whats-holding-you-back.html).
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          reply_to: REPLY_TO,
          to: user.email,
          template: {
            id: 'follow-up',
            variables: {
              login_url: 'https://www.shelfyai.com/login',
              support_email: REPLY_TO,
              unsubscribe_url: `https://www.shelfyai.com/api/unsubscribe?uid=${user.id}`
            }
          }
        })
      });
      if (!sendRes.ok) {
        console.error(`Resend API error sending whats-holding-you-back to ${user.id}:`, await sendRes.text());
        continue;
      }

      await supabaseAdmin
        .from('user_settings')
        .upsert({ user_id: user.id, whats_holding_you_back_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });
      sent++;
    }

    return res.status(200).json({ sent, checked: allUsers.length, candidates: candidates.length });
  } catch (error) {
    console.error('Error in send-whats-holding-you-back:', error);
    return res.status(500).json({ error: error.message });
  }
};
