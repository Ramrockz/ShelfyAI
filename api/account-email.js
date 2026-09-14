// Merged endpoint for account-triggered emails that used to be three
// separate files (send-first-item-email.js, send-onboarding-email.js,
// report-bug.js) -- Vercel's Hobby plan caps a deployment at 12 Serverless
// Functions, and adding send-onboarding-email.js/report-bug.js this session
// pushed api/ to 13, which silently failed every deploy since
// (exceeded_serverless_functions_per_deployment). Folding these three into
// one function is the free fix; see PROJECT-STRUCTURE.md or ask before
// adding another new api/*.js file without checking the current count.
//
// Dispatches on body.action: 'first-item' | 'first-product' | 'first-order' |
// 'first-ai-order-match' | 'first-expense' | 'first-reorder-marked' |
// 'onboarding' | 'report-bug'. Each action's logic below is otherwise
// unchanged from its original file (first-product, first-order,
// first-ai-order-match, first-expense, and first-reorder-marked are new,
// added after the initial merge).
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Every ShelfyAI email sends from noreply@shelfyai.com. Replies still go
// somewhere real, though: inventory@shelfyai.com, set as reply_to below on
// every send, in case someone hits reply anyway.
const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || 'ShelfyAI <noreply@shelfyai.com>';
const REPLY_TO = 'inventory@shelfyai.com';

const BUG_REPORT_TO = 'inventory@shelfyai.com';

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

