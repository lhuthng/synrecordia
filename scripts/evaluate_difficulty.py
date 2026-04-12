#!/usr/bin/env python3
"""
Song Difficulty Evaluator
==========================

Evaluate and classify song difficulty based on multiple metrics with customizable weights.

Metrics considered:
  - Song Length (duration in milliseconds)
  - Note Range (semitone spread)
  - Number of Actions (total notes/events)
  - Average Note Duration (mean duration in ms)
  - Duration Variability (standard deviation)
  - Minimum Note Duration (shortest note in ms)

Usage:
  python3 evaluate_difficulty.py                    # Use default weights
  python3 evaluate_difficulty.py --show-weights     # Display current weights
  python3 evaluate_difficulty.py --weights length:30 range:30 actions:20 avg_dur:15 stdev:3 min_dur:2
  python3 evaluate_difficulty.py --song baby-shark --song blue --output details
  python3 evaluate_difficulty.py --output summary --update-index
"""

import json
import statistics
import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class SongAnalyzer:
    """Analyzes songs and extracts metrics from JSON files."""

    def __init__(self, songs_dir: str):
        self.songs_dir = Path(songs_dir)

    def analyze_song(self, filepath: Path) -> Optional[Dict]:
        """Extract all metrics from a song file."""
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)

            if not data.get('tracks') or len(data['tracks']) == 0:
                return None

            first_track = data['tracks'][0]
            actions = first_track.get('actions', [])

            if not actions:
                return None

            # Calculate length (max end time)
            max_time = 0
            for action in actions:
                end_time = action.get('time', 0) + action.get('duration', 0)
                max_time = max(max_time, end_time)

            # Get note range
            note_range = first_track.get('noteRange', {})
            min_note = note_range.get('min', 0)
            max_note = note_range.get('max', 0)
            range_span = max_note - min_note

            # Duration statistics
            durations = [action.get('duration', 0) for action in actions]
            durations = [d for d in durations if d > 0]

            if not durations:
                return None

            avg_duration = statistics.mean(durations)
            min_duration = min(durations)
            max_duration = max(durations)
            stdev = statistics.stdev(durations) if len(durations) > 1 else 0

            return {
                'id': data.get('id', ''),
                'length': max_time,
                'range_span': range_span,
                'num_actions': len(actions),
                'avg_duration': avg_duration,
                'min_duration': min_duration,
                'max_duration': max_duration,
                'duration_stdev': stdev,
            }
        except Exception as e:
            print(f"Warning: Error analyzing {filepath}: {e}", file=sys.stderr)
            return None

    def analyze_all(self, index_path: str) -> List[Dict]:
        """Analyze all songs from index.json."""
        with open(index_path, 'r') as f:
            index = json.load(f)

        results = []
        for song in index:
            filepath = self.songs_dir / song['file']
            analysis = self.analyze_song(filepath)

            if analysis:
                results.append({
                    'title': song['title'],
                    'bpm': song.get('bpm', 0),
                    'current_difficulty': song.get('difficulty', 'N/A'),
                    **analysis
                })

        return results


