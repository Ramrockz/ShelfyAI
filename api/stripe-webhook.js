const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { buffer } = require('micro');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
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

  // Check if subscription exists first
  const { data: existingSubscription } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('profile_id', userId)
    .single();

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
