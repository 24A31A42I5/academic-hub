## v7.0 Tool-Call Enforced Handwriting Verification

Upgraded from v6.0 JSON response format to tool calling for deterministic enum output.

### What Changed

1. **`extract-handwriting-features`** — Now uses tool calling (`report_handwriting_features`) instead of `response_format: { type: 'json_object' }`. Enums are enforced by the tool schema itself, not by prompt text.
2. **`verify-handwriting`** — Same tool calling upgrade for per-page feature extraction. Falls back to JSON parsing + normalizeProfile() for backward compat.
3. **`StudentHandwriting.tsx`** — Shows amber alert when profile version is pre-7.0, prompting retrain.

### Why Tool Calling > JSON Mode
- JSON mode relies on the model following prompt instructions for enum values
- Tool calling enforces enum values at the API schema level — model literally cannot return invalid values
- Eliminates the "rightward slant" vs "right_lean" inconsistency problem

### Backward Compatibility
- `normalizeProfile()` kept for old v3.0/v5.0/v6.0 profiles
- `isStrictProfile()` fast-paths v6.0+ profiles
- JSON content fallback if tool call not returned

### Rollout
1. ✅ Edge functions updated to v7.0-toolcall
2. ✅ Retraining alert added for old profiles
3. ⬜ All students must retrain handwriting profiles
4. ⬜ Test with known same/different writer pairs
