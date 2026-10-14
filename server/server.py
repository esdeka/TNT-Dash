#!/usr/bin/env python3
"""Personal TNT–Brussels North commute dashboard. Run: python server/server.py --port 3000
Serves the static site/ folder with server-side live access and the JSON API.
Without a key: anonymous and manual-only. With a private key: registered access and auto eligibility. Live feeds are cached at least a minute.
Public-feed safeguards: 80 upstream calls / rolling 24h and 4 / rolling minute.
The remaining headroom is reserved for timetable downloads and source checks.
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs, unquote
from datetime import datetime, timezone
import argparse, gzip, json, mimetypes, time, os, threading
import rail
import delijn_live
from mobility_config import load_config

SERVER_DIR = Path(__file__).resolve().parent
ROOT = SERVER_DIR.parent
SITE = ROOT / 'site'
# Never serve browser-side key files: in server mode keys stay on the server.
PRIVATE_SITE_FILES = {'Dashboard-secrets.js'}
CONFIG = load_config()
DL_CONFIG = delijn_live.load_config()
BASE = CONFIG.base
STATE_DIR = Path(os.environ.get('COMMUTE_STATE_DIR', str(SERVER_DIR / 'state')))
STATE_DIR.mkdir(parents=True, exist_ok=True)
STATE_PATH = STATE_DIR / 'live-state.json'
QUOTA_PATH = STATE_DIR / 'quota.json'
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
    # The De Lijn stop API is a bonus over the BMC feed: a wrong, empty or
    # rejected De Lijn value must never take the corridor's live data down,
    # so its failure falls through to the BMC GTFS-RT attempt with the BMC key.
    stop_failure = None
    if op == 'delijn' and DL_CONFIG.api_key:
        stop_data = delijn_live.fetch(DL_CONFIG, DL_STOPS)
        if stop_data.get('ok'):
            return op, stop_data
        stop_failure = {'kind': stop_data.get('errorKind'), 'message': stop_data.get('error')}
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
        result = normalize(op, body, time.time())
        if stop_failure:
            result['stopApiFallback'] = stop_failure
        return op, result
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
    if op == 'delijn' and stop_failure:
        # The stop API was attempted first: surface its more actionable error.
        return op, {'ok': False, 'kind': 'stop-api', 'attemptedAt': time.time(),
                    'error': stop_failure['message'], 'errorKind': stop_failure['kind']}
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
                # A stop-API call that fell back to the BMC GTFS-RT feed spent
                # one extra Belgian Mobility call beyond the planned bmc_cost.
                if any(op == 'delijn' and result.get('stopApiFallback') for op, result in results):
                    calls.append(now)
                    save_json(QUOTA_PATH, QUOTA)
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
            html = (SITE / 'index.html').read_text(encoding='utf-8')
            html = html.replace('window.COMMUTE_SERVER = false;', 'window.COMMUTE_SERVER = true;')
            html = html.replace('<script src="./Dashboard-secrets.js" onerror="void 0"></script>', '')
            return self.send(html, 'text/html; charset=utf-8')
        if path == '/api/health':
            return self.send(json.dumps({'ok': True, 'app': 'Commute dashboard', 'timezone': 'Europe/Brussels', 'access': public_access()}))
        if path == '/api/live':
            return self.send(json.dumps(get_live(refresh=False)))
        if path == '/api/trains':
            try:
                query = {key: values[-1] for key, values in parse_qs(urlsplit(self.path).query).items()}
                data, status = rail.get_board(query.get('date'), query.get('time'))
            except (ValueError, TypeError) as exc:
                data, status = {'ok': False, 'error': str(exc)}, 400
            return self.send(json.dumps(data), status=status)
        docs = {'/docs/AGENTS.md': ROOT / 'AGENTS.md', '/docs/README.md': ROOT / 'README.md',
                **{'/docs/' + name: ROOT / 'docs' / name for name in
                   ['ARCHITECTURE.md','OPERATIONS.md','TRAIN_PLANNING.md','API.md','API_ACCESS.md','DELIJN_REALTIME.md','VERIFICATION.md']}}
        if path in docs and docs[path].exists():
            return self.send(docs[path].read_text(), 'text/plain; charset=utf-8')
        if path == '/favicon.svg':
            return self.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="12" fill="#184e43"/><rect x="11" y="8" width="18" height="23" rx="4" fill="none" stroke="#d4f3c3" stroke-width="2.5"/><path d="M11 19h18M15 31v3m10-3v3M15 25h1m8 0h1" stroke="#d4f3c3" stroke-width="2.5"/></svg>', 'image/svg+xml')
        static = self.site_file(path)
        if static:
            content_type = mimetypes.guess_type(static.name)[0] or 'application/octet-stream'
            if content_type.startswith('text/') or content_type.endswith('javascript'):
                content_type += '; charset=utf-8'
            return self.send(static.read_bytes(), content_type, cache='no-cache')
        return self.send(json.dumps({'error': 'Not found'}), status=404)

    @staticmethod
    def site_file(path):
        """Map a URL path to a file inside site/, refusing traversal and key files."""
        try:
            target = (SITE / unquote(path).lstrip("/")).resolve()
        except (OSError, ValueError):
            return None
        if not target.is_relative_to(SITE.resolve()) or not target.is_file() or target.name in PRIVATE_SITE_FILES:
            return None
        return target

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
