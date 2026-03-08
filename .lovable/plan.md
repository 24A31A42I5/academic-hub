## v6.0 Weighted Probabilistic Writer Verification

Upgraded from v5.0 binary enum matching to production-grade weighted probabilistic scoring.

### What Changed

1. **`feature_statistics` table** — 28 rows of research-based population frequency & discriminative weights
2. **`extract-handwriting-features`** — New strict enum prompt, validation before storage (v6.0-weighted)
3. **`verify-handwriting`** — `compareProfilesWeighted()` replaces `compareProfiles()`, loads weights from DB, dynamic thresholds, rare feature tracking

### Scoring Logic
- Each feature match is weighted by rarity (common features score less, rare features score more)
- Dynamic threshold: base 70, -3 per rare match, +5 if low confidence, clamped 60-80
- Evidence strength tracked: weak/moderate/strong/very_strong
- Algorithm version: `6.0-weighted-probabilistic`

### Backward Compatibility
- `normalizeProfile()` kept for old v3.0/v5.0 profiles
- `isStrictProfile()` fast-paths v6.0+ profiles

### Rollout
1. ✅ Migration deployed (feature_statistics)
2. ✅ Edge functions updated
3. ⬜ All students must retrain handwriting profiles
4. ⬜ Test with known same/different writer pairs
