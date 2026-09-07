#!/usr/bin/env python3
"""Build distribution archives from the current source. Does not reset runtime state.
Generated archives are written beside the commute/ project, never recursively inside it.
The HA app receives a copy of runtime code/data/assets; ha_app/ remains a template,
not a second maintained implementation of the dashboard.
"""
from pathlib import Path
import zipfile, os
from build import build

ROOT = Path(__file__).resolve().parent
EXCLUDED = {'__pycache__','node_modules','.git','.cache','.venv','.secrets','.pytest_cache','.ruff_cache','.mypy_cache','.npm','.next','build','dist','coverage'}
SECRET_OR_RUNTIME = {'quota.json','live-state.json','font-source.css','secrets.yaml','.netrc','.git-credentials','.npmrc','.pypirc','credentials.json','bmc_api_key','delijn_api_key','api-key.txt','options.json'}
RUNTIME_FILES = ['server.py','mobility_config.py','delijn_live.py','rail.py','api_cli.js','build.py','refresh_schedules.py','requirements.txt','Dashboard.html','AGENTS.md','README.md']


def keep(path):
    for variable in ['BMC_API_KEY_FILE','DELIJN_API_KEY_FILE']:
        configured_secret = os.environ.get(variable)
        if configured_secret and (ROOT / path).resolve() == Path(configured_secret).resolve():
            return False
    return (not any(p in EXCLUDED for p in path.parts) and path.name not in SECRET_OR_RUNTIME
            and not (path.name.startswith('.env') and path.name not in {'.env.example','.env.template'})
            and path.suffix not in {'.pyc','.tmp'})


def package():
    build()
    source = ROOT.parent / 'Commute-dashboard-project.zip'
    app = ROOT.parent / 'Commute-HAOS-app.zip'
    with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(ROOT.rglob('*')):
            if p.is_file() and keep(p.relative_to(ROOT)):
                z.write(p,Path('commute') / p.relative_to(ROOT))
    with zipfile.ZipFile(app,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name in ['config.yaml','Dockerfile','run.py']:
            z.write(ROOT/'ha_app'/name,Path('commute_dashboard')/name)
        z.write(ROOT/'docs/HOME_ASSISTANT.md','commute_dashboard/DOCS.md')
        for name in RUNTIME_FILES:
            z.write(ROOT/name,Path('commute_dashboard/app')/name)
        for p in sorted((ROOT/'home_assistant').rglob('*')):
            if p.is_file() and keep(p.relative_to(ROOT)):
                z.write(p,Path('commute_dashboard')/p.relative_to(ROOT))
        for folder in ['static','data','docs']:
            for p in sorted((ROOT/folder).rglob('*')):
                if p.is_file() and keep(p.relative_to(ROOT)):
                    z.write(p,Path('commute_dashboard/app')/p.relative_to(ROOT))
    for p in [source,app]:
        print(f'{p.name}: {p.stat().st_size:,} bytes')
    return source,app


if __name__ == '__main__':
    package()
