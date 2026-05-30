// ═══════════════════════════════════════════════════════════════
// Onboarding Modal Logic
// ═══════════════════════════════════════════════════════════════

// State
const onboardingState = {
  storeCount: null,
  categories: [],
  orderVolume: null,
  recommendedPlan: null
};

// Show onboarding modal
function showOnboardingModal() {
  const modal = document.getElementById('onboardingModal');
  if (!modal) return;
  
  modal.style.display = 'flex';
  showScreen('onboarding-greeting');
  animateGreeting();
}

// Hide onboarding modal
function hideOnboardingModal() {
  const modal = document.getElementById('onboardingModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Show specific screen
function showScreen(screenId) {
  // Hide all screens
  const screens = document.querySelectorAll('.onboarding-screen');
  screens.forEach(screen => screen.style.display = 'none');
  
  // Show target screen
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.style.display = 'block';
  }
  
  // Update progress dots based on which question we're on
  updateProgressDots(screenId);
}

// Update progress dots
function updateProgressDots(screenId) {
  const dots = document.querySelectorAll('.progress-dot');
  
  // Remove all active/completed states
  dots.forEach(dot => {
    dot.classList.remove('active', 'completed');
  });
  
  // Determine which step we're on
  if (screenId === 'onboarding-greeting') {
    // No dots active on greeting
  } else if (screenId === 'onboarding-q1' || screenId === 'onboarding-t1') {
    dots[0]?.classList.add('active');
  } else if (screenId === 'onboarding-q2' || screenId === 'onboarding-t2') {
    dots[0]?.classList.add('completed');
    dots[1]?.classList.add('active');
  } else if (screenId === 'onboarding-q3' || screenId === 'onboarding-t3') {
    dots[0]?.classList.add('completed');
    dots[1]?.classList.add('completed');
    dots[2]?.classList.add('active');
  } else if (screenId === 'onboarding-final') {
    dots[0]?.classList.add('completed');
    dots[1]?.classList.add('completed');
    dots[2]?.classList.add('completed');
  }
}

// Animate greeting text lines
function animateGreeting() {
  const continueBtn = document.getElementById('greetingContinue');
  if (continueBtn) {
    // Show continue button after all lines have animated
    setTimeout(() => {
      continueBtn.style.transition = 'opacity 0.5s ease';
      continueBtn.style.opacity = '1';
    }, 2400);
  }
}

// Navigate to next step
function nextOnboardingStep() {
  showScreen('onboarding-q1');
}

// ─────────────────────────────────────────────────────────────
// Question 1: Store Count
// ───────────────────────────────────────────────────────────── 

function selectStoreCount(count) {
  onboardingState.storeCount = count;
  
  // Show transition screen with response
  const responseText = document.getElementById('storeCountResponse');
  const responseEmoji = document.getElementById('storeCountEmoji');
  
  if (responseText) {
    if (count === '1') {
      responseText.textContent = 'that sounds about right';
      if (responseEmoji) responseEmoji.textContent = '👌';
    } else if (count === '2-5') {
      responseText.textContent = 'You sure about being lazy, anyways..';
      if (responseEmoji) responseEmoji.textContent = '😏';
    } else if (count === 'more-than-5') {
      responseText.textContent = "No one said you can't be lazy and busy";
      if (responseEmoji) responseEmoji.textContent = '🚀';
    }
  }
  
  showScreen('onboarding-t1');
  
  // Auto-advance after 3 seconds
  setTimeout(() => {
    showScreen('onboarding-q2');
  }, 3000);
}

// ─────────────────────────────────────────────────────────────
// Question 2: Product Categories
// ───────────────────────────────────────────────────────────── 

function toggleCategory(button) {
  const category = button.getAttribute('data-category');
  
  // If "Whatever" is clicked, deselect all others
  if (category === 'Whatever') {
    const allPills = document.querySelectorAll('.category-pill');
    allPills.forEach(pill => {
      if (pill !== button) {
        pill.classList.remove('selected');
      }
    });
    button.classList.toggle('selected');
  } else {
    // If any other category is clicked, deselect "Whatever"
    const whateverBtn = document.querySelector('.category-pill[data-category="Whatever"]');
    if (whateverBtn) {
      whateverBtn.classList.remove('selected');
    }
    button.classList.toggle('selected');
  }
  
  // Update state
  const selectedPills = document.querySelectorAll('.category-pill.selected');
  onboardingState.categories = Array.from(selectedPills).map(pill => 
    pill.getAttribute('data-category')
  );
}

function submitCategories() {
  const selectedPills = document.querySelectorAll('.category-pill.selected');
  const selectedCategories = Array.from(selectedPills).map(pill => 
    pill.getAttribute('data-category')
  );
  
  // If nothing selected, default to "Whatever"
  if (selectedCategories.length === 0) {
    selectedCategories.push('Whatever');
  }
  
  onboardingState.categories = selectedCategories;
  
  // Show transition screen with response
  const responseText = document.getElementById('categoryResponse');
  const responseEmoji = document.getElementById('categoryEmoji');
  
  if (responseText) {
    if (selectedCategories.includes('Whatever')) {
      responseText.textContent = 'I feel you, whatever sells';
      if (responseEmoji) responseEmoji.textContent = '🤷';
    } else if (selectedCategories.length === 1) {
      const category = selectedCategories[0];
      const funnyComments = {
        'Handmade Crafts & Art': 'Nice! Arts and crafts, the original hustle.',
        'Jewelry & Accessories': 'Shiny things that make people happy. Smart.',
        'Home Decor': 'Making houses feel like homes, one piece at a time.',
        'Apparel & Fashion': 'Looking good is good business!',
        'Beauty & Skincare': 'Beauty is big business. You know what\'s up.',
        'Food & Beverage': 'Everyone needs to eat. Solid choice.',
        'Stationery & Paper Goods': 'Paper products never go out of style.',
        'Toys & Games': 'Fun and profit. The best combo.',
        'Party Supplies & Gifts': 'You\'re in the happiness business!',
        'Electronics & Gadgets': 'Tech savvy. I like it.',
        'Tools & Supplies': 'Tools of the trade. Practical and profitable.'
      };
      const emojiMap = {
        'Handmade Crafts & Art': '🎨',
        'Jewelry & Accessories': '💎',
        'Home Decor': '🏠',
        'Apparel & Fashion': '👕',
        'Beauty & Skincare': '💄',
        'Food & Beverage': '🍰',
        'Stationery & Paper Goods': '📝',
        'Toys & Games': '🎮',
        'Party Supplies & Gifts': '🎁',
        'Electronics & Gadgets': '⚡',
        'Tools & Supplies': '🔧'
      };
      responseText.textContent = `${category}. ${funnyComments[category] || 'Nice choice!'}`;
      if (responseEmoji) responseEmoji.textContent = emojiMap[category] || '✨';
    } else {
      responseText.textContent = 'busy, busy, busy';
      if (responseEmoji) responseEmoji.textContent = '🐝';
    }
  }
  
  showScreen('onboarding-t2');
  
  // Auto-advance after 3 seconds
  setTimeout(() => {
    showScreen('onboarding-q3');
  }, 3000);
}

// ─────────────────────────────────────────────────────────────
// Question 3: Order Volume
// ───────────────────────────────────────────────────────────── 

function selectOrderVolume(volume) {
  onboardingState.orderVolume = volume;
  
  // Show transition screen with response
  const responseText = document.getElementById('orderVolumeResponse');
  const responseEmoji = document.getElementById('orderVolumeEmoji');
  
  if (responseText) {
    if (volume === '1-10') {
      responseText.textContent = 'Every business starts small. Stick with it, the breakthrough is closer than you think.';
      if (responseEmoji) responseEmoji.textContent = '🌱';
    } else if (volume === '11-50') {
      responseText.textContent = "You're finding your rhythm! Keep that momentum going.";
      if (responseEmoji) responseEmoji.textContent = '📈';
    } else if (volume === 'more-than-50') {
      responseText.textContent = "Look at you crushing it! That's the kind of hustle that builds empires.";
      if (responseEmoji) responseEmoji.textContent = '🔥';
    }
  }
  
  showScreen('onboarding-t3');
  
  // Auto-advance after 3 seconds and calculate recommendation
  setTimeout(() => {
    calculateRecommendation();
    showScreen('onboarding-final');
  }, 3000);
}

// ─────────────────────────────────────────────────────────────
// Plan Recommendation Logic
// ───────────────────────────────────────────────────────────── 

function calculateRecommendation() {
  const { storeCount, orderVolume } = onboardingState;
  
  let plan = 'free';
  
  // Recommendation logic
  if (storeCount === 'more-than-5') {
    plan = 'pro';
  } else if (storeCount === '2-5') {
    plan = 'starter';
  } else if (storeCount === '1') {
    if (orderVolume === 'more-than-50') {
      plan = 'starter';
    } else {
      plan = 'free';
    }
  }
  
  onboardingState.recommendedPlan = plan;
  
  // Update UI with recommendation
  updateRecommendationUI(plan);
}

function updateRecommendationUI(plan) {
  const badgeEl = document.getElementById('recommendedPlanBadge');
  const nameEl = document.getElementById('recommendedPlanName');
  const priceEl = document.getElementById('recommendedPlanPrice');
  const featuresEl = document.getElementById('recommendedPlanFeatures');
  const upgradeBtn = document.getElementById('upgradeButtonText');
  
  if (plan === 'free') {
    if (badgeEl) badgeEl.textContent = 'FREE';
    if (nameEl) nameEl.textContent = 'Free Plan';
    if (priceEl) priceEl.textContent = '€0/month';
    if (featuresEl) {
      featuresEl.innerHTML = `
        <div class="plan-feature">✓ 1 store</div>
        <div class="plan-feature">✓ 5 AI scans per month</div>
        <div class="plan-feature">✓ Unlimited ingredients & recipes</div>
      `;
    }
    if (upgradeBtn) upgradeBtn.textContent = 'Start with Free';
  } else if (plan === 'starter') {
    if (badgeEl) badgeEl.textContent = 'STARTER';
    if (nameEl) nameEl.textContent = 'Starter Plan';
    if (priceEl) priceEl.textContent = '€9.99/month';
    if (featuresEl) {
      featuresEl.innerHTML = `
        <div class="plan-feature">✓ Up to 5 stores</div>
        <div class="plan-feature">✓ 100 AI scans per month</div>
        <div class="plan-feature">✓ Analytics dashboard</div>
      `;
    }
    if (upgradeBtn) upgradeBtn.textContent = 'Upgrade to Starter';
  } else if (plan === 'pro') {
    if (badgeEl) badgeEl.textContent = 'PRO';
    if (nameEl) nameEl.textContent = 'Pro Plan';
    if (priceEl) priceEl.textContent = '€24.99/month';
    if (featuresEl) {
      featuresEl.innerHTML = `
        <div class="plan-feature">✓ Unlimited stores</div>
        <div class="plan-feature">✓ 300 AI scans per month</div>
        <div class="plan-feature">✓ Analytics dashboard</div>
      `;
    }
    if (upgradeBtn) upgradeBtn.textContent = 'Upgrade to Pro';
  }
}

// ─────────────────────────────────────────────────────────────
// Complete Onboarding
// ───────────────────────────────────────────────────────────── 

async function completeOnboarding() {
  try {
    const _supabase = window.supabaseClient;
    const user = _supabase.auth.getUser ? await _supabase.auth.getUser() : await _supabase.auth.user();
    const userId = user?.data?.user?.id || user?.id;
    
    if (!userId) {
      console.error('No user ID found');
      hideOnboardingModal();
      return;
    }
    
    // Save onboarding data to Supabase
    const { error } = await _supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        onboarding_completed: true,
        onboarding_store_count: onboardingState.storeCount,
        onboarding_categories: onboardingState.categories,
        onboarding_order_volume: onboardingState.orderVolume,
        personalized_categories_enabled: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });
    
    if (error) {
      console.error('Error saving onboarding data:', error);
    }
    
    // Close modal and proceed to app
    hideOnboardingModal();
    
    // Reload to apply category filters
    if (typeof applyPersonalizedCategories === 'function') {
      applyPersonalizedCategories();
    }
    
  } catch (err) {
    console.error('Error completing onboarding:', err);
    hideOnboardingModal();
  }
}

