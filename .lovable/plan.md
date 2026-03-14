## v7.0 Masterpiece Weighted Probabilistic Writer Verification

Upgraded from v6.0 to production-grade three-layer defense system.

### Three-Layer Defense

1. **Strict Enum Extraction** — Forces Gemini to return exact categorical values with 2 new features (connectivity, line_stability). Eliminates AI output inconsistency.
2. **Rarity-Weighted Comparison** — Weights rare features higher (left_lean slant = 0.90) than common features (right_lean = 0.35). Prevents false positives when different writers share common traits. Dynamic thresholds adjust based on evidence quality.
3. **Anti-Spoofing Detection** — `submission_consistency` table tracks variation across submissions. Flags students with suspiciously consistent scores (98-100% repeatedly). `check_spoofing_risk()` DB function auto-escalates risk level.

### What Changed from v6.0

1. **New features**: `connectivity` (connected/semi_connected/disconnected) and `line_stability` (straight/rising/descending/erratic)
2. **`submission_consistency` table** — Tracks per-student submission patterns (perfect_match_count, avg_variation_score, spoofing_risk_level)
3. **`check_spoofing_risk()` function** — DB function that analyzes submission history and returns risk level
4. **`extract-handwriting-features`** — Updated prompt with 12 features (was 10), v7.0-masterpiece-weighted metadata
5. **`verify-handwriting`** — Integrated anti-spoofing check after comparison, spoofing_risk in ai_analysis_details, spoofing flags in ai_flagged_sections
6. **Frontend** — Profile upgrade banner shown when student has pre-v7.0 profile

### Expected Results

- Same writer, different page: 80-95% accuracy
- Different writers: <50% (correctly rejected)
- AI-generated submissions: Flagged after 2-3 perfect matches

### Rollout

1. ✅ Migration deployed (submission_consistency, check_spoofing_risk, new feature stats)
2. ✅ Edge functions updated (v7.0-masterpiece-weighted)
3. ✅ Frontend upgrade banner added
4. ⬜ All students must retrain handwriting profiles
5. ⬜ Test with known same/different writer pairs
