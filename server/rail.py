"""Read-only, on-demand Brussels North train board via iRail.

The station identifier was verified against iRail /liveboard on 2026-09-05.
No booking, ticketing, platform routing, background polling or fictional trains.
Each distinct date/time has a minimum 60s cache; at most 20 upstream calls/min.
This is a separate service/budget from the Belgian Mobility bus APIs.
"""
from collections import deque
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError
import json
import os
import re
import threading
import time

STATION_ID = 'BE.NMBS.008812005'
ENDPOINT = 'https://api.irail.be/liveboard/'
USER_AGENT = os.environ.get('IRAIL_USER_AGENT', 'PersonalCommuteDashboard/1.0 (private commute planner)')
LOCK = threading.Lock()
CACHE = {}
CALLS = deque()


def validate_query(date, clock):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date or ''):
        raise ValueError('Use a date in YYYY-MM-DD format.')
    if not re.fullmatch(r'\d{2}:\d{2}', clock or ''):
        raise ValueError('Use a time in HH:MM format.')
    dt = datetime.strptime(date + ' ' + clock, '%Y-%m-%d %H:%M')
    if not 2020 <= dt.year <= 2099:
        raise ValueError('Train-board dates must be between 2020 and 2099.')
    return dt


def normalize_board(body, date, clock, fetched_at):
    station = body.get('stationinfo', {})
    if station.get('id') != STATION_ID:
        raise ValueError('The provider response is not for Brussels North.')
    departures = body.get('departures', {}).get('departure', [])
    if not isinstance(departures, list):
        raise ValueError('Unexpected train departure-board format.')
    rows = []
    for d in departures:
        try:
            scheduled = int(d['time'])
            delay = int(d.get('delay', 0))
            vehicle = d.get('vehicleinfo', {}).get('shortname') or d.get('vehicle', '').replace('BE.NMBS.', '')
            if not vehicle or scheduled <= 0:
                continue
            rows.append({
                'id': d.get('departureConnection') or f'{vehicle}@{scheduled}',
                'service': vehicle, 'vehicleId': d.get('vehicle'),
                'destination': d.get('station', 'Destination not supplied'),
                'destinationId': d.get('stationinfo', {}).get('id'),
                'scheduledDeparture': scheduled, 'expectedDeparture': scheduled + delay,
                'delaySeconds': delay, 'platform': str(d.get('platform') or '?'),
                'platformChanged': str(d.get('platforminfo', {}).get('normal', '1')) == '0',
                'cancelled': str(d.get('canceled', '0')) == '1',
                'left': str(d.get('left', '0')) == '1', 'source': 'irail',
                'fetchedAt': fetched_at
            })
        except (TypeError, ValueError, KeyError):
            continue
    return {'ok': True, 'source': 'iRail · SNCB/NMBS train information',
            'sourceUrl': ENDPOINT, 'station': station,
            'date': date, 'time': clock, 'fetchedAt': fetched_at,
            'feedTime': int(body.get('timestamp') or fetched_at),
            'departures': sorted(rows, key=lambda r: (r['scheduledDeparture'], r['service']))}


def get_board(date, clock):
    dt = validate_query(date, clock)
    key = (date, clock)
    with LOCK:
        now = time.time()
        # Cache keys are bounded: a public client cannot grow this without limit.
        for old_key in list(CACHE):
            if CACHE[old_key]['expires'] < now - 3600:
                del CACHE[old_key]
        cached = CACHE.get(key)
        if cached and now < cached['expires']:
            return {**cached['data'], 'cached': True}, 200 if cached['data']['ok'] else 502
        while CALLS and CALLS[0] < now - 60:
            CALLS.popleft()
        if len(CALLS) >= 20 or (CALLS and now - CALLS[-1] < 1):
            return {'ok': False, 'error': 'Please wait before loading another train board.', 'departures': []}, 429
        CALLS.append(now)
        params = {'id': STATION_ID, 'format': 'json', 'lang': 'en', 'arrdep': 'departure',
                  'date': dt.strftime('%d%m%y'), 'time': dt.strftime('%H%M'), 'alerts': 'false'}
        try:
            request = Request(ENDPOINT + '?' + urlencode(params), headers={
                'Accept': 'application/json', 'User-Agent': USER_AGENT})
            with urlopen(request, timeout=18) as response:
                body = json.loads(response.read(4 * 1024 * 1024))
                cache_header = response.headers.get('Cache-Control', '')
            max_age = re.search(r'max-age=(\d+)', cache_header, re.I)
            ttl = max(60, int(max_age.group(1))) if max_age else 60
            data = normalize_board(body, date, clock, time.time())
            status = 200
        except HTTPError as exc:
            data = {'ok': False, 'departures': [], 'error':
                    f'iRail returned HTTP {exc.code}. Try another date/time, or enter the train departure manually.'}
            ttl, status = 60, 502
        except Exception:
            data = {'ok': False, 'departures': [], 'error':
                    'Train board unavailable. Try again later or enter the train departure manually.'}
            ttl, status = 60, 502
        CACHE[key] = {'data': data, 'expires': time.time() + ttl}
        if len(CACHE) > 80:
            del CACHE[next(iter(CACHE))]
        return {**data, 'cached': False}, status
