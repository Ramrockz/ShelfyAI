// ShelfyAI Chat Bot
// FAQ-based chatbot with context-aware responses

// Public FAQ (for non-authenticated users)
const publicFAQ = [
  {
    id: 1,
    question: "What is ShelfyAI?",
    answer: "ShelfyAI is an intelligent inventory management system designed for small businesses, restaurants, and food producers. It helps you track ingredients, manage recipes, monitor expenses, and optimize your operations.",
    keywords: ["what", "shelfy", "about", "explain", "describe"],
    category: "general",
    relatedQuestions: [2, 3]
  },
  {
    id: 2,
    question: "How much does ShelfyAI cost?",
    answer: "ShelfyAI offers flexible pricing plans. Visit our <a href='pricing.html'>pricing page</a> to see our current plans and find the one that fits your needs best.",
    keywords: ["price", "cost", "pricing", "plan", "subscription", "pay", "money"],
    category: "pricing",
    relatedQuestions: [7, 8]
  },
  {
    id: 3,
    question: "How do I sign up?",
    answer: "Click the 'Sign Up' button in the top right corner or visit our <a href='login.html'>login page</a>. You can create an account using your email address.",
    keywords: ["sign up", "register", "create account", "join", "start"],
    category: "getting-started",
    relatedQuestions: [4]
  },
  {
    id: 4,
    question: "Is there a free trial?",
    answer: "Yes! We offer a free trial so you can explore all features before committing. Sign up to get started immediately.",
    keywords: ["free", "trial", "demo", "test"],
    category: "pricing",
    relatedQuestions: [2, 3]
  },
  {
    id: 5,
    question: "What features does ShelfyAI include?",
    answer: "ShelfyAI includes: ingredient tracking, recipe management, expense tracking, sales monitoring, order management, low stock alerts, shopping lists, and detailed analytics.",
    keywords: ["features", "capabilities", "what can", "includes", "offers", "functions"],
    category: "general",
    relatedQuestions: [1, 6]
  },
  {
    id: 6,
    question: "Can I track multiple locations?",
    answer: "Yes! ShelfyAI supports multi-location tracking. You can manage inventory across different warehouses, stores, or production facilities.",
    keywords: ["location", "multiple", "warehouse", "stores", "branches"],
    category: "features",
    relatedQuestions: [5]
  },
  {
    id: 7,
    question: "Can I cancel anytime?",
    answer: "Absolutely! You can cancel your subscription at any time with no penalties. Your data remains accessible until the end of your billing period.",
    keywords: ["cancel", "subscription", "stop", "quit", "leave"],
    category: "pricing",
    relatedQuestions: [2, 8]
  },
  {
    id: 8,
    question: "Is my data secure?",
    answer: "Yes! We use industry-standard encryption and security practices. Your data is stored securely and backed up regularly. We never share your data with third parties.",
    keywords: ["secure", "security", "safe", "privacy", "data protection", "encryption"],
    category: "security",
    relatedQuestions: [9]
  },
  {
    id: 9,
    question: "Can I export my data?",
    answer: "Yes! Once you're signed in, you can export your data in various formats including CSV and PDF from any section of the app.",
    keywords: ["export", "download", "backup", "save"],
    category: "features",
    relatedQuestions: [8]
  },
  {
    id: 10,
    question: "What types of businesses use ShelfyAI?",
    answer: "ShelfyAI is perfect for restaurants, cafes, bakeries, catering companies, food trucks, meal prep services, and small food manufacturing businesses.",
    keywords: ["business", "industry", "restaurant", "bakery", "cafe", "food"],
    category: "general",
    relatedQuestions: [1, 5]
  }
];

