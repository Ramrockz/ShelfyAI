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

  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'No URL provided' });
    }

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

    // Check usage limits for ingredients (URL extraction is always for ingredients)
    const { data: settings } = await supabase
      .from('user_settings')
      .select('tier')
      .eq('user_id', user.id)
      .single();

    const tier = settings?.tier || 'free';
    const limits = {
      free: { ingredients: 25 },
      starter: { ingredients: 50 },
      pro: { ingredients: 100 }
    };

    // Get current month's usage (YYYY-MM format)
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    
    const { data: usageRecords } = await supabase
      .from('ai_usage_tracking')
      .select('ingredient_count')
      .eq('user_id', user.id)
      .gte('date', `${yearMonth}-01`)
      .lte('date', `${yearMonth}-${String(lastDay).padStart(2, '0')}`);

    const used = usageRecords?.reduce((sum, record) => sum + (record.ingredient_count || 0), 0) || 0;
    const limit = limits[tier].ingredients;

    console.log(`Usage check - Tier: ${tier}, Used: ${used}/${limit} (monthly)`);

    if (used >= limit) {
      return res.status(429).json({ 
        error: 'Monthly limit reached',
        message: `You've reached your monthly limit of ${limit} AI ingredient extractions. Your limit will reset on the 1st of next month.`,
        limit,
        used,
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

    // Call AgentQL API for URL extraction
    const response = await fetch('https://api.agentql.com/v1/query-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AGENTQL_API_KEY
      },
      body: JSON.stringify({
        url: url,
        query: extractionQuery
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AgentQL API error:', errorText);
      return res.status(response.status).json({ 
        error: 'Failed to extract data from URL',
        details: errorText 
      });
    }

    const agentqlResponse = await response.json();
    console.log('AgentQL raw response:', JSON.stringify(agentqlResponse, null, 2));
    
    // AgentQL wraps the response in a 'data' object
    const extractedData = agentqlResponse.data || {};
    
    // Parse and return the extracted data
    const quantity = extractedData.item?.quantity || 0;
    
    // Increment usage counter
    const { data: rpcData, error: rpcError } = await supabase.rpc('increment_ingredient_usage', { p_user_id: user.id });
    if (rpcError) {
      console.error('Error incrementing usage:', rpcError);
    } else {
      console.log(`Successfully incremented ingredient usage for user ${user.id}`, rpcData);
    }

    return res.status(200).json({
      success: true,
      data: {
        vendor: extractedData.vendor || null,
        name: extractedData.item?.name || null,
        price: extractedData.item?.price || null,
        estimated_delivery: extractedData.item?.shipping_time || null,
        sku: extractedData.item?.SKU || null,
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
      message: error.message 
    });
  }
};