class DifficultyCalculator:
    """Calculates difficulty scores with configurable weights."""

    # Default weights (must sum to 100)
    DEFAULT_WEIGHTS = {
        'length': 25,
        'range': 25,
        'actions': 15,
        'avg_duration': 15,
        'stdev': 10,
        'min_duration': 10,
    }

    # Difficulty thresholds (score ranges)
    THRESHOLDS = {
        'beginner': 16,
        'easy': 32,
        'medium': 52,
        'hard': 75,
    }

    def __init__(self, weights: Optional[Dict[str, float]] = None):
        """Initialize with optional custom weights."""
        self.weights = weights or self.DEFAULT_WEIGHTS.copy()
        self._validate_weights()

    def _validate_weights(self) -> None:
        """Validate weights sum to 100 and have valid keys."""
        valid_keys = set(self.DEFAULT_WEIGHTS.keys())
        provided_keys = set(self.weights.keys())

        if not provided_keys.issubset(valid_keys):
            invalid = provided_keys - valid_keys
            raise ValueError(f"Invalid weight keys: {invalid}. Valid: {valid_keys}")

        total = sum(self.weights.values())
        if abs(total - 100) > 0.01:
            raise ValueError(f"Weights must sum to 100, got {total}")

    def _normalize(self, value: float, min_val: float, max_val: float) -> float:
        """Normalize value to 0-1 range."""
        if max_val <= min_val:
            return 0
        return (value - min_val) / (max_val - min_val)

    def calculate_score(self, song: Dict, all_songs: List[Dict]) -> Tuple[float, Dict]:
        """
        Calculate difficulty score (0-100) and component breakdown.

        Returns:
            Tuple of (total_score, components_dict)
        """
        # Extract all metrics for normalization
        lengths = [s['length'] for s in all_songs]
        ranges = [s['range_span'] for s in all_songs]
        actions_list = [s['num_actions'] for s in all_songs]
        avg_durs = [s['avg_duration'] for s in all_songs]
        stdevs = [s['duration_stdev'] for s in all_songs]
        min_durs = [s['min_duration'] for s in all_songs]

        # Calculate normalized scores (0-1)
        length_norm = self._normalize(song['length'], min(lengths), max(lengths))
        range_norm = self._normalize(song['range_span'], min(ranges), max(ranges))
        actions_norm = self._normalize(song['num_actions'], min(actions_list), max(actions_list))
        # Inverted: shorter notes = harder
        avg_dur_norm = 1 - self._normalize(song['avg_duration'], min(avg_durs), max(avg_durs))
        stdev_norm = self._normalize(song['duration_stdev'], min(stdevs), max(stdevs))
        # Inverted: shorter minimum = harder
        min_dur_norm = 1 - self._normalize(song['min_duration'], min(min_durs), max(min_durs))

        # Apply weights
        components = {
            'length': length_norm * self.weights['length'],
            'range': range_norm * self.weights['range'],
            'actions': actions_norm * self.weights['actions'],
            'avg_duration': avg_dur_norm * self.weights['avg_duration'],
            'stdev': stdev_norm * self.weights['stdev'],
            'min_duration': min_dur_norm * self.weights['min_duration'],
        }

        total_score = sum(components.values())
        return total_score, components

    def get_difficulty(self, score: float) -> str:
        """Map score to difficulty level."""
        if score < self.THRESHOLDS['beginner']:
            return 'beginner'
        elif score < self.THRESHOLDS['easy']:
            return 'easy'
        elif score < self.THRESHOLDS['medium']:
            return 'medium'
        elif score < self.THRESHOLDS['hard']:
            return 'hard'
        else:
            return 'expert'


