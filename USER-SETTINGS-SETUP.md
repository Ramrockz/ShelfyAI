# User Settings Database Setup

## Overview
The application now stores user settings (avatar, theme, notification preferences) in a Supabase database table instead of localStorage. This provides better data persistence, cross-device synchronization, and proper backup/restoration.

## Setup Instructions

### 1. Create the User Settings Table

Run the SQL script `create-user-settings-table.sql` in your Supabase SQL Editor:

```bash
# You can find the script at: create-user-settings-table.sql
```

This will:
- Create the `user_settings` table
- Set up Row Level Security (RLS) policies
- Create automatic timestamp updates

### 2. Table Schema

```sql
user_settings (
  user_id UUID PRIMARY KEY,           -- References auth.users(id)
  avatar_url TEXT,                    -- Base64 encoded image or URL
  theme TEXT DEFAULT 'light',         -- 'light' or 'dark'
  notifications_enabled BOOLEAN,      -- Master notification toggle
  low_stock_notifications BOOLEAN,    -- Low stock alerts
  out_of_stock_notifications BOOLEAN, -- Out of stock alerts
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### 3. Security Policies

The table has RLS enabled with policies that ensure:
- Users can only view their own settings
- Users can only insert their own settings
- Users can only update their own settings
- Users can only delete their own settings

### 4. How It Works

#### First Time User
When a user first accesses the settings page, the system automatically creates a default settings record with:
- Theme: light
- Notifications enabled: true
- Low stock notifications: true
- Out of stock notifications: true

#### Settings Storage
- **Avatar**: Stored as base64-encoded image in `avatar_url` field
- **Theme**: Stored as 'light' or 'dark' in `theme` field
- **Notifications**: Three boolean fields for notification preferences

#### Settings Access
- Settings page: Full read/write access via `settings.html`
- User menu: Reads avatar from database in `auth.js`
- Theme toggle: Reads/writes theme from database in `theme.js`
- Notification creation: Checks settings before creating notifications in `notifications.js`

### 5. Migration from localStorage

If you have existing users with localStorage settings, they will be migrated automatically:
1. When the user visits the settings page, the system checks for database settings
2. If no settings exist, default settings are created
3. The user can manually re-upload their avatar and set preferences

**Note**: localStorage preferences are no longer used and can be safely ignored.

## Benefits of Database Storage

✅ **Cross-Device Sync**: Settings sync across all devices where the user is logged in
✅ **Persistence**: Settings survive browser cache clears
✅ **Backup**: Settings are included in database backups
✅ **Proper Deletion**: Settings are deleted when user deletes account or data
✅ **Performance**: Single query loads all settings instead of multiple localStorage reads

## Troubleshooting

### Settings Not Loading
1. Check that the `user_settings` table exists in Supabase
2. Verify RLS policies are enabled and configured correctly
3. Check browser console for database errors

### Avatar Not Displaying
1. Verify the `avatar_url` field contains valid base64 data
2. Check that the user_menu initialization happens after authentication
3. Look for errors in browser console during avatar load

### Theme Not Persisting
1. Ensure the `user_settings` table has the `theme` column
2. Verify the theme toggle function is saving to database
3. Check that theme loading happens after user authentication
