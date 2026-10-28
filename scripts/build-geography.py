"""Build a compact, attributed local gazetteer from GeoNames (CC BY 4.0).
Run with Python 3. Reads public downloads; does not geocode visitors' searches.
"""
import io
import json
import pathlib
import urllib.request
import zipfile
from datetime import datetime, timezone

root = pathlib.Path(__file__).resolve().parents[1] / 'src' / 'data'
base = 'https://download.geonames.org/export/dump/'
def fetch(name):
    with urllib.request.urlopen(base + name, timeout=90) as response:
        return response.read()

countries = {}
for line in fetch('countryInfo.txt').decode('utf-8').splitlines():
    if not line or line.startswith('#'): continue
    fields = line.split('\t')
    countries[fields[0]] = {'name': fields[4], 'numeric': fields[2]}

archive = zipfile.ZipFile(io.BytesIO(fetch('cities5000.zip')))
rows = []
for line in archive.read('cities5000.txt').decode('utf-8').splitlines():
    fields = line.split('\t')
    if fields[7] in ('PPLX', 'PPLH', 'PPLQ', 'PPLW'): continue
    # Keep local and ASCII names; selected familiar exonyms are supplied in geography.ts.
    rows.append([int(fields[0]), fields[1], fields[2], fields[8], float(fields[4]), float(fields[5]), int(fields[14] or 0), fields[10]])
rows.sort(key=lambda row: -row[6])
root.mkdir(exist_ok=True)
payload = {'downloadedAt': datetime.now(timezone.utc).isoformat(), 'source': base + 'cities5000.zip', 'license': 'CC BY 4.0', 'countries': countries, 'cities': rows}
(root / 'geography.json').write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
(root / 'countries.json').write_text(json.dumps(countries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Wrote {len(rows)} cities and {len(countries)} countries; {(root / "geography.json").stat().st_size:,} bytes')
