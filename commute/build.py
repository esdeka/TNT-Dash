#!/usr/bin/env python3
"""Build one self-contained HTML dashboard (fonts, schedule, PDF, code and styles).
The same file is served by server.py with live mode enabled, or opened standalone
(file:// or any static host): then browser-side direct API access takes over and
uses the keys embedded via COMMUTE_KEYS.

Key distribution (standalone direct access only; the server keeps reading its own
private key files). Default: keys stay OUT of the page — when BMC_API_KEY(_FILE) /
DELIJN_API_KEY(_FILE) are set, build.py writes a git-ignored Dashboard-secrets.js
next to Dashboard.html, loaded by a plain script tag (works from file:// too).
--embed-keys is the legacy single-file alternative; --no-embed-keys removes any
real key material for artifacts you may commit. Real key values must only live
where you alone can read them.
"""
from pathlib import Path
import argparse, base64, json, os, sys
ROOT = Path(__file__).resolve().parent

def read_key(environ, direct, file_var):
    key = str(environ.get(direct) or '').strip()
    if not key and environ.get(file_var):
        try:
            key = Path(environ[file_var]).read_text().strip()
        except OSError:
            raise ValueError(f'Cannot read the configured {file_var} secret file') from None
    return key

# Key distribution for standalone direct access. Preferred: a sibling
# Dashboard-secrets.js next to Dashboard.html (edit to rotate; git-ignored,
# never committed) — generated from your private key files when they are
# referenced in the environment. --embed-keys is the compatible single-file
# fallback (embeds INTO the page). A built Dashboard.html or secrets file
# containing keys must only be hosted where you alone can reach it.
SECRETS_EXAMPLE = """/* Optional: copy to Dashboard-secrets.js next to Dashboard.html to give the
   standalone page direct operator access without rebuilding. Manual entries
   made in the page (Reference -> API keys) take precedence over this file,
   which in turn takes precedence over any build-embedded keys. Keep the real
   file private: it is git-ignored and must never be committed or shared. */
window.COMMUTE_SECRETS = { bmc: "YOUR-BELGIAN-MOBILITY-KEY", delijn: "YOUR-DE-LIJN-KEY" };
"""
SECRETS_REAL = """/* Your private operator keys for standalone direct access. Loaded by
   Dashboard.html with a plain script tag (works on file:// as well as any
   static host). THIS FILE IS GIT-IGNORED: never commit, share or upload it
   anywhere you are not the only reader. */
window.COMMUTE_SECRETS = { bmc: __BMC__, delijn: __DELIJN__ };
"""

def write_secrets(keys):
    (ROOT / 'Dashboard-secrets.example.js').write_text(SECRETS_EXAMPLE, encoding='utf-8')
    text = SECRETS_REAL.replace('__BMC__', json.dumps(keys['bmc'])).replace('__DELIJN__', json.dumps(keys['delijn']))
    target = ROOT / 'Dashboard-secrets.js'
    if keys['bmc'] or keys['delijn']:
        tmp = target.with_suffix('.tmp')
        tmp.write_text(text, encoding='utf-8')
        tmp.replace(target)
        return 'written (git-ignored)'
    if target.exists():
        target.unlink()
    return 'not written'

def build(embed_keys=None):
    env = os.environ
    env_keys = {'bmc': read_key(env, 'BMC_API_KEY', 'BMC_API_KEY_FILE'),
                'delijn': read_key(env, 'DELIJN_API_KEY', 'DELIJN_API_KEY_FILE')}
    keys = env_keys if embed_keys else {'bmc': '', 'delijn': ''}
    if embed_keys is None:       # preferred: distribute keys via the sibling file
        secrets_note = write_secrets(env_keys)
    elif embed_keys is False:    # commit-safe: nothing with real values anywhere
        write_secrets({'bmc': '', 'delijn': ''})
        secrets_note = 'example only (real sibling removed)'
    else:                        # legacy single-file build
        (ROOT / 'Dashboard-secrets.example.js').write_text(SECRETS_EXAMPLE, encoding='utf-8')
        write_secrets({'bmc': '', 'delijn': ''})
        secrets_note = 'example only (keys embedded in page)'
    static = ROOT / 'static'
    html = (static / 'template.html').read_text()
    font = base64.b64encode((static / 'manrope-latin.woff2').read_bytes()).decode()
    css = ((static / 'style.css').read_text() + '\n' + (static / 'readability.css').read_text() + '\n' + (static / 'personal.css').read_text() + '\n' + (static / 'glance.css').read_text()).replace('__FONT__', font)
    logos = {op: 'data:image/png;base64,' + base64.b64encode((static / 'logos' / name).read_bytes()).decode()
             for op, name in {'delijn':'delijn.png','stib':'mivb.png','shuttle':'tnt.png'}.items()}
    replacements = {
        '/*__LIVE_KEYS__*/': json.dumps(keys),
        '/*__STYLES__*/': css,
        '/*__TIMETABLE__*/': (ROOT / 'data' / 'timetable.json').read_text().replace('</', '<\\/'),
        '/*__WALKING__*/': (ROOT / 'data' / 'walking.json').read_text().replace('</', '<\\/'),
        '/*__LOGOS__*/': json.dumps(logos),
        '/*__PDF__*/': json.dumps(base64.b64encode((static / 'shuttle.pdf').read_bytes()).decode()),
        '/*__ENGINE__*/': (static / 'engine.js').read_text().replace('</script', '<\\/script'),
        '/*__LIVE_DIRECT__*/': (static / 'live-direct.js').read_text().replace('</script', '<\\/script'),
        '/*__REFERENCE__*/': (static / 'reference.js').read_text().replace('</script', '<\\/script'),
        '/*__APP__*/': (static / 'app.js').read_text().replace('</script', '<\\/script')
    }
    for marker, text in replacements.items():
        if marker not in html:
            raise ValueError('Missing template marker: ' + marker)
        html = html.replace(marker, text)
    output = ROOT / 'Dashboard.html'
    tmp = output.with_suffix('.tmp')
    tmp.write_text(html, encoding='utf-8')
    tmp.replace(output)
    embedded = 'BMC+De Lijn keys' if keys['bmc'] and keys['delijn'] else 'De Lijn key only' if keys['delijn'] else 'BMC key only' if keys['bmc'] else 'none (secrets sibling/browser storage)'
    print(f'Built {output.name}: {output.stat().st_size:,} bytes; no external assets required; embedded keys: {embedded}; secrets file: {secrets_note}.')
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--embed-keys', dest='embed', action='store_true', default=None,
                       help='embed the configured private API keys into the built page (private hosting only)')
    group.add_argument('--no-embed-keys', dest='embed', action='store_false',
                       help='never embed keys, suitable for commits and sharing')
    args = parser.parse_args()
    build(embed_keys=args.embed)
