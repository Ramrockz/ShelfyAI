# Storage Limits for Pricing Tiers

## 📊 Recommended Storage Limits

Based on typical receipt image sizes (50KB - 2MB per image), here are recommended storage limits:

| Tier | AI Scans/Month | Storage Limit | Approx. Receipts | Price Point |
|------|----------------|---------------|------------------|-------------|
| **Free** | 20 scans | **100 MB** | ~50-2,000 receipts | Free |
| **Starter** | 100 scans | **1 GB** | ~500-20,000 receipts | $9-19/mo |
| **Pro** | 300 scans | **10 GB** | ~5,000-200,000 receipts | $29-49/mo |

### Storage Limit Rationale:

**Free Tier (100 MB)**
- Enough for small businesses testing the platform
- ~200 receipt images at 500KB average
- Limits abuse while allowing meaningful trial
- Industry standard for freemium storage

**Starter Tier (1 GB)**
- Suitable for small businesses with 100-500 expenses/year
- ~2,000 receipts at 500KB average
- Room for larger files (scanned PDFs)
- Aligns with Starter-level businesses

**Pro Tier (10 GB)**
- Enterprise-ready storage
- ~20,000 receipts at 500KB average
- Accommodates high-resolution scans and PDFs
- Future-proof for multi-year retention

---

## 🔧 Implementation Details

### Database Changes

Run the SQL migration in `add-storage-limits.sql` to:
1. ✅ Add `storage_used_bytes` column (tracks current usage)
2. ✅ Add `storage_limit_bytes` column (tier-based limit)
3. ✅ Create trigger to auto-update usage on upload/delete
4. ✅ Create helper function to check if user has space
5. ✅ Create view for easy storage stats

### Storage Structure

```
expenses/
  ├── user-uuid-1/
  │   ├── timestamp_receipt1.jpg    (500 KB)
  │   ├── timestamp_receipt2.pdf    (2 MB)
  │   └── timestamp_receipt3.png    (800 KB)
  └── user-uuid-2/
      └── timestamp_receipt.jpg     (450 KB)
```

Each user's storage is:
- **Isolated** by user ID folder
- **Automatically tracked** by database trigger
- **Enforced** before upload via check function

---

## 💻 Frontend Implementation

### 1. Show Storage Usage in Settings

Add to `settings.html` near the AI Scans display:

```html
<!-- Storage Usage Section -->
<div class="setting-group">
  <h4 style="text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 12px;">Storage Used</h4>
  <div style="font-size: 24px; font-weight: 700; margin-bottom: 4px;">
    <span id="storageUsedDisplay">0 MB</span> / <span id="storageLimitDisplay">100 MB</span>
  </div>
  <div style="width: 100%; height: 8px; background: var(--bg-inner); border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
    <div id="storageProgressBar" style="height: 100%; background: linear-gradient(90deg, var(--accent), #0891b2); width: 0%; transition: width 0.3s;"></div>
  </div>
  <p style="font-size: 12px; color: var(--text-muted); margin: 0;">
    <span id="storagePercentDisplay">0%</span> used
  </p>
</div>
```

### 2. Check Storage Before Upload

Add to expense-detail.html and order-detail.html:

```javascript
async function checkStorageLimit(fileSize) {
  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) return false;

    // Get user's storage stats
    const { data: settings } = await window.supabaseClient
      .from('user_settings')
      .select('storage_used_bytes, storage_limit_bytes, user_tier')
      .eq('user_id', user.id)
      .single();

    if (!settings) return false;

    const availableSpace = settings.storage_limit_bytes - settings.storage_used_bytes;
    
    if (fileSize > availableSpace) {
      const usedMB = (settings.storage_used_bytes / 1048576).toFixed(1);
      const limitMB = (settings.storage_limit_bytes / 1048576).toFixed(1);
      
      showNotification(
        `Storage limit reached (${usedMB}/${limitMB} MB). Upgrade your plan for more storage.`,
        'error'
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking storage:', error);
    return false;
  }
}

async function handleReceiptFile(file) {
  // Check file size (10MB max per file)
  const maxFileSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxFileSize) {
    showNotification('File too large. Maximum size is 10MB.', 'error');
    return;
  }

  // Check if user has enough storage quota
  const hasSpace = await checkStorageLimit(file.size);
  if (!hasSpace) return;

  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Upload file...
    // (rest of upload logic)
  } catch (error) {
    console.error('Error uploading receipt:', error);
    showNotification('Failed to upload receipt', 'error');
  }
}
```

### 3. Load Storage Stats

Add to settings.html:

