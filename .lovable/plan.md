## Two-Stage Deterministic Writer Verification

Replace the current AI-scored verification (reference image + submission image sent to Gemini for a score) with a deterministic two-stage pipeline where AI only extracts features and code computes the score mathematically.

---

### What Changes

**File:** `supabase/functions/verify-handwriting/index.ts`

Only this file is modified. No other files change.

---

### Stage 1 -- Feature Extraction per Submission Page (NEW)

For each submission page image, call Gemini with the **same forensic extraction prompt** already used in `extract-handwriting-features/index.ts` to produce a structured profile. Then **normalize** the AI output into a strict enum-based schema:

```text
HandwritingProfile {
  slant: "left_lean" | "right_lean" | "upright"
  stroke_weight: "thin" | "medium" | "thick"
  letter_spacing: "tight" | "normal" | "wide"
  word_spacing: "tight" | "normal" | "wide"
  baseline: "straight" | "wavy" | "variable"
  height_ratio: "short" | "moderate" | "tall"
  writing_style: "cursive" | "print" | "mixed"
  letter_formations: { a, e, g, r, t, s } (string each)
  confidence_level: number (0-1)
}
```

A new `normalizeProfile()` function maps the free-text AI output fields to the strict enum values above. If any required field is missing or unmappable, the profile is `null` and the page gets a fallback score of 50.

A new `extractPageFeatures()` function replaces the old `verifyPage()`. It sends **only the submission image** to Gemini (no reference image), gets the structured profile JSON back, and normalizes it.

The same normalization is applied to the student's stored `handwriting_feature_embedding` (reference profile) at the start of the request.

---

### Stage 2 -- Deterministic Comparison (NEW)

A new `compareProfiles(ref, sub)` function computes a score from 0-100 using exact enum matching:


| Feature                               | Points  |
| ------------------------------------- | ------- |
| Slant                                 | 15      |
| Stroke Weight                         | 10      |
| Letter Spacing                        | 15      |
| Letter Formations (6 letters x 5 pts) | 30      |
| Baseline                              | 10      |
| Height Ratio                          | 10      |
| Writing Style                         | 10      |
| **Total**                             | **100** |


Each feature: exact match = full points, mismatch = 0.

Output:

- `similarity_score`: sum of matched points
- `same_writer`: score >= 70
- `confidence_level`: average of ref and sub confidence
- `key_observations`: list of matched and mismatched feature names

---

### What Gets Removed

- The `verifyPage()` function (lines 173-287) -- this is the function that sends two images to Gemini for comparison scoring. It is deleted entirely.
- No reference image is fetched anymore (the `referenceBase64` fetch on line 398 is removed). Only the stored structured profile is used.

---

### What Stays Unchanged

Everything else in the file remains identical:

- `VERIFICATION_THRESHOLDS`
- `determineRiskLevel()`
- `determineStatus()`
- `getFallbackResult()`
- `fetchImageAsBase64()` (still used for submission pages)
- `corsHeaders`
- Ownership verification block (lines 318-341)
- CDN cache-busting logic (lines 391-394, though reference image fetch is no longer needed)
- MIN aggregation (line 464)
- Database update logic (lines 503-533)
- Response format (lines 542-553)
- Error handling (lines 555-564)
- `PageResult` interface

---

### Typed Content Detection

Currently handled inside Gemini's verification prompt. In the new flow, the extraction prompt already asks if content is handwritten. The normalization step will check for a `is_handwritten` field in the AI response. If the AI indicates typed/printed content, the page result is flagged with `is_handwritten: false` and `similarity: 0`.

---

### Updated Page Processing Loop

```text
for each page:
  1. Fetch image as base64
  2. If too large -> fallback (score 50), continue
  3. Call extractPageFeatures(image) -> normalized profile or null
  4. If null -> fallback (score 50), continue
  5. If not handwritten -> score 0, is_handwritten=false
  6. Call compareProfiles(referenceProfile, submissionProfile) -> deterministic score
  7. Push result
```

Everything after the loop (aggregation, status, DB update, response) stays identical.

---

### Algorithm Version

Updated from `'4.0-image-only'` to `'5.0-deterministic'` in `ai_analysis_details` for traceability.

---

### Summary of New Functions Added

1. `normalizeProfile(rawProfile)` -- maps AI output to strict enum schema
2. `extractPageFeatures(pageNumber, imageBase64, apiKey)` -- calls Gemini for feature extraction on a single submission page
3. `compareProfiles(ref, sub)` -- deterministic point-based scoring

### Functions Removed

1. `verifyPage()` -- the old AI-comparison function

### Net Result

- AI is used **only** for feature extraction (converting image to structured data)
- Scoring is **purely mathematical** -- same inputs always produce same score
- No images are compared against each other by the AI
- Reference image is never fetched -- only the stored structured profile is used
- Deterministic, debuggable, reproducible results  
  
**IN SIMPLE WAY:**  
Replace AI image-to-image verification with a two-stage deterministic pipeline:
  1. Extract structured enum-based stylometric profiles from each submission page using Gemini.
  2. Normalize and validate profiles.
  3. Compare reference profile and submission profile using strict enum equality scoring.
  4. Remove verifyPage() completely.
  5. Keep thresholds, aggregation, and DB logic unchanged.
  6. Update algorithm version to 5.0-deterministic.