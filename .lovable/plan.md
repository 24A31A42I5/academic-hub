
## Plan: Convert to Image-Only Multi-Page Handwriting Verification System

This plan replaces the current PDF/DOC-based verification with an **image-only, multi-page handwritten assignment verification system** while preserving all existing dashboards, database structure, and verification workflows.

---

### Overview of Changes

| Area | Current State | Target State |
|------|---------------|--------------|
| Allowed formats | PDF, DOC, DOCX, TXT, images | **JPG, PNG, WEBP only** |
| Files per submission | Single file | **Multiple images (one per page)** |
| AI verification | Single file analysis | **Per-page analysis + aggregation** |
| Storage | Single `file_url` | **Array of image URLs** |

---

### Phase 1: Database Schema Update

**New column in `submissions` table:**

```text
file_urls (TEXT ARRAY) - Stores array of image URLs for multi-page submissions
```

The existing `file_url` column will be kept for backward compatibility but new submissions will use `file_urls`.

**Migration SQL:**
- Add `file_urls` column as `TEXT[]`
- Add `page_verification_results` column as `JSONB` (stores per-page AI results)

---

### Phase 2: Frontend - Submission Page Updates

**File: `src/pages/student/SubmitAssignment.tsx`**

Changes:
1. **Remove PDF/DOC support** - Accept only `.jpg`, `.jpeg`, `.png`, `.webp`
2. **Enable multi-file selection** - Allow multiple images via `multiple` attribute
3. **Add image previews** - Show thumbnails of all selected pages before submission
4. **Add page ordering** - Allow drag-to-reorder or numbered display
5. **Update UI text** - "Upload handwritten assignment images (one image per page)"
6. **Validate each file** - Reject non-image files with clear error message
7. **Upload all images** - Store all to Supabase storage and save URLs array

**New UI structure:**
```text
+---------------------------------------+
| Upload Handwritten Assignment         |
|                                       |
| [Page 1]  [Page 2]  [Page 3]  [+Add]  |
|  📄 img1   📄 img2   📄 img3          |
|                                       |
| "Upload images only (JPG, PNG, WEBP)" |
| "One image per handwritten page"      |
|                                       |
| [Submit All Pages]                    |
+---------------------------------------+
```

---

### Phase 3: Backend - Edge Function Updates

**File: `supabase/functions/verify-handwriting/index.ts`**

**Complete rewrite of verification logic:**

1. **Accept array of file URLs** - New parameter `file_urls: string[]`
2. **Remove PDF handling** - Delete all PDF MIME type logic
3. **Per-page verification loop:**
   ```text
   For each image in file_urls:
     1. Fetch image as base64
     2. Check if it's handwritten (is_handwritten flag)
     3. Compare against student's handwriting profile
     4. Store page-level: { page_number, similarity_score, same_writer, is_handwritten }
   ```

4. **Conservative aggregation logic:**
   ```text
   overall_similarity = MIN(page_similarity_scores)
   
   If any page has same_writer = false → final = false
   If any page has is_handwritten = false → flag for manual review
   
   Confidence increases only if ALL pages are consistent
   ```

5. **Updated AI prompt for images only:**
   ```text
   You are an AI handwriting verification engine.
   This is an IMAGE of a handwritten document page.
   Analyze ONLY handwriting features, not content.
   
   First, determine if this is handwritten or typed/printed.
   If typed → is_handwritten = false, similarity_score = 0
   
   If handwritten, compare against the student's profile...
   ```

6. **Output structure:**
   ```json
   {
     "overall_similarity_score": 72,
     "same_writer": true,
     "confidence_level": "high",
     "risk_level": "low",
     "page_results": [
       { "page": 1, "similarity": 78, "same_writer": true, "is_handwritten": true },
       { "page": 2, "similarity": 72, "same_writer": true, "is_handwritten": true }
     ],
     "final_reasoning": "..."
   }
   ```

---

### Phase 4: Update Verification Progress UI

**File: `src/components/submission/VerificationProgress.tsx`**

Changes:
1. Show "Analyzing page X of Y..." during verification
2. Display per-page results in the progress indicator
3. Show final aggregated result

---

### Phase 5: Update Submissions Display

**File: `src/pages/student/StudentSubmissions.tsx`**

Changes:
1. Show image gallery instead of single file link
2. Display per-page verification scores in details dialog
3. Update file preview to show all pages

**File: `src/components/submission/VerificationDetailsDialog.tsx`**

Changes:
1. Add per-page results table showing each page's score
2. Highlight any pages flagged as non-handwritten or different writer

---

### Phase 6: Update Faculty/Admin Views

**Files:**
- `src/pages/faculty/FacultySubmissions.tsx`
- `src/pages/admin/AssignmentsPage.tsx`

Changes:
1. Show multi-image gallery for submissions
2. Display per-page verification breakdown
3. Allow clicking individual pages to view details

---

### Phase 7: Clean Up - Remove Document Logic

**Remove from codebase:**
1. PDF MIME type handling in `verify-handwriting`
2. `application/pdf` detection code
3. DOC/DOCX format references
4. Any OCR or text extraction logic (none exists currently)
5. PDF format badges in UI

**Update `assignments` table default:**
- Change `allowed_formats` default from `['pdf', 'doc', 'docx', 'image']` to `['image']`

---

### Technical Implementation Details

**Storage structure for multi-page:**
```text
uploads/{user_id}/{assignment_id}/
  ├── page_1_{timestamp}.jpg
  ├── page_2_{timestamp}.jpg
  └── page_3_{timestamp}.jpg
```

**Database submission row:**
```json
{
  "file_url": "url_to_first_image",  // Backward compat
  "file_urls": ["url_page_1", "url_page_2", "url_page_3"],
  "file_type": "image/jpeg",
  "ai_analysis_details": {
    "algorithm_version": "4.0-image-only",
    "page_count": 3,
    "page_results": [...],
    "overall_similarity_score": 72,
    "aggregation_method": "conservative_minimum"
  }
}
```

**Verification decision rules:**
```text
If overall_score >= 75 AND all pages same_writer = true:
  → status: "verified", risk_level: "low"

If any page is_handwritten = false:
  → status: "needs_manual_review", flag: "typed_content_detected"

If overall_score < 50 OR any page clearly different writer:
  → status: "needs_reupload", risk_level: "high"

Otherwise (50-74 range):
  → status: "needs_manual_review", risk_level: "medium"
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/pages/student/SubmitAssignment.tsx` | Multi-file upload, image preview, validation |
| `supabase/functions/verify-handwriting/index.ts` | Per-page verification, aggregation logic |
| `src/components/submission/VerificationProgress.tsx` | Per-page progress display |
| `src/pages/student/StudentSubmissions.tsx` | Multi-image display |
| `src/components/submission/VerificationDetailsDialog.tsx` | Per-page results table |
| `src/pages/faculty/FacultySubmissions.tsx` | Multi-image gallery |
| `src/components/faculty/FilePreviewDialog.tsx` | Image gallery support |

**Database migration:**
- Add `file_urls TEXT[]` column to `submissions`
- Add `page_verification_results JSONB` column to `submissions`

---

### Benefits of This Approach

1. **More stable** - Images are simpler than PDFs for AI analysis
2. **More accurate** - Direct handwriting comparison without conversion
3. **Deterministic** - Clear per-page scoring with minimum aggregation
4. **No infinite loops** - Terminal states clearly defined
5. **Real-world suitable** - Students photograph handwritten pages naturally


also make the assignment pages submitted by the student to store in the database and send it to the submissions age of the faculty and when they hit the view button the assignment images uploaded by the student need to be visible to the faculty and also to the student 
