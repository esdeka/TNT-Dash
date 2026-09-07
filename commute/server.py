#!/usr/bin/env python3
"""Personal TNT–Brussels North commute dashboard. Run: python server.py --port 3000
Without a key: anonymous and manual-only. With a private key: registered access and auto eligibility. Live feeds are cached at least a minute.
Public-feed safeguards: 80 upstream calls / rolling 24h and 4 / rolling minute.
The remaining headroom is reserved for timetable downloads and source checks.
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs
from datetime import datetime, timezone
import argparse, gzip, json, time, threading, os, shutil, subprocess
import rail
import delijn_live
from mobility_config import load_config

ROOT = Path(__file__).resolve().parent
CONFIG = load_config()
DL_CONFIG = delijn_live.load_config()
BASE = CONFIG.base
STATE_DIR = Path(os.environ.get('COMMUTE_STATE_DIR', str(ROOT / 'data')))
STATE_DIR.mkdir(parents=True, exist_ok=True)
STATE_PATH = STATE_DIR / 'live-state.json'
QUOTA_PATH = STATE_DIR / 'quota.json'
API_SLOTS = threading.BoundedSemaphore(2)
TTL = 60
STALE_AFTER = 120
LOCK = threading.Lock()
TIMETABLE = json.loads((ROOT / 'data' / 'timetable.json').read_text())
FEED_PATHS = {'stib':'datasets/stibmivb/rt/WaitingTimes', 'delijn':'gtfs/feed/delijn/rt/trip-update'}
ENDPOINTS = {op: BASE + path for op,path in FEED_PATHS.items()}
DL_STOPS = tuple(TIMETABLE['operators']['delijn']['stops'])

def public_access():
    return {**CONFIG.public(), 'delijnStopKeyConfigured':bool(DL_CONFIG.api_key),
            'delijnSource':'stop-api' if DL_CONFIG.api_key else 'bmc-gtfs-rt',
            'delijnDailyLimit':DL_CONFIG.daily_limit if DL_CONFIG.api_key else None}


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def save_json(path, data):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, separators=(',', ':')))
    tmp.replace(path)


def long_number(value):
    if isinstance(value, dict):
        return (int(value.get('high', 0)) << 32) + (int(value.get('low', 0)) & 0xffffffff)
    return int(value) if value is not None else None


def normalize(op, body, fetched_at):
    d = TIMETABLE['operators'][op]
    if op == 'stib':
        if not isinstance(body, dict) or not isinstance(body.get('results'), list):
            raise ValueError('Unexpected STIB waiting-time response')
        records = []
        lines = {v['line'] for v in d['routes'].values()}
        for row in body['results']:
            if row.get('pointid') not in d['stops'] or row.get('lineid') not in lines:
                continue
            pts = row.get('passingtimes', [])
            if isinstance(pts, str):
                pts = json.loads(pts)
            for p in pts:
                destination = p.get('destination', {})
                # End-of-service sentinel rows have no destination and are NOT departures.
                if not destination or not p.get('expectedArrivalTime'):
                    continue
                msg = p.get('message', {})
                if 'end of service' in str(msg).lower() or 'service terminé' in str(msg).lower():
                    continue
                records.append({'stop': row['pointid'], 'line': p.get('lineId', row['lineid']),
                                'destination': destination,
                                'time': datetime.fromisoformat(p['expectedArrivalTime'].replace('Z', '+00:00')).timestamp(),
                                'message': msg.get('en', '') if isinstance(msg, dict) else str(msg)})
        return {'ok': True, 'fetchedAt': fetched_at, 'feedTime': None,
                'timestampNote': 'STIB does not expose a feed-generation timestamp here; time shown is the fetch time.',
                'records': records, 'source': ENDPOINTS[op]}
    if not isinstance(body, dict) or 'header' not in body:
        raise ValueError('Unexpected De Lijn trip-update response')
    updates = {}
    for e in body.get('entity', []):
        u = e.get('tripUpdate', e.get('trip_update', {}))
        trip = u.get('trip', {})
        tid = trip.get('tripId', trip.get('trip_id'))
        if tid not in d['trips']:
            continue
        relevant = []
        for call in u.get('stopTimeUpdate', u.get('stop_time_update', [])):
            sid = call.get('stopId', call.get('stop_id'))
            if sid not in d['stops']:
                continue
            rec = {'stop': sid, 'seq': call.get('stopSequence', call.get('stop_sequence')),
                   'relationship': call.get('scheduleRelationship', call.get('schedule_relationship', 0))}
            occupancy=call.get('departureOccupancyStatus', call.get('departure_occupancy_status'))
            if occupancy is not None: rec['occupancyStatus']=occupancy
            for event in ['arrival', 'departure']:
                if event in call:
                    ev = call[event]
                    rec[event] = {}
                    if 'time' in ev:
                        rec[event]['time'] = long_number(ev['time'])
                    if 'delay' in ev:
                        rec[event]['delay'] = long_number(ev['delay'])
            relevant.append(rec)
        updates[tid] = {'date': trip.get('startDate', trip.get('start_date')),
                        'relationship': trip.get('scheduleRelationship', trip.get('schedule_relationship', 0)),
                        'timestamp': long_number(u.get('timestamp')), 'stops': relevant}
    return {'ok': True, 'fetchedAt': fetched_at,
            'feedTime': long_number(body.get('header', {}).get('timestamp')),
            'trips': updates, 'source': ENDPOINTS[op]}


def fetch_provider(op):
    if op == 'delijn' and DL_CONFIG.api_key:
        return op, delijn_live.fetch(DL_CONFIG, DL_STOPS)
    try:
        request = CONFIG.request(FEED_PATHS[op])
        with urlopen(request, timeout=18) as response:
            raw = response.read(25 * 1024 * 1024)
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            # The portal may deliver standard GTFS-RT protobuf rather than its JSON representation.
            if op != 'delijn':
                raise ValueError('Unexpected response format')
            from google.transit import gtfs_realtime_pb2
            from google.protobuf.json_format import MessageToDict
            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(raw)
            body = MessageToDict(feed, use_integers_for_enums=True)
        return op, normalize(op, body, time.time())
    except HTTPError as exc:
        body = exc.read(2048).decode(errors='replace').lower()
        if exc.code == 429 or 'quota' in body:
            kind = 'quota'
            message = 'Operator quota reached; using the timetable.'
        elif exc.code in (401,403) and CONFIG.api_key:
            kind = 'authentication'
            message = 'Registered API access was rejected; check the subscription/key. No anonymous fallback was attempted.'
        else:
            kind = 'upstream'
            message = f'Operator feed returned HTTP {exc.code}; using the timetable.'
    except Exception:
        kind = 'network'
        message = 'Live feed temporarily unavailable; using the timetable.'
    return op, {'ok': False, 'attemptedAt': time.time(), 'error': message, 'errorKind': kind}


STATE = load_json(STATE_PATH, {'providers': {}, 'lastAttempt': 0})

def migrate_quota(data):
    """Keep old anonymous usage. Registered usage must not exhaust its bucket."""
    if isinstance(data.get('buckets'), dict):
        buckets = {mode: {'calls': list((data['buckets'].get(mode) or {}).get('calls', []))}
                   for mode in ['anonymous','registered','delijn_stop']}
    else:
        buckets = {'anonymous': {'calls': list(data.get('calls', []))}, 'registered': {'calls': []}, 'delijn_stop': {'calls': []}}
    return {'version': 3, 'buckets': buckets}


QUOTA = migrate_quota(load_json(QUOTA_PATH, {'calls': []}))


def get_live(refresh=False, automatic=False):
    global STATE, QUOTA
    with LOCK:
        now = time.time()
        for bucket in QUOTA['buckets'].values():
            bucket['calls'] = [t for t in bucket.get('calls', []) if isinstance(t,(int,float)) and t > now - 86400]
        calls = QUOTA['buckets'][CONFIG.mode]['calls']
        dl_calls = QUOTA['buckets']['delijn_stop']['calls']
        bmc_cost = 1 if DL_CONFIG.api_key else 2
        message = None
        # Enforce this on the server too: stale/legacy browser tabs cannot
        # silently spend anonymous requests on an automatic timer.
        if refresh and automatic and not CONFIG.api_key:
            refresh = False
            message = 'Automatic live refresh requires an API key. Press Refresh for an anonymous manual check.'
        same_access = STATE.get('accessMode', 'anonymous') == CONFIG.mode and STATE.get('delijnSource', 'bmc-gtfs-rt') == public_access()['delijnSource']
        last_attempt = STATE.get('lastAttempt', 0) if same_access else 0
        age = now - last_attempt
        if refresh and age >= TTL:
            recent = sum(t > now - 60 for t in calls)
            if len(calls) + bmc_cost > CONFIG.daily_limit:
                message = 'Daily live-refresh allowance reached. Timetable departures remain available.'
            elif recent + bmc_cost > CONFIG.minute_limit:
                message = 'Please wait a minute before refreshing again.'
            elif DL_CONFIG.api_key and (len(dl_calls)+1>DL_CONFIG.daily_limit or sum(t>now-60 for t in dl_calls)+1>DL_CONFIG.minute_limit):
                message = 'De Lijn stop API allowance reached; using the timetable/cache.'
            else:
                calls.extend([now]*bmc_cost)
                if DL_CONFIG.api_key: dl_calls.append(now)
                save_json(QUOTA_PATH, QUOTA)
                STATE['lastAttempt'] = now
                STATE['accessMode'] = CONFIG.mode
                STATE['delijnSource'] = public_access()['delijnSource']
                with ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(pool.map(fetch_provider, ['stib', 'delijn']))
                for op, result in results:
                    STATE.setdefault('providers', {})[op] = result
                save_json(STATE_PATH, STATE)
                last_attempt = now
        elif refresh and age < TTL:
            message = 'Showing the shared cache. Live feeds can be refreshed once a minute.'
        return {**STATE, 'serverTime': time.time(), 'staleAfter': STALE_AFTER,
                'access': public_access(),
                'quota': {'mode': CONFIG.mode, 'used': len(calls), 'limit': CONFIG.daily_limit,
                          'refreshesLeft': max(0, min((CONFIG.daily_limit-len(calls))//bmc_cost, DL_CONFIG.daily_limit-len(dl_calls) if DL_CONFIG.api_key else CONFIG.daily_limit)),
                          'bmcCallsPerRefresh':bmc_cost,
                          'delijnStop':{'used':len(dl_calls),'limit':DL_CONFIG.daily_limit,'callsPerRefresh':1} if DL_CONFIG.api_key else None,
                          'nextRefreshAt': last_attempt + TTL},
                'notice': message}


def validate_api_query(query, train=False):
    if train or 'date' in query or 'time' in query:
        rail.validate_query(query.get('date'), query.get('time'))
    allowed = {'direction': {'toBN','toTNT'}, 'walking': {'0','1'}, 'shuttle': {'0','1'},
               'operator': {'all','shuttle','stib','delijn'}, 'stop': {'all','shuttle','picard','suzan','thurn'}}
    for key, values in allowed.items():
        if key in query and query[key] not in values:
            raise ValueError('Invalid ' + key)
    for key, lower, upper in [('horizon',30,2880), ('limit',1,20), ('margin',0,60)]:
        if key in query:
            try:
                value = int(query[key])
            except ValueError:
                raise ValueError(key + ' must be an integer') from None
            if not lower <= value <= upper:
                raise ValueError(f'{key} must be between {lower} and {upper}')


def engine_response(query, train=False):
    validate_api_query(query, train)
    node = shutil.which('node')
    if not node:
        return {'ok': False, 'error': 'The entities API requires Node.js 20+. The browser dashboard still works.'}, 503
    if not API_SLOTS.acquire(timeout=1):
        return {'ok': False, 'error': 'Planner busy; retry shortly.'}, 503
    try:
        # Read-only: polling for HA entities MUST NOT spend upstream API quota.
        payload = {'query': query, 'action': 'train' if train else 'next', 'now': time.time(), 'live': get_live(False)}
        run = subprocess.run([node, str(ROOT / 'api_cli.js')], input=json.dumps(payload),
                             capture_output=True, text=True, cwd=ROOT, timeout=8, check=True)
        return json.loads(run.stdout), 200
    except (subprocess.SubprocessError, ValueError):
        return {'ok': False, 'error': 'Could not calculate departures. Check the local timetable and server logs.'}, 500
    finally:
        API_SLOTS.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'CommuteDashboard/1.0'

    def send(self, body, content_type='application/json; charset=utf-8', status=200, cache='no-store'):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        if 'gzip' in self.headers.get('Accept-Encoding', '') and len(body) > 2048:
            body = gzip.compress(body, compresslevel=5)
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
        self.send_header('Content-Length', str(len(body)))
        # No frame/host/origin restrictions: Arena's HTTPS preview can embed this application.
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ('/', '/index.html'):
            html = (ROOT / 'Dashboard.html').read_text()
            html = html.replace('window.COMMUTE_SERVER = false;', 'window.COMMUTE_SERVER = true;')
            return self.send(html, 'text/html; charset=utf-8')
        if path == '/api/health':
            return self.send(json.dumps({'ok': True, 'app': 'Commute dashboard', 'timezone': 'Europe/Brussels', 'entitiesApiAvailable': bool(shutil.which('node')), 'access': public_access()}))
        if path == '/api/live':
            return self.send(json.dumps(get_live(refresh=False)))
        if path in ('/api/next', '/api/plan-train', '/api/trains'):
            try:
                query = {key: values[-1] for key, values in parse_qs(urlsplit(self.path).query).items()}
                if path == '/api/trains':
                    data, status = rail.get_board(query.get('date'), query.get('time'))
                else:
                    data, status = engine_response(query, train=path == '/api/plan-train')
            except (ValueError, TypeError) as exc:
                data, status = {'ok': False, 'error': str(exc)}, 400
            return self.send(json.dumps(data), status=status)
        docs = {'/docs/AGENTS.md': ROOT / 'AGENTS.md', '/docs/README.md': ROOT / 'README.md',
                **{'/docs/' + name: ROOT / 'docs' / name for name in
                   ['ARCHITECTURE.md','OPERATIONS.md','HOME_ASSISTANT.md','TRAIN_PLANNING.md','API.md','API_ACCESS.md','DELIJN_REALTIME.md','VERIFICATION.md']}}
        if path in docs and docs[path].exists():
            return self.send(docs[path].read_text(), 'text/plain; charset=utf-8')
        if path == '/shuttle.pdf':
            return self.send((ROOT / 'static' / 'shuttle.pdf').read_bytes(), 'application/pdf', cache='public, max-age=86400')
        if path == '/favicon.svg':
            return self.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="12" fill="#184e43"/><rect x="11" y="8" width="18" height="23" rx="4" fill="none" stroke="#d4f3c3" stroke-width="2.5"/><path d="M11 19h18M15 31v3m10-3v3M15 25h1m8 0h1" stroke="#d4f3c3" stroke-width="2.5"/></svg>', 'image/svg+xml')
        return self.send(json.dumps({'error': 'Not found'}), status=404)

    def do_POST(self):
        if urlsplit(self.path).path != '/api/live/refresh':
            return self.send(json.dumps({'error': 'Not found'}), status=404)
        # Missing/unknown mode is treated as automatic (fail closed for old tabs).
        automatic = self.headers.get('X-Commute-Refresh', '').strip().lower() != 'manual'
        return self.send(json.dumps(get_live(refresh=True, automatic=automatic)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=3000)
    args = parser.parse_args()
    print(f'Commute dashboard listening on 0.0.0.0:{args.port}', flush=True)
    ThreadingHTTPServer(('0.0.0.0', args.port), Handler).serve_forever()
