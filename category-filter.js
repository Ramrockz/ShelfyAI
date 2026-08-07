// ═══════════════════════════════════════════════════════════════
// Category Filter Mapping System
// ═══════════════════════════════════════════════════════════════

// All system categories -- a generic inventory-item classification (Raw
// Material, Component, ...), not a craft-type-specific one. Every business
// type needs all of these regardless of what it sells (a jewelry shop and
// a candle shop both have raw materials, components, packaging, ...), so
// the old per-business-type subsetting no longer has a meaningful basis.
const ALL_SYSTEM_CATEGORIES = [
  'Raw Material', 'Component', 'Base Product', 'Packaging', 'Shipping Supply',
  'Finished Product', 'Digital Product', 'Equipment', 'Consumable', 'Other'
];

// Map onboarding categories to system categories -- every business type maps
// to the full list now (see comment above ALL_SYSTEM_CATEGORIES). Kept as a
// per-key mapping rather than collapsing the feature entirely so a future,
// genuinely business-specific subset can be reintroduced without reworking
// every call site.
const CATEGORY_MAPPING = {
  'Handmade Crafts & Art': ALL_SYSTEM_CATEGORIES,
  'Jewelry & Accessories': ALL_SYSTEM_CATEGORIES,
  'Home Decor': ALL_SYSTEM_CATEGORIES,
  'Apparel & Fashion': ALL_SYSTEM_CATEGORIES,
  'Beauty & Skincare': ALL_SYSTEM_CATEGORIES,
  'Food & Beverage': ALL_SYSTEM_CATEGORIES,
  'Stationery & Paper Goods': ALL_SYSTEM_CATEGORIES,
  'Toys & Games': ALL_SYSTEM_CATEGORIES,
  'Party Supplies & Gifts': ALL_SYSTEM_CATEGORIES,
  'Electronics & Gadgets': ALL_SYSTEM_CATEGORIES,
  'Tools & Supplies': ALL_SYSTEM_CATEGORIES,
  'Whatever': ALL_SYSTEM_CATEGORIES
};

// Get filtered categories based on user's onboarding preferences
function getPersonalizedCategories(onboardingCategories) {
  if (!onboardingCategories || onboardingCategories.length === 0) {
    return ALL_SYSTEM_CATEGORIES;
  }
  
  // If "Whatever" is selected, return all categories
  if (onboardingCategories.includes('Whatever')) {
    return ALL_SYSTEM_CATEGORIES;
  }
  
  // Merge all mapped categories and remove duplicates
  const categories = new Set();
  onboardingCategories.forEach(onboardingCat => {
    const mapped = CATEGORY_MAPPING[onboardingCat] || [];
    mapped.forEach(cat => categories.add(cat));
  });
  
  return Array.from(categories);
}

// Apply personalized category filtering to the current page
async function applyPersonalizedCategories() {
  try {
    const _supabase = window.supabaseClient;
    const user = _supabase.auth.getUser ? await _supabase.auth.getUser() : await _supabase.auth.user();
    const userId = user?.data?.user?.id || user?.id;
    
    if (!userId) return;
    
    // Fetch user settings
    const { data, error } = await _supabase
      .from('user_settings')
      .select('personalized_categories_enabled, onboarding_categories')
      .eq('user_id', userId)
      .single();
    
    if (error) {
      console.error('Error fetching user settings:', error);
      return;
    }

    // Stashed globally regardless of the toggle below -- that toggle only
    // controls category-CHIP filtering (a no-op today, see CATEGORY_MAPPING
    // above), but other features (e.g. ingredients.html's suggested
    // Attributes chips) want the raw "what do you sell" signal on its own.
    window.userOnboardingCategories = (data && data.onboarding_categories) || [];

    // If personalized categories are disabled, show all
    if (!data || !data.personalized_categories_enabled) {
      showAllCategories();
      return;
    }

    // Get personalized categories
    const onboardingCategories = data.onboarding_categories || [];
    const allowedCategories = getPersonalizedCategories(onboardingCategories);
    
    // Filter category chips on the page
    filterCategoryChips(allowedCategories);
    
  } catch (err) {
    console.error('Error applying personalized categories:', err);
  }
}

// Filter category chips to only show allowed categories
// Only applies to modal chips (.ing-cat-chip, .cat-chip, .ops-cat-chip)
// Main page filters (.mobile-type-filter) should show only existing categories
function filterCategoryChips(allowedCategories) {
  // Find only modal category chips, NOT main page filters
  const chipSelectors = [
    '.ing-cat-chip',      // ingredients.html modal
    '.cat-chip',          // ingredient-detail.html
    '.ops-cat-chip'       // operations.html modal
  ];
  
  chipSelectors.forEach(selector => {
    const chips = document.querySelectorAll(selector);
    chips.forEach(chip => {
      const categoryValue = chip.getAttribute('data-value') || 
                           chip.getAttribute('data-cat') ||
                           chip.textContent.trim();
      
      if (allowedCategories.includes(categoryValue)) {
        chip.style.display = '';
      } else {
        chip.style.display = 'none';
      }
    });
  });
}

// Show all categories (when personalized filtering is disabled)
// Only applies to modal chips, NOT main page filters
function showAllCategories() {
  const chipSelectors = [
    '.ing-cat-chip',
    '.cat-chip',
    '.ops-cat-chip'
  ];
  
  chipSelectors.forEach(selector => {
    const chips = document.querySelectorAll(selector);
    chips.forEach(chip => {
      chip.style.display = '';
    });
  });
}

// Show only categories that exist in current ingredients
// This is for main page filters (.mobile-type-filter)
function showExistingCategories(existingCategories) {
  const filters = document.querySelectorAll('.mobile-type-filter');
  filters.forEach(filter => {
    const categoryValue = filter.getAttribute('data-cat');
    if (existingCategories.includes(categoryValue)) {
      filter.style.display = '';
    } else {
      filter.style.display = 'none';
    }
  });
}

// Toggle personalized categories on/off
async function togglePersonalizedCategories(enabled) {
  try {
    const _supabase = window.supabaseClient;
    const user = _supabase.auth.getUser ? await _supabase.auth.getUser() : await _supabase.auth.user();
    const userId = user?.data?.user?.id || user?.id;
    
    if (!userId) return;
    
    // Update setting in database
    const { error } = await _supabase
      .from('user_settings')
      .update({
        personalized_categories_enabled: enabled,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
    
    if (error) {
      console.error('Error updating personalized categories setting:', error);
      return;
    }
    
    // Apply changes immediately
    if (enabled) {
      applyPersonalizedCategories();
    } else {
      showAllCategories();
    }
    
  } catch (err) {
    console.error('Error toggling personalized categories:', err);
  }
}

// Initialize category filtering on page load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for auth to be ready
    setTimeout(() => {
      applyPersonalizedCategories();
    }, 1000);
  });
}
