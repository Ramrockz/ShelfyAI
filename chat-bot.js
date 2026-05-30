// ShelfyAI Chat Bot — sophisticated local FAQ with synonym expansion + page context

// ─── Matching helpers ────────────────────────────────────────────────────────

function normalise(str) {
  return str.toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const SYNONYMS = {
  ingredient: ['ingredient','material','item','product','supply','stock','inventory','component'],
  recipe:     ['recipe','product','formula','template','creation'],
  order:      ['order','sale','customer','client','revenue','transaction'],
  expense:    ['expense','invoice','bill','cost','purchase','receipt','supplier','payment'],
  restock:    ['restock','reorder','refill','replenish','resupply','delivery','inbound'],
  delete:     ['delete','remove','erase','clear','wipe','get rid'],
  add:        ['add','create','new','make','insert','set up','log'],
  edit:       ['edit','update','change','modify','fix','adjust','correct'],
  export:     ['export','download','csv','pdf','backup','save','print'],
  scan:       ['scan','upload','photo','image','pdf','receipt','ai','extract','import','detect'],
  stock:      ['stock','quantity','amount','level','units','how much'],
  cost:       ['cost','price','value','worth','rate','per unit','spending'],
  limit:      ['limit','quota','cap','allowance','restriction','maximum','ran out'],
  alert:      ['alert','notification','warning','notify','bell'],
};

function expandSynonyms(words) {
  return [...new Set(words.flatMap(w => {
    for (const group of Object.values(SYNONYMS)) {
      if (group.includes(w)) return group;
    }
    return [w];
  }))];
}

function getChatbotPage() {
  return window.location.pathname.replace(/\.html$/, '').replace(/^\//, '') || 'index';
}

function scoreEntry(query, entry) {
  const qWords = expandSynonyms(normalise(query).split(' ').filter(w => w.length > 2));
  const eText  = normalise(entry.q + ' ' + (entry.keywords || []).join(' '));
  const eWords = expandSynonyms(eText.split(' '));
  let s = 0;
  for (const qw of qWords) {
    if (eWords.includes(qw)) s += 3;
    else if (eWords.some(ew => ew.startsWith(qw) || qw.startsWith(ew))) s += 1;
  }
  if (eText.includes(normalise(query))) s += 5;
  if (entry.page && entry.page === getChatbotPage()) s += 4;
  return s;
}

function findBestAnswer(query, faq) {
  const scored = faq
    .map(e => ({ e, s: scoreEntry(query, e) }))
    .sort((a, b) => b.s - a.s);

  if (scored[0] && scored[0].s >= 3) {
    const related = scored.slice(1, 4).filter(x => x.s > 0).map(x => x.e);
    return { answer: scored[0].e.a, related };
  }

  const partials = scored.filter(x => x.s > 0).slice(0, 3).map(x => x.e);
  return {
    answer: partials.length
      ? "I couldn't find an exact answer. Here are some related topics:"
      : "Try asking about: ingredients, recipes, orders, expenses, AI scanning, or exporting your data.",
    related: partials
  };
}

// ─── Public FAQ (not logged in) ──────────────────────────────────────────────

const publicFAQ = [
  { q: "What is ShelfyAI?", keywords: ["what","shelfy","about","explain","describe"],
    a: "ShelfyAI is an AI-powered inventory management app for small businesses — track ingredients, build recipes, log orders and expenses, and get low stock alerts automatically." },
  { q: "How much does ShelfyAI cost?", keywords: ["price","cost","pricing","plan","subscription","pay","money","how much"],
    a: "We have three plans: <strong>Free</strong> (20 AI scans/month), <strong>Starter</strong> at €9.99/month (100 scans), and <strong>Pro</strong> at €19.99/month (300 scans). Ingredients, recipes, orders and expenses are unlimited on all plans. See <a href='/pricing'>pricing page</a> for details." },
  { q: "Is there a free plan?", keywords: ["free","trial","demo","test","no cost","without paying"],
    a: "Yes! The free plan includes unlimited ingredients, recipes, orders and expenses, plus 20 AI receipt scans per month. No credit card required to sign up." },
  { q: "How do I sign up?", keywords: ["sign up","register","create account","join","start","get started"],
    a: "Click Sign Up on the <a href='/login'>login page</a> and enter your email. You can also continue with Google." },
  { q: "What features does ShelfyAI include?", keywords: ["features","capabilities","what can","includes","offers","functions","does"],
    a: "ShelfyAI includes: ingredient tracking with custom attributes, recipe builder with auto cost calculation, order management, expense tracking with AI receipt scanning, low stock alerts, and CSV data export." },
  { q: "Is my data secure?", keywords: ["secure","security","safe","privacy","data","encryption","gdpr"],
    a: "Yes. Your data is stored in Supabase with industry-standard encryption. We never share your data with third parties." },
  { q: "Can I cancel my subscription?", keywords: ["cancel","subscription","stop","quit","leave","unsubscribe"],
    a: "Yes, cancel anytime with no penalties. You keep access until the end of your billing period." },
  { q: "What types of businesses use ShelfyAI?", keywords: ["business","industry","restaurant","bakery","cafe","food","maker","craft","etsy","seller"],
    a: "ShelfyAI is used by bakeries, cafes, restaurants, food producers, Etsy sellers, crafters, and small manufacturers — anyone who needs to track materials and production costs." },
  { q: "Can I export my data?", keywords: ["export","download","csv","backup","data","save"],
    a: "Yes! Once logged in, go to Settings → Data Export to download your ingredients, orders, and expenses as CSV files." },
  { q: "Does ShelfyAI have a mobile app?", keywords: ["mobile","app","phone","android","iphone","ios","pwa"],
    a: "ShelfyAI works as a Progressive Web App — open it in your mobile browser and add it to your home screen for a full app experience." },
];

// ─── Authenticated FAQ (logged in) ───────────────────────────────────────────

const authenticatedFAQ = [
  // Ingredients
  { q: "How do I add an ingredient?", page: "ingredients",
    keywords: ["add","ingredient","create","new","make"],
    a: "Go to <a href='/ingredients'>Ingredients</a> → tap <strong>+ New Ingredient</strong>. Choose from four methods: Manual entry, AI scan (receipt/PDF), CSV bulk import, or URL import from a supplier page." },
  { q: "How do I import ingredients from a URL?", page: "ingredients",
    keywords: ["url","link","import","supplier","website","page","extract"],
    a: "Add Ingredient → <strong>URL Import</strong>. Paste the product page URL and the AI will extract the ingredient details automatically. URL imports don't count toward your AI scan limit." },
  { q: "How do I bulk import ingredients from CSV?", page: "ingredients",
    keywords: ["bulk","csv","import","spreadsheet","batch","multiple"],
    a: "Add Ingredient → <strong>CSV Import</strong>. Required columns: name, quantity, unit, cost_per_unit, category, notes. Download a template from the import modal." },
  { q: "How do I scan a receipt to add ingredients?", page: "ingredients",
    keywords: ["scan","receipt","invoice","upload","image","pdf","photo","ai"],
    a: "Add Ingredient → <strong>Image/PDF Upload</strong>. Upload your supplier invoice and the AI extracts item details. This uses one of your monthly AI scans — ingredient URL imports are unlimited." },
  { q: "How do I edit an ingredient?", page: "ingredient-detail",
    keywords: ["edit","update","change","modify","ingredient","field"],
    a: "Click an ingredient's name to open its detail page. All fields auto-save when you leave them — no save button needed." },
  { q: "How do I delete an ingredient?",
    keywords: ["delete","remove","ingredient","erase"],
    a: "Open the ingredient detail page and click <strong>Delete</strong>, or use the delete option on the ingredient card. Deletions are permanent." },
  { q: "How do I set a minimum stock level?", page: "ingredient-detail",
    keywords: ["minimum","min","stock","level","alert","threshold","reorder point"],
    a: "Open the ingredient detail page → <strong>Minimum Stock Alert</strong> field. When stock drops below this number you'll see a low stock alert on the dashboard." },
  { q: "How do I add a supplier link to an ingredient?", page: "ingredient-detail",
    keywords: ["supplier","source","url","link","where to buy","vendor"],
    a: "Ingredient detail page → <strong>Source URL</strong> field. Paste your supplier's product page. This link is also used by the Restock flow to reorder quickly." },
  { q: "How do I add custom fields to an ingredient?", page: "ingredient-detail",
    keywords: ["custom","attribute","field","extra","property","metadata"],
    a: "Ingredient detail page → <strong>Custom Attributes</strong> section → Add Attribute. Use this for colour, size, SKU, or any property specific to your business." },
  { q: "How do I duplicate an ingredient?",
    keywords: ["duplicate","copy","clone","same"],
    a: "Open the ingredient detail page and click <strong>Copy</strong>. It creates a new ingredient pre-filled with the same details." },
  { q: "How do I mark an ingredient as reorder pending?",
    keywords: ["reorder","pending","mark","ordered","on the way","restock"],
    a: "Ingredient detail page → click <strong>Restock</strong>. This marks the item as reorder pending and shows a truck icon on the dashboard until you confirm delivery." },
  { q: "Why isn't my stock level going down?",
    keywords: ["stock","not updating","going down","deduct","reduce","inventory","not working"],
    a: "Stock deducts automatically when you confirm an order <em>with the inventory toggle switched on</em>. Check that the order is linked to a recipe that uses the ingredient." },
  { q: "How do I see which recipes use an ingredient?", page: "ingredient-detail",
    keywords: ["recipes","uses","linked","connected","ingredient","used in"],
    a: "Open the ingredient detail page → scroll to the <strong>Used in Recipes</strong> panel. Click any recipe name to go directly to that recipe." },

  // Recipes
  { q: "How do I create a recipe?", page: "recipes",
    keywords: ["create","recipe","new","make","build"],
    a: "Go to <a href='/recipes'>Recipes</a> → <strong>+ New Recipe</strong>. Name it, then drag ingredients from the library on the right into the recipe. Cost is calculated automatically." },
  { q: "How do I add ingredients to a recipe?", page: "recipes",
    keywords: ["add","ingredient","recipe","drag","builder"],
    a: "In the recipe builder, search for ingredients in the right panel and drag them into the recipe area. On mobile, use the ingredient swiper and type filters." },
  { q: "What does the green orange red dot mean on a recipe?",
    keywords: ["dot","green","orange","red","colour","color","recipe","status","indicator","availability"],
    a: "<strong>Green</strong> = enough stock to produce. <strong>Orange</strong> = at minimum stock level. <strong>Red</strong> = can't produce — one or more ingredients are out of stock." },
  { q: "How is recipe cost calculated?",
    keywords: ["cost","calculate","price","recipe","total","how much"],
    a: "Recipe cost = sum of (cost per unit × quantity used) for every ingredient in the recipe. It updates automatically when ingredient costs change." },
  { q: "How do I delete a recipe?",
    keywords: ["delete","remove","recipe","erase"],
    a: "Recipes page → click the <strong>delete</strong> button on the recipe card. Confirm in the modal. This doesn't affect your ingredients." },

  // Orders
  { q: "How do I add an order?", page: "orders",
    keywords: ["add","order","new","sale","customer","create","log"],
    a: "Go to <a href='/orders'>Orders</a> → <strong>+ New Order</strong>. Fill in customer, sales channel, date, and items — or upload a receipt image to have the AI extract the details." },
  { q: "How do I scan an order receipt?", page: "orders",
    keywords: ["scan","order","receipt","upload","image","pdf","ai","extract"],
    a: "Orders → + New Order → <strong>Image/PDF Upload</strong>. Upload the invoice or screenshot and the AI fills in the order details. Review and confirm before saving." },
  { q: "How do I change an order status?", page: "orders",
    keywords: ["status","order","update","change","fulfilled","shipped","refunded"],
    a: "On the order card click the status button to advance it: Processed → Fulfilled → Shipped → Refunded. You can also drag cards between columns in Kanban view." },
  { q: "How do I use Kanban view for orders?", page: "orders",
    keywords: ["kanban","board","drag","column","view","orders"],
    a: "Orders page → click the <strong>Kanban</strong> view tab. Drag order cards between the Processed, Fulfilled, Shipped, and Refunded columns." },
  { q: "Does adding an order deduct my stock?",
    keywords: ["stock","deduct","reduce","order","inventory","automatic"],
    a: "Yes — if you enable the <strong>inventory toggle</strong> when confirming the order. The app deducts each ingredient used by the matched recipe." },
  { q: "What is my AI scan limit for orders?",
    keywords: ["limit","scan","order","quota","how many","monthly","ai"],
    a: "Order and expense scans share a combined monthly pool: <strong>Free</strong> = 20, <strong>Starter</strong> = 100, <strong>Pro</strong> = 300. Resets on the 1st of each month. Ingredient URL imports are unlimited." },

  // Expenses
  { q: "How do I log an expense?", page: "expenses",
    keywords: ["log","expense","add","new","create","record","bill","invoice"],
    a: "Go to <a href='/expenses'>Expenses</a> → <strong>+ New Expense</strong>. Fill in the form manually, or upload a receipt image to let the AI extract the details." },
  { q: "How do I scan an expense receipt?", page: "expenses",
    keywords: ["scan","expense","receipt","upload","image","pdf","ai","photo"],
    a: "Expenses → + New Expense → <strong>Image/PDF Upload</strong>. Upload your invoice or bill. After extraction you can match the item to an ingredient to update its cost per unit automatically." },
  { q: "Does scanning an expense update ingredient costs?",
    keywords: ["expense","ingredient","cost","update","per unit","match","link"],
    a: "Yes. After scanning, you'll see an ingredient matching modal. Confirm the match and the ingredient's <strong>cost per unit</strong> is updated automatically. You can also skip and just save the expense." },
  { q: "What expense categories are available?", page: "expenses",
    keywords: ["category","type","expense","classify","label"],
    a: "Materials, Supplies, Shipping, Packaging, Tools, Marketing, Utilities, Software, Other." },

  // Dashboard
  { q: "What does the dashboard show?", page: "operations",
    keywords: ["dashboard","operations","overview","show","what","hub"],
    a: "The dashboard shows: stock alerts (out of stock + low stock items with click-through to each), pending deliveries with confirm/cancel actions, and quick action cards for common tasks." },
  { q: "How do I mark a delivery as received?", page: "operations",
    keywords: ["delivery","received","mark","arrived","confirm","pending","reorder"],
    a: "Dashboard → <strong>Pending Deliveries</strong> → click the <strong>✓ checkmark</strong> button on the item. This clears the reorder pending flag and removes the truck icon." },
  { q: "How do I cancel a pending reorder?", page: "operations",
    keywords: ["cancel","reorder","pending","delivery","remove","clear"],
    a: "Dashboard → Pending Deliveries → click the <strong>✕</strong> button on the item. This clears the reorder pending flag without marking the goods as received." },

  // AI scanning
  { q: "What file types can I upload for AI scanning?",
    keywords: ["file","type","format","png","jpg","pdf","upload","supported"],
    a: "PNG, JPG, and PDF files are supported. Maximum file size is 10MB. Clear, well-lit photos give the best extraction results." },
  { q: "How accurate is the AI scanning?",
    keywords: ["accurate","accuracy","correct","reliable","ai","scanning","how good"],
    a: "Very accurate for clear receipts and invoices — typically 85–95%. Always review the extracted data before confirming, especially for handwritten or low-quality images." },
  { q: "Why did I get a scan limit error?",
    keywords: ["limit","error","reached","quota","too many","scan","429"],
    a: "You've used all your monthly AI scans for orders and expenses. The limit resets on the 1st of next month. Ingredient URL imports are unaffected — they're always unlimited. Upgrade your plan for a higher limit." },
  { q: "Do ingredient URL imports count toward my scan limit?",
    keywords: ["url","import","limit","count","ingredient","scan","quota"],
    a: "No — URL imports use a separate process and are completely unlimited. Only order and expense <em>receipt</em> scans count toward the monthly quota." },

  // Export & data
  { q: "How do I export my data?", page: "settings",
    keywords: ["export","download","csv","data","backup","ingredients","orders","expenses"],
    a: "Go to <a href='/settings'>Settings</a> → <strong>Data Export</strong>. Download your ingredients, orders, or expenses as CSV files." },

  // Settings
  { q: "How do I change my password?", page: "settings",
    keywords: ["password","change","reset","update","security"],
    a: "Settings → <strong>Security</strong> → <strong>Change Password</strong>. Enter and confirm your new password." },
  { q: "How do I switch between light and dark mode?",
    keywords: ["theme","dark","light","mode","appearance","colour","color"],
    a: "Click the sun/moon icon in the top navigation bar. Your preference is saved automatically across all pages." },
  { q: "How do I turn off notifications?", page: "settings",
    keywords: ["notification","turn off","disable","stop","alert","bell"],
    a: "Settings → <strong>Notifications</strong>. Toggle the master switch off to disable all notifications, or turn off individual types (low stock, out of stock, AI limit alerts) independently." },
  { q: "How do I delete my account?", page: "settings",
    keywords: ["delete","account","remove","close","cancel"],
    a: "Settings → <strong>Danger Zone</strong> → <strong>Delete Account</strong>. Type DELETE MY ACCOUNT to confirm. This is permanent and removes all your data." },
  { q: "How do I upgrade my plan?",
    keywords: ["upgrade","plan","starter","pro","pay","subscribe","more scans"],
    a: "Settings → tap <strong>Upgrade</strong> on your plan card, or go to the <a href='/pricing'>Pricing page</a>." },

  // Billing
  { q: "What plans are available?",
    keywords: ["plan","tier","pricing","available","options","difference"],
    a: "<strong>Free</strong>: 20 AI scans/month · <strong>Starter</strong> €9.99: 100 scans/month · <strong>Pro</strong> €19.99: 300 scans/month. All plans include unlimited ingredients, recipes, orders and expenses." },
  { q: "When do my AI scans reset?",
    keywords: ["reset","renew","refresh","scans","monthly","when"],
    a: "Your AI scan count resets on the <strong>1st of each month</strong>." },
  { q: "How do I cancel my subscription?",
    keywords: ["cancel","subscription","billing","stop paying","downgrade"],
    a: "You can cancel via your billing portal linked in Settings, or contact support. You keep access until the end of your current billing period." },

  // Notifications
  { q: "How do low stock alerts work?",
    keywords: ["low stock","alert","notification","warning","minimum","trigger"],
    a: "When an ingredient quantity drops below its <strong>Minimum Stock Alert</strong> value, it appears in the dashboard's stock alerts section. You can also enable bell notifications in Settings → Notifications." },
  { q: "How do I turn off low stock notifications?",
    keywords: ["low stock","notification","off","disable","alert"],
    a: "Settings → Notifications → toggle off <strong>Low Stock Alerts</strong>. You can also turn off the master Notifications switch to silence everything." },
];

// ─── Quick replies ────────────────────────────────────────────────────────────

const publicQuickReplies  = ["What is ShelfyAI?", "How much does it cost?", "Is there a free plan?", "What features are included?"];
const authenticatedQuickReplies = ["How do I add an ingredient?", "How do I create a recipe?", "How do I scan a receipt?", "How do I export my data?"];

// ─── Chat state ───────────────────────────────────────────────────────────────

const CHAT_SESSION_KEY = 'shelfy_chat_session';
let chatState = { isOpen: false, isAuthenticated: false, messages: [], conversationStarted: false };

function saveChatSession() {
  try { sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify({ messages: chatState.messages, isOpen: chatState.isOpen })); } catch (e) {}
}
function loadChatSession() {
  try { const r = sessionStorage.getItem(CHAT_SESSION_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initChatBot() {
  if (typeof supabaseClient !== 'undefined') {
    try { const { data: { session } } = await supabaseClient.auth.getSession(); chatState.isAuthenticated = !!session; } catch (e) {}
  }

  const saved = loadChatSession();
  if (saved && saved.messages && saved.messages.length > 0) {
    chatState.messages = saved.messages;
    chatState.conversationStarted = true;
    chatState.isOpen = saved.isOpen || false;
  }

  createChatWidget();

  if (chatState.conversationStarted && chatState.messages.length > 0) {
    const container = document.getElementById('chatMessages');
    chatState.messages.forEach(({ type, message }) => {
      const div = document.createElement('div');
      if (type === 'bot') {
        div.className = 'chat-message bot-message';
        div.innerHTML = `<div class="message-avatar">${botAvatarSVG()}</div><div class="message-content">${message}</div>`;
      } else {
        div.className = 'chat-message user-message';
        const content = document.createElement('div');
        content.className = 'message-content';
        content.textContent = message;
        div.appendChild(content);
      }
      container.appendChild(div);
    });
    scrollToBottom();
    if (chatState.isOpen) {
      document.getElementById('chatWindow').classList.add('active');
      document.getElementById('chatBubble').classList.add('hidden');
    }
  } else {
    setTimeout(() => { if (!chatState.conversationStarted) addWelcomeMessage(); }, 1000);
    if (!chatState.isAuthenticated) {
      setTimeout(() => { if (!chatState.isOpen) toggleChat(); }, 5000);
    }
  }
}

// ─── Widget ───────────────────────────────────────────────────────────────────

function botAvatarSVG() {
  return `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>`;
}

function createChatWidget() {
  const widget = document.createElement('div');
  widget.id = 'chatWidget';
  widget.innerHTML = `
    <div class="chat-bubble" id="chatBubble" onclick="toggleChat()">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
      </svg>
      <span class="chat-bubble-badge" id="chatBadge" style="display:none;">1</span>
    </div>
    <div class="chat-window" id="chatWindow">
      <div class="chat-header">
        <div class="chat-header-title">
          <img src="ShelfyAI%20logo.svg" alt="ShelfyAI" class="chat-logo-light" style="height:32px;width:auto;">
          <img src="shelfyai%20logo_dark.svg" alt="ShelfyAI" class="chat-logo-dark" style="height:32px;width:auto;">
        </div>
        <button class="chat-close-btn" onclick="toggleChat()">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-quick-replies" id="chatQuickReplies"></div>
      <div class="chat-input-container">
        <input type="text" class="chat-input" id="chatInput" placeholder="Ask a question..." onkeypress="handleChatInputKeypress(event)" />
        <button class="chat-send-btn" onclick="sendChatMessage()">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
        </button>
      </div>
    </div>`;

  // Inject typing-dots CSS
  const style = document.createElement('style');
  style.textContent = `
    .typing-dots{display:flex;gap:4px;align-items:center;padding:4px 0}
    .typing-dots span{width:7px;height:7px;background:var(--text-muted,#9ca3af);border-radius:50%;animation:typingBounce 1.2s infinite}
    .typing-dots span:nth-child(2){animation-delay:.2s}
    .typing-dots span:nth-child(3){animation-delay:.4s}
    @keyframes typingBounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}
  `;
  document.head.appendChild(style);
  document.body.appendChild(widget);
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function toggleChat() {
  chatState.isOpen = !chatState.isOpen;
  const win = document.getElementById('chatWindow');
  const bubble = document.getElementById('chatBubble');
  if (chatState.isOpen) {
    win.classList.add('active');
    bubble.classList.add('hidden');
    document.getElementById('chatBadge').style.display = 'none';
    setTimeout(() => document.getElementById('chatInput')?.focus(), 100);
  } else {
    win.classList.remove('active');
    bubble.classList.remove('hidden');
  }
  saveChatSession();
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function addWelcomeMessage() {
  const msg = chatState.isAuthenticated
    ? "Hi! I'm here to help with ShelfyAI. Ask me anything about ingredients, recipes, orders, expenses, scanning, or exporting your data."
    : "Welcome to ShelfyAI! I can answer questions about features, pricing, and getting started. What would you like to know?";
  addBotMessage(msg);
  showQuickReplies();
  chatState.conversationStarted = true;
  const badge = document.getElementById('chatBadge');
  if (badge && !chatState.isOpen) badge.style.display = 'flex';
}

function addBotMessage(message, related) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-message bot-message';
  div.innerHTML = `<div class="message-avatar">${botAvatarSVG()}</div><div class="message-content">${message}</div>`;
  container.appendChild(div);

  if (related && related.length > 0) {
    const rel = document.createElement('div');
    rel.className = 'chat-message bot-message related-questions';
    rel.innerHTML = `
      <div class="message-avatar">${botAvatarSVG()}</div>
      <div class="message-content">
        <div class="related-questions-title">Related:</div>
        ${related.map(e => `<button class="related-question-btn" onclick="handleQuickReply('${e.q.replace(/'/g, "\\'")}')">${e.q}</button>`).join('')}
      </div>`;
    container.appendChild(rel);
  }

  scrollToBottom();
  chatState.messages.push({ type: 'bot', message });
  saveChatSession();
}

function addUserMessage(message) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-message user-message';
  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = message; // textContent — safe, no XSS
  div.appendChild(content);
  container.appendChild(div);
  scrollToBottom();
  chatState.messages.push({ type: 'user', message });
  saveChatSession();
}

function showTypingIndicator() {
  const container = document.getElementById('chatMessages');
  const el = document.createElement('div');
  el.id = 'chat-typing';
  el.className = 'chat-message bot-message';
  el.innerHTML = `<div class="message-avatar">${botAvatarSVG()}</div><div class="message-content"><span class="typing-dots"><span></span><span></span><span></span></span></div>`;
  container.appendChild(el);
  scrollToBottom();
}
function hideTypingIndicator() { document.getElementById('chat-typing')?.remove(); }

// ─── Quick replies ────────────────────────────────────────────────────────────

function showQuickReplies() {
  const c = document.getElementById('chatQuickReplies');
  const replies = chatState.isAuthenticated ? authenticatedQuickReplies : publicQuickReplies;
  c.innerHTML = replies.map(r => `<button class="quick-reply-btn" onclick="handleQuickReply('${r.replace(/'/g, "\\'")}')">${r}</button>`).join('');
}

function handleQuickReply(q) {
  document.getElementById('chatInput').value = q;
  sendChatMessage();
}

function handleChatInputKeypress(e) { if (e.key === 'Enter') sendChatMessage(); }

// ─── Send ─────────────────────────────────────────────────────────────────────

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  addUserMessage(message);
  input.value = '';
  document.getElementById('chatQuickReplies').innerHTML = '';

  showTypingIndicator();
  await new Promise(r => setTimeout(r, 400 + Math.random() * 300));
  hideTypingIndicator();

  const faq = chatState.isAuthenticated ? authenticatedFAQ : publicFAQ;
  const { answer, related } = findBestAnswer(message, faq);
  addBotMessage(answer, related);
}

function scrollToBottom() {
  const c = document.getElementById('chatMessages');
  if (c) c.scrollTop = c.scrollHeight;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChatBot);
} else {
  initChatBot();
}
