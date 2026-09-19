const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { buffer } = require('micro');
const fetch = require('node-fetch');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Same sender/reply-to convention as api/account-email.js.
const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || 'ShelfyAI <noreply@shelfyai.com>';
const REPLY_TO = 'inventory@shelfyai.com';
const APP_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.shelfyai.com';

// Resend's dashboard-published templates are assumed to match these
// checked-in file names under emails/ -- correct the id here if a published
// alias ever differs (as happened for onboarding -> "welcome-email").
async function sendTemplateEmail(to, templateId, variables) {
  if (!process.env.RESEND_API_KEY) {
    console.error(`RESEND_API_KEY not configured -- skipping ${templateId} email`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: EMAIL_FROM, reply_to: REPLY_TO, to, template: { id: templateId, variables } })
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Resend API error sending ${templateId} (${res.status}): ${errBody}`);
      return;
    }
    console.log(`${templateId} email sent to ${to}`);
  } catch (err) {
    // Never throw out of here -- these calls run after billing-critical
    // writes (subscription/scan-pack updates) have already succeeded. A
    // thrown error would make the webhook handler return non-2xx, and
    // Stripe would retry the whole event, re-running those writes.
    console.error(`Error sending ${templateId} email:`, err);
  }
}

async function getUserEmailAndName(userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) {
    console.error(`Could not look up user ${userId} for email send:`, error?.message);
    return null;
  }
  const meta = data.user.user_metadata || {};
  const rawName = (meta.full_name || meta.name || '').trim();
  const firstName = rawName ? rawName.split(/\s+/)[0] : 'there';
  return { email: data.user.email, firstName };
}

function formatMoney(amountInCents, currency) {
  if (!Number.isFinite(amountInCents)) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(amountInCents / 100);
  } catch (_) {
    return `$${(amountInCents / 100).toFixed(2)}`;
  }
}

function formatDate(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function titleCase(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

// Daily cron (see vercel.json) -- reuses this same endpoint/route instead of
// adding a 13th api/*.js file, which would exceed Vercel Hobby's 12
// Serverless Function cap (see api/account-email.js's header comment for the
// prior incident this caused). Stripe always POSTs; Vercel Cron GETs, so the
// two are distinguished by method.
async function handleWinbackCron(req, res) {
  try {
    const targetDay = new Date();
    targetDay.setUTCDate(targetDay.getUTCDate() + 7);
    const dayStart = new Date(Date.UTC(targetDay.getUTCFullYear(), targetDay.getUTCMonth(), targetDay.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Scoped to Starter monthly only -- the RESTOCK code (100% off, once) is
    // a Stripe coupon restricted to that specific price, so a Pro or annual
    // canceller would get an email advertising a discount that doesn't
    // actually apply to their plan at checkout.
    const { data: candidates, error } = await supabase
      .from('subscriptions')
      .select('profile_id, tier, current_period_end')
      .eq('cancel_at_period_end', true)
      .eq('status', 'active')
      .eq('tier', 'starter')
      .eq('billing_interval', 'month')
      .is('winback_email_sent_at', null)
      .gte('current_period_end', dayStart.toISOString())
      .lt('current_period_end', dayEnd.toISOString());
    if (error) throw error;

    let sent = 0;
    for (const sub of candidates || []) {
      const userInfo = await getUserEmailAndName(sub.profile_id);
      if (!userInfo) continue;

      const accessUntilDate = formatDate(sub.current_period_end);
      await sendTemplateEmail(userInfo.email, 'subscription-cancelled-winback', {
        first_name: userInfo.firstName,
        plan_name: titleCase(sub.tier),
        access_until_date: accessUntilDate,
        discount_percent: process.env.STRIPE_WINBACK_DISCOUNT_PERCENT || '',
        discount_code: process.env.STRIPE_WINBACK_DISCOUNT_CODE || '',
        discount_expires_date: accessUntilDate,
        resubscribe_url: `${APP_URL}/plan`,
        support_email: REPLY_TO
      });

      await supabase
        .from('subscriptions')
        .update({ winback_email_sent_at: new Date().toISOString() })
        .eq('profile_id', sub.profile_id);
      sent++;
    }

    return res.status(200).json({ candidates: candidates?.length || 0, sent });
  } catch (error) {
    console.error('Error in winback cron:', error);
    return res.status(500).json({ error: error.message });
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return handleWinbackCron(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Get raw body as buffer using micro
    const rawBody = await buffer(req);
    
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Received webhook event:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        if (session.mode === 'subscription') {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          await updateSubscription(subscription);
        } else if (session.mode === 'payment' && session.metadata?.type === 'scan_pack') {
          await handleScanPackPurchase(session);
        }
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        // Retrieve full subscription object to ensure we have all fields
        const fullSubscription = await stripe.subscriptions.retrieve(event.data.object.id);
        await updateSubscription(fullSubscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleFailedPayment(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        if (event.data.object.subscription) {
          const subscription = await stripe.subscriptions.retrieve(event.data.object.subscription);
          await updateSubscription(subscription);
        }
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: error.message });
  }
};

async function updateSubscription(subscription) {
  const tier = subscription.metadata.tier || 'free';
  const userId = subscription.metadata.supabase_user_id;

  if (!userId) {
    console.error('No user ID in subscription metadata');
    return;
  }

  const interval = subscription.items.data[0]?.price?.recurring?.interval || 'month';

  // Get period dates with fallbacks
  let currentPeriodStart;
  let currentPeriodEnd;

  try {
    // Try subscription-level fields first
    if (subscription.current_period_start) {
      currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
    } else if (subscription.billing_cycle_anchor) {
      currentPeriodStart = new Date(subscription.billing_cycle_anchor * 1000).toISOString();
    } else if (subscription.start_date) {
      currentPeriodStart = new Date(subscription.start_date * 1000).toISOString();
    } else {
      currentPeriodStart = new Date().toISOString();
    }

    if (subscription.current_period_end) {
      currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
    }
  } catch (err) {
    console.error('Error parsing subscription dates:', err);
    currentPeriodStart = new Date().toISOString();
  }

  // Update subscriptions table
  const updateData = {
    profile_id: userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: subscription.customer,
    tier,
    billing_interval: interval,
    status: subscription.status,
    current_period_start: currentPeriodStart,
    cancel_at_period_end: subscription.cancel_at_period_end || false,
    updated_at: new Date().toISOString()
  };

  // Only set current_period_end if it exists
  if (currentPeriodEnd) {
    updateData.current_period_end = currentPeriodEnd;
  }

  // Check if subscription exists first -- also pulls the fields needed below
  // to detect a tier upgrade or a fresh cancellation for milestone emails.
  const { data: existingSubscription } = await supabase
    .from('subscriptions')
    .select('id, tier, status, cancel_at_period_end')
    .eq('profile_id', userId)
    .single();

  // Cleared whenever the subscription isn't currently pending cancellation,
  // so a later cancel-then-resubscribe-then-cancel-again cycle can trigger
  // the winback email again instead of being skipped forever.
  if (!subscription.cancel_at_period_end) {
    updateData.winback_email_sent_at = null;
  }

  let subError;
  if (existingSubscription) {
    // Update existing subscription
    const { error } = await supabase
      .from('subscriptions')
      .update(updateData)
      .eq('profile_id', userId);
    subError = error;
  } else {
    // Insert new subscription
    const { error } = await supabase
      .from('subscriptions')
      .insert(updateData);
    subError = error;
  }

  if (subError) {
    console.error('Error updating subscriptions:', subError);
    throw new Error(`Failed to update subscriptions: ${subError.message}`);
  }

  // Sync tier to user_settings (uses user_id, not profile_id)
  const activeTier = subscription.status === 'active' ? tier : 'free';
  const { error: settingsError } = await supabase
    .from('user_settings')
    .update({ tier: activeTier })
    .eq('user_id', userId);

  if (settingsError) {
    // Log but don't throw - we can rely on subscriptions table
    console.warn('Could not update user_settings tier:', settingsError.message);
  } else {
    console.log(`Successfully updated user_settings tier to: ${activeTier}`);
  }

  console.log(`Updated subscription for user ${userId}: ${activeTier} (${subscription.status})`);

  // Milestone emails -- best-effort, after every write above has already
  // succeeded (see sendTemplateEmail's own comment on why this must never
  // throw back into the caller).
  try {
    const previousTier = existingSubscription && existingSubscription.status === 'active' ? existingSubscription.tier : 'free';
    const wasAlreadyCancelling = existingSubscription?.cancel_at_period_end === true;

    if ((activeTier === 'starter' || activeTier === 'pro') && activeTier !== previousTier) {
      const userInfo = await getUserEmailAndName(userId);
      if (userInfo) {
        const price = subscription.items.data[0]?.price;
        await sendTemplateEmail(userInfo.email, `subscribed-${activeTier}`, {
          first_name: userInfo.firstName,
          amount_paid: formatMoney(price?.unit_amount, price?.currency),
          billing_interval: interval,
          next_billing_date: currentPeriodEnd ? formatDate(currentPeriodEnd) : '',
          manage_billing_url: `${APP_URL}/plan`,
          app_url: APP_URL,
          support_email: REPLY_TO
        });
      }
    } else if (subscription.cancel_at_period_end && !wasAlreadyCancelling) {
      const userInfo = await getUserEmailAndName(userId);
      if (userInfo) {
        await sendTemplateEmail(userInfo.email, 'subscription-cancelled', {
          first_name: userInfo.firstName,
          plan_name: titleCase(previousTier),
          access_until_date: currentPeriodEnd ? formatDate(currentPeriodEnd) : '',
          downgrade_tier: 'Free',
          manage_billing_url: `${APP_URL}/plan`,
          support_email: REPLY_TO
        });
      }
    }
  } catch (emailErr) {
    console.error('Error sending subscription milestone email:', emailErr);
  }
}

async function handleSubscriptionDeleted(subscription) {
  const userId = subscription.metadata.supabase_user_id;

  if (!userId) return;

  // Clear all billing information when subscription is fully cancelled
  await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      tier: 'free',
      billing_interval: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      stripe_subscription_id: null,
      updated_at: new Date().toISOString()
    })
    .eq('profile_id', userId);

  await supabase
    .from('user_settings')
    .update({ tier: 'free' })
    .eq('user_id', userId);

  console.log(`Subscription deleted for user ${userId}, reverted to free tier`);
}

async function handleScanPackPurchase(session) {
  const userId = session.metadata?.supabase_user_id;
  if (!userId) { console.error('Scan pack purchase: no user ID in metadata'); return; }

  // Pack size travels with the Stripe price's metadata (scan_count) rather
  // than being hardcoded here, so pricing.html and this handler can't drift.
  let scanCount = 50;
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price'] });
    const metaCount = parseInt(lineItems?.data?.[0]?.price?.metadata?.scan_count, 10);
    if (Number.isFinite(metaCount) && metaCount > 0) scanCount = metaCount;
  } catch (err) {
    console.error('Error reading scan pack price metadata, defaulting to 50:', err);
  }

  // Atomic RPC instead of read-then-write — a retried webhook delivery for
  // the same session shouldn't be able to race itself into over/under-crediting.
  const { data: newValue, error } = await supabase.rpc('adjust_bonus_scans', { p_user_id: userId, p_delta: scanCount });

  if (error) {
    console.error('Error adding bonus scans:', error);
    throw new Error(`Failed to add bonus scans: ${error.message}`);
  }
  console.log(`Scan pack purchased: added ${scanCount} bonus scans for user ${userId} (new total: ${newValue})`);

  // Best-effort, after the credit above has already succeeded -- see
  // sendTemplateEmail's comment on why this must never throw back out.
  try {
    const userInfo = await getUserEmailAndName(userId);
    if (userInfo) {
      let receiptUrl = '';
      try {
        if (session.payment_intent) {
          const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ['latest_charge'] });
          receiptUrl = paymentIntent.latest_charge?.receipt_url || '';
        }
      } catch (err) {
        console.error('Error fetching receipt URL for scan pack email:', err);
      }

      await sendTemplateEmail(userInfo.email, 'scan-pack-purchased', {
        first_name: userInfo.firstName,
        scan_count: String(scanCount),
        amount_paid: formatMoney(session.amount_total, session.currency),
        purchase_date: formatDate(new Date()),
        total_scans_available: String(newValue),
        receipt_url: receiptUrl || `${APP_URL}/plan`,
        usage_url: `${APP_URL}/plan`,
        support_email: REPLY_TO
      });
    }
  } catch (emailErr) {
    console.error('Error sending scan-pack-purchased email:', emailErr);
  }
}

async function handleFailedPayment(invoice) {
  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  const userId = subscription.metadata.supabase_user_id;

  if (!userId) return;

  await supabase
    .from('subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString()
    })
    .eq('profile_id', userId);

  console.log(`Payment failed for user ${userId}, marked as past_due`);
}
