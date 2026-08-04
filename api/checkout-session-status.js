// Real details for a completed Checkout Session, for the return screen on
// plan.html (success_url lands there with ?session_id={CHECKOUT_SESSION_ID}).
// Exists so that screen can show what was actually paid instead of guessing
// from client-side state -- the amount, the real next-charge date, the real
// scan-pack count, and a receipt link, all come from Stripe itself.
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const sessionId = req.query.session_id;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Missing session_id' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'invoice', 'payment_intent.latest_charge', 'line_items.data.price']
    });

    // Ownership check -- subscription mode carries the user id on the
    // subscription's own metadata (subscription_data.metadata in
    // create-checkout-session.js), payment mode carries it on the session.
    const ownerId = session.mode === 'subscription'
      ? session.subscription?.metadata?.supabase_user_id
      : session.metadata?.supabase_user_id;
    if (ownerId !== user.id) {
      return res.status(403).json({ error: 'This session does not belong to you' });
    }

    const paid = session.payment_status === 'paid';
    const result = {
      mode: session.mode,
      paid,
      amountTotal: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
      currency: session.currency || null,
      receiptUrl: null,
      tier: null,
      interval: null,
      nextChargeDate: null,
      scanCount: null
    };

    if (session.mode === 'subscription' && session.subscription) {
      result.tier = session.subscription.metadata?.tier || null;
      result.interval = session.subscription.items?.data?.[0]?.price?.recurring?.interval || null;
      if (session.subscription.current_period_end) {
        result.nextChargeDate = new Date(session.subscription.current_period_end * 1000).toISOString();
      }
      result.receiptUrl = session.invoice?.hosted_invoice_url || null;
    } else if (session.mode === 'payment') {
      const metaCount = parseInt(session.line_items?.data?.[0]?.price?.metadata?.scan_count, 10);
      result.scanCount = Number.isFinite(metaCount) && metaCount > 0 ? metaCount : 50;
      result.receiptUrl = session.payment_intent?.latest_charge?.receipt_url || null;
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Checkout session status error:', error);
    return res.status(500).json({ error: error.message });
  }
};