class ReportGenerator:
    """Generate various report formats."""

    @staticmethod
    def print_table(results: List[Dict]) -> None:
        """Print results as formatted table."""
        print("\n" + "="*180)
        print("SONG DIFFICULTY EVALUATION")
        print("="*180)
        print(f"{'Title':<40} {'Score':>6} {'Rec.':>10} {'Current':>10} {'Length':>8} {'Range':>6} {'Dur(ms)':>8}")
        print("-"*180)

        for r in results:
            marker = " → " if r['current_difficulty'] != r['recommended'] and r['current_difficulty'] != 'N/A' else "   "
            print(f"{r['title']:<40} {r['score']:>6.1f} {r['recommended']:>10}{marker}{r['current_difficulty']:>9} "
                  f"{r['length']/1000:>7.2f}s {r['range_span']:>6} {r['avg_duration']:>7.2f}")

        print("-"*180)
        print(f"Total songs: {len(results)}\n")

    @staticmethod
    def print_details(results: List[Dict]) -> None:
        """Print detailed information for each song."""
        print("\n" + "="*180)
        print("DETAILED EVALUATION")
        print("="*180)

        for r in results:
            print(f"\n{r['title']}")
            print(f"  Score: {r['score']:.1f}/100 → {r['recommended'].upper()}")
            if r['current_difficulty'] != 'N/A':
                if r['current_difficulty'] != r['recommended']:
                    print(f"  Current: {r['current_difficulty'].upper()} (changed)")
                else:
                    print(f"  Current: {r['current_difficulty'].upper()} (unchanged)")
            print(f"  Metrics:")
            print(f"    Length: {r['length']/1000:.2f}s | Range: {r['range_span']} semitones | BPM: {r['bpm']}")
            print(f"    Actions: {r['num_actions']} | Avg Duration: {r['avg_duration']:.2f}ms | Min: {r['min_duration']:.2f}ms")
            print(f"    Variability: {r['duration_stdev']:.2f}ms")
            comp = r['components']
            print(f"  Score Components: Length={comp['length']:.1f} Range={comp['range']:.1f} Actions={comp['actions']:.1f} "
                  f"AvgDur={comp['avg_duration']:.1f} StdDev={comp['stdev']:.1f} MinDur={comp['min_duration']:.1f}")

    @staticmethod
    def print_summary(results: List[Dict]) -> None:
        """Print summary by difficulty level."""
        print("\n" + "="*180)
        print("SUMMARY BY DIFFICULTY")
        print("="*180)

        for difficulty in ['beginner', 'easy', 'medium', 'hard', 'expert']:
            songs = [r for r in results if r['recommended'] == difficulty]
            if songs:
                percentage = (len(songs) / len(results)) * 100
                print(f"\n{difficulty.upper()} ({len(songs)} songs, {percentage:.1f}%):")
                for song in songs:
                    change = f" [from {song['current_difficulty']}]" if song['current_difficulty'] != difficulty and song['current_difficulty'] != 'N/A' else ""
                    print(f"  • {song['title']:<38} {song['score']:>6.1f}{change}")

    @staticmethod
    def print_json(results: List[Dict]) -> None:
        """Print results as JSON."""
        print(json.dumps(results, indent=2))

    @staticmethod
    def print_changes(results: List[Dict]) -> None:
        """Print only songs that have changed."""
        changes = [r for r in results if r['current_difficulty'] != r['recommended'] and r['current_difficulty'] != 'N/A']

        if not changes:
            print("\n✓ No changes needed - all songs are correctly classified\n")
            return

        print("\n" + "="*180)
        print(f"CHANGES NEEDED ({len(changes)} songs)")
        print("="*180)

        for change in sorted(changes, key=lambda x: x['current_difficulty']):
            print(f"{change['title']:<40} {change['current_difficulty']:>10} → {change['recommended']:<10} (Score: {change['score']:.1f})")
        print()