// Upgrade to recommended plan
function upgradeToPlan() {
  // Redirect to pricing page
  window.location.href = '/pricing.html';
}

// ─────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────── 

// Check if user should see onboarding
async function checkAndShowOnboarding() {
  try {
    const _supabase = window.supabaseClient;
    const user = _supabase.auth.getUser ? await _supabase.auth.getUser() : await _supabase.auth.user();
    const userId = user?.data?.user?.id || user?.id;
    
    if (!userId) return;
    
    // Skip onboarding on desktop
    if (window.innerWidth > 768) return;
    
    // For testing: always show onboarding
    // In production, check onboarding_completed flag
    showOnboardingModal();
    
    /* Production version:
    const { data, error } = await _supabase
      .from('user_settings')
      .select('onboarding_completed')
      .eq('user_id', userId)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error checking onboarding status:', error);
      return;
    }
    
    // Show onboarding if not completed
    if (!data || !data.onboarding_completed) {
      showOnboardingModal();
    }
    */
    
  } catch (err) {
    console.error('Error checking onboarding:', err);
  }
}

// Retake onboarding (for settings)
function retakeOnboarding() {
  // Reset state
  onboardingState.storeCount = null;
  onboardingState.categories = [];
  onboardingState.orderVolume = null;
  onboardingState.recommendedPlan = null;
  
  // Reset UI
  const selectedPills = document.querySelectorAll('.category-pill.selected');
  selectedPills.forEach(pill => pill.classList.remove('selected'));
  
  // Show modal from beginning
  showOnboardingModal();
}
