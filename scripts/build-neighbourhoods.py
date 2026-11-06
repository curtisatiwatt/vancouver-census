#!/usr/bin/env python3
"""Build named municipal navigation without changing any census observations.

The retained municipal snapshots contain official polygons and independently
verified published profile values. Spatial intersections attach location names
to census tracts; they never allocate population or average income medians.
"""
import hashlib
import json
from pathlib import Path

from pyproj import Transformer
from shapely import transform, union_all
from shapely.geometry import shape, mapping, Point

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/source/municipal-neighbourhoods'
OUT = ROOT / 'public/data/neighbourhoods.json'
AUDIT = ROOT / 'data/audit/neighbourhoods.json'


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')


def build():
    project = Transformer.from_crs(4326, 3347, always_xy=True).transform
    unproject = Transformer.from_crs(3347, 4326, always_xy=True).transform
    records = []
    for path in sorted(SOURCE.glob('*-profiles.json')):
        records.extend(json.loads(path.read_text())['records'])
    assert records, 'No retained municipal profiles found'
    assert len({r['id'] for r in records}) == len(records), 'Duplicate municipal area ID'
    water = union_all([transform(shape(f['geometry']), project, interleaved=False)
                       for f in json.loads((ROOT / 'public/data/basemap.geojson').read_text())['features']
                       if f['properties'].get('kind') == 'water'])
    features, projected = [], {}
    for record in sorted(records, key=lambda r: (r['municipality'], r['name'])):
        geometry = transform(shape(record['geometry']), project, interleaved=False)
        assert geometry.is_valid and not geometry.is_empty, record['id']
        if geometry.geom_type in ('Polygon', 'MultiPolygon'):
            projected[record['id']] = geometry
        land = geometry.difference(water)
        if land.is_empty:
            land = geometry
        if hasattr(land, 'geoms'):
            land = max(land.geoms, key=lambda g: g.area)
        anchor = land.centroid if land.covers(land.centroid) else land.representative_point()
        point = transform(anchor, unproject, interleaved=False)
        p = {k: v for k, v in record.items() if k not in ('geometry', 'tractIntersections')}
        p.update(code='N:' + record['id'], kind='neighbourhood', typeLabel='市府社区',
                 sourceUrl=record.get('sourceUrl') or record.get('sourceUrls', [record['boundarySourceUrl']])[-1],
                 centroid=[round(point.x, 7), round(point.y, 7)])
        display = transform(geometry.simplify(3, preserve_topology=True), unproject, interleaved=False)
        features.append({'type': 'Feature', 'properties': p, 'geometry': mapping(display)})
    tracts = json.loads((ROOT / 'public/data/communities.geojson').read_text())['features']
    by_id = {f['properties']['id']: f['properties'] for f in features}
    crosswalk, tract_geometries = {}, {}
    for tract in tracts:
        p = tract['properties']
        geom = transform(shape(tract['geometry']), project, interleaved=False)
        tract_geometries[p['code']] = geom
        anchor = transform(Point(*p['centroid']), project, interleaved=False)
        matches = []
        for id_, area in projected.items():
            if by_id[id_]['municipality'] not in p.get('municipalities', [p['municipality']]):
                continue
            if not area.intersects(geom):
                continue
            overlap = area.intersection(geom).area
            fraction = overlap / geom.area
            if fraction < .015 and overlap / area.area < .95:
                continue
            matches.append({'id': id_, 'areaShare': round(fraction, 6), 'containsAnchor': area.covers(anchor)})
        matches.sort(key=lambda m: (-m['areaShare'], m['id']))
        if matches:
            crosswalk[p['code']] = matches
    for record in records:
        for match in record.get('tractIntersections', []):
            crosswalk.setdefault(match['code'], []).append({k: v for k, v in {**match, 'id': record['id']}.items() if k != 'code'})
    for matches in crosswalk.values():
        matches.sort(key=lambda m: (-m['areaShare'], m['id']))
    for feature in features:
        p = feature['properties']
        anchor = transform(Point(*p['centroid']), project, interleaved=False)
        p['anchorTractCode'] = next((code for code, geom in tract_geometries.items() if geom.covers(anchor)), None)
    sources = sorted({url for r in records for url in r.get('sourceUrls', [])})
    result = {'schemaVersion': 1, 'type': 'FeatureCollection', 'features': features,
              'tractNeighbourhoods': crosswalk, 'sources': sources,
              'municipalSources': [{'label': city + ' · Official neighbourhood data', 'url': next(r.get('sourceUrl') or r.get('sourceUrls', [r['boundarySourceUrl']])[-1] for r in records if r['municipality'] == city)} for city in sorted({r['municipality'] for r in records})],
              'attributions': sorted({r['licence']['attribution'] for r in records if r.get('licence', {}).get('attribution')}),
              'method': 'Municipal names and polygons are navigation geography. Census tract values remain unchanged; intersections identify locations only, not population weights.'}
    write(OUT, result)
    audit = {'areaCount': len(features), 'namedTractCount': len(crosswalk),
             'municipalities': {city: sum(r['municipality'] == city for r in records) for city in sorted({r['municipality'] for r in records})},
             'method': result['method'], 'displaySimplificationMetres': 3,
             'sources': sources,
             'sha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in sorted(SOURCE.glob('*.json'))},
             'outputSha256': hashlib.sha256(OUT.read_bytes()).hexdigest()}
    write(AUDIT, audit)
    print(f'Prepared {len(features)} named municipal areas; {len(crosswalk)} tracts have official location context. Census observations were not changed.')


if __name__ == '__main__':
    build()
