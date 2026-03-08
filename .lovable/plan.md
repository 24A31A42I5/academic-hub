## v7.0 Enhanced Probabilistic Writer Verification

Upgraded from v6.0 to production-grade enhanced biometric verification with partial matching and robust aggregation.

### What Changed (v6.0 → v7.0)

1. **5 New Biometric Features**: `pen_pressure`, `line_quality`, `size_consistency`, `t_cross_position`, `i_dot_style` — 18 total features (7 core + 5 extended + 6 letter shapes)
2. **Partial Match Scoring**: Near-miss values get partial credit (e.g., "thin" vs "medium" = 40% credit instead of 0%)
3. **Robust Aggregation**: Trimmed median replaces conservative minimum — drops outlier pages, adds cross-page consistency bonus
4. **Model Upgrade**: Training uses `gemini-2.5-pro` (highest accuracy); verification uses `gemini-2.5-flash` (speed/cost balance)
5. **16 new `feature_statistics` rows** for population frequencies of new features
6. **Enhanced extraction prompt** with detailed forensic analysis instructions

### Scoring Logic (v7.0)
- Each feature match is weighted by rarity (discriminative_weight from DB)
- **Partial matching**: Similar but not identical values get 20-50% credit
- Dynamic threshold: base 70, -3 per rare match, clamped 55-80
- Evidence strength: weak/moderate/strong/very_strong (based on rare match count)
- **Aggregation**: 1-2 pages = minimum, 3-5 pages = drop worst + median, 6+ pages = trim bottom 15% + median
- **Consistency bonus**: +5% if >75% pages agree on same writer

### Backward Compatibility
- `normalizeProfile()` handles v3.0/v5.0/v6.0 legacy profiles
- Extended features (pen_pressure etc.) are optional — old profiles skip them in comparison
- Algorithm version: `7.0-enhanced-probabilistic`

### Rollout
1. ✅ Migration deployed (16 new feature_statistics rows)
2. ✅ Edge functions updated (extract v7.0 + verify v7.0)
3. ⬜ All students must retrain handwriting profiles for v7.0 features
4. ⬜ Test with known same/different writer pairs
