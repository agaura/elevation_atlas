"""Refresh compact official IAU/USGS labels; Python standard library only."""
import datetime
import io
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NS = {'k': 'http://www.opengis.net/kml/2.2'}
for body in ('mars', 'moon'):
    url = f'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/{body.upper()}_nomenclature_center_pts.kmz'
    archive = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url, timeout=60).read()))
    document = ET.fromstring(archive.read(next(n for n in archive.namelist() if n.endswith('.kml'))))
    features = []
    seen = set()
    for placemark in document.findall('.//k:Placemark', NS):
        fields = {node.attrib['name']: node.text or '' for node in placemark.findall('.//k:SimpleData', NS)}
        if fields.get('approval') != 'Adopted by IAU':
            continue
        name = placemark.findtext('k:name', namespaces=NS)
        coordinates = placemark.findtext('k:Point/k:coordinates', namespaces=NS)
        if not name or not coordinates:
            continue
        lon, lat = map(float, coordinates.split(',')[:2])
        diameter = float(fields.get('diameter') or 0)
        feature_id = int(fields['link'].rstrip('/').split('/')[-1])
        if feature_id in seen:
            continue
        seen.add(feature_id)
        features.append([name, round(lon, 6), round(lat, 6), round(diameter, 3), fields['code'], feature_id])
    features.sort(key=lambda row: (-row[3], row[0]))
    output = {'source': url, 'retrieved': datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
              'coordinates': 'east longitude, planetocentric latitude',
              'fields': ['name', 'longitude', 'latitude', 'diameterKm', 'typeCode', 'iauId'], 'features': features}
    path = ROOT / 'data' / 'planetary' / f'{body}-names.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(body, len(features), path.stat().st_size, 'bytes')
