// Vercel Serverless Function to handle AgentQL API calls
// This keeps the API key secure on the server side

const fetch = require('node-fetch');
const { IncomingForm } = require('formidable');
const FormData = require('form-data');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// AgentQL returns attribute keys verbatim from the source document, so a German
// or Spanish receipt/screenshot produces keys like "Größe"/"Talla" instead of
// "size" — normalize known synonyms to the canonical English key so variant
// grouping and the color/size lookups downstream keep working regardless of
// the document's language.
const ATTRIBUTE_KEY_SYNONYMS = {
  size: 'size', größe: 'size', groesse: 'size', grosse: 'size', grösse: 'size',
  talla: 'size', tamaño: 'size', tamano: 'size',
  color: 'color', colour: 'color', farbe: 'color'
};

function normalizeAttributeKey(key) {
  const clean = String(key || '').trim();
  return ATTRIBUTE_KEY_SYNONYMS[clean.toLowerCase()] || clean;
}

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
    // 4MB, not 10MB: Vercel's serverless functions reject request bodies over
    // ~4.5MB at the platform layer before this code runs at all, so a 10MB
    // ceiling here was unreachable dead code -- files between 4.5MB and
    // 10MB were rejected upstream with no JSON body, surfacing to the client
    // as a generic, undiagnosable failure. Matches import-modal.js's own
    // client-side limit (which now also compresses images before upload).
    const form = new IncomingForm({ maxFileSize: 4 * 1024 * 1024 });
    
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

    // Check usage limits — orders and expenses share a single monthly pool
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

    // Get current month's usage (YYYY-MM format)
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const { data: usageRecords } = await supabase
      .from('ai_usage_tracking')
      .select('ingredient_count, order_count, expense_count')
      .eq('user_id', user.id)
      .gte('date', `${yearMonth}-01`)
      .lte('date', `${yearMonth}-${String(lastDay).padStart(2, '0')}`);

    const totalScansUsed = usageRecords?.reduce((sum, r) =>
      sum + (r.ingredient_count || 0) + (r.order_count || 0) + (r.expense_count || 0), 0) || 0;

    const usageType = context === 'order' ? 'order' : context === 'expense' ? 'expense' : 'ingredient';

    console.log(`Usage check - Tier: ${tier}, Type: ${usageType}, Scans used: ${totalScansUsed}/${effectiveLimit} (plan: ${scanLimit}, bonus: ${bonusScans})`);

    if (totalScansUsed >= effectiveLimit) {
      return res.status(429).json({
        error: 'Monthly limit reached',
        message: `You've reached your AI scan limit of ${effectiveLimit}. ${bonusScans > 0 ? 'Purchase another Scan Pack to continue.' : 'Upgrade your plan or buy a Scan Pack to continue.'}`,
        limit: effectiveLimit,
        used: totalScansUsed,
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
  item []{
    name 
    quantity (quantity ordered)
    attributes(key like color, size and value)[]
  }
}
`.trim();

    const ingredientPrompt = `
{
  vendor (supplier name or vendor name)
  date (purchase date or invoice date)
  amount (total cost)
  item []{
    name (ingredient or material name)
    price (unit cost)
    SKU (Stock Keeping Unit or product code)
    quantity (quantity ordered)
    attributes(key like color, size and value)[]
  }
}
`.trim();

    const extractionPrompt = context === 'order' ? orderPrompt : ingredientPrompt;
    
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
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('AgentQL API error:', errorText);
      return res.status(response.status).json({ 
        error: 'Failed to extract data from receipt',
        details: errorText 
      });
    }

    const data = await response.json();
    console.log('=== AgentQL Response ===');
    console.log(JSON.stringify(data, null, 2));
    
    // AgentQL wraps the response in a 'data' object
    const extractedData = data.data || data;
    console.log('=== Extracted Data ===');
    console.log(JSON.stringify(extractedData, null, 2));
    
    // Parse and return the extracted data based on context
    let result;
    
    if (context === 'order') {
      // Parse attributes from array format ["Key: Value"] to object {key: "value"}
      const parseAttributes = (attrArray) => {
        if (!Array.isArray(attrArray)) return {};
        const result = {};
        attrArray.forEach(attr => {
          if (typeof attr === 'string' && attr.includes(':')) {
            const [key, ...valueParts] = attr.split(':');
            const value = valueParts.join(':').trim();
            result[normalizeAttributeKey(key)] = value;
          }
        });
        return result;
      };
      
      // Handle item as array (from prompt: item []{})
      let items = [];
      if (Array.isArray(extractedData.item)) {
        items = extractedData.item.map(item => ({
          name: item.name || null,
          quantity: item.quantity || 1,
          attributes: parseAttributes(item.attributes)
        }));
      } else if (extractedData.item) {
        // Fallback for single item
        items = [{
          name: extractedData.item.name || null,
          quantity: extractedData.item.quantity || 1,
          attributes: parseAttributes(extractedData.item.attributes)
        }];
      }
      
      result = {
        success: true,
        data: {
          vendor: extractedData.customer || null, // Map customer to vendor for frontend compatibility
          customer: extractedData.customer || null,
          order_reference: extractedData.order_reference || null,
          revenue: extractedData.revenue || null,
          date: extractedData.date || null,
          item: items // Return array of items
        }
      };
    } else {
      // Parse attributes from array format ["Key: Value"] to object {key: "value"}
      const parseAttributes = (attrArray) => {
        if (!Array.isArray(attrArray)) return {};
        const result = {};
        attrArray.forEach(attr => {
          if (typeof attr === 'string' && attr.includes(':')) {
            const [key, ...valueParts] = attr.split(':');
            const value = valueParts.join(':').trim();
            result[normalizeAttributeKey(key)] = value;
          }
        });
        return result;
      };
      
      // Handle item as array (from prompt: item []{})
      let items = [];
      if (Array.isArray(extractedData.item) && extractedData.item.length > 0) {
        items = extractedData.item.map(item => ({
          name: item.name || null,
          price: item.price || null,
          SKU: item.SKU || item.name || null,
          quantity: item.quantity || 1,
          attributes: parseAttributes(item.attributes)
        }));
      } else if (extractedData.item && typeof extractedData.item === 'object') {
        // Fallback for single item
        const singleItem = extractedData.item;
        items = [{
          name: singleItem.name || null,
          price: singleItem.price || null,
          SKU: singleItem.SKU || singleItem.name || null,
          quantity: singleItem.quantity || 1,
          attributes: parseAttributes(singleItem.attributes)
        }];
      }
      
      result = {
        success: true,
        data: {
          vendor: extractedData.vendor || null,
          item: items, // Return array of items
          amount: extractedData.amount || null,
          date: extractedData.date || null
        }
      };
    }

    // Increment usage counter
    const incrementFunction = usageType === 'order' 
      ? 'increment_order_usage' 
      : usageType === 'expense'
      ? 'increment_expense_usage'
      : 'increment_ingredient_usage';

    const { data: rpcData, error: rpcError } = await supabase.rpc(incrementFunction, { p_user_id: user.id });
    if (rpcError) {
      console.error(`Error incrementing ${usageType} usage:`, rpcError);
    }

    // Consume a bonus scan if this scan went past the plan limit — applies
    // regardless of context, since ingredient/order/expense scans all draw
    // from the same shared pool. Atomic RPC (adjust_bonus_scans) instead of
    // a read-then-write to avoid a race double-spending or losing a credit.
    if (bonusScans > 0 && totalScansUsed >= scanLimit) {
      const { error: bonusError } = await supabase.rpc('adjust_bonus_scans', { p_user_id: user.id, p_delta: -1 });
      if (bonusError) {
        console.error('Error consuming bonus scan:', bonusError);
      }
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
