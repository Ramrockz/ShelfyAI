// Vercel Serverless Function to extract ingredient data from URL using AgentQL
// This keeps the API key secure on the server side

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let hostname = null;

  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'No URL provided' });
    }

    try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { hostname = url; }

    // Get API keys from environment variables
    const AGENTQL_API_KEY = process.env.AGENTQL_KEY;
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!AGENTQL_API_KEY) {
      console.error('AGENTQL_KEY not configured');
      return res.status(500).json({ error: 'API key not configured' });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('Supabase not configured');
      return res.status(500).json({ error: 'Database not configured' });
    }

    // Get user from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Initialize Supabase client with user's token
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    console.log('User authenticated:', user.id);

    // Unified limit check (ingredients + orders + expenses share one pool)
    const { data: settings } = await supabase
      .from('user_settings')
      .select('tier, bonus_scans')
      .eq('user_id', user.id)
      .single();

    const tier = settings?.tier || 'free';
    const bonusScans = settings?.bonus_scans || 0;
    const scanLimits = { free: 5, starter: 100, pro: 300 };
    const scanLimit = scanLimits[tier] ?? 5;
    const effectiveLimit = scanLimit + bonusScans;

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const { data: usageRecords } = await supabase
      .from('ai_usage_tracking')
      .select('ingredient_count, order_count, expense_count')
      .eq('user_id', user.id)
      .gte('date', `${yearMonth}-01`)
      .lte('date', `${yearMonth}-${String(lastDay).padStart(2, '0')}`);

    const totalUsed = usageRecords?.reduce((sum, r) =>
      sum + (r.ingredient_count || 0) + (r.order_count || 0) + (r.expense_count || 0), 0) || 0;

    if (totalUsed >= effectiveLimit) {
      return res.status(429).json({
        error: 'Monthly limit reached',
        message: `You've reached your AI scan limit of ${effectiveLimit}. ${bonusScans > 0 ? 'Purchase another Scan Pack to continue.' : 'Upgrade your plan or buy a Scan Pack to continue.'}`,
        limit: effectiveLimit,
        used: totalUsed,
        tier
      });
    }

    // Define the extraction query using AgentQL's query language
    const extractionQuery = `{
  vendor(The name of the vendor/supplier)
  item {
    name
    price
    shipping_time (integer of max days)
    SKU (Stock Keeping Unit)
    product_category (for example: T-Shirt, Sweater, Packaging)
    quantity (per order)
    unit (pieces,Kilograms,Liters)
    type (Production, Packaging, Shipping)
  }
  attributes {
    color
    size
  }
}`;

    // AgentQL has no documented SLA and this app has no client-side timeout
    // of its own -- without this, a hung upstream call would just run until
    // Vercel's platform-level function timeout kills it, which the caller
    // never sees as anything more specific than a raw 504.
    const AGENTQL_TIMEOUT_MS = 25000;
    let response;
    try {
      response = await fetch('https://api.agentql.com/v1/query-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': AGENTQL_API_KEY
        },
        body: JSON.stringify({
          url: url,
          query: extractionQuery
        }),
        signal: AbortSignal.timeout(AGENTQL_TIMEOUT_MS)
      });
    } catch (fetchError) {
      if (fetchError.name === 'TimeoutError' || fetchError.name === 'AbortError') {
        return res.status(504).json({
          error: `${hostname} stopped answering`,
          code: 'scan.timeout',
          hostname
        });
      }
      throw fetchError;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AgentQL API error:', errorText);
      return res.status(response.status).json({
        error: 'The scan failed — it came back broken',
        code: 'scan.malformed',
        details: errorText
      });
    }

    const agentqlResponse = await response.json();
    console.log('AgentQL raw response:', JSON.stringify(agentqlResponse, null, 2));

    // AgentQL wraps the response in a 'data' object
    const extractedData = agentqlResponse.data || {};

    // Parse and return the extracted data
    const quantity = extractedData.item?.quantity || 0;

    // AgentQL can return 200 with every field empty (e.g. the link isn't
    // actually a single product page) -- that's not a usable draft, and the
    // user shouldn't be charged a scan for a page that had nothing on it.
    if (!extractedData.item?.name && !extractedData.item?.price) {
      return res.status(200).json({
        success: false,
        error: 'No title or price found on that page',
        code: 'scan.no_match'
      });
    }

    // Increment usage counter
    const { data: rpcData, error: rpcError } = await supabase.rpc('increment_ingredient_usage', { p_user_id: user.id });
    if (rpcError) {
      console.error('Error incrementing usage:', rpcError);
    } else {
      console.log(`Successfully incremented ingredient usage for user ${user.id}`, rpcData);
    }

    // Consume a bonus scan if this scan went past the plan limit (matches
    // api/extract-receipt.js — URL imports draw from the same shared pool).
    if (bonusScans > 0 && totalUsed >= scanLimit) {
      const { error: bonusError } = await supabase.rpc('adjust_bonus_scans', { p_user_id: user.id, p_delta: -1 });
      if (bonusError) {
        console.error('Error consuming bonus scan:', bonusError);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        vendor: extractedData.vendor || null,
        name: extractedData.item?.name || null,
        price: extractedData.item?.price || null,
        estimated_delivery: extractedData.item?.shipping_time || null,
        sku: extractedData.item?.SKU || extractedData.item?.name || null,
        product_category: extractedData.item?.product_category || null,
        quantity: quantity === 0 ? 1 : quantity,
        unit: extractedData.item?.unit || null,
        color: extractedData.attributes?.color || null,
        size: extractedData.attributes?.size || null
      }
    });

  } catch (error) {
    console.error('Error processing URL:', error);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'unknown',
      message: error.message
    });
  }
};
