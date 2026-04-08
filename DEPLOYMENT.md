# ShelfyAI Deployment Guide

## 🚀 Deploying to Vercel (Recommended)

Vercel is perfect for static HTML sites - free, fast, and automatic HTTPS.

### Option 1: Deploy via Vercel CLI (Fastest)

#### Step 1: Install Vercel CLI
```powershell
npm install -g vercel
```

#### Step 2: Deploy from your project folder
```powershell
cd C:\Users\Admin\Desktop\ShelfyAi
vercel
```

#### Step 3: Follow the prompts
- Login to Vercel (it will open browser)
- Confirm project settings
- Deploy!

You'll get a URL like: `https://shelfyai.vercel.app`

---

### Option 2: Deploy via Vercel Dashboard (No CLI needed)

#### Step 1: Push to GitHub (if not already)

1. Go to [GitHub](https://github.com) and create a new repository
2. In PowerShell:
```powershell
cd C:\Users\Admin\Desktop\ShelfyAi
git init
git add .
git commit -m "Initial ShelfyAI commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/shelfyai.git
git push -u origin main
```

#### Step 2: Import to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up/login
2. Click "Add New Project"
3. Import your GitHub repository
4. Click "Deploy" (no configuration needed!)

Your site will be live in ~30 seconds!

---

## 🔧 Post-Deployment Setup

### 1. Update Supabase Settings

Once deployed, you MUST update your Supabase configuration:

**In Supabase Dashboard:**
1. Go to **Authentication** → **URL Configuration**
2. Add your Vercel URL to **Site URL**: `https://your-project.vercel.app`
3. Add to **Redirect URLs**: `https://your-project.vercel.app/**`

### 2. Verify Your Deployment

Test these URLs:
- ✅ Homepage: `https://your-project.vercel.app`
- ✅ Login: `https://your-project.vercel.app/login.html`
- ✅ Protected page: `https://your-project.vercel.app/ingredients.html` (should redirect to login)

---

## 🌐 Alternative Hosting Options

### Netlify (Similar to Vercel)

**Drag & Drop Deploy:**
1. Go to [netlify.com](https://netlify.com)
2. Drag your `ShelfyAi` folder onto the page
3. Done! Get instant URL

**Via CLI:**
```powershell
npm install -g netlify-cli
cd C:\Users\Admin\Desktop\ShelfyAi
netlify deploy --prod
```

### GitHub Pages (100% Free)

1. Create GitHub repo named: `your-username.github.io`
2. Push your files
3. Site live at: `https://your-username.github.io`

**Enable in repo settings:**
Settings → Pages → Source: main branch

### Cloudflare Pages

1. Go to [pages.cloudflare.com](https://pages.cloudflare.com)
2. Connect GitHub repo
3. Deploy automatically

---

## 📋 Pre-Deployment Checklist

Before deploying, make sure:

- [ ] Supabase credentials are in `auth.js`
- [ ] All files are in the same directory
- [ ] Test locally that login works
- [ ] No console errors in browser
- [ ] All links between pages work

---

## 🔐 Environment Variables (Optional - More Secure)

Instead of hardcoding Supabase credentials, use environment variables:

### Create vercel.json
```json
{
  "env": {
    "SUPABASE_URL": "https://xxxxx.supabase.co",
    "SUPABASE_ANON_KEY": "eyJhbGc..."
  }
}
```

### Or set in Vercel Dashboard:
Settings → Environment Variables → Add:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Then update `auth.js` to use them (requires build step).

---

## 🎨 Custom Domain (Optional)

### Add to Vercel:
1. Vercel Dashboard → Your Project → Settings → Domains
2. Add your domain: `shelfyai.com`
3. Update DNS records as instructed
4. Update Supabase Site URL to your custom domain

---

## 🔄 Continuous Deployment

Once connected to GitHub:
- Push to GitHub → Auto-deploys to Vercel
- Every commit = new deployment
- Instant preview URLs for branches

```powershell
# Make changes
git add .
git commit -m "Update feature"
git push
# Automatically deploys!
```

---

## 🐛 Common Deployment Issues

### 404 on refresh
**Solution:** Vercel handles this automatically for HTML files

### Login not working
- ✅ Check Supabase Site URL matches deployment URL
- ✅ Verify redirect URLs in Supabase
- ✅ Check browser console for errors

### CSS/JS not loading
- ✅ Ensure all paths are relative (not absolute)
- ✅ All files use lowercase names
- ✅ Check network tab in browser DevTools

---

## 📊 Vercel Features You Get Free

- ✅ Unlimited bandwidth
- ✅ Automatic HTTPS/SSL
- ✅ Global CDN
- ✅ Instant rollbacks
- ✅ Preview deployments
- ✅ Analytics (basic)
- ✅ Custom domains (100 per project)

---

## 🚀 Quick Deploy Commands

### Deploy to Vercel (one command):
```powershell
cd C:\Users\Admin\Desktop\ShelfyAi
npx vercel --prod
```

### Deploy to Netlify (one command):
```powershell
cd C:\Users\Admin\Desktop\ShelfyAi
npx netlify-cli deploy --prod --dir .
```

---

## 📝 What Happens When You Deploy

1. Your HTML/CSS/JS files are uploaded
2. Vercel serves them via global CDN
3. You get a unique URL
4. HTTPS is automatic
5. Every git push = new deployment

**Your app remains 100% static** - no server needed, just files!

---

## ✅ Recommended: Vercel

**Why Vercel:**
- Easiest for static sites
- Free forever for personal projects
- Automatic HTTPS
- Global CDN
- Perfect for HTML/CSS/JS
- GitHub integration

**Deployment time:** ~2 minutes from setup to live site!

---

Need help? The Vercel/Netlify dashboards are very intuitive and have great documentation!
