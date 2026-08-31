// Vercel Serverless Function to handle AgentQL API calls
// This keeps the API key secure on the server side

const fetch = require('node-fetch');
const { IncomingForm } = require('formidable');
const FormData = require('form-data');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

// Claude vision fallback for Item Creation (context === 'ingredient') only,
// and only when the upload is an image AgentQL couldn't read (or read as
// empty) -- AgentQL runs first as the primary reader; this is a backup, not
// a parallel/competing call. This prompt describes a SINGLE item (one photo
// of one thing), unlike AgentQL's ingredientPrompt above which describes a
// list -- extractWithClaude() below wraps its single result in a one-entry
// item[] array so it still fits the same result.data envelope everything
// downstream (usage metering, applyReceiptScanToManualModal() in
// ingredients.html) already expects from AgentQL.
// Must stay in sync with CAT_META in ingredients.html -- that's the only
// list of categories the New Item form's own picker ever offers, and
// applyReceiptScanToManualModal() sets ing_category to this value verbatim
// (selectIngCategory() does an exact-string lookup against CAT_META for the
// row's icon). Without constraining Claude to these exact strings, it was
// free to invent its own category label per photo -- never matching the
// picker's options, so the field looked "set" but couldn't be found again
// by anything that filters/groups by category.
const INGREDIENT_CATEGORIES = [
  'Raw Material', 'Component', 'Base Product', 'Packaging', 'Shipping Supply',
  'Finished Product', 'Digital Product', 'Equipment', 'Consumable', 'Other'
];

const CLAUDE_INGREDIENT_PROMPT = `You are analyzing a photo of an item that a small business buys as a raw
material or ingredient for making its products, and wants to log into its
inventory.

Your task: fill in as many of the following inventory-form fields as you
can, based ONLY on what's actually visible in the photo (packaging text,
labels, barcodes, printed quantities, brand, etc.). Respond in English
regardless of any language printed on the packaging itself — e.g. translate
a German product name into English rather than copying it verbatim.

Respond with valid JSON only, in exactly this schema:

{
  "name": string | null,            // product name in English, e.g. "Extra Virgin Olive Oil"
  "unit": "pcs" | "g" | "kg" | "ml" | "L" | "oz" | "lb" | "m" | "cm" | "other" | null,
  "stock_on_hand": number | null,   // only if clearly countable (e.g. "3 bottles visible")
  "category": ${INGREDIENT_CATEGORIES.map((c) => `"${c}"`).join(' | ')} | null,
  "attributes": [                   // e.g. brand, origin, color, variety, size
    { "name": string, "value": string }
  ],
  "sku_barcode": string | null,     // only if a barcode/UPC/product code is readable
  "expiration_date": string | null, // format DD.MM.YYYY, only if visible on the packaging
  "notes": string | null,           // anything useful that doesn't fit elsewhere, including uncertainties
  "guesses": {                      // separately-flagged estimates, see below -- omit or null if there's nothing to guess
    "unit": "pcs" | "g" | "kg" | "ml" | "L" | "oz" | "lb" | "m" | "cm" | "other" | null,
    "stock_on_hand": number | null,
    "cost_per_unit": number | null,
    "reasoning": string | null
  } | null
}

Important rules:
- category MUST be exactly one of the values listed above (written exactly
  like that, including case) or null. Never invent your own category, even
  if none of the options is a perfect fit -- pick the closest one, or null
  if truly nothing fits.
- Fields that can't be reliably determined from a photo (cost_each,
  low_stock_alert, delivery_days, source_url) are left out entirely /
  returned as absent -- don't guess them in the main fields above. A cost
  estimate belongs exclusively in "guesses.cost_per_unit" (see below),
  never in any other field.
- "unit" should only be "pcs" when the product is actually tracked piece
  by piece for inventory purposes (e.g. bottles, boxes, tools, individually
  packaged units) -- NOT for goods normally tracked by weight, volume, or
  length (e.g. a roll of paper/fabric, a liquid, loose/bulk material), even
  when only a single one is visible in the photo. For those, leave "unit"
  null here and let guesses.unit supply the practical tracking unit
  instead (e.g. "m" for a roll) -- don't default to "pcs" just because one
  discrete object is visible.
- stock_on_hand: only set it when the count is clearly readable in the
  image (e.g. "5 boxes"). For a single item with no visible batch size:
  null.
- Don't invent values in the main fields above. If a field isn't
  readable/recognizable: null.
- Read packaging text carefully (even small or partially obscured) before
  setting a field to null.

"guesses" -- reasoned estimates for a clearly-recognizable product, when
unit, quantity, and/or price aren't readable from the photo (e.g. a single
item with no price tag or quantity marking). Unlike the fields above, here
it's explicitly fine to draw on your general knowledge of this product
(not just what's shown in the photo) -- e.g. "a roll of toilet paper
typically has about 30m and costs around $0.50".
- Omit guesses entirely (or null) if the name isn't recognizable, OR if
  unit, stock_on_hand, AND the price are already readable from the photo
  with high confidence (then there's nothing to guess).
- guesses.unit: only set it when the "unit" field above is null.
- guesses.stock_on_hand: the typical TOTAL quantity, in the (possibly
  guessed) unit, for however many items are actually visible in the photo
  (e.g. 1 visible roll × ~30m/roll = 30). Only set it when the
  "stock_on_hand" field above is null.
- guesses.cost_per_unit: the typical price PER UNIT (not per
  piece/package!) in the (possibly guessed) unit, in US dollars -- e.g. for
  a roll costing ~$0.50 with ~30m: cost_per_unit ≈ 0.0167. Set this
  practically always, since price never comes from the main fields above.
- guesses.reasoning: ONE short, user-friendly sentence in English
  explaining the estimate (e.g. typical package size and unit price that
  cost_per_unit was derived from).
- Return ONLY the JSON object, no prose, no markdown code fences.`;

