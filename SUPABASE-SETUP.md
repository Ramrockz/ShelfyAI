# ShelfyAI Supabase Setup Guide

## 🚀 Quick Setup Steps

### 1. Get Your Supabase Credentials

1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Select your project (or create a new one)
3. Go to **Settings** → **API**
4. Copy these two values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (the long string under "Project API keys")

### 2. Update auth.js

Open `auth.js` and replace the placeholder values:

```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';  // ← Your Project URL
const SUPABASE_ANON_KEY = 'eyJhbGc...';  // ← Your anon public key
```

### 3. Enable Authentication in Supabase

In your Supabase Dashboard:

1. Go to **Authentication** → **Providers**
2. Enable **Email** provider (it's usually enabled by default)
3. Configure settings:
   - ✅ Enable email confirmations (recommended)
   - ✅ Enable password reset
   - Set your site URL (e.g., `http://localhost` for development)

### 4. Optional: Configure Email Templates

Go to **Authentication** → **Email Templates** to customize:
- Confirmation email
- Magic link email
- Password reset email

---

## 🔐 Authentication Features Implemented

### Login Options:
1. **Email + Password** - Traditional login
2. **Magic Link** - Passwordless login via email
3. **Sign Up** - Create new account

### Security Features:
- ✅ Session-based authentication
- ✅ Automatic redirect to login for protected pages
- ✅ Secure logout functionality
- ✅ Return URL after login

---

## 📝 How It Works

### Protected Pages (Require Login):
- ingredients.html
- recipes.html
- sales.html
- expenses.html
- operations.html
- shopping-list.html
- ingredient-detail.html
- recipe-detail.html

### Public Pages (No Login Required):
- index.html (homepage)
- pricing.html
- faq.html
- sandbox.html
- login.html

### Authentication Flow:

```
User visits protected page
    ↓
auth.js checks Supabase session
    ↓
No session? → Redirect to login.html
    ↓
User logs in with Supabase
    ↓
Redirect back to intended page
    ↓
Session maintained across pages
```

---

## 🧪 Testing Your Setup

### 1. Create a Test User

**Option A: Through Supabase Dashboard**
1. Go to **Authentication** → **Users**
2. Click "Add User"
3. Enter email and password
4. User is created instantly (no email confirmation needed)

**Option B: Through Your App**
1. Open `login.html` in your browser
2. Enter email and password
3. Click "Sign up" link
4. Check email for confirmation (if enabled)

### 2. Test Login Flow

1. Try to open `ingredients.html` directly
   - Should redirect to `login.html`
2. Login with your test credentials
   - Should redirect back to `ingredients.html`
3. Navigate between protected pages
   - Should stay logged in
4. Click "Logout"
   - Should return to homepage

---

## 🔧 Advanced Configuration

### Custom Redirect URLs

In `auth.js`, you can customize the redirect behavior:

```javascript
// After login, redirect to specific page
window.location.href = 'ingredients.html';  // ← Change this

// After logout
window.location.href = 'index.html';  // ← Or this
```

### Add OAuth Providers

In Supabase Dashboard → **Authentication** → **Providers**, enable:
- Google
- GitHub
- Facebook
- etc.

Then update `login.html` to add OAuth buttons:

```javascript
async function loginWithGoogle() {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + '/ingredients.html'
    }
  });
}
```

### Session Persistence

Sessions are automatically persisted in localStorage by Supabase. Users stay logged in even after closing the browser (until they explicitly log out or the session expires).

---

## 🐛 Troubleshooting

### "Invalid API Key" Error
- ✅ Check that you copied the **anon public** key (not the service_role key)
- ✅ Make sure there are no extra spaces in the key

### Redirect Loop
- ✅ Check that auth.js is loaded BEFORE page content
- ✅ Verify Supabase URL is correct (include `https://`)

### Email Not Sending
- ✅ Check **Authentication** → **Email Templates** settings
- ✅ Verify your email provider is configured
- ✅ For testing, disable email confirmation in settings

### Can't Login After Sign Up
- ✅ If email confirmation is enabled, check your email
- ✅ In Supabase Dashboard, go to **Authentication** → **Users** to manually confirm users

---

## 📚 Next Steps

### Database Integration
Once auth is working, you can:
1. Store user data in Supabase tables
2. Use Row Level Security (RLS) to protect data
3. Link ingredients/recipes to user accounts

### Example: Create ingredients table
```sql
-- In Supabase SQL Editor
CREATE TABLE ingredients (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users can view own ingredients"
  ON ingredients FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ingredients"
  ON ingredients FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

---

## 🆘 Need Help?

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/auth-signup)
- [Supabase Discord Community](https://discord.supabase.com/)

---

**Ready to go live?** Update the site URL in Supabase settings to your production domain!