// Authenticated FAQ (for logged-in users)
const authenticatedFAQ = [
  {
    id: 101,
    question: "How do I add a new ingredient?",
    answer: "Go to the <a href='ingredients.html'>Ingredients page</a>, click the '+' button in the top right, fill in the ingredient details (name, quantity, unit, cost), and click Save.",
    keywords: ["add", "ingredient", "create", "new", "item"],
    category: "ingredients",
    relatedQuestions: [102, 103]
  },
  {
    id: 102,
    question: "How do I edit or delete an ingredient?",
    answer: "On the <a href='ingredients.html'>Ingredients page</a>, click on an ingredient to open its detail page. From there, you can edit any information or click the delete button to remove it.",
    keywords: ["edit", "delete", "remove", "update", "change", "ingredient"],
    category: "ingredients",
    relatedQuestions: [101, 104]
  },
  {
    id: 103,
    question: "How do low stock alerts work?",
    answer: "When an ingredient quantity drops below the minimum stock level you set, ShelfyAI automatically creates a notification. You can customize these alerts in <a href='settings.html'>Settings</a>.",
    keywords: ["alert", "notification", "low stock", "warning", "minimum"],
    category: "notifications",
    relatedQuestions: [104, 105]
  },
  {
    id: 104,
    question: "How do I restock an ingredient?",
    answer: "Click the notification bell or go to the ingredient's detail page and click 'Restock'. Enter the quantity to add and the total cost. ShelfyAI will update the inventory and track the expense.",
    keywords: ["restock", "add stock", "refill", "replenish", "order"],
    category: "ingredients",
    relatedQuestions: [101, 103]
  },
  {
    id: 105,
    question: "How do I turn off notifications?",
    answer: "Go to <a href='settings.html'>Settings</a> and scroll to the Notifications section. You can toggle notifications on/off, and customize which types of alerts you want to receive.",
    keywords: ["disable", "turn off", "notifications", "alerts", "stop"],
    category: "notifications",
    relatedQuestions: [103]
  },
  {
    id: 106,
    question: "How do I create a recipe?",
    answer: "Go to the <a href='recipes.html'>Recipes page</a>, click 'New Recipe', add the recipe name and instructions, then add ingredients from your inventory. ShelfyAI will calculate costs automatically.",
    keywords: ["recipe", "create", "add", "new", "make"],
    category: "recipes",
    relatedQuestions: [107, 108]
  },
  {
    id: 107,
    question: "How do I see recipe costs?",
    answer: "Recipe costs are calculated automatically based on your ingredient costs. View them on the <a href='recipes.html'>Recipes page</a> or click on a recipe to see detailed cost breakdowns.",
    keywords: ["cost", "price", "recipe", "calculate", "total"],
    category: "recipes",
    relatedQuestions: [106, 109]
  },
  {
    id: 108,
    question: "Can I scale recipes?",
    answer: "Yes! When viewing a recipe detail page, you can adjust the serving size and ShelfyAI will automatically calculate the adjusted ingredient quantities and costs.",
    keywords: ["scale", "adjust", "recipe", "portion", "servings"],
    category: "recipes",
    relatedQuestions: [106, 107]
  },
  {
    id: 109,
    question: "How do I track expenses?",
    answer: "Go to the <a href='expenses.html'>Expenses page</a> and click '+' to add a new expense. Enter the description, amount, and category. You can also track expenses automatically when restocking ingredients.",
    keywords: ["expense", "cost", "spending", "track", "money"],
    category: "expenses",
    relatedQuestions: [110, 107]
  },
  {
    id: 110,
    question: "How do I record a sale?",
    answer: "Visit the <a href='sales.html'>Sales page</a> and click '+' to record a new sale. Select the recipe or item sold, quantity, and sale price. ShelfyAI will update inventory and calculate profit margins automatically.",
    keywords: ["sale", "revenue", "sell", "record", "transaction"],
    category: "sales",
    relatedQuestions: [111, 107]
  },
  {
    id: 111,
    question: "Where can I see my profit margins?",
    answer: "Profit margins are displayed on the <a href='operations.html'>Operations page</a> in the Key Metrics section. You can also see individual profit margins on each sale in the <a href='sales.html'>Sales page</a>.",
    keywords: ["profit", "margin", "earnings", "revenue", "analytics"],
    category: "sales",
    relatedQuestions: [110, 112]
  },
  {
    id: 112,
    question: "How do I generate a shopping list?",
    answer: "Go to the <a href='shopping-list.html'>Shopping List page</a>. It automatically shows ingredients that are low in stock or out of stock. You can also manually add items.",
    keywords: ["shopping", "list", "buy", "purchase", "order"],
    category: "shopping",
    relatedQuestions: [103, 104]
  },
  {
    id: 113,
    question: "How do I change my password?",
    answer: "Go to <a href='settings.html'>Settings</a>, scroll to the Security section, and click 'Change Password'. Enter your new password and confirm it.",
    keywords: ["password", "change", "reset", "security"],
    category: "account",
    relatedQuestions: [114, 105]
  },
  {
    id: 114,
    question: "How do I change the theme?",
    answer: "You can toggle between light and dark mode using the toggle in the top navigation bar, or set your default preference in <a href='settings.html'>Settings</a> under Appearance.",
    keywords: ["theme", "dark mode", "light mode", "appearance", "color"],
    category: "account",
    relatedQuestions: [113]
  },
  {
    id: 115,
    question: "How do I delete my account?",
    answer: "Go to <a href='settings.html'>Settings</a>, scroll to the Danger Zone, and click 'Delete Account'. This action is permanent and will remove all your data.",
    keywords: ["delete", "account", "remove", "close"],
    category: "account",
    relatedQuestions: [113]
  },
  {
    id: 116,
    question: "Can I undo a deletion?",
    answer: "No, deletions are permanent and cannot be undone. We recommend exporting your data regularly as backups. Always double-check before confirming any deletion.",
    keywords: ["undo", "restore", "recover", "undelete"],
    category: "general",
    relatedQuestions: [115]
  },
  {
    id: 117,
    question: "How do I view my order history?",
    answer: "Visit the <a href='orders.html'>Orders page</a> to see all your past orders, including restock orders and purchase history with full details and costs.",
    keywords: ["orders", "history", "past", "previous", "view"],
    category: "orders",
    relatedQuestions: [104, 112]
  },
  {
    id: 118,
    question: "What's the Operations page for?",
    answer: "The <a href='operations.html'>Operations page</a> is your dashboard showing key metrics, recent activity, and important insights about your business performance at a glance.",
    keywords: ["operations", "dashboard", "overview", "metrics", "analytics"],
    category: "general",
    relatedQuestions: [111]
  }
];

