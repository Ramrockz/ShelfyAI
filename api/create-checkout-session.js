const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  starter: {
    month: 'price_1TNnJv1kaouEa47TYVrlez0u',
    year: 'price_1TNnJz1kaouEa47TOBsonXkm'
  },
  pro: {
    month: 'price_1TNnJx1kaouEa47Ty3R9ZLRf',
    year: 'price_1TNnJy1kaouEa47Ti0d3oXL6'
  }
};

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
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

    const { tier, interval } = req.body;
    
    if (!tier || !interval || !PRICE_IDS[tier] || !PRICE_IDS[tier][interval]) {
      return res.status(400).json({ error: 'Invalid tier or interval' });
    }

    // Get or create Stripe customer
    let stripeCustomerId;
    
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('profile_id', user.id)
      .single();

    if (existingSub?.stripe_customer_id) {
      // Verify customer exists in current Stripe environment (test/live)
      try {
        await stripe.customers.retrieve(existingSub.stripe_customer_id);
        stripeCustomerId = existingSub.stripe_customer_id;
      } catch (err) {
        // Customer doesn't exist (e.g., switching from test to production)
        // Create new customer and update database
        console.log('Customer not found in Stripe, creating new one');
        stripeCustomerId = null;
      }
    }
    
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id }
      });
      stripeCustomerId = customer.id;
      
      // Create or update subscription record
      const supabaseService = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      if (existingSub) {
        // Update existing record with new customer ID
        await supabaseService.from('subscriptions')
          .update({ stripe_customer_id: stripeCustomerId })
          .eq('profile_id', user.id);
      } else {
        // Create new subscription record
        await supabaseService.from('subscriptions').insert({
          profile_id: user.id,
          stripe_customer_id: stripeCustomerId,
          tier: 'free',
          status: 'active'
        });
      }
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[tier][interval], quantity: 1 }],
      automatic_tax: { enabled: true },
      customer_update: {
        address: 'auto',
        name: 'auto'
      },
      tax_id_collection: {
        enabled: true
      },
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://www.shelfyai.com'}/settings.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://www.shelfyai.com'}/pricing.html`,
      subscription_data: {
        metadata: {
          tier,
          supabase_user_id: user.id
        }
      }
    });

    return res.status(200).json({
      sessionId: session.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });

  } catch (error) {
    console.error('Checkout session error:', error);
    return res.status(500).json({ error: error.message });
  }
};
