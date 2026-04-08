// === Notification System ===
// Shared notification functionality across all pages

let notificationsCache = [];
let notificationCheckInterval = null;

// Initialize notifications on page load
async function initializeNotifications() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    const bellElement = document.getElementById('notificationBell');
    if (bellElement) {
      bellElement.style.display = 'flex';
    }
    await loadNotifications();
    
    // Check for new notifications every 30 seconds
    notificationCheckInterval = setInterval(loadNotifications, 30000);
  }
}

// Load notifications from database
async function loadNotifications() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    
    const { data: notifications, error } = await supabaseClient
      .from('notifications')
      .select('*')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) throw error;
    
    notificationsCache = notifications || [];
    renderNotifications();
    updateNotificationBadge();
  } catch (error) {
    console.error('Error loading notifications:', error);
  }
}

// Render notifications in dropdown
function renderNotifications() {
  const listContainer = document.getElementById('notificationList');
  if (!listContainer) return;
  
  if (notificationsCache.length === 0) {
    listContainer.innerHTML = `
      <div class="notification-empty">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
        </svg>
        <p>No notifications</p>
      </div>
    `;
    return;
  }
  
  listContainer.innerHTML = notificationsCache.map(notification => `
    <div class="notification-item ${!notification.is_read ? 'unread' : ''}" 
         data-notification-id="${notification.id}"
         onmouseenter="markAsRead('${notification.id}')">
      <div class="notification-message">${notification.message}</div>
      <div class="notification-time">${formatNotificationTime(notification.created_at)}</div>
      <div class="notification-actions">
        ${notification.ingredient_id ? `
          <button onclick="openIngredient('${notification.ingredient_id}'); event.stopPropagation();">
            Open Ingredient
          </button>
          <button onclick="restockIngredient('${notification.ingredient_id}', '${notification.id}'); event.stopPropagation();">
            Restock
          </button>
        ` : ''}
        <button class="delete-btn" onclick="deleteNotification('${notification.id}'); event.stopPropagation();">
          Delete
        </button>
      </div>
    </div>
  `).join('');
}

// Update notification badge count
function updateNotificationBadge() {
  const unreadCount = notificationsCache.filter(n => !n.is_read).length;
  const badge = document.getElementById('notificationBadge');
  
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
}

// Format notification time (e.g., "2 minutes ago", "1 hour ago")
function formatNotificationTime(timestamp) {
  const now = new Date();
  const time = new Date(timestamp);
  const diff = Math.floor((now - time) / 1000); // seconds
  
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  return time.toLocaleDateString();
}

// Toggle notification dropdown
function toggleNotifications() {
  const dropdown = document.getElementById('notificationDropdown');
  if (dropdown) {
    dropdown.classList.toggle('active');
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const bell = document.getElementById('notificationBell');
  const dropdown = document.getElementById('notificationDropdown');
  
  if (bell && dropdown && !bell.contains(e.target)) {
    dropdown.classList.remove('active');
  }
});

// Mark notification as read on hover
async function markAsRead(notificationId) {
  const notification = notificationsCache.find(n => n.id === notificationId);
  if (!notification || notification.is_read) return;
  
  try {
    const { error } = await supabaseClient
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId);
    
    if (error) throw error;
    
    // Update cache
    notification.is_read = true;
    updateNotificationBadge();
    
    // Update UI without re-rendering entire list
    const item = document.querySelector(`[data-notification-id="${notificationId}"]`);
    if (item) {
      item.classList.remove('unread');
    }
  } catch (error) {
    console.error('Error marking notification as read:', error);
  }
}

// Mark all notifications as read
async function markAllAsRead() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    
    const unreadIds = notificationsCache.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    
    const { error } = await supabaseClient
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in('id', unreadIds);
    
    if (error) throw error;
    
    // Update cache
    notificationsCache.forEach(n => {
      if (!n.is_read) n.is_read = true;
    });
    
    renderNotifications();
    updateNotificationBadge();
    
    if (typeof showNotification === 'function') {
      showNotification('All notifications marked as read', 'success');
    }
  } catch (error) {
    console.error('Error marking all as read:', error);
  }
}

// Delete notification
async function deleteNotification(notificationId) {
  try {
    const { error } = await supabaseClient
      .from('notifications')
      .delete()
      .eq('id', notificationId);
    
    if (error) throw error;
    
    // Remove from cache
    notificationsCache = notificationsCache.filter(n => n.id !== notificationId);
    
    renderNotifications();
    updateNotificationBadge();
  } catch (error) {
    console.error('Error deleting notification:', error);
  }
}

// Open ingredient page
function openIngredient(ingredientId) {
  window.location.href = `ingredient-detail.html?id=${ingredientId}`;
}

