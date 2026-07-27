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

// Linear step order the user can navigate back through.
// Transition screens (t1/t2/t3) auto-advance and aren't part of it.
const ONBOARDING_STEPS = ['onboarding-greeting', 'onboarding-q1', 'onboarding-q2', 'onboarding-q3', 'onboarding-final'];
let currentOnboardingScreen = null;

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

  currentOnboardingScreen = screenId;

  // Back button only makes sense on a navigable step that isn't the first
  const backBtn = document.getElementById('onboardingBackBtn');
  const stepIndex = ONBOARDING_STEPS.indexOf(screenId);
  if (backBtn) backBtn.style.display = stepIndex > 0 ? 'flex' : 'none';

  // No skipping once we're on the last step — there's nothing left to skip
  const skipBtn = document.querySelector('.onboarding-skip');
  if (skipBtn) skipBtn.style.display = screenId === 'onboarding-final' ? 'none' : '';

  // Render any icons set via data-lucide on the newly-shown screen
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Go back to the previous step
function goToPreviousStep() {
  const stepIndex = ONBOARDING_STEPS.indexOf(currentOnboardingScreen);
  if (stepIndex > 0) {
    showScreen(ONBOARDING_STEPS[stepIndex - 1]);
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
    }, 1300);
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
      responseText.textContent = 'Nice, one store to master.';
      if (responseEmoji) responseEmoji.innerHTML = '<i data-lucide="store"></i>';
    } else if (count === '2-5') {
      responseText.textContent = 'Multitasking, we see you.';
      if (responseEmoji) responseEmoji.innerHTML = '<i data-lucide="layers"></i>';
    } else if (count === 'more-than-5') {
      responseText.textContent = "Big moves. Let's go.";
      if (responseEmoji) responseEmoji.innerHTML = '<i data-lucide="rocket"></i>';
    }
  }

  showScreen('onboarding-t1');

  // Auto-advance after a short pause
  setTimeout(() => {
    showScreen('onboarding-q2');
  }, 1800);
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
      responseText.textContent = 'Anything goes. Got it.';
      if (responseEmoji) responseEmoji.innerHTML = '<i data-lucide="shuffle"></i>';
    } else if (selectedCategories.length === 1) {
      const category = selectedCategories[0];
      const iconMap = {
        'Handmade Crafts & Art': 'palette',
        'Jewelry & Accessories': 'gem',
        'Home Decor': 'home',
        'Apparel & Fashion': 'shirt',
        'Beauty & Skincare': 'sparkles',
        'Food & Beverage': 'cake',
        'Stationery & Paper Goods': 'pencil',
        'Toys & Games': 'gamepad-2',
        'Party Supplies & Gifts': 'gift',
        'Electronics & Gadgets': 'cpu',
        'Tools & Supplies': 'wrench'
      };
      responseText.textContent = `${category}. Good pick.`;
      if (responseEmoji) responseEmoji.innerHTML = `<i data-lucide="${iconMap[category] || 'sparkles'}"></i>`;
    } else {
      responseText.textContent = 'Nice mix. Noted.';
      if (responseEmoji) responseEmoji.innerHTML = '<i data-lucide="layers"></i>';
    }
  }

  showScreen('onboarding-t2');

  // Auto-advance after a short pause
  setTimeout(() => {
    showScreen('onboarding-q3');
  }, 1800);
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
      responseText.textContent = 'Every empire starts small.';
      if (responseEmoji) responseEmoji.innerHTML = '<i data-lucide="sprout"></i>';
    } else if (volume === '11-50') {
      responseText.textContent = "Solid rhythm you've got there.";
      if (responseEmoji) responseEmoji.innerHTML = '<i data-lucide="bar-chart-3"></i>';
    } else if (volume === 'more-than-50') {
      responseText.textContent = "Okay, you're not lazy at all.";
      if (responseEmoji) responseEmoji.innerHTML = '<i data-lucide="flame"></i>';
    }
  }
  
  showScreen('onboarding-t3');

  // Auto-advance after a short pause and calculate recommendation
  setTimeout(() => {
    calculateRecommendation();
    showScreen('onboarding-final');
  }, 1800);
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
  const maybeLaterBtn = document.getElementById('maybeLaterBtn');
  if (maybeLaterBtn) maybeLaterBtn.style.display = '';

  if (plan === 'free') {
    if (badgeEl) badgeEl.textContent = 'FREE';
    if (nameEl) nameEl.textContent = 'Free Plan';
    if (priceEl) priceEl.textContent = '€0/month';
    if (featuresEl) {
      featuresEl.innerHTML = `
        <div class="plan-feature"><i data-lucide="check" class="plan-feature-icon"></i> 1 store</div>
        <div class="plan-feature"><i data-lucide="check" class="plan-feature-icon"></i> 5 AI scans per month</div>
        <div class="plan-feature"><i data-lucide="check" class="plan-feature-icon"></i> Unlimited ingredients & products</div>
      `;
    }
    if (upgradeBtn) upgradeBtn.textContent = 'Stay Free for Now';
    // Everyone starts on Free, so "Maybe later" doesn't apply here
    if (maybeLaterBtn) maybeLaterBtn.style.display = 'none';
  } else if (plan === 'starter') {
    if (badgeEl) badgeEl.textContent = 'STARTER';
    if (nameEl) nameEl.textContent = 'Starter Plan';
    if (priceEl) priceEl.textContent = '€9.99/month';
    if (featuresEl) {
      featuresEl.innerHTML = `
        <div class="plan-feature"><i data-lucide="check" class="plan-feature-icon"></i> Up to 5 stores</div>
        <div class="plan-feature"><i data-lucide="check" class="plan-feature-icon"></i> 100 AI scans per month</div>
        <div class="plan-feature"><i data-lucide="check" class="plan-feature-icon"></i> Analytics dashboard</div>
      `;
    }
    if (upgradeBtn) upgradeBtn.textContent = 'Upgrade to Starter';
  } else if (plan === 'pro') {
    if (badgeEl) badgeEl.textContent = 'PRO';
    if (nameEl) nameEl.textContent = 'Pro Plan';
    if (priceEl) priceEl.textContent = '€24.99/month';
    if (featuresEl) {
      featuresEl.innerHTML = `
        <div class="plan-feature"><i data-lucide="check" class="plan-feature-icon"></i> Unlimited stores</div>
        <div class="plan-feature"><i data-lucide="check" class="plan-feature-icon"></i> 300 AI scans per month</div>
        <div class="plan-feature"><i data-lucide="check" class="plan-feature-icon"></i> Analytics dashboard</div>
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
  // Free has nothing to upgrade to yet — just finish onboarding
  if (onboardingState.recommendedPlan === 'free') {
    completeOnboarding();
    return;
  }
  // Redirect to pricing page
  window.location.href = '/pricing';
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

    // Skip auto-show on settings page (user can retake manually)
    if (window.location.pathname.includes('settings')) return;
    
    const { data, error } = await _supabase
      .from('user_settings')
      .select('onboarding_completed')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error checking onboarding status:', error);
      return;
    }

    // Show onboarding only if the user has never completed or skipped it.
    // completeOnboarding() sets onboarding_completed on both paths, so
    // once this is true it never shows again.
    if (!data || !data.onboarding_completed) {
      showOnboardingModal();
    }
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
