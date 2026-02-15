
# Fix Plan: Handwriting Verification, Mobile Upload, and Preview Issues

## Root Cause Analysis

After tracing through every code path and examining the actual database data, here are the **3 real root causes**:

### Root Cause 1: AI Verification Uses CDN-Cached Old Handwriting Image
The `verify-handwriting` edge function fetches the reference handwriting image from a **public URL** (`handwriting-samples` bucket is public). When a student re-uploads and retrains, the file at the same storage path (`userId/handwriting.jpg`) is replaced. However, the public URL is served through a CDN that **caches the old image**.

- The `extract-handwriting-features` function adds `?t=timestamp` to bust cache -- so it trains on the NEW image correctly.
- But `verify-handwriting` fetches `studentDetails.handwriting_url` which is the **raw public URL without any cache buster** -- so it compares assignments against the **OLD cached image**.

This is why retraining appears to do nothing: the profile JSON is updated with new features, but verification still fetches the old image from CDN cache.

**Fix:** In `verify-handwriting/index.ts`, add a cache-busting timestamp to the reference image URL before fetching, using the `handwriting_features_extracted_at` timestamp from the database. This ensures it always fetches the version that matches the trained profile.

### Root Cause 2: Mobile Upload "Failed to Fetch"
The `SubmitAssignment.tsx` upload uses `img.file.type` for the `contentType` header. On some Android mobile browsers, when images are selected from the gallery, `file.type` can be empty or unreliable (e.g., `""` or an unusual MIME type). Additionally, some mobile browsers may have issues uploading raw `File` objects to Supabase storage.

**Fix:** 
- Convert the selected File to a Blob via canvas (similar to what `StudentHandwriting.tsx` already does with `stripExifData`) to normalize the image format.
- Use a robust content type detection fallback based on file extension, not just `file.type`.
- Add explicit error handling that distinguishes network errors from permission errors for clearer user feedback on mobile.

### Root Cause 3: Preview Not Working on Mobile
The `FilePreviewDialog` calls the `resolve-submission-files` edge function to get signed URLs. On mobile, if the auth token isn't properly included or the request times out, the dialog shows no files. The underlying signed URL generation is correct, but the mobile browser may need longer timeouts or the dialog needs better error recovery.

**Fix:** Add retry logic in the `FilePreviewDialog` when URL resolution fails, and ensure proper loading states on mobile.

---

## Implementation Plan

### Step 1: Fix `verify-handwriting` Edge Function (Cache Busting)

**File:** `supabase/functions/verify-handwriting/index.ts`

- Read `handwriting_features_extracted_at` alongside existing fields from `student_details`
- When fetching the reference image, append `?t={extracted_at_timestamp}` to the URL to bypass CDN cache
- This ensures the fetched reference image matches the trained profile

### Step 2: Fix Mobile Upload in `SubmitAssignment.tsx`

**File:** `src/pages/student/SubmitAssignment.tsx`

- Add a `normalizeImageFile` helper function that converts a File to a JPEG Blob via canvas (same technique used in `StudentHandwriting.tsx` with `stripExifData`)
- Before uploading each image, run it through this normalizer -- this guarantees a valid JPEG blob with correct content type on both desktop and mobile
- Use the normalized blob for the storage upload with explicit `contentType: 'image/jpeg'`
- Add a file-extension-based content type fallback for cases where the normalizer isn't needed

### Step 3: Ensure Preview Works on Mobile

**File:** `src/components/faculty/FilePreviewDialog.tsx`

- Add retry logic (1 retry) when `resolve-submission-files` fails
- Increase error visibility with specific mobile-friendly error messages
- Ensure the dialog properly resets state when switching between submissions

### Summary of Files Changed

| File | Change |
|------|--------|
| `supabase/functions/verify-handwriting/index.ts` | Add cache-busting to reference image fetch |
| `src/pages/student/SubmitAssignment.tsx` | Normalize images via canvas before upload for mobile compatibility |
| `src/components/faculty/FilePreviewDialog.tsx` | Add retry logic for signed URL resolution |

### What is NOT Changed
- AI verification algorithms and thresholds (untouched)
- Similarity scoring logic (untouched)
- Data isolation code (already correct -- verified in database queries)
- Backend decision rules (untouched)
- `extract-handwriting-features` function (already works correctly)
- `resolve-submission-files` function (already works correctly)