// Metric unit pairs the New Item form's "Claude has ideas" sheet can offer
// as two alternate options for the SAME physical quantity (e.g. "25 m" or
// "2500 cm") -- factor is how many of `unit` make up 1 of the paired key.
// Deliberately computed here rather than asked of the model: keeping the
// two option's numbers internally consistent (same total stock value) is
// just arithmetic, and doing it in code guarantees that instead of hoping
// the model's own multiplication is exact.
const UNIT_CONVERSIONS = {
  m:  { unit: 'cm', factor: 100 },
  cm: { unit: 'm',  factor: 0.01 },
  kg: { unit: 'g',  factor: 1000 },
  g:  { unit: 'kg', factor: 0.001 },
  L:  { unit: 'ml', factor: 1000 },
  ml: { unit: 'L',  factor: 0.001 }
};
function roundGuess(n) {
  return Math.round(n * 10000) / 10000;
}

// "Claude has ideas" suggestion FAB on the New Item form (ingredients.html)
// -- turns the model's raw "guesses" object (unit/stock/cost estimates for
// a clearly-recognizable product whose photo doesn't show them) into one or
// two ready-to-apply options. Kept out of the strict fields above (which
// only ever reflect what's actually visible) so a guess never silently
// looks like a read value -- the client shows these behind an explicit
// opt-in affordance with a "select" per option instead.
function buildGuessOptions(g) {
  if (!g || typeof g !== 'object') return null;
  const guessedUnit = (g.unit && g.unit !== 'other') ? g.unit : null;
  const guessedStock = typeof g.stock_on_hand === 'number' && isFinite(g.stock_on_hand) ? g.stock_on_hand : null;
  const guessedCost = typeof g.cost_per_unit === 'number' && isFinite(g.cost_per_unit) ? g.cost_per_unit : null;
  if (!guessedUnit && !guessedStock && !guessedCost) return null;

  const primary = { unit: guessedUnit, stock_on_hand: guessedStock, cost_per_unit: guessedCost };
  const options = [primary];

  // Only offer a second unit option when the unit itself is actually in
  // question (guessedUnit set -- the strict "unit" field was null) and both
  // numbers needed to convert it are present.
  const pair = guessedUnit && UNIT_CONVERSIONS[guessedUnit];
  if (pair && guessedStock != null && guessedCost != null) {
    options.push({
      unit: pair.unit,
      stock_on_hand: roundGuess(guessedStock * pair.factor),
      cost_per_unit: roundGuess(guessedCost / pair.factor)
    });
  }

  return { reasoning: g.reasoning || null, options };
}

