&nbsp;

---

# 🚨 FINAL MASTER FIX PROMPT — Forensic Stylometric Writer Identification System

## 🎯 Objective

Convert the handwriting verification pipeline from **image similarity comparison** into **true forensic stylometric writer identification**, while preserving all existing scoring logic, thresholds, aggregation, database behavior, and frontend functionality.

Only the specified prompts and minimal supporting fixes are allowed.

---

# ⚠️ ABSOLUTE CONSTRAINTS — DO NOT MODIFY

Do NOT change:

- `VERIFICATION_THRESHOLDS`
- `determineRiskLevel`
- `determineStatus`
- `getFallbackResult`
- conservative minimum aggregation across pages
- ownership verification block
- CDN cache-busting logic
- `fetchImageAsBase64`
- scoring math
- risk mapping
- database update logic
- database schema
- frontend code
- other edge functions

---

# ✅ ALLOWED MODIFICATIONS (ONLY THESE)

- Update prompt strings in the two specified edge functions.
- Remove module-level caches or shared variables.
- Remove stale embedding early-return logic.
- Update CORS headers in one file.
- Ensure feature/profile queries are filtered by authenticated `student_id`.
- Redeploy edge functions.

Do NOT add new helper functions or abstractions.

Do NOT introduce image hashing, pixel comparison, or visual similarity logic.

---

# 🔎 PRE-FIX AUDIT (MANDATORY BEFORE CHANGES)

In BOTH files below:

- `supabase/functions/extract-handwriting-features/index.ts`
- `supabase/functions/verify-handwriting/index.ts`

Check for any module-level variables outside the request handler:

Examples:

- caches
- singleton objects
- stored profile references
- persistent state between requests

If found:

➡️ Move them inside the request handler so each request is isolated.

Purpose: prevent cross-user contamination.

---

# 🧩 FIX 1 — Stylometric Feature Extraction Prompt

## File

```
supabase/functions/extract-handwriting-features/index.ts

```

Replace the existing AI prompt completely.

### New Prompt Requirements

Tell the model:

- It is a **forensic document examiner** creating a biometric writer profile.
- This is NOT:
  - image description
  - transcription
  - layout analysis
  - visual similarity measurement.

Ignore completely:

- words and meaning
- topic/content
- page layout
- image quality
- background texture
- ink color
- visual noise.

Extract ONLY stylometric features:

1. letter slant angle & consistency
2. stroke width (thin / medium / thick)
3. pen pressure patterns
4. letter spacing (cramped / normal / wide)
5. word spacing (tight / normal / wide)
6. baseline consistency/drift
7. uppercase-to-lowercase height ratio
8. loop formations (l, h, b, d, f, g, y)
9. letter connection style
10. distinctive formation of at least five letters:

- a, e, g, o, r, s, d, b, f, l, h

11. writing rhythm and consistency.

### Output Requirements

Return JSON with EXACTLY these keys:

- `letter_formation`
- `spacing`
- `stroke_characteristics`
- `slant_and_baseline`
- `unique_identifiers`
- `overall_description`
- `confidence_level`

No additional keys.

`overall_description` = 2–3 sentence stylometric signature summary.  
`confidence_level` = decimal 0–1.

This output becomes the permanent biometric writer profile.

---

# 🧩 FIX 2 — Forensic Writer Identification Prompt

## File

```
supabase/functions/verify-handwriting/index.ts

```

Inside `verifyPage`, replace the prompt string entirely.

### New Prompt Requirements

Tell the model:

- It is a **forensic handwriting analyst** for an academic integrity system.
- This is biometric writer identification.
- NOT image comparison.
- NOT content matching.

Ignore completely:

- words written
- text similarity
- image similarity
- layout
- background texture
- image quality
- ink color
- whether images appear identical.

Even if images look identical → analyze stylometric features only.

Core principle:

- Same writer = consistent stylometric features across different pages.
- Different writers = inconsistent features even with similar content.

Compare ONLY:

1. letter slant consistency
2. stroke weight & pressure
3. letter spacing
4. word spacing
5. baseline behavior
6. loop formations
7. specific letter formations (a, e, g, o, r, s)
8. connection style
9. writing rhythm and density
10. uppercase/lowercase proportions.

### Required JSON Output (unchanged format)

- `same_writer` (boolean)
- `similarity_score` (integer 0–100)
- `confidence` (0–1)
- `reasoning` (2–3 sentences, stylometric features only)
- `typed_content_detected` (boolean)

Rules:

- Score reflects ONLY stylometric matching.
- Score 100 requires multiple distinctive feature matches.
- Score 100 is NEVER justified by image or content similarity.
- Reasoning MUST mention handwriting features.
- Reasoning MUST NOT mention visual similarity.

---

# 🧩 FIX 3 — Embedding Refresh on Every Upload

## File

```
supabase/functions/extract-handwriting-features/index.ts

```

Remove any logic that:

- checks if embeddings already exist
- skips extraction if profile exists
- returns cached features.

Requirements:

- Always run full feature extraction.
- Overwrite existing embeddings.
- Update `handwriting_features_extracted_at` every time.
- Never early-return existing data.

---

# 🧩 FIX 4 — CORS Headers Consistency

## File

```
supabase/functions/extract-handwriting-features/index.ts

```

Update `corsHeaders`:

Add:

- `x-client-info`
- `x-supabase-client-platform`

No other changes.

---

# 🚀 FIX 5 — Redeploy (MANDATORY)

After changes:

Redeploy BOTH edge functions.

Deployment drift must be avoided.

Verify deployment by checking edge function logs and confirming stylometric prompt language appears during first invocation.

---

# 🧹 POST-DEPLOY DATABASE CLEANUP (MANDATORY)

Old embeddings were generated using image-based prompts and must be invalidated.

Run SQL:

```sql
update student_details
set handwriting_feature_embedding = null,
    handwriting_features_extracted_at = null;

```

This forces retraining with new stylometric profiles.

---

# 🧪 VERIFICATION TESTS

## Test 1 — Same Writer, Different Page

- Train with sample A.
- Submit different page with different content.

Expected:

- Score > 70
- Reasoning references stylometric features.

---

## Test 2 — Different Writer

Expected:

- Score < 50
- Reasoning identifies inconsistent stylometric features.

---

## Test 3 — Identical Image

Expected:

- High score possible.
- Reasoning MUST mention handwriting features.
- Reasoning MUST NOT mention image similarity.

---

## Test 4 — Deployment Confirmation

Check logs after first invocation.

If logs reference image comparison → redeploy failed.

---

# 🎯 EXPECTED FINAL RESULT

The system must now behave as:

```
Each student = independent forensic handwriting profile

```

with:

- stylometric writer identification
- no image matching bias
- fresh embeddings on every upload
- no cross-user contamination
- stable verification across different pages.

---

&nbsp;