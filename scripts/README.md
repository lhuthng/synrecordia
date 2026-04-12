# Song Difficulty Evaluator

A flexible Python script for evaluating and classifying song difficulty based on multiple metrics with customizable weights.

## Overview

This script analyzes songs from your `public/songs/` directory and assigns difficulty ratings (beginner, easy, medium, hard, expert) based on multiple musical characteristics. You can customize how much each factor influences the final score and automatically update `index.json` with new ratings.

## Features

- **6 Independent Metrics**: Analyzes different aspects of song difficulty
- **Customizable Weights**: Control how much each metric influences the final score
- **Multiple Output Formats**: Table, detailed, summary, JSON, or changes-only views
- **Automatic Index Updates**: Optional one-command update to `index.json`
- **Easy CLI**: Simple command-line interface with sensible defaults
- **Validation**: Built-in checks for weight configuration validity

## Metrics

The evaluator considers six factors (with default 25/25/15/15/10/10 split):

| Metric | Default | Description |
|--------|---------|-------------|
| Song Length | 25% | Duration in milliseconds (longer = harder) |
| Note Range | 25% | Semitone spread between lowest and highest note |
| Number of Actions | 15% | Total count of notes/events in first track |
| Average Duration | 15% | Mean duration of notes (shorter = faster = harder) |
| Duration Variability | 10% | Standard deviation of note durations (more varied = harder) |
| Minimum Duration | 10% | Shortest note (indicates required precision/speed) |

**Note**: Average and minimum durations are inverted - shorter notes score higher (indicating more difficulty).

## Installation

No external dependencies required beyond Python 3.6+.

```bash
cd synrecordia
python3 scripts/evaluate_difficulty.py --help
```

## Quick Start

```bash
# See current default weights
python3 scripts/evaluate_difficulty.py --show-weights

# Evaluate all songs with default weights
python3 scripts/evaluate_difficulty.py

# View results as summary (grouped by difficulty)
python3 scripts/evaluate_difficulty.py --output summary

# Update index.json with new ratings
python3 scripts/evaluate_difficulty.py --update-index
```

## Usage Examples

### Basic Evaluation

```bash
# Default weights, table output
python3 scripts/evaluate_difficulty.py

# Same as above but with summary view
python3 scripts/evaluate_difficulty.py --output summary

# Detailed breakdown with score components
python3 scripts/evaluate_difficulty.py --output details

# Show only songs that would change
python3 scripts/evaluate_difficulty.py --output changes
```

### Custom Weights

All weights must sum to 100. Format: `key:value` pairs separated by spaces.

```bash
# Emphasize speed (fastest songs are hardest)
python3 scripts/evaluate_difficulty.py \
  --weights length:15 range:15 actions:15 avg_dur:35 stdev:15 min_dur:5

# Emphasize range (widest ranges are hardest)
python3 scripts/evaluate_difficulty.py \
  --weights length:20 range:40 actions:15 avg_dur:15 stdev:5 min_dur:5

# Emphasize endurance (long songs are hardest)
python3 scripts/evaluate_difficulty.py \
  --weights length:40 range:15 actions:30 avg_dur:10 stdev:3 min_dur:2

# Technical focus (speed + range + complexity)
python3 scripts/evaluate_difficulty.py \
  --weights length:10 range:30 actions:10 avg_dur:25 stdev:20 min_dur:5
```

### Specific Songs

```bash
# Evaluate only specific songs
python3 scripts/evaluate_difficulty.py \
  --song baby-shark --song blue --output details

# Single song with detailed breakdown
python3 scripts/evaluate_difficulty.py \
  --song giorno-s-theme --output details
```

### Update Index

```bash
# Calculate new ratings and update index.json
python3 scripts/evaluate_difficulty.py --update-index

# Use custom weights and update
python3 scripts/evaluate_difficulty.py \
  --weights length:30 range:25 actions:20 avg_dur:15 stdev:5 min_dur:5 \
  --update-index

# Preview changes before updating
python3 scripts/evaluate_difficulty.py --output changes
python3 scripts/evaluate_difficulty.py --update-index  # if satisfied
```

### Export and Integration

```bash
# Export results as JSON
python3 scripts/evaluate_difficulty.py --output json > results.json

# Use custom directory
python3 scripts/evaluate_difficulty.py \
  --songs-dir /path/to/songs

# Combine with other tools
python3 scripts/evaluate_difficulty.py --output json | jq '.[] | select(.score > 50)'
```

