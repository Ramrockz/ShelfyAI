const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Public, no-auth endpoint — this is the same price pricing.html already
// shows anyone who isn't logged in. Cached in-process for 5 minutes so a
// burst of sheet-opens doesn't hit Stripe on every one; also cached at the
// edge/CDN via Cache-Control for the same reason.
const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { value, expiresAt }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (cache && cache.expiresAt > Date.now()) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(cache.value);
  }

  const priceId = process.env.STRIPE_SCAN_PACK_PRICE_ID;
  if (!priceId) {
    // Not configured — the offer stays tappable with a generic label
    // instead of failing the sheet/pricing page outright.
    const value = { configured: false, scanCount: 50 };
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(value);
  }

  try {
    const price = await stripe.prices.retrieve(priceId);
    const scanCount = parseInt(price.metadata?.scan_count, 10) || 50;
    const unitAmount = price.unit_amount;
    const currency = (price.currency || 'eur').toUpperCase();
    const priceFormatted = typeof unitAmount === 'number'
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(unitAmount / 100)
      : null;

    const value = { configured: true, scanCount, currency, unitAmount, priceFormatted };
    cache = { value, expiresAt: Date.now() + CACHE_MS };
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(value);
  } catch (err) {
    console.error('Error fetching scan pack price:', err);
    // Same soft-fail shape as the unconfigured case — the button still works.
    const value = { configured: false, scanCount: 50 };
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json(value);
  }
};