```javascript
async function loadStorageStats() {
  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) return;

    const { data: settings } = await window.supabaseClient
      .from('user_settings')
      .select('storage_used_bytes, storage_limit_bytes')
      .eq('user_id', user.id)
      .single();

    if (!settings) return;

    const usedMB = (settings.storage_used_bytes / 1048576).toFixed(1);
    const limitMB = (settings.storage_limit_bytes / 1048576).toFixed(0);
    const percentUsed = ((settings.storage_used_bytes / settings.storage_limit_bytes) * 100).toFixed(1);

    document.getElementById('storageUsedDisplay').textContent = `${usedMB} MB`;
    document.getElementById('storageLimitDisplay').textContent = `${limitMB} MB`;
    document.getElementById('storagePercentDisplay').textContent = `${percentUsed}%`;
    document.getElementById('storageProgressBar').style.width = `${percentUsed}%`;

    // Change progress bar color if near limit
    const progressBar = document.getElementById('storageProgressBar');
    if (percentUsed >= 90) {
      progressBar.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
    } else if (percentUsed >= 75) {
      progressBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
    }
  } catch (error) {
    console.error('Error loading storage stats:', error);
  }
}
```

---

## 📈 Business Benefits

### 1. **Clear Value Proposition**
- Users can see tangible benefit of upgrading
- Storage is easy to understand and measure
- Creates urgency when approaching limits

### 2. **Revenue Driver**
- Natural upsell path: "Upgrade for more storage"
- Prevents free tier abuse
- Justifies price increases

### 3. **Cost Management**
- Prevents unlimited storage costs on free tier
- Supabase charges for storage overages
- Predictable infrastructure costs

### 4. **Industry Standard**
```
Dropbox: 2 GB free → 2 TB paid
Google Drive: 15 GB free → 100 GB paid
Notion: 5 MB limit → Unlimited paid
```

---

## 🎯 Upgrade Prompts

### When User Approaches Limit (75%)

```javascript
if (percentUsed >= 75 && percentUsed < 90) {
  showNotification(
    'You\'re running low on storage. Upgrade to get more space!',
    'warning',
    { action: 'Upgrade', link: '/pricing' }
  );
}
```

### When User Hits Limit (100%)

```javascript
if (percentUsed >= 100) {
  showNotification(
    'Storage limit reached! Upgrade your plan to upload more receipts.',
    'error',
    { action: 'Upgrade Now', link: '/pricing' }
  );
}
```

### On Upload Failure

```html
<div class="upgrade-modal">
  <h3>Storage Limit Reached</h3>
  <p>You've used all ${limitMB} MB of your ${tier} plan storage.</p>
  <p><strong>Upgrade to get more space:</strong></p>
  <ul>
    <li>Starter: 1 GB storage ($19/mo)</li>
    <li>Pro: 10 GB storage ($49/mo)</li>
  </ul>
  <button onclick="window.location.href='/pricing'">View Plans</button>
</div>
```

---

## 🔄 Migration Path

### For Existing Users

When you run the migration:
1. All users get `storage_used_bytes = 0` initially
2. Trigger tracks new uploads going forward
3. Optionally run a one-time calculation:

```sql
-- Calculate current storage usage from existing files (optional)
UPDATE user_settings us
SET storage_used_bytes = COALESCE(
  (SELECT SUM((metadata->>'size')::BIGINT)
   FROM storage.objects
   WHERE bucket_id = 'expenses'
   AND (storage.foldername(name))[1]::UUID = us.user_id),
  0
);
```

### Update Stripe Webhooks

In `api/stripe-webhook.js`, update tier changes to also update storage limits:

```javascript
// When tier changes
await supabaseAdmin
  .from('user_settings')
  .update({
    user_tier: newTier,
    storage_limit_bytes: {
      'free': 104857600,      // 100 MB
      'starter': 1073741824,  // 1 GB
      'pro': 10737418240      // 10 GB
    }[newTier]
  })
  .eq('user_id', userId);
```

---

## 📊 Analytics to Track

Monitor these metrics:
1. **Storage usage by tier** - Are users filling up their quota?
2. **Upload failure rate** - How many hit storage limits?
3. **Upgrades due to storage** - Track conversion from storage prompts
4. **Average storage per user** - Adjust limits if needed

---

## ⚠️ Important Considerations

### File Size Validation
- **Individual file limit**: 10 MB per file (prevents massive uploads)
- **Total storage**: Tier-based (100MB / 1GB / 10GB)
- **Allowed types**: jpg, jpeg, png, pdf, webp

### User Experience
- Show storage bar **prominently** in settings
- **Pre-flight check** before upload (don't let them try and fail)
- **Clear error messages** when limit reached
- **Easy upgrade path** from limit warnings

### Technical Notes
- Storage tracking happens **automatically via trigger**
- Calculations are in **bytes** for precision
- Display uses **MB/GB** for readability
- Cleanup: Delete files when expenses are deleted

---

## 🚀 Next Steps

1. ✅ Run `add-storage-limits.sql` in Supabase
2. ✅ Add storage display to settings page
3. ✅ Implement pre-upload storage checks
4. ✅ Add limit warnings and upgrade prompts
5. ✅ Update pricing page with storage info
6. ✅ Update Stripe webhook for tier changes
7. ✅ Test full flow: upload → limit → upgrade

This gives you a complete storage-based pricing differentiator that aligns with industry standards and provides clear upgrade incentives! 🎉
