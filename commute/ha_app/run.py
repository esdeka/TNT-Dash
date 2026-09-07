"""HA OS entrypoint. GTFS refresh is opt-in; runtime quota is never reset.

Choose compatible data per provider. A newer cached dataset made by the old
STIB extractor must not mask the new Thurn en Taxis / 88 stop scope on upgrade.
"""
from pathlib import Path
import copy
import json
import os
import subprocess
import sys

APP = Path('/app')
PERSISTENT = Path('/data/timetable.json')
BUNDLED = APP / 'data/timetable.json'


def load(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def select_timetable(bundled, persistent):
    """Preserve newer compatible providers, never restore a narrower stop scope."""
    selected = copy.deepcopy(bundled)
    for op, current in bundled['operators'].items():
        saved = (persistent or {}).get('operators', {}).get(op)
        if not saved:
            continue
        compatible = int(saved.get('stopScopeVersion', 1)) >= int(current.get('stopScopeVersion', 1))
        newer = str(saved.get('fetchedAt') or '') > str(current.get('fetchedAt') or '')
        if compatible and newer:
            selected['operators'][op] = copy.deepcopy(saved)
    return selected


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, separators=(',', ':')))
    tmp.replace(path)


def main():
    bundled = load(BUNDLED)
    if not bundled or not bundled.get('operators'):
        raise RuntimeError('The bundled timetable is missing or invalid')
    save(BUNDLED, select_timetable(bundled, load(PERSISTENT)))
    options = load(Path('/data/options.json')) or {}
    if str(options.get('bmc_api_key') or '').strip():
        os.environ['BMC_API_KEY'] = str(options['bmc_api_key']).strip()
    if str(options.get('delijn_api_key') or '').strip():
        os.environ['DELIJN_API_KEY'] = str(options['delijn_api_key']).strip()
    if options.get('delijn_daily_limit') is not None:
        os.environ['DELIJN_DAILY_LIMIT'] = str(options['delijn_daily_limit'])
    if options.get('bmc_auth_daily_limit') is not None:
        os.environ['BMC_AUTH_DAILY_LIMIT'] = str(options['bmc_auth_daily_limit'])
    if str(options.get('bmc_auth_base') or '').strip():
        os.environ['BMC_AUTH_BASE'] = str(options['bmc_auth_base']).strip()
    if options.get('refresh_schedules_on_start', False):
        print('Requested GTFS refresh: two downloads, including about 217 MB for De Lijn. This may take several minutes.', flush=True)
        try:
            subprocess.run([sys.executable, 'refresh_schedules.py'], cwd=APP, check=True)
        except subprocess.CalledProcessError:
            print('GTFS refresh failed. Keeping the last complete timetable; inspect coverage in the dashboard.', flush=True)
    save(PERSISTENT, load(BUNDLED))
    subprocess.run([sys.executable, 'build.py'], cwd=APP, check=True)
    os.chdir(APP)
    os.execv(sys.executable, [sys.executable, 'server.py', '--port', '3000'])


if __name__ == '__main__':
    main()