// German dd.mm.yyyy (the format CLAUDE_INGREDIENT_PROMPT asks for) -> the
// yyyy-mm-dd an <input type="date"> actually needs to display a value.
function parseGermanDate(value) {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function extractWithClaude(filepath, mimeType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const imageBase64 = fs.readFileSync(filepath).toString('base64');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: { effort: 'medium' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text', text: CLAUDE_INGREDIENT_PROMPT }
      ]
    }]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) return null;

  // The prompt asks for raw JSON, but strip markdown fences / stray prose
  // defensively rather than trust that instruction held every time.
  const raw = textBlock.text;
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  } catch (parseError) {
    console.error('Claude fallback: failed to parse JSON response:', parseError, raw);
    return null;
  }

  // No usable item recognized -- an empty item[] matches AgentQL's own
  // "zero items" shape so the caller's existing no-match handling applies.
  if (!parsed.name) {
    return { vendor: null, item: [], amount: null, date: null };
  }

  // [{name, value}] (the shape the prompt was written against) -> the flat
  // {key: value} object applyReceiptScanToManualModal() already expects
  // from AgentQL's own parseAttributes() output.
  const attributes = {};
  if (Array.isArray(parsed.attributes)) {
    parsed.attributes.forEach(attr => {
      if (attr && attr.name && attr.value) attributes[attr.name] = attr.value;
    });
  }

  const guesses = buildGuessOptions(parsed.guesses);

  return {
    vendor: null,
    item: [{
      name: parsed.name,
      price: null, // deliberately not asked for -- the prompt excludes cost_each as unreadable from a photo
      SKU: parsed.sku_barcode || null,
      // Left null (not defaulted to 1) when the prompt itself left
      // stock_on_hand null -- that's it declining to guess a count it
      // couldn't clearly read, not "one of these."
      quantity: parsed.stock_on_hand || null,
      unit: (parsed.unit && parsed.unit !== 'other') ? parsed.unit : null,
      // Allowlist check, not just a prompt instruction -- the prompt asks
      // Claude to only use one of INGREDIENT_CATEGORIES, but nothing
      // guarantees it actually will. A category selectIngCategory() can't
      // find in CAT_META isn't just cosmetic (wrong icon) -- it also can't
      // be filtered/grouped by category anywhere else in the app, so a
      // stray value is worse than leaving the field blank for the user.
      product_category: INGREDIENT_CATEGORIES.includes(parsed.category) ? parsed.category : null,
      expiration_date: parseGermanDate(parsed.expiration_date),
      notes: parsed.notes || null,
      attributes,
      guesses
    }],
    amount: null,
    date: null
  };
}

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

// Known key words, longest first so e.g. "grösse" isn't cut short by a
// shorter synonym that happens to be a prefix of it.
const ATTRIBUTE_KEY_WORDS = Object.keys(ATTRIBUTE_KEY_SYNONYMS).sort((a, b) => b.length - a.length);

