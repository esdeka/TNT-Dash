#!/usr/bin/env python3
"""Download official GTFS, retaining direct neighbourhood-stop ↔ BN bus trips.
Run: python refresh_schedules.py [--cached] [--operators stib delijn]
Large ZIPs are stored in .cache (not in the deliverable). Only the compact subset persists.
Uses one public API request per selected operator when downloading; obey BMC quota.
"""
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
import csv, io, zipfile, re, json, sys, urllib.request, email.utils, os, argparse
from mobility_config import load_config

ROOT = Path(__file__).resolve().parent
CACHE = Path(os.environ.get('COMMUTE_GTFS_CACHE', str(ROOT.parent / '.cache' / 'transit')))
DATA = ROOT / 'data'
CONFIG = load_config()
BASE = CONFIG.base
CACHE.mkdir(parents=True, exist_ok=True)
DATA.mkdir(exist_ok=True)

def seconds(value):
    h, m, s = map(int, value.strip().split(':'))
    return h * 3600 + m * 60 + s

def refresh(cached=False, operators=None):
    selected = set(operators or ['stib', 'delijn'])
    if not selected or not selected <= {'stib', 'delijn'}:
        raise ValueError('Choose stib and/or delijn')
    existing = DATA / 'timetable.json'
    output = json.loads(existing.read_text()) if existing.exists() else {'version': 1, 'timezone': 'Europe/Brussels', 'operators': {}}
    output['generatedAt'] = datetime.now(timezone.utc).isoformat()
    # A targeted import must preserve the other provider's snapshot exactly.
    for op, agency in [('stib', 'stibmivb'), ('delijn', 'delijn')]:
        if op not in selected:
            continue
        path = CACHE / f'{op}.zip'
        url = BASE + f'gtfs/feed/{agency}/static'
        if not cached or not path.exists():
            print('Downloading', op, flush=True)
            req = CONFIG.request(f'gtfs/feed/{agency}/static', accept='application/zip')
            with urllib.request.urlopen(req, timeout=180) as r, path.open('wb') as f:
                headers = dict(r.headers)
                while chunk := r.read(1024 * 1024):
                    f.write(chunk)
            meta = {'source': url, 'fetched_at': datetime.now(timezone.utc).isoformat(), 'headers': headers}
            path.with_suffix('.zip.meta.json').write_text(json.dumps(meta))
        meta_path = path.with_suffix('.zip.meta.json')
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        z = zipfile.ZipFile(path)
        def rows(name):
            return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig', newline=''))
        all_stops = {s['stop_id']: s for s in rows('stops.txt')}
        stops = {}
        for sid, s in all_stops.items():
            n = s['stop_name'].upper()
            group = ('picard' if n in ('PICARD', 'BRUSSEL PICARD') else
                     'suzan' if n.startswith('BRUSSEL SUZAN DANIEL') or n == 'SUZAN DANIEL' else
                     'thurn' if op == 'stib' and re.sub(r'[^A-Z0-9]', '', n) in ('TOURETTAXIS', 'THURNENTAXIS', 'THURNTAXIS') else
                     'bn' if n == 'GARE DU NORD' or n.startswith('BRUSSEL NOORD ') else None)
            if group and s.get('location_type') != '1':
                stops[sid] = {'name': s['stop_name'], 'group': group,
                              'lat': float(s['stop_lat']), 'lon': float(s['stop_lon']),
                              'code': s.get('stop_code') or sid,
                              'url': s.get('stop_url') or 'https://www.stib-mivb.be/'}
        pattern = re.compile(rb',(?:"?)(?:' + b'|'.join(re.escape(s.encode()) for s in stops) + rb')(?:"?),')
        calls = defaultdict(list)
        print('Scanning stop times', op, flush=True)
        with z.open('stop_times.txt') as f:
            header = f.readline().decode('utf-8-sig')
            fields = next(csv.reader([header]))
            col = {k: fields.index(k) for k in fields}
            for raw in f:
                if not pattern.search(raw):
                    continue
                r = next(csv.reader([raw.decode('utf-8')]))
                sid = r[col['stop_id']]
                if sid not in stops:
                    continue
                calls[r[col['trip_id']]].append({
                    'stop': sid, 'seq': int(r[col['stop_sequence']]),
                    'arr': seconds(r[col['arrival_time']]), 'dep': seconds(r[col['departure_time']]),
                    'pickup': r[col['pickup_type']] if 'pickup_type' in col else '0',
                    'dropoff': r[col['drop_off_type']] if 'drop_off_type' in col else '0'
                })
        all_routes = {r['route_id']: r for r in rows('routes.txt')}
        wanted = {tid for tid, cs in calls.items() if
                  any(stops[c['stop']]['group'] == 'bn' for c in cs) and
                  any(stops[c['stop']]['group'] != 'bn' for c in cs)}
        trips = {}
        for t in rows('trips.txt'):
            if t['trip_id'] in wanted and all_routes[t['route_id']]['route_type'] == '3':
                trips[t['trip_id']] = t
        legs, trip_info, used_routes, services, used_stops = [], {}, set(), set(), set()
        for tid, t in trips.items():
            cs = sorted(calls[tid], key=lambda c: c['seq'])
            for a in cs:
                if a['pickup'] not in ('', '0'):
                    continue
                for b in cs:
                    if b['seq'] <= a['seq'] or b['dropoff'] not in ('', '0'):
                        continue
                    ga, gb = stops[a['stop']]['group'], stops[b['stop']]['group']
                    if (ga == 'bn') == (gb == 'bn'):
                        continue
                    if not 0 <= b['arr'] - a['dep'] <= 3600:
                        continue
                    legs.append([tid, a['stop'], b['stop'], a['dep'], b['arr'], a['seq'], b['seq']])
                    trip_info[tid] = [t['route_id'], t['service_id'], t['trip_headsign']]
                    used_routes.add(t['route_id'])
                    services.add(t['service_id'])
                    used_stops.update((a['stop'], b['stop']))
        cal = [r for r in rows('calendar.txt') if r['service_id'] in services]
        exceptions = [r for r in rows('calendar_dates.txt') if r['service_id'] in services]
        info = next(rows('feed_info.txt'))
        routes = {rid: {'line': all_routes[rid]['route_short_name'],
                        'name': all_routes[rid]['route_long_name'],
                        'color': all_routes[rid].get('route_color', ''),
                        'url': all_routes[rid].get('route_url', '')}
                  for rid in used_routes}
        headers = {k.lower(): v for k, v in meta.get('headers', {}).items()}
        output['operators'][op] = {
            'name': 'MIVB / STIB' if op == 'stib' else 'De Lijn',
            'stopScopeVersion': 2 if op == 'stib' else 1,
            'feedStart': info['feed_start_date'].strip(), 'feedEnd': info['feed_end_date'].strip(),
            'feedVersion': info.get('feed_version'), 'sourceUrl': url,
            'fetchedAt': meta.get('fetched_at'), 'lastModified': headers.get('last-modified'),
            'attribution': f"Source: {'STIB-MIVB' if op == 'stib' else 'De Lijn'} – Open Data – {headers.get('last-modified', output['generatedAt'])}. Direct-trip subset adapted for the personal commute dashboard. CC BY 4.0.",
            'stops': {sid: stops[sid] for sid in used_stops}, 'routes': routes,
            'trips': trip_info, 'legs': legs, 'calendar': cal, 'exceptions': exceptions
        }
        print(op, len(trip_info), 'trips', len(legs), 'boarding options',
              'lines', sorted({v['line'] for v in routes.values()}),
              'stops', {sid: stops[sid]['name'] for sid in used_stops}, flush=True)
    tmp = DATA / 'timetable.tmp'
    tmp.write_text(json.dumps(output, separators=(',', ':')), encoding='utf-8')
    tmp.replace(DATA / 'timetable.json')
    print('Saved', (DATA / 'timetable.json').stat().st_size, 'bytes', flush=True)
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cached', action='store_true', help='Reuse selected downloaded archives; download if missing')
    parser.add_argument('--operators', nargs='+', choices=['stib','delijn'], default=['stib','delijn'], help='Import selected providers and preserve all others')
    args = parser.parse_args()
    refresh(cached=args.cached, operators=args.operators)
