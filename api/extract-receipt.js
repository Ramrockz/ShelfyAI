// Vercel Serverless Function to handle AgentQL API calls
// This keeps the API key secure on the server side

const fetch = require('node-fetch');
const { IncomingForm } = require('formidable');
const FormData = require('form-data');
const fs = require('fs');
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
    console.log('=== Extract Receipt API Called ===');
    console.log('Method:', req.method);
    console.log('Content-Type:', req.headers['content-type']);

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

    // Parse multipart form data first to get context
    const form = new IncomingForm({ maxFileSize: 10 * 1024 * 1024 }); // 10MB limit
    
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    console.log('Files received:', Object.keys(files));
    console.log('Fields received:', fields);
    
    const file = files.file?.[0] || files.file;
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    // Get context (order or ingredient or expense)
    const context = (fields.context?.[0] || fields.context || 'ingredient').toLowerCase();
    console.log('Extraction context:', context);

    // Check usage limits based on context
    const { data: settings } = await supabase
      .from('user_settings')
      .select('tier')
      .eq('user_id', user.id)
      .single();

    const tier = settings?.tier || 'free';
    const limits = {
      free: { ingredients: 5, orders: 5, expenses: 5 },
      starter: { ingredients: 25, orders: 25, expenses: 25 },
      pro: { ingredients: 50, orders: 50, expenses: 50 }
    };

    // Get today's usage
    const { data: usage } = await supabase
      .from('ai_usage_tracking')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', new Date().toISOString().split('T')[0])
      .single();

    const currentUsage = {
      ingredient: usage?.ingredient_count || 0,
      order: usage?.order_count || 0,
      expense: usage?.expense_count || 0
    };

    // Determine which counter to check based on context
    const usageType = context === 'order' ? 'order' : context === 'expense' ? 'expense' : 'ingredient';
    const limit = limits[tier][usageType + 's'];
    const used = currentUsage[usageType];

    console.log(`Usage check - Tier: ${tier}, Type: ${usageType}, Used: ${used}/${limit}`);

    if (used >= limit) {
      return res.status(429).json({ 
        error: 'Daily limit reached',
        message: `You've reached your daily limit of ${limit} AI ${usageType} extractions. Upgrade your plan for more.`,
        limit,
        used,
        tier
      });
    }

    // Define extraction prompts based on context
    const orderPrompt = `
{
  customer 
  order_reference (ID or reference number for the purchase)
  date (purchase date or invoice date)
  revenue (total purchase amount)
  item {
    name 
    quantity (quantity ordered)
  }
  attributes {
    color (material color)
    size (material size)
  }
}
`.trim();

    const ingredientPrompt = `
{
  vendor (supplier name or vendor name)
  date (purchase date or invoice date)
  amount (total cost)
  item {
    name (ingredient or material name)
    price (unit cost)
    shipping_time (estimated delivery in days)
    SKU (Stock Keeping Unit or product code)
    product_category (e.g., Fabric, Thread, Packaging, Raw Material)
    quantity (quantity ordered)
    unit (pieces, Stückzahl, Kilograms, Liters)
    type (Production, Packaging, Shipping)
  }
  attributes {
    color (material color)
    size (material size)
  }
}
`.trim();

    const extractionPrompt = context === 'order' ? orderPrompt : ingredientPrompt;
    console.log('Using prompt for context:', context);

    console.log('File path:', file.filepath);
    console.log('File type:', file.mimetype);
    console.log('File size:', file.size);

    console.log('Sending file MIME type:', file.mimetype);
    console.log('Expected: application/pdf');
    console.log('Calling AgentQL API with form-data package...');
    
    console.log('Body being sent:', extractionPrompt);
    console.log('Body length:', extractionPrompt.length);
    
    // Use form-data package for proper multipart encoding
    const formData = new FormData();
    
    // Use createReadStream for proper file upload
    formData.append('file', fs.createReadStream(file.filepath));
    formData.append(
      'body',
      JSON.stringify({
        query: extractionPrompt
      })
    );
    
    console.log('FormData prepared with fields: file, body');
    console.log('Endpoint: https://api.agentql.com/v1/query-document');
    
    const response = await fetch(
      'https://api.agentql.com/v1/query-document',
      {
        method: 'POST',
        headers: {
          'X-API-Key': AGENTQL_API_KEY,
          ...formData.getHeaders() // Sets Content-Type with boundary
        },
        body: formData
      }
    );

    console.log('AgentQL response status:', response.status);
    console.log('AgentQL response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('AgentQL API error:', errorText);
      return res.status(response.status).json({ 
        error: 'Failed to extract data from receipt',
        details: errorText 
      });
    }

    const data = await response.json();
    console.log('=== AgentQL Full Response ===');
    console.log(JSON.stringify(data, null, 2));
    console.log('=== End Response ===');
    
    // AgentQL wraps the response in a 'data' object
    const extractedData = data.data || data;
    console.log('Extracted data:', JSON.stringify(extractedData, null, 2));
    
    // Parse and return the extracted data based on context
    let result;
    
    if (context === 'order') {
      console.log('=== ORDER CONTEXT - Mapping Response ===');
      console.log('Customer:', extractedData.customer);
      console.log('Order Reference:', extractedData.order_reference);
      console.log('Revenue:', extractedData.revenue);
      console.log('Date:', extractedData.date);
      console.log('Item:', JSON.stringify(extractedData.item, null, 2));
      console.log('Attributes:', JSON.stringify(extractedData.attributes, null, 2));
      
      result = {
        success: true,
        data: {
          vendor: extractedData.customer || null, // Map customer to vendor for frontend compatibility
          customer: extractedData.customer || null,
          order_reference: extractedData.order_reference || null,
          revenue: extractedData.revenue || null,
          date: extractedData.date || null,
          item: {
            ...extractedData.item,
            SKU: extractedData.order_reference // Map order_reference to SKU for frontend
          },
          attributes: extractedData.attributes || {},
          description: extractedData.item?.name || null
        }
      };
    } else {
      console.log('=== INGREDIENT CONTEXT - Mapping Response ===');
      console.log('Vendor:', extractedData.vendor);
      console.log('Amount:', extractedData.amount);
      console.log('Date:', extractedData.date);
      console.log('Item:', JSON.stringify(extractedData.item, null, 2));
      console.log('Attributes:', JSON.stringify(extractedData.attributes, null, 2));
      
      result = {
        success: true,
        data: {
          vendor: extractedData.vendor || null,
          item: extractedData.item || {},
          attributes: extractedData.attributes || {},
          amount: extractedData.amount || null,
          date: extractedData.date || null,
          description: extractedData.item?.name || null
        }
      };
    }
    
    console.log('=== Final Result ===');
    console.log(JSON.stringify(result, null, 2));

    // Increment usage counter
    const incrementFunction = usageType === 'order' 
      ? 'increment_order_usage' 
      : usageType === 'expense'
      ? 'increment_expense_usage'
      : 'increment_ingredient_usage';

    const { data: rpcData, error: rpcError } = await supabase.rpc(incrementFunction, { p_user_id: user.id });
    if (rpcError) {
      console.error(`Error incrementing ${usageType} usage:`, rpcError);
    } else {
      console.log(`Successfully incremented ${usageType} usage for user ${user.id}`, rpcData);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('Error processing receipt:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