// Fallback responses when no match is found
const fallbackResponses = [
  "I'm not sure I understand that question. Could you try rephrasing it?",
  "I couldn't find an answer to that. Try asking about ingredients, recipes, expenses, or sales.",
  "Hmm, I don't have information about that. Would you like to see our commonly asked questions?"
];

// Quick reply suggestions
const publicQuickReplies = [
  "What is ShelfyAI?",
  "How much does it cost?",
  "How do I sign up?",
  "What features are included?"
];

const authenticatedQuickReplies = [
  "How do I add an ingredient?",
  "How do I create a recipe?",
  "How do low stock alerts work?",
  "How do I track expenses?"
];

// Chat state
const CHAT_SESSION_KEY = 'shelfy_chat_session';

function saveChatSession() {
  try {
    sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify({
      messages: chatState.messages,
      isOpen: chatState.isOpen
    }));
  } catch (e) {}
}

function loadChatSession() {
  try {
    const raw = sessionStorage.getItem(CHAT_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

let chatState = {
  isOpen: false,
  isAuthenticated: false,
  messages: [],
  conversationStarted: false
};

// Initialize chat bot
async function initChatBot() {
  // Check authentication status
  if (typeof supabaseClient !== 'undefined') {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      chatState.isAuthenticated = !!session;
    } catch (error) {
      chatState.isAuthenticated = false;
    }
  }

  // Restore previous session before building the widget
  const savedSession = loadChatSession();
  if (savedSession && savedSession.messages && savedSession.messages.length > 0) {
    chatState.messages = savedSession.messages;
    chatState.conversationStarted = true;
    chatState.isOpen = savedSession.isOpen || false;
  }
  
  // Create chat widget
  createChatWidget();

  // Replay saved messages into the DOM
  if (chatState.conversationStarted && chatState.messages.length > 0) {
    const container = document.getElementById('chatMessages');
    chatState.messages.forEach(({ type, message }) => {
      const div = document.createElement('div');
      if (type === 'bot') {
        div.className = 'chat-message bot-message';
        div.innerHTML = `
          <div class="message-avatar">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
            </svg>
          </div>
          <div class="message-content">${message}</div>`;
      } else {
        div.className = 'chat-message user-message';
        div.innerHTML = `<div class="message-content">${message}</div>`;
      }
      container.appendChild(div);
    });
    scrollToBottom();

    // Re-open if it was open on previous page
    if (chatState.isOpen) {
      document.getElementById('chatWindow').classList.add('active');
      document.getElementById('chatBubble').classList.add('hidden');
    }
  } else {
    // Fresh session — show welcome message after a short delay
    setTimeout(() => {
      if (!chatState.conversationStarted) {
        addWelcomeMessage();
      }
    }, 1000);

    // Auto-open chat for non-authenticated users after 5 seconds
    if (!chatState.isAuthenticated) {
      setTimeout(() => {
        if (!chatState.isOpen) {
          toggleChat();
        }
      }, 5000);
    }
  }
}

// Create chat widget HTML
function createChatWidget() {
  const widget = document.createElement('div');
  widget.id = 'chatWidget';
  widget.innerHTML = `
    <div class="chat-bubble" id="chatBubble" onclick="toggleChat()">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
      </svg>
      <span class="chat-bubble-badge" id="chatBadge" style="display: none;">1</span>
    </div>
    
    <div class="chat-window" id="chatWindow">
      <div class="chat-header">
        <div class="chat-header-title">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
          </svg>
          <span>ShelfyAI Help</span>
        </div>
        <button class="chat-close-btn" onclick="toggleChat()">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      
      <div class="chat-messages" id="chatMessages"></div>
      
      <div class="chat-quick-replies" id="chatQuickReplies"></div>
      
      <div class="chat-input-container">
        <input 
          type="text" 
          class="chat-input" 
          id="chatInput" 
          placeholder="Ask a question..."
          onkeypress="handleChatInputKeypress(event)"
        />
        <button class="chat-send-btn" onclick="sendMessage()">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(widget);
}

// Toggle chat window
function toggleChat() {
  chatState.isOpen = !chatState.isOpen;
  const chatWindow = document.getElementById('chatWindow');
  const chatBubble = document.getElementById('chatBubble');
  const chatBadge = document.getElementById('chatBadge');
  
  if (chatState.isOpen) {
    chatWindow.classList.add('active');
    chatBubble.classList.add('hidden');
    chatBadge.style.display = 'none';
    
    // Focus input
    setTimeout(() => {
      document.getElementById('chatInput')?.focus();
    }, 100);
  } else {
    chatWindow.classList.remove('active');
    chatBubble.classList.remove('hidden');
  }

  saveChatSession();
}

// Add welcome message
function addWelcomeMessage() {
  const welcomeMsg = chatState.isAuthenticated
    ? "Hi! 👋 I'm here to help you with ShelfyAI. Ask me anything about managing your inventory, recipes, expenses, or sales!"
    : "Welcome to ShelfyAI! 👋 I can answer questions about our features, pricing, and how to get started. What would you like to know?";
  
  addBotMessage(welcomeMsg);
  showQuickReplies();
  chatState.conversationStarted = true;
  
  // Show badge
  const badge = document.getElementById('chatBadge');
  if (badge && !chatState.isOpen) {
    badge.style.display = 'flex';
  }
}

// Add bot message
function addBotMessage(message) {
  const messagesContainer = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message bot-message';
  messageDiv.innerHTML = `
    <div class="message-avatar">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
      </svg>
    </div>
    <div class="message-content">${message}</div>
  `;
  
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
  chatState.messages.push({ type: 'bot', message });
  saveChatSession();
}

// Add user message
function addUserMessage(message) {
  const messagesContainer = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message user-message';
  messageDiv.innerHTML = `
    <div class="message-content">${message}</div>
  `;
  
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
  chatState.messages.push({ type: 'user', message });
  saveChatSession();
}

// Show quick replies
function showQuickReplies() {
  const quickRepliesContainer = document.getElementById('chatQuickReplies');
  const replies = chatState.isAuthenticated ? authenticatedQuickReplies : publicQuickReplies;
  
  quickRepliesContainer.innerHTML = replies.map(reply => 
    `<button class="quick-reply-btn" onclick="handleQuickReply('${reply.replace(/'/g, "\\'")}')">${reply}</button>`
  ).join('');
}

