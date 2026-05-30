// ═══════════════════════════════════════════════════════════════
// Category Filter Mapping System
// ═══════════════════════════════════════════════════════════════

// Map onboarding categories to system categories
const CATEGORY_MAPPING = {
  'Handmade Crafts & Art': ['Wood', 'Paper', 'Colors', 'Tools'],
  'Jewelry & Accessories': ['Jewelry', 'Boxes', 'Packaging'],
  'Home Decor': ['Wood', 'Plants', 'Boxes', 'Cards'],
  'Apparel & Fashion': ['Apparel', 'Spool', 'Rope'],
  'Beauty & Skincare': ['Boxes', 'Packaging', 'Giveaway'],
  'Food & Beverage': ['Food', 'Candy', 'Beverage', 'Packaging'],
  'Stationery & Paper Goods': ['Paper', 'Letter', 'Cards', 'Office Supplies'],
  'Toys & Games': ['Toys', 'Gaming', 'Giveaway'],
  'Party Supplies & Gifts': ['Party Supplies', 'Giveaway', 'Cards'],
  'Electronics & Gadgets': ['Electronics', 'Tools', 'Printing Supplies'],
  'Tools & Supplies': ['Tools', 'Packaging', 'Boxes'],
  'Whatever': ['Apparel', 'Wood', 'Boxes', 'Cards', 'Plants', 'Candy', 'Beverage', 'Jewelry', 
               'Party Supplies', 'Gaming', 'Toys', 'Office Supplies', 'Colors', 'Rope', 'Paper', 
               'Spool', 'Letter', 'Giveaway', 'Electronics', 'Printing Supplies', 'Tools', 'Packaging', 'Food']
};

// All system categories
const ALL_SYSTEM_CATEGORIES = [
  'Apparel', 'Wood', 'Boxes', 'Cards', 'Plants', 'Candy', 'Beverage', 'Jewelry',
  'Party Supplies', 'Gaming', 'Toys', 'Office Supplies', 'Colors', 'Rope', 'Paper',
  'Spool', 'Letter', 'Giveaway', 'Electronics', 'Printing Supplies', 'Tools', 'Packaging', 'Food'
];

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
