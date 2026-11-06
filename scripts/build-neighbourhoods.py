#!/usr/bin/env python3
"""Build named municipal navigation without changing any census observations.

The retained municipal snapshots contain official polygons and independently
verified published profile values. Spatial intersections attach location names
to census tracts; they never allocate population or average income medians.
Richmond's selectable location footprints are unions of openly licensed census
blocks. Retained Richmond municipal profile geometry remains point-only.
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
RICHMOND_BLOCKS = SOURCE / 'richmond-census-blocks.geojson'


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')


def census_location_footprints(records, project):
    """Combine public census geometry using retained location membership facts.

    No municipal reference polygon is read by this build, and no statistical
    value is aggregated from the blocks. Membership was reviewed independently
    against the City's planning map; the result is explicitly approximate.
    """
    snapshot = json.loads(RICHMOND_BLOCKS.read_text())
    richmond = {r['id']: r for r in records if r['municipality'] == 'Richmond'}
    assert len(richmond) == 15
    assert all(r['geometry']['type'] == 'Point' for r in richmond.values())
    pieces = {id_: [] for id_ in richmond}
    block_codes = {id_: [] for id_ in richmond}
    income_pieces = {'richmond-east-richmond': [], 'richmond-fraser-lands': []}
    seen = set()
    for block in snapshot['features']:
        p = block['properties']
        id_, code = p['neighbourhoodId'], p['code']
        assert id_ in richmond and code not in seen, (id_, code)
        assert p['level'] == 'DB' and p['municipalityCode'] == '5915015'
        seen.add(code)
        geometry = transform(shape(block['geometry']), project, interleaved=False)
        assert geometry.is_valid and not geometry.is_empty, code
        pieces[id_].append(geometry)
        block_codes[id_].append(code)
        if p.get('incomeAreaId'):
            assert id_ == 'richmond-east-richmond-fraser-lands'
            assert p['incomeAreaId'] in income_pieces
            income_pieces[p['incomeAreaId']].append(geometry)
    footprints = {}
    for id_, blocks in pieces.items():
        assert blocks, 'Missing selectable footprint: ' + id_
        geometry = union_all(blocks)
        assert geometry.is_valid and geometry.geom_type in ('Polygon', 'MultiPolygon'), id_
        footprints[id_] = {'geometry': geometry, 'blockCodes': sorted(block_codes[id_])}
    assert all(income_pieces.values()), 'Missing separate Richmond income footprint'
    income_footprints = {id_: union_all(blocks) for id_, blocks in income_pieces.items()}
    return footprints, income_footprints, snapshot['metadata']


def build():
    project = Transformer.from_crs(4326, 3347, always_xy=True).transform
    unproject = Transformer.from_crs(3347, 4326, always_xy=True).transform
    records = []
    for path in sorted(SOURCE.glob('*-profiles.json')):
        records.extend(json.loads(path.read_text())['records'])
    assert records, 'No retained municipal profiles found'
    assert len({r['id'] for r in records}) == len(records), 'Duplicate municipal area ID'
    richmond_footprints, income_footprints, footprint_metadata = census_location_footprints(records, project)
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
        if record['id'] in richmond_footprints:
            footprint = richmond_footprints[record['id']]
            # Retain the original source point, but keep visible labels inside
            # their own selectable footprint when its approximation differs.
            geometry = footprint['geometry']
            if not geometry.covers(anchor):
                land = geometry.difference(water)
                if land.is_empty:
                    land = geometry
                if hasattr(land, 'geoms'):
                    land = max(land.geoms, key=lambda g: g.area)
                anchor = land.centroid if land.covers(land.centroid) else land.representative_point()
                point = transform(anchor, unproject, interleaved=False)
                p['centroid'] = [round(point.x, 7), round(point.y, 7)]
            p.update(locationOnly=False, boundaryType='census-approximation',
                     boundaryLabel='社区定位范围（按普查边界近似）',
                     boundaryLabelEn='Approximate neighbourhood location (census boundaries)',
                     sourceGeometry=record['geometry'], censusBoundaryLevel='DB',
                     locationBlockCodes=footprint['blockCodes'],
                     footprintSourceUrl=footprint_metadata['sourceUrl'],
                     boundaryNote={
                         'zh': '可点击范围由公开普查街块组合，用于社区定位，可能跨越实际社区边界；人口、族裔和收入仍为市政府公布的社区统计。',
                         'en': 'This selectable footprint combines public census blocks for neighbourhood navigation and can cross the actual planning boundary. Population, population-group and income values remain the City’s published neighbourhood statistics.'})
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
    income_areas = []
    parent = by_id['richmond-east-richmond-fraser-lands']
    for subprofile in parent['statistics']['subprofiles']:
        id_ = 'richmond-' + subprofile['name'].lower().replace(' ', '-')
        geometry = income_footprints[id_]
        assert geometry.is_valid and geometry.geom_type in ('Polygon', 'MultiPolygon')
        p = {'id': id_, 'code': 'I:' + id_, 'parentCode': parent['code'],
             'name': subprofile['name'], 'municipality': 'Richmond', 'kind': 'neighbourhood',
             'statistics': subprofile['statistics'],
             'sourceUrl': subprofile['statistics']['incomeMedian']['sourceUrl'],
             'boundaryType': 'census-approximation',
             'boundaryLabel': parent['boundaryLabel'], 'boundaryLabelEn': parent['boundaryLabelEn'],
             'footprintSourceUrl': footprint_metadata['sourceUrl'], 'censusBoundaryLevel': 'DB'}
        display = transform(geometry.simplify(3, preserve_topology=True), unproject, interleaved=False)
        income_areas.append({'type': 'Feature', 'properties': p, 'geometry': mapping(display)})
    sources = sorted({url for r in records for url in r.get('sourceUrls', [])} | {footprint_metadata['sourceUrl']})
    result = {'schemaVersion': 1, 'type': 'FeatureCollection', 'features': features,
              'incomeAreas': income_areas,
              'tractNeighbourhoods': crosswalk, 'sources': sources,
              'municipalSources': [{'label': city + ' · Official neighbourhood data', 'url': next(r.get('sourceUrl') or r.get('sourceUrls', [r['boundarySourceUrl']])[-1] for r in records if r['municipality'] == city)} for city in sorted({r['municipality'] for r in records})],
              'attributions': sorted({r['licence']['attribution'] for r in records if r.get('licence', {}).get('attribution')} | {footprint_metadata['attribution']}),
              'method': 'Municipal names and polygons are navigation geography. Richmond uses explicitly approximate unions of public census blocks, with original point anchors retained. Census tract values and published community statistics remain unchanged; spatial membership identifies locations only, not population weights.'}
    write(OUT, result)
    audit = {'areaCount': len(features), 'namedTractCount': len(crosswalk),
             'municipalities': {city: sum(r['municipality'] == city for r in records) for city in sorted({r['municipality'] for r in records})},
             'method': result['method'], 'displaySimplificationMetres': 3,
             'sources': sources,
             'approximateFootprints': {'municipality': 'Richmond', 'areaCount': len(richmond_footprints),
                                      'censusBoundaryLevel': 'DB',
                                      'blockCount': sum(len(f['blockCodes']) for f in richmond_footprints.values()),
                                      'separateIncomeAreaCount': len(income_areas),
                                      'source': str(RICHMOND_BLOCKS.relative_to(ROOT)),
                                      'assessment': footprint_metadata['assessment']},
             'sha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in sorted([*SOURCE.glob('*.json'), RICHMOND_BLOCKS])},
             'outputSha256': hashlib.sha256(OUT.read_bytes()).hexdigest()}
    write(AUDIT, audit)
    print(f'Prepared {len(features)} named municipal areas; {len(crosswalk)} tracts have official location context. Census observations were not changed.')


if __name__ == '__main__':
    build()
