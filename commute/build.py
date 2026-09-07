#!/usr/bin/env python3
"""Build one self-contained HTML dashboard (fonts, schedule, PDF, code and styles).
The same file is served by server.py with live mode enabled.
"""
from pathlib import Path
import base64, json
ROOT = Path(__file__).resolve().parent

def build():
    static = ROOT / 'static'
    html = (static / 'template.html').read_text()
    font = base64.b64encode((static / 'manrope-latin.woff2').read_bytes()).decode()
    css = ((static / 'style.css').read_text() + '\n' + (static / 'readability.css').read_text() + '\n' + (static / 'personal.css').read_text() + '\n' + (static / 'glance.css').read_text()).replace('__FONT__', font)
    logos = {op: 'data:image/png;base64,' + base64.b64encode((static / 'logos' / name).read_bytes()).decode()
             for op, name in {'delijn':'delijn.png','stib':'mivb.png','shuttle':'tnt.png'}.items()}
    replacements = {
        '/*__STYLES__*/': css,
        '/*__TIMETABLE__*/': (ROOT / 'data' / 'timetable.json').read_text().replace('</', '<\\/'),
        '/*__WALKING__*/': (ROOT / 'data' / 'walking.json').read_text().replace('</', '<\\/'),
        '/*__LOGOS__*/': json.dumps(logos),
        '/*__PDF__*/': json.dumps(base64.b64encode((static / 'shuttle.pdf').read_bytes()).decode()),
        '/*__ENGINE__*/': (static / 'engine.js').read_text().replace('</script', '<\\/script'),
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
    print(f'Built {output.name}: {output.stat().st_size:,} bytes; no external assets required.')
    return output

if __name__ == '__main__':
    build()
