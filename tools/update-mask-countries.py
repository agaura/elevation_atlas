"""Refresh the Natural Earth country lookup used before on-demand region queries."""
import json
from pathlib import Path
import urllib.request

url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'
source = json.load(urllib.request.urlopen(url, timeout=60))
def rounded(value):
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return round(value, 5) if isinstance(value, float) else value
features = []
for feature in source['features']:
    properties = feature['properties']
    iso = properties.get('ADM0_A3')
    iso = {'KOS': 'XKX'}.get(iso, iso)
    if not iso or len(iso) != 3:
        continue
    features.append({'type': 'Feature', 'properties': {'iso': iso, 'name': properties.get('NAME_EN') or properties.get('NAME')},
                     'geometry': {'type': feature['geometry']['type'], 'coordinates': rounded(feature['geometry']['coordinates'])}})
path = Path(__file__).resolve().parents[1] / 'data' / 'regions' / 'countries.json'
path.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False, separators=(',', ':')))
print(len(features), 'countries;', path.stat().st_size, 'bytes')