## Output Formats

### Table (Default)

Compact table with scores and key metrics:

```
Title                                    Score        Rec.    Current    Length  Range   Dur(ms)
========================================================================================================
Marry had a Little Lamb                   11.8      beginner  beginner    0.06s      7      1.11
Baby Shark                                24.4         easy      easy      0.14s      6      0.50
Giorno's Theme                            56.0         hard    medium      0.65s     25      0.67
Sonata in C (RV 53)                       76.6       expert      hard      1.39s     22      0.53
```

### Summary

Groups songs by recommended difficulty with counts:

```
BEGINNER (3 songs, 9.1%):
  • Marry had a Little Lamb                     11.8
  • Abendlied                                   11.9
  • Twinkle Twkinle Little Star                 12.8

EASY (8 songs, 24.2%):
  • Ode To Joy                                  22.7 [from beginner]
  • Keinöner Land                               22.9 [from beginner]
  ...
```

### Details

Comprehensive breakdown for each song:

```
Giorno's Theme
  Score: 56.0/100 → HARD
  Current: MEDIUM (changed)
  Metrics:
    Length: 0.65s | Range: 25 semitones | BPM: 135
    Actions: 881 | Avg Duration: 0.67ms | Min: 0.25ms
    Variability: 0.9ms
  Score Components: Length=11.5 Range=15.8 Actions=4.5 AvgDur=11.6 StdDev=4.5 MinDur=8.2
```

### Changes

Shows only songs that would change difficulty:

```
Song Of Storm                              medium → easy       (Score: 25.7, Speed: 0.97ms, Range: 15)
Giorno's Theme                             expert → hard       (Score: 56.0, Speed: 0.67ms, Range: 25)
River flows in you                          hard → medium     (Score: 46.7, Speed: 0.34ms, Range: 24)
```

### JSON

Raw JSON output for programmatic use or piping to other tools.

## Algorithm Details

### Scoring Process

1. **Analyze**: Extract metrics from all songs' first track
2. **Normalize**: Scale each metric to 0-1 range using min/max values
3. **Weight**: Multiply each normalized metric by its weight percentage
4. **Aggregate**: Sum all weighted components to get 0-100 score
5. **Map**: Convert score to difficulty level using thresholds

### Difficulty Thresholds

| Level | Score Range |
|-------|-------------|
| Beginner | 0 - 16 |
| Easy | 16 - 32 |
| Medium | 32 - 52 |
| Hard | 52 - 75 |
| Expert | 75 - 100 |

### Inverted Metrics

Two metrics are inverted because shorter = harder:

- **Average Duration**: Lower average duration scores higher
- **Minimum Duration**: Shorter minimum note scores higher

This reflects the reality that fast, rapid-fire notes are more challenging than sustained notes.

### Example Calculation

For a song with:
- Length: 0.50s (middle range) → normalized ~0.5
- Range: 24 semitones (wide) → normalized ~0.85
- Actions: 500 (many) → normalized ~0.6
- Avg Duration: 0.5ms (fast) → normalized 0.5 but inverted to 0.5
- Stdev: 0.8ms (varied) → normalized ~0.8
- Min Duration: 0.1ms (very fast) → normalized 0.1 but inverted to 0.9

With default weights:
```
Score = (0.5 × 0.25) + (0.85 × 0.25) + (0.6 × 0.15) + (0.5 × 0.15) + (0.8 × 0.10) + (0.9 × 0.10)
      = 0.125 + 0.2125 + 0.09 + 0.075 + 0.08 + 0.09
      = 0.7325 × 100
      = 73.25 → Hard (between 52-75)
```

## Weight Configuration Presets

See `weights-examples.json` for ready-to-use weight configurations:

```bash
# Speed-focused (fast songs are much harder)
--weights length:15 range:15 actions:15 avg_dur:35 stdev:15 min_dur:5

# Range-focused (wide ranges are much harder)
--weights length:20 range:40 actions:15 avg_dur:15 stdev:5 min_dur:5

# Endurance-focused (long songs are much harder)
--weights length:40 range:15 actions:30 avg_dur:10 stdev:3 min_dur:2

# Technical-focused (speed + range + complexity)
--weights length:10 range:30 actions:10 avg_dur:25 stdev:20 min_dur:5

# Beginner-friendly (only length and range matter)
--weights length:30 range:40 actions:10 avg_dur:10 stdev:5 min_dur:5
```

