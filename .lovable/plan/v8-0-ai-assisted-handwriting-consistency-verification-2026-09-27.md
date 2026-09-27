# v8.0 — AI-Assisted Handwriting Consistency Verification

Positioning everywhere in the app: "AI-assisted handwriting consistency verification for academic integrity". This is not proof of who wrote a page. All result text changes from "verified/forged" wording to "consistent / needs review / low consistency".

## Part A — What exists today

1. **Workflow**: The student uploads ONE handwriting sample from the gallery (`StudentHandwriting.tsx`). `extract-handwriting-features` runs 3 Gemini passes, builds a consensus profile and saves it to `student_details.handwriting_feature_embedding`. Assignments are uploaded from the gallery (`SubmitAssignment.tsx`). Then `verify-handwriting` extracts features per page and compares them with that one profile.
2. **Tables**: `student_details` (handwriting_url, hash, embedding, extracted_at), `submissions` (file_urls, ai_* fields, page_verification_results, status), `feature_statistics` (rarity weights), `submission_consistency` plus `check_spoofing_risk()` (anti-spoofing), and triggers `restrict_student_details_update` / `restrict_submission_update`.
3. **Storage**: `handwriting-samples` and `uploads` are both already **private**. Signed URLs already come from `src/lib/handwritingUrl.ts` and `resolve-submission-files`.
4. **AI**: Lovable AI Gateway, `google/gemini-2.5-flash`, called directly inside both edge functions. The extraction prompt is duplicated in each.
5. **Algorithm**: exact enum matching, weighted by rarity (`compareProfilesWeighted`), with thresholds in `VERIFICATION_THRESHOLDS`. Pages are combined as 60% average + 40% minimum.
6. **Known weaknesses**: only one reference sample. The comparison is all-or-nothing per feature (no ordinal distance). AI failures fall back to a **score of 50** (it should be a processing error, not a score). Uploads come from the gallery with no quality gate. There is no per-feature confidence and no "unknown" handling.
7. **Isolation today**: `verify-handwriting` takes the student from the submission row, not from the request, and checks that the caller owns it. This stays and gets tests.

## Part B — Changes by phase

**Phase 1 — Guided camera capture** (new `DocumentCapture` component)
- Live camera using `getUserMedia` (rear camera), with a page-frame overlay, alignment hints, a lighting tip, a page counter, and capture / retake / preview / confirm.
- Used by both Handwriting Enrollment and Submit Assignment. Gallery upload is removed from both. If the camera is unavailable or permission is denied, a clear message explains how to allow it. Desktop without a camera: the student sees a message to use a phone. An admin-only override is not included.

**Phase 2 — Image quality check in the browser** (new `src/lib/imageQuality.ts`)
- Resolution (minimum 1000px on the short side), blur (Laplacian variance), brightness and overexposure (histogram), page boundary (edge density at the borders against the centre), tilt (dominant line angle), occlusion (large dark or skin-tone blobs), and ink presence (dark-stroke coverage).
- Each failure shows a specific recapture message. A failing image never reaches the AI.
- Light preprocessing produces a separate AI copy: crop to the frame, grayscale, contrast normalization. The original photo is stored unchanged.

**Phase 3 — Storage**
- Buckets are already private. Add server-side checks so signed URLs are only issued for paths under the caller's own folder, or for faculty/admin inside their scope. Add a signed-URL path for enrollment samples.

**Phase 4 — 3–5 enrollment samples**
- New table `handwriting_samples` (student_profile_id, storage_path, original_path, image_hash, quality_metrics, extracted_features, extraction_confidence, status, schema_version).
- RLS: students manage only their own rows. Faculty see rows for students in their sections. Admins see everything.
- Enrollment needs at least 3 accepted samples before a profile exists. The student can add up to 5.
- The consolidated profile (per-feature mode, distribution and variance) is written to the existing `student_details.handwriting_feature_embedding`. Current screens keep working.
- Existing single-sample students count as 1 of 3 and are asked to add more.

**Phase 5/6 — Structured extraction through a provider abstraction**
- New shared module `supabase/functions/_shared/handwriting/`:
  - `analysisService.ts` exposes `analyzeHandwriting(image)`. Only its provider file talks to the AI Gateway.
  - `schema.ts` is a strict JSON schema: enums plus `"unknown"`, per-feature confidence, overall confidence, `quality_status`, `is_handwritten`.
  - `prompt.ts` holds one prompt: characteristics only, no identity, ignore content, meaning, layout and printed text, JSON only, return "unknown" instead of guessing.
- Validation with zod. Bad JSON, a timeout or a gateway error becomes a processing error and never a score.

**Phase 7 — Deterministic comparison engine** (`_shared/handwriting/compare.ts`)
- Maps categories to numbers (slant -1/0/+1, spacing 0/0.5/1, and so on). Similarity per feature = 1 minus normalized distance. Unknown or low-confidence features are dropped and the weights are renormalized.
- Weights live in a config file (slant 15, stroke 10, letter spacing 10, word spacing 10, baseline 10, height/proportion 10, style 5, character forms 25, other 5). These are starting values, not validated as optimal.
- Each page is compared with every enrollment sample. The combination method is configurable, default: **trimmed mean** (drop the single highest when 4 or more samples, to avoid depending on the closest sample). The rarity weights in `feature_statistics` stay as a secondary multiplier.

**Phase 8 — Page and assignment results**
- Each page gets `quality_status`, `extraction_confidence`, `similarity`, `per_sample_scores` and `category`.
- The assignment score uses only valid pages (existing 60% average + 40% minimum formula). Invalid pages are listed separately.
- Low extraction confidence gives "Recapture requested" instead of a verdict.
- Categories: High consistency (80 or above), Medium (manual review), Low (recapture / manual review).
- Results are stored in the existing `submissions.page_verification_results` and `ai_analysis_details`. No new submission tables.

**Phase 9 — Faculty review**
- `VerificationDetailsDialog` / `FacultyReviews` show the page image next to the student's enrollment samples (signed URLs), per-page similarity, confidence, quality status, the feature-by-feature breakdown and the consistency category. Faculty can still override.

**Phase 10 — Tests**
- Deno tests for the comparison engine: similarity, missing features, combining samples, page and assignment totals, and schema validation for malformed or partial AI output.
- Vitest tests for the image quality checks (blur, dark, blank, tiny).
- Live checks against the backend: Student A cannot read B's samples or signed URLs, cannot verify B's submission, and an AI failure gives an error, not a mismatch.

## Technical details

- **Migration**: create `handwriting_samples` with GRANTs, RLS and an updated_at trigger. Add a `profile_version` / `sample_count` column to `student_details`. Update the student-details protection trigger so the embedding stays service-role only.
- **Edge functions**: `extract-handwriting-features` becomes a per-sample flow (extract, save the sample, rebuild the profile once 3 or more samples exist). `verify-handwriting` is refactored onto the shared modules. The duplicated prompts and consensus code are removed.
- **Model**: stays on the current Gemini vision model behind the abstraction, so a future swap only touches one file.
- **Breaking changes**:
  - Every student must re-enroll with 3 or more camera samples before new verifications give a verdict. Until then submissions are marked "needs manual review – enrollment incomplete".
  - Gallery uploads are gone, so desktop-only students need a camera.
  - Old submission results stay readable. The dialog handles both formats.
- **Memory**: update the AI verification memory (v7 to v8) and the image-only upload rule (camera-only).