def parse_weights(weight_strs: List[str]) -> Dict[str, float]:
    """Parse weight strings like 'length:25 range:25'."""
    weights = {}
    for weight_str in weight_strs:
        key, value = weight_str.split(':')
        weights[key.strip()] = float(value.strip())
    return weights


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description='Evaluate and score song difficulty with customizable weights',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Use default weights
  python3 evaluate_difficulty.py

  # Show current weights
  python3 evaluate_difficulty.py --show-weights

  # Custom weights (must sum to 100)
  python3 evaluate_difficulty.py --weights length:30 range:30 actions:20 avg_dur:15 stdev:3 min_dur:2

  # Evaluate specific songs
  python3 evaluate_difficulty.py --song baby-shark --song blue --output details

  # Show summary with changes
  python3 evaluate_difficulty.py --output summary

  # Update index.json with new ratings
  python3 evaluate_difficulty.py --update-index

  # Output as JSON
  python3 evaluate_difficulty.py --output json > results.json
        '''
    )

    parser.add_argument(
        '--weights',
        nargs='+',
        help='Custom weights (format: length:25 range:25 actions:15 avg_dur:15 stdev:10 min_dur:10)',
    )
    parser.add_argument(
        '--song',
        action='append',
        dest='songs',
        help='Specific song ID to evaluate (can be used multiple times)',
    )
    parser.add_argument(
        '--output',
        choices=['table', 'details', 'summary', 'changes', 'json'],
        default='table',
        help='Output format (default: table)',
    )
    parser.add_argument(
        '--update-index',
        action='store_true',
        help='Update index.json with new difficulty ratings',
    )
    parser.add_argument(
        '--show-weights',
        action='store_true',
        help='Show current weights and exit',
    )
    parser.add_argument(
        '--songs-dir',
        default='public/songs',
        help='Path to songs directory (default: public/songs)',
    )

    return parser.parse_args()


def main():
    """Main entry point."""
    args = parse_args()

    try:
        # Parse custom weights if provided
        weights = None
        if args.weights:
            weights = parse_weights(args.weights)

        # Initialize calculator
        calculator = DifficultyCalculator(weights=weights)

        # Show weights if requested
        if args.show_weights:
            print("\nCurrent weights:")
            for key, value in calculator.weights.items():
                print(f"  {key:<20}: {value:>3}%")
            print(f"  {'TOTAL':<20}: {sum(calculator.weights.values()):>3}%\n")
            return

        # Analyze songs
        print(f"✓ Analyzing songs from {args.songs_dir}...")
        analyzer = SongAnalyzer(args.songs_dir)
        all_songs = analyzer.analyze_all(f"{args.songs_dir}/index.json")

        if not all_songs:
            print("Error: No songs found to analyze")
            sys.exit(1)

        print(f"✓ Analyzed {len(all_songs)} songs")

        # Filter by specific song IDs if requested
        songs_to_evaluate = all_songs
        if args.songs:
            songs_to_evaluate = [s for s in all_songs if s['id'] in args.songs]
            if not songs_to_evaluate:
                print(f"Error: No matching songs found for IDs: {args.songs}")
                sys.exit(1)

        # Calculate difficulties
        print("✓ Calculating difficulty scores...")
        results = []
        for song in songs_to_evaluate:
            score, components = calculator.calculate_score(song, all_songs)
            difficulty = calculator.get_difficulty(score)

            results.append({
                'id': song['id'],
                'title': song['title'],
                'score': round(score, 1),
                'recommended': difficulty,
                'current_difficulty': song['current_difficulty'],
                'length': song['length'],
                'range_span': song['range_span'],
                'num_actions': song['num_actions'],
                'avg_duration': round(song['avg_duration'], 2),
                'min_duration': round(song['min_duration'], 2),
                'max_duration': round(song['max_duration'], 2),
                'duration_stdev': round(song['duration_stdev'], 2),
                'bpm': song['bpm'],
                'components': {k: round(v, 1) for k, v in components.items()},
            })

        # Sort by score
        results.sort(key=lambda x: x['score'])

        # Output results
        if args.output == 'table':
            ReportGenerator.print_table(results)
        elif args.output == 'details':
            ReportGenerator.print_details(results)
        elif args.output == 'summary':
            ReportGenerator.print_summary(results)
        elif args.output == 'changes':
            ReportGenerator.print_changes(results)
        elif args.output == 'json':
            ReportGenerator.print_json(results)

        # Update index if requested
        if args.update_index:
            print("\n✓ Updating index.json...")
            with open(f"{args.songs_dir}/index.json", 'r') as f:
                index = json.load(f)

            # Create mapping
            difficulty_map = {r['id']: r['recommended'] for r in results}

            # Update all songs in index
            for song in index:
                if song['id'] in difficulty_map:
                    song['difficulty'] = difficulty_map[song['id']]

            # Write back
            with open(f"{args.songs_dir}/index.json", 'w') as f:
                json.dump(index, f, indent=2)

            print(f"✓ Updated {len(results)} songs in index.json\n")

        print("✓ Done!\n")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()