## Tips & Best Practices

### Before Updating Index

Always check what would change:

```bash
python3 scripts/evaluate_difficulty.py --output changes
```

Review the changes before committing to the update.

### Validating Weights

Quick check that weights sum to 100:

```bash
python3 scripts/evaluate_difficulty.py --show-weights
```

### Export for Review

Save results to JSON for careful review:

```bash
python3 scripts/evaluate_difficulty.py --output json > results.json
# Review results.json before running --update-index
```

### Single Metric Focus

To focus almost entirely on one metric:

```bash
# Almost all weight on speed
--weights length:5 range:5 actions:5 avg_dur:70 stdev:10 min_dur:5
```

### Comparison

Compare different weighting approaches:

```bash
# Save default approach
python3 scripts/evaluate_difficulty.py --output json > default.json

# Save speed-focused approach
python3 scripts/evaluate_difficulty.py \
  --weights length:15 range:15 actions:15 avg_dur:35 stdev:15 min_dur:5 \
  --output json > speed-focused.json

# Compare the two (use jq or similar)
diff default.json speed-focused.json
```

## Troubleshooting

### "Weights must sum to 100"

Ensure your weights add up to exactly 100:

```bash
# ✓ Correct: 30 + 30 + 20 + 10 + 5 + 5 = 100
python3 scripts/evaluate_difficulty.py \
  --weights length:30 range:30 actions:20 avg_dur:10 stdev:5 min_dur:5

# ✗ Wrong: 30 + 30 + 20 + 10 + 5 + 4 = 99
python3 scripts/evaluate_difficulty.py \
  --weights length:30 range:30 actions:20 avg_dur:10 stdev:5 min_dur:4
```

### "No songs found to analyze"

Make sure:
1. You're running from the project root directory
2. `public/songs/` directory exists
3. `public/songs/index.json` exists

```bash
ls public/songs/index.json  # Should exist
ls public/songs/*.json      # Should show song files
```

### Songs Not Changing

Your songs may already be correctly classified, or your weight changes don't push them over thresholds. Use `--output changes` to see if any would change.

### Different Results Each Run

Results should be consistent. If they differ, check:
1. Did you change the songs directory or weights?
2. Were song files modified?
3. Run with same parameters to verify reproducibility

## Integration with Git

After updating ratings, commit your changes:

```bash
python3 scripts/evaluate_difficulty.py --update-index

# Then commit
git add public/songs/index.json
git commit -m "chore: reevaluate song difficulties with updated metrics"
```

## Advanced Usage

### Batch Processing

Evaluate with multiple weight configurations:

```bash
for weights in \
  "length:30 range:25 actions:20 avg_dur:15 stdev:5 min_dur:5" \
  "length:25 range:30 actions:20 avg_dur:15 stdev:5 min_dur:5" \
  "length:25 range:25 actions:20 avg_dur:20 stdev:5 min_dur:5"
do
  echo "Testing weights: $weights"
  python3 scripts/evaluate_difficulty.py \
    --weights $weights \
    --output summary | head -20
done
```

### Programmatic Access

Use with other tools:

```bash
# Get all expert songs
python3 scripts/evaluate_difficulty.py --output json | \
  jq '.[] | select(.recommended=="expert") | .title'

# Get songs that would change
python3 scripts/evaluate_difficulty.py --output json | \
  jq '.[] | select(.current_difficulty != .recommended)'

# Calculate average score by difficulty
python3 scripts/evaluate_difficulty.py --output json | \
  jq 'group_by(.recommended) | map({difficulty: .[0].recommended, avg_score: (map(.score) | add / length)})'
```

## Contributing

To modify the evaluation algorithm:

1. Edit `evaluate_difficulty.py`
2. Test with `--output summary` to see distribution
3. Test with `--output changes` to see what would change
4. Use `--output json` for detailed analysis
5. Validate with `--show-weights`

## See Also

- `weights-examples.json` - Pre-configured weight sets
- `public/songs/index.json` - Song definitions
- `public/songs/*.json` - Individual song data files
