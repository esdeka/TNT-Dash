"""Supported De Lijn Open Data v1 stop-level real-time connector.

Uses the user's own De Lijn key, not BMC credentials, website cookies or a key
found online. The documented multi-stop endpoint makes one bounded batch call.
Docs: https://data.delijn.be/api-details#api=kernopendataservicesv1&operation=get-haltes-lijst-haltesleutels-real-time
"""
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from zoneinfo import ZoneInfo
import json
import os
import re
import time

BASE = 'https://api.delijn.be/DLKernOpenData/api/v1/'
ZONE = ZoneInfo('Europe/Brussels')


@dataclass(frozen=True)
class DeLijnConfig:
    api_key: str = field(default='', repr=False)
    daily_limit: int = 10000
    minute_limit: int = 4

    def request(self, stops):
        if not self.api_key:
            raise ValueError('Configure your own De Lijn API key to use stop real-time')
        codes = sorted({str(s).replace('gs:delijn:', '') for s in stops})
        if not codes or len(codes) > 20 or any(not re.fullmatch(r'3\d{5}', s) for s in codes):
            raise ValueError('Only the configured Brussels corridor stops are supported')
        # Documented alternating entity_stop keys; all current corridor stops
        # belong to entity 3. Do not infer this for arbitrary future stops.
        keys = '_'.join('3_' + code for code in codes)
        req = Request(BASE + 'haltes/lijst/' + keys + '/real-time?maxAantalDoorkomsten=50',
                      headers={'Accept':'application/json','User-Agent':'PersonalCommuteDashboard/1.4'})
        req.add_unredirected_header('Ocp-Apim-Subscription-Key', self.api_key)
        return req


def load_config(environ=None):
    env = os.environ if environ is None else environ
    key = str(env.get('DELIJN_API_KEY') or '').strip()
    if not key and env.get('DELIJN_API_KEY_FILE'):
        try:
            key = Path(env['DELIJN_API_KEY_FILE']).read_text().strip()
        except OSError:
            raise ValueError('Cannot read the configured De Lijn key file') from None
    try:
        limit = int(env.get('DELIJN_DAILY_LIMIT') or 10000)
    except ValueError:
        raise ValueError('DELIJN_DAILY_LIMIT must be an integer') from None
    if not 1 <= limit <= 864000:
        raise ValueError('Set DELIJN_DAILY_LIMIT within your assigned subscription quota')
    return DeLijnConfig(key, limit)


def timestamp(value):
    if not isinstance(value, str) or not re.search(r'[T ]\d{2}:\d{2}', value):
        return None  # Date-only documentation examples are not actual departures.
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZONE)
        return dt.timestamp()
    except ValueError:
        return None


def status_values(value):
    if isinstance(value, list):
        return {str(x).upper() for x in value}
    if isinstance(value, str):
        return set(re.findall(r'[A-Z]+', value.upper()))
    return set()


def normalize(body, stops, fetched_at):
    if not isinstance(body, dict) or not any(k in body for k in ['halteDoorkomstenLijst','halteDoorkomsten']):
        raise ValueError('Unexpected De Lijn stop API response')
    allowed = {str(x).replace('gs:delijn:', '') for x in stops}
    blocks = body.get('halteDoorkomstenLijst') if 'halteDoorkomstenLijst' in body else [body]
    if not isinstance(blocks, list):
        raise ValueError('Unexpected De Lijn stop list')
    records=[]; rejected=0; total=0
    for block in blocks:
        for group in block.get('halteDoorkomsten', []):
            group_stop = str(group.get('haltenummer') or '')
            for call in group.get('doorkomsten', []):
                stop = str(call.get('haltenummer') or group_stop)
                if stop not in allowed:
                    continue
                total += 1
                planned = timestamp(call.get('dienstregelingTijdstip'))
                actual = timestamp(call.get('doorkomstTijdstip') or call.get('real-timeTijdstip'))
                if planned is None:
                    rejected += 1
                    continue
                statuses = status_values(call.get('predictionStatussen'))
                passage_id = str(call.get('doorkomstId') or '')
                match = re.match(r'^(\d{4}-\d{2}-\d{2})_(\d+)_(\d+)_', passage_id)
                cancelled = str(call.get('status','')).upper() in ['CANCELLED','CANCELED'] or 'GESCHRAPT' in statuses
                records.append({'stop':'gs:delijn:'+stop, 'id':passage_id,
                    'journeyId': '_'.join(match.groups()) if match else None,
                    'lineCode':match.group(2) if match else None,
                    'lineNumber':str(call.get('lijnnummer') or ''), 'entity':str(call.get('entiteitnummer') or '3'),
                    'journeyNumber':match.group(3) if match else str(call.get('ritnummer') or ''),
                    'serviceDate':match.group(1) if match else None,
                    'planned':planned, 'expected':actual if 'REALTIME' in statuses else None,
                    'realtime':'REALTIME' in statuses and actual is not None,
                    'cancelled':cancelled, 'passed':'VERSTREKEN' in statuses,
                    'vehicleId':str(call.get('vrtnum') or ''),
                    'destination':call.get('bestemmingKort') or call.get('bestemming') or '',
                    'statuses':sorted(statuses)})
    if total and not records:
        raise ValueError('No usable date/time values in De Lijn stop response')
    records=list({json.dumps(r,sort_keys=True):r for r in records}.values())
    return {'ok':True,'kind':'stop-api','fetchedAt':fetched_at,'feedTime':None,
            'source':BASE+'haltes/lijst/{configured-stop-keys}/real-time',
            'records':records,'recordCount':len(records),'liveRecordCount':sum(r['realtime'] for r in records),
            'rejectedRecords':rejected,'timestampNote':'Age is measured from the stop API retrieval time.'}


def fetch(config, stops):
    try:
        req=config.request(stops)
        with urlopen(req,timeout=18) as response:
            body=json.loads(response.read(6*1024*1024))
        return normalize(body,stops,time.time())
    except HTTPError as exc:
        kind='authentication' if exc.code in (401,403) else 'quota' if exc.code==429 else 'upstream'
        message='De Lijn stop API rejected access; check the separate De Lijn subscription key.' if kind=='authentication' else 'De Lijn stop real-time unavailable; timetable fallback.'
    except Exception:
        kind='network';message='De Lijn stop real-time unavailable or response not usable; timetable fallback.'
    return {'ok':False,'kind':'stop-api','attemptedAt':time.time(),'errorKind':kind,'error':message}
