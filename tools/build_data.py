#!/usr/bin/env python3
"""Regenerate site/js/data/*.js from the canonical data/*.json files.

The page loads its data as plain scripts (window globals) rather than with
fetch(), so it also works when index.html is opened from file://. Run this
after editing data/walking.json or refreshing data/timetable.json.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {'timetable.json': ('timetable.js', '__TIMETABLE__'),
           'walking.json': ('walking.js', '__WALKING__')}


def main():
    out_dir = ROOT / 'site' / 'js' / 'data'
    out_dir.mkdir(parents=True, exist_ok=True)
    for source, (target, name) in TARGETS.items():
        text = (ROOT / 'data' / source).read_text(encoding='utf-8').strip()
        out = out_dir / target
        tmp = out.with_suffix('.tmp')
        tmp.write_text(f'window.{name}={text};\n', encoding='utf-8')
        tmp.replace(out)
        print(f'Wrote {out.relative_to(ROOT)} ({out.stat().st_size:,} bytes)')


if __name__ == '__main__':
    main()