// Restock ingredient
async function restockIngredient(ingredientId, notificationId) {
  try {
    // Get ingredient details
    const { data: ingredient, error: fetchError } = await supabaseClient
      .from('ingredients')
      .select('*')
      .eq('id', ingredientId)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Simple restock - add 100 units (you can make this more sophisticated)
    const currentQty = parseFloat(ingredient.quantity) || 0;
    const newQty = currentQty + 100;
    
    const { error: updateError } = await supabaseClient
      .from('ingredients')
      .update({ quantity: newQty })
      .eq('id', ingredientId);
    
    if (updateError) throw updateError;
    
    // Create history entry for restock
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) {
        await supabaseClient
          .from('ingredient_history')
          .insert([{
            ingredient_id: ingredientId,
            profile_id: user.id,
            field_name: 'quantity',
            old_value: String(currentQty),
            new_value: String(newQty),
            reason: 'restock',
            reference_id: null,
            reference_text: 'Quick restock (+100 units)'
          }]);
      }
    } catch (historyError) {
      console.error('Error creating history entry:', historyError);
    }
    
    if (typeof showNotification === 'function') {
      showNotification(`${ingredient.name} restocked to ${newQty} ${ingredient.unit}`, 'success');
    }
    
    // Delete the notification
    await deleteNotification(notificationId);
    
    // Reload page data if functions exist
    if (typeof loadRecentUpdates === 'function') {
      await loadRecentUpdates();
    }
    if (typeof loadIngredients === 'function') {
      await loadIngredients();
    }
  } catch (error) {
    console.error('Error restocking ingredient:', error);
    if (typeof showNotification === 'function') {
      showNotification('Failed to restock ingredient', 'error');
    }
  }
}

// Create notification for out-of-stock ingredient
async function createOutOfStockNotification(ingredientId, ingredientName, userId) {
  try {
    // Check user's notification settings from database
    const { data: settings } = await supabaseClient
      .from('user_settings')
      .select('notifications_enabled, out_of_stock_notifications')
      .eq('user_id', userId)
      .single();
    
    // Don't create notification if disabled
    if (!settings || !settings.notifications_enabled || !settings.out_of_stock_notifications) {
      return;
    }

    // Check if notification already exists
    const { data: existing, error: checkError } = await supabaseClient
      .from('notifications')
      .select('id')
      .eq('profile_id', userId)
      .eq('ingredient_id', ingredientId)
      .eq('type', 'ingredient_out_of_stock')
      .eq('is_read', false);
    
    if (checkError) throw checkError;
    
    // Don't create duplicate notifications
    if (existing && existing.length > 0) return;
    
    const { error: insertError } = await supabaseClient
      .from('notifications')
      .insert([{
        profile_id: userId,
        type: 'ingredient_out_of_stock',
        ingredient_id: ingredientId,
        message: `Ingredient ${ingredientName} has run out of stock`,
        is_read: false
      }]);
    
    if (insertError) throw insertError;
    
    // Reload notifications
    await loadNotifications();
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// Check ingredient stock and create notifications if needed
async function checkIngredientStock(ingredientId, quantity, ingredientName, userId) {
  if (quantity <= 0) {
    await createOutOfStockNotification(ingredientId, ingredientName, userId);
  }
}

// Create notification for AI limit reached
async function createAILimitNotification(userId, tier) {
  try {
    console.log('Creating AI limit notification for user:', userId, 'tier:', tier);
    
    // Check user's notification settings from database
    const { data: settings, error: settingsError } = await supabaseClient
      .from('user_settings')
      .select('notifications_enabled, ai_limit_notifications')
      .eq('user_id', userId)
      .single();
    
    console.log('User settings:', settings, 'Error:', settingsError);
    
    // If ai_limit_notifications column doesn't exist, default to notifications_enabled
    const aiLimitEnabled = settings?.ai_limit_notifications !== undefined 
      ? settings.ai_limit_notifications 
      : settings?.notifications_enabled;
    
    // Don't create notification if disabled
    if (!settings || !settings.notifications_enabled || !aiLimitEnabled) {
      console.log('Notifications disabled for AI limits. notifications_enabled:', settings?.notifications_enabled, 'ai_limit_notifications:', aiLimitEnabled);
      return;
    }

    // Get today's date at midnight (start of day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    console.log('Checking for existing notifications since:', todayISO);

    // Check if notification already exists for today
    const { data: existing, error: checkError } = await supabaseClient
      .from('notifications')
      .select('id, created_at')
      .eq('profile_id', userId)
      .eq('type', 'ai_limit_reached')
      .eq('is_read', false)
      .gte('created_at', todayISO);
    
    if (checkError) {
      console.error('Error checking existing notifications:', checkError);
      throw checkError;
    }
    
    console.log('Existing notifications:', existing);
    
    // Don't create duplicate notifications for today
    if (existing && existing.length > 0) {
      console.log('Notification already exists for today, skipping');
      return;
    }
    
    console.log('Creating new AI limit notification');
    
    const { data: inserted, error: insertError } = await supabaseClient
      .from('notifications')
      .insert([{
        profile_id: userId,
        type: 'ai_limit_reached',
        message: `You've reached your daily AI extraction limit for ${tier} tier. Limit resets at midnight.`,
        is_read: false
      }])
      .select();
    
    if (insertError) {
      console.error('Error inserting notification:', insertError);
      throw insertError;
    }
    
    console.log('Notification created successfully:', inserted);
    
    // Reload notifications
    if (typeof loadNotifications === 'function') {
      console.log('Reloading notifications...');
      await loadNotifications();
    } else {
      console.log('loadNotifications function not available');
    }
  } catch (error) {
    console.error('Error creating AI limit notification:', error);
  }
}

// Initialize notifications when page loads
if (typeof window !== 'undefined') {
  window.addEventListener('load', initializeNotifications);
}
