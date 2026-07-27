# ShelfyAI Storage Setup Guide

## 📦 Setting Up Supabase Storage for Receipt Uploads

This guide will help you enable file storage for receipt uploads in your ShelfyAI application.

---

## 🚀 Quick Setup Steps

### 1. Create Storage Bucket in Supabase

1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Select your project
3. Go to **Storage** in the left sidebar
4. Click **New Bucket**
5. Configure the bucket:
   - **Name**: `expenses`
   - **Public bucket**: ✅ Enable (so receipts can be viewed)
   - Click **Create bucket**

### 2. Set Up Storage Policies

You have two options to set up security policies:

#### Option A: Using SQL Editor (Recommended)

1. In Supabase Dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy and paste the SQL from `create-expenses-storage.sql`:

```sql
-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('expenses', 'expenses', true)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies for the expenses bucket
CREATE POLICY "Users can upload their own expense receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'expenses' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can view their own expense receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'expenses' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own expense receipts"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'expenses' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

4. Click **Run** to execute the SQL

#### Option B: Using the UI

1. Go to **Storage** → **Policies**
2. Click **New Policy** for the `expenses` bucket
3. Create three policies with these settings:

**Policy 1: Upload receipts**
- Name: "Users can upload their own expense receipts"
- Allowed operation: INSERT
- Target roles: authenticated
- USING expression:
```sql
bucket_id = 'expenses' AND (storage.foldername(name))[1] = auth.uid()::text
```

**Policy 2: View receipts**
- Name: "Users can view their own expense receipts"  
- Allowed operation: SELECT
- Target roles: authenticated
- USING expression:
```sql
bucket_id = 'expenses' AND (storage.foldername(name))[1] = auth.uid()::text
```

**Policy 3: Delete receipts**
- Name: "Users can delete their own expense receipts"
- Allowed operation: DELETE
- Target roles: authenticated
- USING expression:
```sql
bucket_id = 'expenses' AND (storage.foldername(name))[1] = auth.uid()::text
```

### 3. Enable Receipt Upload in Your Code

Currently, receipt upload is disabled in both `expense-detail.html` and `order-detail.html`. To enable it, you would need to implement the upload functionality.

The basic structure should include:
1. File input field
2. Upload handler that uses Supabase Storage API
3. Display uploaded receipt
4. Delete functionality

Example upload code structure:
```javascript
async function handleReceiptFile(file) {
  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Create unique filename
    const timestamp = Date.now();
    const fileName = `${user.id}/${timestamp}_${file.name}`;

    // Upload to Supabase Storage
    const { data, error } = await window.supabaseClient.storage
      .from('expenses')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = window.supabaseClient.storage
      .from('expenses')
      .getPublicUrl(fileName);

    // Update expense record with receipt URL
    await window.supabaseClient
      .from('expenses')
      .update({ receipt_url: publicUrl })
      .eq('id', expenseId)
      .eq('profile_id', user.id);

    showNotification('Receipt uploaded successfully', 'success');
    return publicUrl;
  } catch (error) {
    console.error('Error uploading receipt:', error);
    showNotification('Failed to upload receipt', 'error');
  }
}
```

---

## 🔒 Security Features

### What These Policies Do:

1. **Folder-based isolation**: Each user's files are stored in their own folder (using their user ID)
2. **Upload security**: Users can only upload files to their own folder
3. **View security**: Users can only view their own receipts
4. **Delete security**: Users can only delete their own receipts
5. **Public bucket**: Receipts can be viewed via public URLs (but only if you know the full path)

### File Structure:
```
expenses/
  ├── user-uuid-1/
  │   ├── 1234567890_receipt.pdf
  │   └── 1234567891_invoice.jpg
  ├── user-uuid-2/
  │   └── 1234567892_receipt.png
  ...
```

---

## 🧪 Testing Your Setup

### 1. Verify Bucket Creation
1. Go to **Storage** in Supabase Dashboard
2. You should see the `expenses` bucket listed
3. Click on it - it should be empty initially

### 2. Test File Upload
Once you implement the upload functionality:
1. Log in to your app
2. Go to an expense detail page
3. Try uploading a receipt image
4. Check Supabase Storage to verify the file appears in your user folder

### 3. Test Policies
Try these scenarios:
- ✅ Upload a file (should work)
- ✅ View your own file (should work)  
- ✅ Delete your own file (should work)
- ❌ Try to access another user's folder (should fail)

---

## 📊 Storage Limits

### Supabase Free Tier:
- **Storage**: 1 GB
- **Bandwidth**: 2 GB/month
- **File size limit**: 50 MB per file

### Recommended File Types for Receipts:
- Images: `.jpg`, `.jpeg`, `.png`, `.webp`
- Documents: `.pdf`
- Maximum recommended size: 10 MB per receipt

---

## 🎯 Next Steps

After setting up storage:

1. **Implement Upload UI**: Add file input and upload button to expense detail pages
2. **Display Receipts**: Show uploaded receipt images/PDFs inline
3. **Add Delete Functionality**: Allow users to remove receipts
4. **Error Handling**: Handle upload failures gracefully
5. **File Validation**: Validate file types and sizes before upload
6. **Loading States**: Show upload progress

---

## ❓ Troubleshooting

### "Bucket not found" error
- Verify the bucket name is exactly `expenses`
- Check that the bucket was created successfully
- Make sure you're using the correct Supabase project

### "Policy violation" error  
- Check that policies are properly created
- Verify user is authenticated before uploading
- Ensure file path follows the `user-id/filename` pattern

### Upload fails silently
- Check browser console for errors
- Verify Supabase credentials in `auth.js`
- Check file size isn't exceeding limits
- Ensure user has storage quota available

### Can't view uploaded file
- Verify bucket is set to public
- Check the public URL is correctly generated
- Ensure the file was actually uploaded successfully

---

## 🔗 Useful Resources

- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [Storage JavaScript API Reference](https://supabase.com/docs/reference/javascript/storage-from-upload)
- [Storage Policies Guide](https://supabase.com/docs/guides/storage/security/access-control)
- [Best Practices](https://supabase.com/docs/guides/storage/best-practices)

---

## 📝 Notes

- The code for receipt upload is already prepared in your files but currently disabled
- Once storage is set up, you'll need to remove the disabled checks and implement the full upload flow
- Consider adding image compression before upload to save storage space
- Implement cleanup logic to delete receipts when expenses are deleted