// AgentQL returns each attribute as a plain string, but NOT always in the
// "Key: Value" shape this originally assumed -- a screenshot where the
// label and value are just visually adjacent (e.g. Etsy's order-detail
// page rendering "Größe" and "L" next to each other with no literal colon
// between them) comes back as "Größe L" instead of "Größe: L". Recognized
// here by matching a known key word at the start of the string; anything
// that matches neither shape is dropped rather than guessed at.
function parseAttributes(attrArray) {
  if (!Array.isArray(attrArray)) return {};
  const result = {};
  attrArray.forEach(attr => {
    if (typeof attr !== 'string') return;
    const trimmed = attr.trim();
    if (!trimmed) return;
    if (trimmed.includes(':')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();
      if (value) result[normalizeAttributeKey(key)] = value;
      return;
    }
    const keyWord = ATTRIBUTE_KEY_WORDS.find(k => trimmed.toLowerCase().startsWith(k.toLowerCase() + ' '));
    if (keyWord) {
      const value = trimmed.slice(keyWord.length).trim();
      if (value) result[normalizeAttributeKey(keyWord)] = value;
    }
  });
  return result;
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

    // Claude fallback only applies to Item Creation, and only for an actual
    // image (a photo upload or camera capture) -- not PDFs, and not
    // order/expense scans. formidable v3 exposes the parsed mimetype here;
    // fall back to the filename extension if a browser ever sends it blank.
    const fileMimeType = file.mimetype || '';
    const isImage = fileMimeType
      ? fileMimeType.startsWith('image/')
      : !/\.pdf$/i.test(file.originalFilename || '');
    const claudeEligible = context === 'ingredient' && isImage && !!process.env.ANTHROPIC_API_KEY;
    // Claude's vision API accepts image/jpeg|png|gif|webp -- "image/jpg" is
    // not a real media type but some browsers/cameras report it anyway.
    const claudeMimeType = fileMimeType === 'image/jpg' ? 'image/jpeg' : (fileMimeType || 'image/jpeg');

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
    
    // No documented SLA from AgentQL and no timeout of our own -- without
    // this, a hung upstream call just runs until Vercel's platform-level
    // function timeout kills it as an undiagnosable raw failure.
    const AGENTQL_TIMEOUT_MS = 25000;
    let response;
    try {
      response = await fetch(
        'https://api.agentql.com/v1/query-document',
        {
          method: 'POST',
          headers: {
            'X-API-Key': AGENTQL_API_KEY,
            ...formData.getHeaders() // Sets Content-Type with boundary
          },
          body: formData,
          signal: AbortSignal.timeout(AGENTQL_TIMEOUT_MS)
        }
      );
    } catch (fetchError) {
      if (fetchError.name === 'TimeoutError' || fetchError.name === 'AbortError') {
        return res.status(504).json({
          error: 'The read took too long',
          code: 'scan.timeout'
        });
      }
      throw fetchError;
    }

    console.log('AgentQL response status:', response.status);

    // Set once a usable result comes from either reader, so the fallback
    // block below (zero-items case) knows not to re-attempt Claude after
    // this branch already did.
    let result;
    let usedClaude = false;

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AgentQL API error:', errorText);

      if (claudeEligible) {
        console.log('AgentQL failed — trying Claude fallback for Item Creation image');
        const claudeData = await extractWithClaude(file.filepath, claudeMimeType)
          .catch(claudeError => { console.error('Claude fallback error:', claudeError); return null; });
        if (claudeData && claudeData.item.length > 0) {
          result = { success: true, data: claudeData };
          usedClaude = true;
        }
      }

      if (!usedClaude) {
        // This return happens before the usage-increment RPC further down,
        // so a failure here never counts against the user's monthly scan
        // limit -- say so explicitly since "did this use up my scan?" is the
        // natural worry after seeing this message.
        return res.status(response.status).json({
          error: "Couldn't read this photo — try a clearer, well-lit shot, or enter it manually. This didn't use one of your scans.",
          code: 'scan.malformed',
          details: errorText
        });
      }
    } else {
      const data = await response.json();
      console.log('=== AgentQL Response ===');
      console.log(JSON.stringify(data, null, 2));

      // AgentQL wraps the response in a 'data' object
      const extractedData = data.data || data;
      console.log('=== Extracted Data ===');
      console.log(JSON.stringify(extractedData, null, 2));

      // Parse and return the extracted data based on context
      if (context === 'order') {
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
    }

    // AgentQL can return 200 with zero items read (e.g. a blurry photo or one
    // that isn't actually a receipt/product) -- that's not a usable draft,
    // and the user shouldn't be charged a scan for a photo nothing came from.
    // A non-empty array with no real name is just as unusable -- AgentQL's
    // single-item fallback branch can produce e.g. [{ name: null, quantity: 1 }]
    // for a product photo it couldn't actually read (its "supplier list/price
    // sheet" prompt isn't tuned for single-product packaging shots the way
    // Claude's is), and `.length === 0` alone doesn't catch that -- it would
    // silently accept a blank draft with AgentQL's own quantity-defaults-to-1
    // filled in, instead of ever trying the Claude fallback.
    // usedClaude guards against re-running the fallback when this AgentQL
    // result already IS the Claude result from the !response.ok branch above.
    const hasUsableItem = result.data.item && result.data.item.some(i => i.name);
    if (!usedClaude && !hasUsableItem) {
      if (claudeEligible) {
        console.log('AgentQL found nothing — trying Claude fallback for Item Creation image');
        const claudeData = await extractWithClaude(file.filepath, claudeMimeType)
          .catch(claudeError => { console.error('Claude fallback error:', claudeError); return null; });
        if (claudeData && claudeData.item.length > 0) {
          result = { success: true, data: claudeData };
          usedClaude = true;
        }
      }

      if (!usedClaude) {
        return res.status(200).json({
          success: false,
          error: context === 'order' ? 'No order details found in that photo' : 'No item found in that photo',
          code: 'scan.no_match'
        });
      }
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
      code: 'unknown',
      message: error.message
    });
  }
};
