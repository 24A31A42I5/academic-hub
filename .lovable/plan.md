# FINAL FIX PROMPT —

## Absolute Constraints

Do not modify AI verification algorithms, similarity scoring, or threshold values. Do not change the verify-handwriting comparison logic — only fix the data fetching around it. Do not remove any existing features or UI elements. Do not change timeout durations. Do not add capture="environment" to any file input because it breaks gallery access on iOS. Apply every fix exactly as written without interpreting or simplifying. Apply fixes in the exact numbered order because each one depends on the previous being correct.

---

## Fix 1 — RLS Policy

**No file path — run directly in Supabase SQL Editor.**

Drop every possible variant of the student submissions UPDATE policy by name, then recreate it from scratch. The correct policy must allow students to update only their own submissions where marks IS NULL, using a subquery to match auth.uid() to the profiles table to get the profile id. Use both USING and WITH CHECK clauses with identical conditions. Do not assume any previous version of this policy exists correctly — always drop and recreate unconditionally.

---

## Fix 2 — New Edge Function: resolve-submission-files

**File to create:** `supabase/functions/resolve-submission-files/index.ts`

**File to edit:** `supabase/config.toml`

Create the new edge function file at supabase/functions/resolve-submission-files/index.ts. This function must extract the Bearer token from the Authorization header, then verify the user by calling supabaseAdmin.auth.getUser(token) using only the admin client. Do not create a second Supabase client using ANON_KEY for auth verification — this was the original 401 bug. After verifying the user, look up their profile to get their role and profile id. Fetch the submission by the submission_id from the request body. Fetch the assignment to get the faculty_profile_id. Authorize the request by checking if the caller is the student who owns the submission, a faculty member assigned to that assignment, or an admin. Reject with 403 if none match. Collect all paths from the file_urls array first, falling back to file_url if file_urls is empty. Normalize each path before signing it — if the path is a full URL extract everything after /uploads/ and strip any existing query parameters to get a bare storage path, and if the path does not start with http use it as-is. Generate a signed URL for each normalized path using [supabaseAdmin.storage](http://supabaseAdmin.storage).from uploads with a 3600 second expiry. Return the array of signed URLs.

In supabase/config.toml add a top-level block for this function with verify_jwt = false. This block must not be nested inside any other function's config block.

---

## Fix 3 — CDN Cache Busting in verify-handwriting

**File to edit:** `supabase/functions/verify-handwriting/index.ts`

Make exactly two changes and nothing else. First, add handwriting_features_extracted_at to the fields selected from the student_details table. Second, when building the reference image URL to fetch, strip any existing query parameters from handwriting_url by splitting on the question mark and taking the first part, then append a query parameter t equal to the Unix timestamp of handwriting_features_extracted_at. If handwriting_features_extracted_at is null fall back to [Date.now](http://Date.now)(). Use this cache-busted URL everywhere the reference handwriting image is fetched in this function. Do not change any comparison logic, scoring, or threshold — only the URL construction.

---

## Fix 4 — Mobile Gallery Upload

**File to edit:** `src/pages/student/SubmitAssignment.tsx`

Make four changes to this file.

First, rewrite the validateImageFile function to check both file.type and the file extension extracted from [file.name](http://file.name). Convert the extension to lowercase. Accept the file if either the MIME type is in the accepted list or the extension is one of jpg, jpeg, png, or webp. This handles Android gallery picks where file.type is an empty string.

Second, rewrite the normalizeImageFile function to resize images to a maximum dimension of 1920 pixels on the longest side before creating a canvas. Calculate the new width and height proportionally. Draw the image onto the resized canvas. After calling canvas.toBlob immediately set canvas.width = 0 and canvas.height = 0 to release the backing store memory before resolving the promise. Use JPEG format at 0.85 quality. Create the object URL before setting imgEl.src, store it in a variable, and call URL.revokeObjectURL on that variable in both the onload handler after drawing is complete and in the onerror handler before rejecting.

Third, update the file input element accept attribute to include both MIME types and extensions: image/jpeg, image/png, image/webp, .jpg, .jpeg, .png, .webp. Do not add capture="environment".

Fourth, in the upload loop pass the normalized blob to Supabase storage with explicit contentType of image/jpeg and cacheControl of no-cache.

---

## Fix 5 — Preview Spinner

**File to edit:** `src/components/faculty/FilePreviewDialog.tsx`

**Files to edit for caller updates:** `src/pages/faculty/FacultySubmissions.tsx` and `src/pages/student/StudentSubmissions.tsx`

Rewrite the resolveSignedUrls function in src/components/faculty/FilePreviewDialog.tsx. The function must call the resolve-submission-files edge function with the submission id. Implement retry logic using async recursion inside the try block — do not use setTimeout with early return because that bypasses the finally block. Allow up to 2 total attempts with a 1500 millisecond delay between them using await with a Promise that resolves after a setTimeout. Put setResolvingUrls(false) exclusively inside the finally block with no conditions around it whatsoever — this is the fix for the spinner never disappearing. On all failures after retries are exhausted, fall back to the original fileUrls array or the single fileUrl. Add submissionId as a required prop to FilePreviewDialogProps. In src/pages/faculty/FacultySubmissions.tsx update every usage of FilePreviewDialog to pass the submission id as the submissionId prop. In src/pages/student/StudentSubmissions.tsx update every usage of FilePreviewDialog to pass the submission id as the submissionId prop.

---

## Fix 6 — Manual Re-Verify All Pages

**File to edit:** `src/pages/student/StudentSubmissions.tsx`

Find the handleManualVerify function. Change the verify-handwriting invocation to send file_urls as an array instead of the single file_url string. Build the array by using submission.file_urls if it has length, otherwise wrap submission.file_url in a single-element array. Also pass page_count equal to the length of that array.

---

## Fix 7 — Cross-User Cache Isolation

**File to edit:** `src/App.tsx`

**File to edit:** `src/contexts/AuthContext.tsx`

In src/App.tsx create a new component called UserCacheClearer. Inside it use useAuth to get the current user and useQueryClient to get the query client. Use a ref to store the previous user id. In a useEffect that watches user id, when the user id changes from a non-null previous value to any new value including null, call queryClient.clear() to wipe all cached query data. Render this component inside the QueryClientProvider and AuthProvider wrappers so it has access to both contexts.

In src/contexts/AuthContext.tsx find the signOut function. After calling supabase.auth.signOut() and setting profile to null, call localStorage.clear() and sessionStorage.clear() inside a try-catch that silently ignores errors.

---

## Fix 8 — Ownership Verification in verify-handwriting

**File to edit:** `supabase/functions/verify-handwriting/index.ts`

Add a security block that runs before any image fetching begins. First, query the submissions table to get the student_profile_id for the given submission_id. If the returned student_profile_id does not exactly match the student_profile_id that was passed in the request body, throw an error saying the submission does not belong to the claimed student. Second, query the profiles table to get the user_id for the student_profile_id. Third, for each file URL or path in the imageUrls array, normalize it to a bare storage path by splitting on /uploads/ and taking the second part then stripping query parameters. Check that the normalized path starts with the student's user_id followed by a forward slash. If any path fails this check throw an error saying access denied. Do not change any verification logic beyond these security checks.

---

## Fix 9 — Retrain Invalidates Old Features First

**File to edit:** `src/pages/student/StudentHandwriting.tsx`

Rewrite the handleRetrainFeatures function body. The first step must be a Supabase update that sets handwriting_feature_embedding to null and handwriting_features_extracted_at to null for the student's record, filtered by both id and profile_id equal to currentProfileId. Only proceed to the next step if this update succeeds without error. The second step is to build a fresh image URL by splitting handwriting_url on the question mark, taking the first part, and appending ?t= followed by [Date.now](http://Date.now)(). The third step is to invoke extract-handwriting-features with this fresh URL and the student_details_id. The fourth step is to refetch the student_details record filtered by both id and profile_id equal to currentProfileId and update local state. Show an appropriate error toast if any step fails and stop execution at the failed step.

---

## Fix 10 — Submission Update Integrity Check

**File to edit:** `src/pages/student/SubmitAssignment.tsx`

After the update call on an existing submission, chain .select('id') to the update query so Supabase returns the affected rows. Check if the returned data array is empty or null. If it is empty throw an error with the message that the submission update was blocked which likely means it is already graded. Do not make a second database fetch for the integrity check — use only the returned data from the update call itself. This keeps the check zero-latency and avoids a race condition between the integrity check and the verification invocation.

---

## Complete File Path Reference

Every file touched by this prompt:

- `supabase/functions/resolve-submission-files/index.ts` — new file, created in Fix 2
- `supabase/functions/verify-handwriting/index.ts` — edited in Fix 3 and Fix 8
- `supabase/config.toml` — edited in Fix 2
- `src/pages/student/SubmitAssignment.tsx` — edited in Fix 4 and Fix 10
- `src/pages/student/StudentSubmissions.tsx` — edited in Fix 6 and Fix 5 caller update
- `src/pages/student/StudentHandwriting.tsx` — edited in Fix 9
- `src/components/faculty/FilePreviewDialog.tsx` — edited in Fix 5
- `src/pages/faculty/FacultySubmissions.tsx` — edited in Fix 5 caller update
- `src/App.tsx` — edited in Fix 7
- `src/contexts/AuthContext.tsx` — edited in Fix 7
- Supabase SQL Editor — Fix 1 RLS migration, no file path

---

## Final Verification Checklist

After applying all ten fixes verify the following before considering the work complete.

The RLS migration in Fix 1 must have been run and not skipped. The resolve-submission-files function in supabase/functions/resolve-submission-files/index.ts must use only the admin client for auth token verification. The verify-handwriting function in supabase/functions/verify-handwriting/index.ts must fetch the reference image with a cache-busting timestamp derived from handwriting_features_extracted_at. The normalizeImageFile function in src/pages/student/SubmitAssignment.tsx must resize to a maximum of 1920 pixels, release canvas memory by setting width and height to zero after toBlob, and revoke the object URL in both onload and onerror. The validateImageFile function in src/pages/student/SubmitAssignment.tsx must accept files with valid extensions even when file.type is empty. The setResolvingUrls(false) call in src/components/faculty/FilePreviewDialog.tsx must be unconditionally inside the finally block with no surrounding conditions. The handleManualVerify function in src/pages/student/StudentSubmissions.tsx must send the full file_urls array and page_count. The UserCacheClearer component in src/App.tsx must render inside both QueryClientProvider and AuthProvider. The handleRetrainFeatures function in src/pages/student/StudentHandwriting.tsx must null out old embeddings before invoking feature extraction. The submission update in src/pages/student/SubmitAssignment.tsx must chain .select('id') and throw a meaningful error if zero rows are returned.