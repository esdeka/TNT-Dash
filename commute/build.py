#!/usr/bin/env python3
"""Build the dashboard in two shapes, from the same template and sources:
- Dashboard.html: one self-contained file (fonts, schedule, PDF, code and
  styles inlined). Served by server.py with live mode enabled, or opened
  standalone (file:// or any static host) with browser-side direct access.
- site/: a standard multi-file static website (index.html + assets/*.css,
  images, PDF + js/*.js). Same page, same code; data ships as window globals
  in js/data-*.js so it also works over file://. Never carries key material.

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
    css_src = (static / 'style.css').read_text() + '\n' + (static / 'readability.css').read_text() + '\n' + (static / 'personal.css').read_text() + '\n' + (static / 'glance.css').read_text()
    timetable = (ROOT / 'data' / 'timetable.json').read_text()
    walking = (ROOT / 'data' / 'walking.json').read_text()
    logo_files = {'delijn':'delijn.png','stib':'mivb.png','shuttle':'tnt.png'}

    # ---- shape 1: the self-contained single file --------------------------
    font = base64.b64encode((static / 'manrope-latin.woff2').read_bytes()).decode()
    logos = {op: 'data:image/png;base64,' + base64.b64encode((static / 'logos' / name).read_bytes()).decode()
             for op, name in logo_files.items()}
    data = ''.join(f'<script type="application/json" id="{tag}">{body}</script>' for tag, body in [
        ('timetable-data', timetable.replace('</', '<\\/')),
        ('walking-data', walking.replace('</', '<\\/')),
        ('operator-logos', json.dumps(logos)),
        ('pdf-data', json.dumps(base64.b64encode((static / 'shuttle.pdf').read_bytes()).decode()))])
    code = ''.join(f'<script>{(static / name).read_text().replace("</script", "<\\/script")}</script>'
                   for name in ('engine.js', 'live-direct.js', 'reference.js', 'app.js'))
    mono = html.replace('/*__LIVE_KEYS__*/', json.dumps(keys)) \
               .replace('/*__HEAD__*/', '<style>' + css_src.replace('__FONT__', font) + '</style>') \
               .replace('/*__DATA__*/', data) \
               .replace('/*__CODE__*/', code)
    for leftover in ('/*__HEAD__*/', '/*__DATA__*/', '/*__CODE__*/'):
        if leftover in mono:
            raise ValueError('Missing template marker: ' + leftover)
    output = ROOT / 'Dashboard.html'
    tmp = output.with_suffix('.tmp')
    tmp.write_text(mono, encoding='utf-8')
    tmp.replace(output)

    # ---- shape 2: the multi-file static site ------------------------------
    build_static(html, css_src, timetable, walking, logo_files, env_keys)

    embedded = 'BMC+De Lijn keys' if keys['bmc'] and keys['delijn'] else 'De Lijn key only' if keys['delijn'] else 'BMC key only' if keys['bmc'] else 'none (secrets sibling/browser storage)'
    print(f'Built {output.name}: {output.stat().st_size:,} bytes; no external assets required; embedded keys: {embedded}; secrets file: {secrets_note}.')
    return output

def build_static(template, css_src, timetable, walking, logo_files, env_keys):
    """Write site/: index.html + assets/*.css|font|logos|PDF + js/*.js.
    Same template and the same script files as the single-file build; the
    static shapes differ only in how the head/data/code markers are filled.
    Never embeds keys: the sibling Dashboard-secrets.js (git-ignored) is the
    only key source, exactly like for the single-file standalone build."""
    import shutil
    static = ROOT / 'static'
    site = ROOT / 'site'
    (site / 'assets' / 'logos').mkdir(parents=True, exist_ok=True)
    (site / 'js').mkdir(parents=True, exist_ok=True)
    font_css = css_src.replace('data:font/woff2;base64,__FONT__', 'manrope-latin.woff2')
    (site / 'assets' / 'commute.css').write_text(font_css, encoding='utf-8')
    shutil.copy2(static / 'manrope-latin.woff2', site / 'assets' / 'manrope-latin.woff2')
    shutil.copy2(static / 'shuttle.pdf', site / 'assets' / 'TT-SHUTTLE-SCHEDULE.pdf')
    for name in logo_files.values():
        shutil.copy2(static / 'logos' / name, site / 'assets' / 'logos' / name)
    (site / 'js' / 'data-timetable.js').write_text('window.__TIMETABLE__=' + timetable.strip() + ';\n', encoding='utf-8')
    (site / 'js' / 'data-walking.js').write_text('window.__WALKING__=' + walking.strip() + ';\n', encoding='utf-8')
    for name in ('engine.js', 'live-direct.js', 'reference.js', 'app.js'):
        shutil.copy2(static / name, site / 'js' / name)
    index = template.replace('/*__LIVE_KEYS__*/', json.dumps({'bmc': '', 'delijn': ''})) \
        .replace('/*__HEAD__*/', '<link rel="stylesheet" href="assets/commute.css">') \
        .replace('/*__DATA__*/',
                 '<script src="js/data-timetable.js"></script><script src="js/data-walking.js"></script>'
                 '<script type="application/json" id="operator-logos">' + json.dumps({op: 'assets/logos/' + name for op, name in logo_files.items()}) + '</script>'
                 "<script>window.__PDF_PATH__='assets/TT-SHUTTLE-SCHEDULE.pdf';</script>") \
        .replace('/*__CODE__*/', ''.join(f'<script src="js/{name}"></script>' for name in ('engine.js', 'live-direct.js', 'reference.js', 'app.js')))
    (site / 'index.html').write_text(index, encoding='utf-8')
    if env_keys['bmc'] or env_keys['delijn']:
        shutil.copy2(ROOT / 'Dashboard-secrets.js', site / 'Dashboard-secrets.js')
        secrets_note = 'copied (git-ignored)'
    else:
        stale = site / 'Dashboard-secrets.js'
        if stale.exists():
            stale.unlink()
        secrets_note = 'none (use the root sibling or browser storage)'
    files = [f for f in site.rglob('*') if f.is_file()]
    total = sum(f.stat().st_size for f in files)
    print(f'Built site/: index.html + {len(files):,} files, {total:,} bytes total; secrets file: {secrets_note}.')
    return site

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--embed-keys', dest='embed', action='store_true', default=None,
                       help='embed the configured private API keys into the built page (private hosting only)')
    group.add_argument('--no-embed-keys', dest='embed', action='store_false',
                       help='never embed keys, suitable for commits and sharing')
    args = parser.parse_args()
    build(embed_keys=args.embed)