// Handle quick reply click
function handleQuickReply(question) {
  document.getElementById('chatInput').value = question;
  sendMessage();
}

// Handle chat input keypress
function handleChatInputKeypress(event) {
  if (event.key === 'Enter') {
    sendMessage();
  }
}

// Send message
function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  
  if (!message) return;
  
  // Add user message
  addUserMessage(message);
  input.value = '';
  
  // Hide quick replies after first message
  document.getElementById('chatQuickReplies').innerHTML = '';
  
  // Find answer
  setTimeout(() => {
    const answer = findAnswer(message);
    addBotMessage(answer.message);
    
    // Show related questions if available
    if (answer.relatedQuestions && answer.relatedQuestions.length > 0) {
      showRelatedQuestions(answer.relatedQuestions);
    }
  }, 500);
}

// Find answer from FAQ
function findAnswer(query) {
  const faqData = chatState.isAuthenticated ? authenticatedFAQ : publicFAQ;
  const lowerQuery = query.toLowerCase();
  
  let bestMatch = null;
  let bestScore = 0;
  
  faqData.forEach(entry => {
    let score = 0;
    
    // Check keywords
    entry.keywords.forEach(keyword => {
      if (lowerQuery.includes(keyword.toLowerCase())) {
        score += 3;
      }
    });
    
    // Check question similarity
    const questionWords = entry.question.toLowerCase().split(' ');
    questionWords.forEach(word => {
      if (word.length > 3 && lowerQuery.includes(word)) {
        score += 1;
      }
    });
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  });
  
  // If good match found, return it
  if (bestScore >= 3 && bestMatch) {
    return {
      message: bestMatch.answer,
      relatedQuestions: bestMatch.relatedQuestions?.map(id => 
        faqData.find(entry => entry.id === id)
      ).filter(Boolean)
    };
  }
  
  // Return fallback
  return {
    message: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
    relatedQuestions: []
  };
}

// Show related questions
function showRelatedQuestions(questions) {
  if (questions.length === 0) return;
  
  const relatedDiv = document.createElement('div');
  relatedDiv.className = 'chat-message bot-message related-questions';
  relatedDiv.innerHTML = `
    <div class="message-avatar">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
      </svg>
    </div>
    <div class="message-content">
      <div class="related-questions-title">Related questions:</div>
      ${questions.map(q => 
        `<button class="related-question-btn" onclick="handleQuickReply('${q.question.replace(/'/g, "\\'")}')">${q.question}</button>`
      ).join('')}
    </div>
  `;
  
  document.getElementById('chatMessages').appendChild(relatedDiv);
  scrollToBottom();
}

// Scroll to bottom of messages
function scrollToBottom() {
  const messagesContainer = document.getElementById('chatMessages');
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChatBot);
} else {
  initChatBot();
}