// Called client-side right after a successful ingredient save (see
// ingredients.html's saveIngredient() and expenses.html's/recipes.html's
// own notifyFirstItemIfNeeded()) whenever the client's own count suggests
// this was the user's first-ever item. That client-side check is just an
// optimization to avoid calling this on every single item -- the actual
// "is this really their first, and have we already emailed them" decision
// is made here, server-side, against the database, so a stale client count
// or a duplicate call can never send the email twice or send it on item #2.
//
// Needs RESEND_API_KEY (Vercel env var) and both
// email-sql/add-first-time-email-tracking.sql (user_settings.
// first_item_email_sent_at) and email-sql/add-unsubscribed-all-emails.sql
// (user_settings.unsubscribed_all_emails) run in Supabase before this does
// anything.
async function sendFirstItemEmail(req, res, user) {
  const itemName = typeof req.body?.itemName === 'string' ? req.body.itemName.slice(0, 200) : 'your first item';
  const itemAttributes = req.body?.itemAttributes && typeof req.body.itemAttributes === 'object' ? req.body.itemAttributes : null;

  // Source of truth for "has this already been sent" -- never trust the
  // client to only call this once.
  const { data: settings } = await supabaseAdmin
    .from('user_settings')
    .select('first_item_email_sent_at, unsubscribed_all_emails')
    .eq('user_id', user.id)
    .maybeSingle();
  if (settings?.first_item_email_sent_at) {
    console.log(`first-item email skipped for ${user.id}: already_sent at ${settings.first_item_email_sent_at}`);
    return res.status(200).json({ sent: false, reason: 'already_sent' });
  }
  if (settings?.unsubscribed_all_emails) {
    console.log(`first-item email skipped for ${user.id}: unsubscribed_all_emails`);
    return res.status(200).json({ sent: false, reason: 'unsubscribed' });
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
    console.log(`first-item email skipped for ${user.id}: not_first_item (count=${count})`);
    return res.status(200).json({ sent: false, reason: 'not_first_item' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured -- skipping first-item email');
    return res.status(200).json({ sent: false, reason: 'email_not_configured' });
  }

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
      reply_to: REPLY_TO,
      to: user.email,
      template: {
        id: 'first-item-created',
        variables: {
          item_name: escapeHtmlServer(itemName),
          item_attributes_suffix: formatAttributesSuffix(itemAttributes),
          unsubscribe_url: `https://www.shelfyai.com/api/unsubscribe?uid=${user.id}`
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

  console.log(`first-item email sent to ${user.email} (${user.id})`);
  return res.status(200).json({ sent: true });
}

// Called client-side right after a successful new-product save (see
// recipes.html's own notifyFirstProductIfNeeded(), called from both
// _doSaveRecipe() (the normal create path) and finalizeRecipe() (the
// drag/drop-to-build naming-modal path) -- new products only, never on edit.
//
// Same reasoning as sendFirstItemEmail: the client-side "is this their
// first product" guess is just an optimization, this re-checks server-side
// against the database so a stale count or duplicate call can't double-send.
//
// Needs RESEND_API_KEY (Vercel env var) and both
// email-sql/add-first-time-email-tracking.sql (user_settings.
// first_product_email_sent_at) and email-sql/add-unsubscribed-all-emails.sql
// (user_settings.unsubscribed_all_emails) run in Supabase before this does
// anything.
async function sendFirstProductEmail(req, res, user) {
  const productName = typeof req.body?.productName === 'string' ? req.body.productName.slice(0, 200) : 'your first product';
  const ingredientCount = Number.isFinite(req.body?.ingredientCount) ? req.body.ingredientCount : 0;

  const { data: settings } = await supabaseAdmin
    .from('user_settings')
    .select('first_product_email_sent_at, unsubscribed_all_emails')
    .eq('user_id', user.id)
    .maybeSingle();
  if (settings?.first_product_email_sent_at) {
    console.log(`first-product email skipped for ${user.id}: already_sent at ${settings.first_product_email_sent_at}`);
    return res.status(200).json({ sent: false, reason: 'already_sent' });
  }
  if (settings?.unsubscribed_all_emails) {
    console.log(`first-product email skipped for ${user.id}: unsubscribed_all_emails`);
    return res.status(200).json({ sent: false, reason: 'unsubscribed' });
  }

  // Source of truth for "is this actually their first product" -- scoped by
  // profile_id (not user_id), same as every other table here.
  const { count, error: countError } = await supabaseAdmin
    .from('recipes')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', user.id);
  if (countError) throw countError;
  if ((count || 0) !== 1) {
    console.log(`first-product email skipped for ${user.id}: not_first_product (count=${count})`);
    return res.status(200).json({ sent: false, reason: 'not_first_product' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured -- skipping first-product email');
    return res.status(200).json({ sent: false, reason: 'email_not_configured' });
  }

  // Assumes the Resend dashboard template's alias matches this checked-in
  // file's name, emails/first-product-created.html -- correct it here if the
  // published alias differs (as it did for onboarding -> "welcome-email",
  // and for orders/expenses -> "-logged").
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
        id: 'first-product-created',
        variables: {
          product_name: escapeHtmlServer(productName),
          product_ingredient_count_suffix: ingredientCount > 0
            ? ` <span style="color:#64748b; font-weight:400;">(${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'})</span>`
            : '',
          unsubscribe_url: `https://www.shelfyai.com/api/unsubscribe?uid=${user.id}`
        }
      }
    })
  });
  if (!sendRes.ok) {
    const errBody = await sendRes.text();
    throw new Error(`Resend API error (${sendRes.status}): ${errBody}`);
  }

  await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: user.id, first_product_email_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

  console.log(`first-product email sent to ${user.email} (${user.id})`);
  return res.status(200).json({ sent: true });
}

// Called client-side right after a successful MANUAL order save (see
// orders.html's/operations.html's own notifyFirstOrderIfNeeded(), called
// from each page's saveManualOrder() only -- both pages duplicate the whole
// order-creation flow independently, so both need their own call). The
// AI-scan confirm flow (confirmMappedOrder()) calls sendFirstAiOrderMatchEmail
// below instead -- these are two separate milestones (an account could get
// both, if a later manual order follows an earlier AI-matched one), not the
// same "first order" event gated by how it was entered.
//
// Same reasoning as sendFirstItemEmail: the client-side "is this their
// first order" guess is just an optimization, this re-checks server-side
// against the database so a stale count or duplicate call can't double-send.
//
// Needs RESEND_API_KEY (Vercel env var) and both
// email-sql/add-first-time-email-tracking.sql (user_settings.
// first_order_email_sent_at) and email-sql/add-unsubscribed-all-emails.sql
// (user_settings.unsubscribed_all_emails) run in Supabase before this does
// anything.
async function sendFirstOrderEmail(req, res, user) {
  const { data: settings } = await supabaseAdmin
    .from('user_settings')
    .select('first_order_email_sent_at, unsubscribed_all_emails')
    .eq('user_id', user.id)
    .maybeSingle();
  if (settings?.first_order_email_sent_at) {
    console.log(`first-order email skipped for ${user.id}: already_sent at ${settings.first_order_email_sent_at}`);
    return res.status(200).json({ sent: false, reason: 'already_sent' });
  }
  if (settings?.unsubscribed_all_emails) {
    console.log(`first-order email skipped for ${user.id}: unsubscribed_all_emails`);
    return res.status(200).json({ sent: false, reason: 'unsubscribed' });
  }

  // Source of truth for "is this actually their first MANUAL order" --
  // orders live in the `sales` table, scoped by profile_id (not user_id).
  // Filtered to source = 'Manual Entry' (the value both pages' own
  // saveManualOrder() writes) since this milestone is manual-entry-only now
  // -- an account whose first-ever order was AI-scanned wouldn't otherwise
  // ever trigger this once they later place a manual one.
  const { count, error: countError } = await supabaseAdmin
    .from('sales')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', user.id)
    .eq('source', 'Manual Entry');
  if (countError) throw countError;
  if ((count || 0) !== 1) {
    console.log(`first-order email skipped for ${user.id}: not_first_order (count=${count})`);
    return res.status(200).json({ sent: false, reason: 'not_first_order' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured -- skipping first-order email');
    return res.status(200).json({ sent: false, reason: 'email_not_configured' });
  }

  // Resend's dashboard-published template is "first-order-logged" (matches
  // how orders get counted -- "logged", not "created" -- not the checked-in
  // emails/first-order-created.html filename, which predates this alias).
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
        id: 'first-order-logged',
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
  // row yet, and .update() on a non-existent row silently affects zero rows
  // with no error, which would leave this column permanently null despite
  // the email having actually sent (same fix as sendFirstItemEmail).
  await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: user.id, first_order_email_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

  console.log(`first-order email sent to ${user.email} (${user.id})`);
  return res.status(200).json({ sent: true });
}

// Called client-side right after a successful new-expense save (see
// expenses.html's own notifyFirstExpenseIfNeeded(), called from both
// saveExpense() (manual entry) and confirmIngredientMapping() (receipt-scan
// confirm) equally -- unlike orders, there's no separate "AI matched this"
// milestone for expenses, so both entry methods count toward the same
// "first expense" celebration.
//
// Needs RESEND_API_KEY (Vercel env var) and both
// email-sql/add-first-time-email-tracking.sql (user_settings.
// first_expense_email_sent_at) and email-sql/add-unsubscribed-all-emails.sql
// (user_settings.unsubscribed_all_emails) run in Supabase before this does
// anything.
async function sendFirstExpenseEmail(req, res, user) {
  const { data: settings } = await supabaseAdmin
    .from('user_settings')
    .select('first_expense_email_sent_at, unsubscribed_all_emails')
    .eq('user_id', user.id)
    .maybeSingle();
  if (settings?.first_expense_email_sent_at) {
    console.log(`first-expense email skipped for ${user.id}: already_sent at ${settings.first_expense_email_sent_at}`);
    return res.status(200).json({ sent: false, reason: 'already_sent' });
  }
  if (settings?.unsubscribed_all_emails) {
    console.log(`first-expense email skipped for ${user.id}: unsubscribed_all_emails`);
    return res.status(200).json({ sent: false, reason: 'unsubscribed' });
  }

  // Source of truth for "is this actually their first expense" -- scoped by
  // profile_id (not user_id), same as every other table here.
  const { count, error: countError } = await supabaseAdmin
    .from('expenses')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', user.id);
  if (countError) throw countError;
  if ((count || 0) !== 1) {
    console.log(`first-expense email skipped for ${user.id}: not_first_expense (count=${count})`);
    return res.status(200).json({ sent: false, reason: 'not_first_expense' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured -- skipping first-expense email');
    return res.status(200).json({ sent: false, reason: 'email_not_configured' });
  }

  // Resend's dashboard-published template is "first-expense-logged" (matches
  // "first-order-logged"'s naming), not the checked-in filename
  // emails/first-expense-created.html, which predates this alias.
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
        id: 'first-expense-logged',
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

  await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: user.id, first_expense_email_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

  console.log(`first-expense email sent to ${user.email} (${user.id})`);
  return res.status(200).json({ sent: true });
}

// Called client-side right after a successful AI-scan order confirm (see
// orders.html's/operations.html's own notifyFirstAiOrderMatchIfNeeded(),
// called from each page's confirmMappedOrder() only -- the manual entry
// form calls sendFirstOrderEmail above instead). Separate milestone from
// "first order logged": this celebrates the AI actually matching a scanned
// order to existing products/stock, not just placing an order at all.
//
// Needs RESEND_API_KEY (Vercel env var) and both
// email-sql/add-first-time-email-tracking.sql (user_settings.
// first_ai_order_match_email_sent_at) and
// email-sql/add-unsubscribed-all-emails.sql (user_settings.
// unsubscribed_all_emails) run in Supabase before this does anything.
async function sendFirstAiOrderMatchEmail(req, res, user) {
  const { data: settings } = await supabaseAdmin
    .from('user_settings')
    .select('first_ai_order_match_email_sent_at, unsubscribed_all_emails')
    .eq('user_id', user.id)
    .maybeSingle();
  if (settings?.first_ai_order_match_email_sent_at) {
    console.log(`first-ai-order-match email skipped for ${user.id}: already_sent at ${settings.first_ai_order_match_email_sent_at}`);
    return res.status(200).json({ sent: false, reason: 'already_sent' });
  }
  if (settings?.unsubscribed_all_emails) {
    console.log(`first-ai-order-match email skipped for ${user.id}: unsubscribed_all_emails`);
    return res.status(200).json({ sent: false, reason: 'unsubscribed' });
  }

  // Source of truth for "is this actually their first AI-matched order" --
  // both pages' own confirmMappedOrder() write source = 'Image Upload' for
  // this flow specifically (vs 'Manual Entry' for the manual form).
  const { count, error: countError } = await supabaseAdmin
    .from('sales')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', user.id)
    .eq('source', 'Image Upload');
  if (countError) throw countError;
  if ((count || 0) !== 1) {
    console.log(`first-ai-order-match email skipped for ${user.id}: not_first_match (count=${count})`);
    return res.status(200).json({ sent: false, reason: 'not_first_match' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured -- skipping first-ai-order-match email');
    return res.status(200).json({ sent: false, reason: 'email_not_configured' });
  }

  // Assumes the Resend dashboard template's alias matches this checked-in
  // file's name, emails/first-ai-order-match.html -- correct it here if the
  // published alias differs (as it did for onboarding -> "welcome-email").
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
        id: 'first-ai-order-match',
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

  await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: user.id, first_ai_order_match_email_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

  console.log(`first-ai-order-match email sent to ${user.email} (${user.id})`);
  return res.status(200).json({ sent: true });
}

// Called client-side once per account, right after ensureProfileExists(user)
// resolves in auth.js's initUserMenu() (see the localStorage-gated call
// there) -- that client-side gate is just an optimization to avoid hitting
// this endpoint on every single page load once it's already been sent. The
// actual "has this account already gotten its onboarding email" decision is
// made here, server-side, against user_settings.onboarding_email_sent_at, so
// a cleared localStorage or a duplicate call can never send it twice.
//
// Unlike sendFirstItemEmail, there's no secondary "is this really their
// first X" data check to make -- onboarding is tied to the account's
// existence, not a data milestone, so the sent_at flag alone is authoritative.
//
// Needs RESEND_API_KEY (Vercel env var) and
// email-sql/add-onboarding-email-tracking.sql (user_settings.
// onboarding_email_sent_at) run in Supabase before this does anything.
//
// The actual email content lives in Resend's own dashboard-published
// template ("welcome-email"), not in emails/onboarding.html -- that file is
// kept only as the source-of-truth copy used to build the Resend template,
// since Resend has no way to sync from a checked-in HTML file.
async function sendOnboardingEmail(req, res, user) {
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
      from: EMAIL_FROM,
      reply_to: REPLY_TO,
      to: user.email,
      template: {
        id: 'welcome-email',
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
  // email having actually sent (same fix as sendFirstItemEmail).
  await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: user.id, onboarding_email_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

  console.log(`onboarding email sent to ${user.email} (${user.id})`);
  return res.status(200).json({ sent: true });
}

// Called client-side after any successful "mark as reordered" write (see
// reorder-modal.js's shared notifyFirstReorderMarkedIfNeeded(), called from
// its own placeReorder() -- covering ingredient-detail.html/operations.html/
// recipe-detail.html, which all include that shared script -- plus two
// page-local duplicates of the same action that bypass the shared modal:
// ingredient-detail.html's own completeReorder() and recipe-detail.html's
// own rdmMarkAsReordered()).
//
// Unlike first-item/first-order, there's no historical table to re-verify
// "is this genuinely their first" against -- ingredients.reorder_pending
// just reflects current state (it gets marked, then cleared on arrival,
// then can be marked again later), not an append-only log. So this works
// like sendOnboardingEmail: the user_settings sent_at flag alone is
// authoritative, no secondary data check.
//
// Needs RESEND_API_KEY (Vercel env var) and both
// email-sql/add-first-time-email-tracking.sql (user_settings.
// first_reorder_marked_email_sent_at) and
// email-sql/add-unsubscribed-all-emails.sql (user_settings.
// unsubscribed_all_emails) run in Supabase before this does anything.
async function sendFirstReorderMarkedEmail(req, res, user) {
  const { data: settings } = await supabaseAdmin
    .from('user_settings')
    .select('first_reorder_marked_email_sent_at, unsubscribed_all_emails')
    .eq('user_id', user.id)
    .maybeSingle();
  if (settings?.first_reorder_marked_email_sent_at) {
    console.log(`first-reorder-marked email skipped for ${user.id}: already_sent at ${settings.first_reorder_marked_email_sent_at}`);
    return res.status(200).json({ sent: false, reason: 'already_sent' });
  }
  if (settings?.unsubscribed_all_emails) {
    console.log(`first-reorder-marked email skipped for ${user.id}: unsubscribed_all_emails`);
    return res.status(200).json({ sent: false, reason: 'unsubscribed' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured -- skipping first-reorder-marked email');
    return res.status(200).json({ sent: false, reason: 'email_not_configured' });
  }

  // Assumes the Resend dashboard template's alias matches this checked-in
  // file's name, emails/first-reorder-marked.html -- correct it here if the
  // published alias differs (as it did for onboarding -> "welcome-email").
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
        id: 'first-reorder-marked',
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

  await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: user.id, first_reorder_marked_email_sent_at: new Date().toISOString() }, { onConflict: 'user_id' });

  console.log(`first-reorder-marked email sent to ${user.email} (${user.id})`);
  return res.status(200).json({ sent: true });
}

// Called from the "Report a bug" menu item injected globally in auth.js
// (initUserMenu()/openReportBugModal()). Sends the report to
// inventory@shelfyai.com with the reporting user's own email set as
// reply-to (Resend requires `from` to be an address on a domain verified
// with them, so it can't literally send as the user -- reply-to gets the
// same practical result: replying from inbox goes straight to them).
async function sendBugReport(req, res, user) {
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
}

const ACTIONS = {
  'first-item': sendFirstItemEmail,
  'first-product': sendFirstProductEmail,
  'first-order': sendFirstOrderEmail,
  'first-ai-order-match': sendFirstAiOrderMatchEmail,
  'first-expense': sendFirstExpenseEmail,
  'first-reorder-marked': sendFirstReorderMarkedEmail,
  'onboarding': sendOnboardingEmail,
  'report-bug': sendBugReport
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const handler = ACTIONS[req.body?.action];
  if (!handler) {
    return res.status(400).json({ error: 'Unknown or missing action' });
  }

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

    await handler(req, res, user);
  } catch (error) {
    console.error(`Error in account-email action "${req.body?.action}":`, error);
    return res.status(500).json({ error: error.message || 'Failed to process request' });
  }
};
