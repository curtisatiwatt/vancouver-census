#!/usr/bin/env python3
"""Prepare a local Metro Vancouver basemap from openly licensed official data.

Maintenance only: Python 3.9+ and Shapely 2.x. The website has no Python,
external map-tile or GIS-service runtime dependency.

python scripts/build-geography.py --source-dir /tmp/vancouver-geography --download
Omit --download to reproduce the retained raw source snapshot. Current BC and
Vancouver layers can change; the audit records hashes of the exact input files.
"""
import argparse
import collections
import concurrent.futures
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.parse
import urllib.request

from shapely import make_valid
from shapely.geometry import shape, mapping, box, Point, MultiLineString
from shapely.ops import unary_union, linemerge

ROOT = Path(__file__).resolve().parents[1]
BOUNDS = [-123.65, 48.9, -122.35, 49.8]
CLIP = box(*BOUNDS)
BC = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_basemapping/MapServer'
ROADS = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Road_Network_File/MapServer'
VANCOUVER_PARKS = 'https://opendata.vancouver.ca/explore/dataset/parks-polygon-representation/'
BC_LICENCE = 'https://www2.gov.bc.ca/gov/content/data/policy-standards/data-policies/open-data/open-government-licence-bc'
CANADA_LICENCE = 'https://open.canada.ca/en/open-government-licence-canada'
VANCOUVER_LICENCE = 'https://opendata.vancouver.ca/pages/licence/'

DATASETS = {
    'layer69.json': (BC + '/69', '1=1', 'af9ceee9-6545-423e-b5f7-75872968704c', 'Open Government Licence - Canada'),
    'layer66.json': (BC + '/66', '1=1', '60fb779b-e0b0-4026-9ecc-40579d63a724', 'Open Government Licence - British Columbia'),
    'layer20.json': (BC + '/20', 'AREA_HA >= 2', 'cb1e3aba-d3fe-4de1-a2d4-b8b6650fb1f6', 'Open Government Licence - British Columbia'),
    'layer17.json': (BC + '/17', 'AREA_HA >= 1', 'f7dac054-efbf-402f-ab62-6fc4b32a619e', 'Open Government Licence - British Columbia'),
    'layer40.json': (BC + '/40', 'FEATURE_AREA_SQM >= 50000', '6a2fea1b-0cc4-4fc2-8017-eaf755d516da', 'Open Government Licence - British Columbia'),
    'layer44.json': (BC + '/44', "STATUS = 'Operational'", '4ff93cda-9f58-4055-a372-98c22d04a9f8', 'Open Government Licence - Canada'),
}
ICONIC = {'Stanley Park', 'Queen Elizabeth Park', 'Pacific Spirit Regional Park', 'Burnaby Mountain Conservation Area', 'Deer Lake Park', 'Lighthouse Park', 'Lynn Canyon Park', 'Central Park', 'Minoru Park', 'Mundy Park', 'Tynehead Regional Park', 'Campbell Valley Regional Park'}
SOURCE_TITLES = {
    'layer69.json': 'Natural Resources Canada / BC · NTS Coastline Polygons (1:250,000)',
    'layer66.json': 'Province of BC · Freshwater Atlas Bays and Channels',
    'layer20.json': 'Province of BC · Freshwater Atlas Lakes',
    'layer17.json': 'Province of BC · Freshwater Atlas Rivers',
    'layer40.json': 'Province of BC · Local and Regional Greenspaces',
    'layer44.json': 'Natural Resources Canada / BC · Railway Track Lines',
}


def fetch(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                value = json.load(response)
            if 'error' in value:
                raise ValueError(value['error'])
            return value
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def write(path, value, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None, separators=None if pretty else (',', ':')) + '\n')


def download_arcgis(service, where, fields='*'):
    params = {'f': 'geojson', 'where': where, 'geometryType': 'esriGeometryEnvelope',
              'geometry': ','.join(map(str, BOUNDS)), 'inSR': 4326, 'outSR': 4326,
              'outFields': fields, 'returnGeometry': 'true', 'geometryPrecision': 6,
              'maxAllowableOffset': 0.00005, 'resultRecordCount': 1000,
              'orderByFields': 'OBJECTID'}
    rows = []
    for offset in range(0, 100000, 1000):
        data = fetch(service + '/query?' + urllib.parse.urlencode({**params, 'resultOffset': offset}))
        rows.extend(data['features'])
        if not data.get('exceededTransferLimit'):
            return {'type': 'FeatureCollection', 'features': rows}
        if not data['features']:
            raise ValueError('Empty page with exceededTransferLimit: ' + service)
    raise ValueError('Pagination limit exceeded: ' + service)


def round_coordinates(coords):
    if isinstance(coords[0], (float, int)):
        return [round(float(coords[0]), 6), round(float(coords[1]), 6)]
    return [round_coordinates(c) for c in coords]


def geometries(g, kind):
    if g.geom_type == kind:
        yield g
    elif hasattr(g, 'geoms'):
        for part in g.geoms:
            yield from geometries(part, kind)


def clean_geometry(raw, polygon=False):
    g = shape(raw) if isinstance(raw, dict) else raw
    if not g.is_valid:
        g = make_valid(g)
    g = g.intersection(CLIP)
    if g.is_empty:
        return None
    parts = list(geometries(g, 'Polygon' if polygon else 'LineString'))
    if not parts:
        return None
    g = unary_union(parts).simplify(0.000045, preserve_topology=True)
    result = mapping(g)
    rounded = {'type': result['type'], 'coordinates': round_coordinates(result['coordinates'])}
    if not shape(rounded).is_valid:
        return {'type': result['type'], 'coordinates': result['coordinates']}
    return rounded


def feature(kind, identifier, name, geometry, source, **properties):
    if not geometry:
        return None
    p = {'kind': kind, 'id': identifier, 'name': name or '', 'sourceUrl': source, **properties}
    if geometry['type'] in ('Polygon', 'MultiPolygon'):
        anchor = shape(geometry).representative_point()
        p['labelPoint'] = [anchor.x, anchor.y]
    return {'type': 'Feature', 'properties': p, 'geometry': geometry}


def collection(rows):
    return {'type': 'FeatureCollection', 'features': [row for row in rows if row is not None]}


def road_name(p):
    name = str(p.get('NAME') or '').strip()
    if not name:
        return ''
    direction = str(p.get('DIR') or '').strip()
    suffix = str(p.get('TYPE') or '').strip()
    return ' '.join(part for part in [direction, name, suffix] if part)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--snapshot-date', default='2026-11-06')
    args = parser.parse_args()
    args.source_dir.mkdir(parents=True, exist_ok=True)
    if args.download:
        def get_bc(item):
            name, (service, where, dataset, expected_licence) = item
            metadata = fetch('https://catalogue.data.gov.bc.ca/api/3/action/package_show?id=' + dataset)['result']
            if metadata.get('license_title') != expected_licence:
                raise ValueError('Review changed licence before publishing: ' + dataset)
            write(args.source_dir / name, download_arcgis(service, where))
            print('Downloaded', name, flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(get_bc, DATASETS.items()))
        for rank in range(4):
            write(args.source_dir / f'roads{rank}.json', download_arcgis(ROADS + '/' + str(rank), '1=1', 'NGD_UID,NAME,TYPE,DIR,RANK,CLASS'))
        write(args.source_dir / 'vancouver-parks.json', fetch('https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/parks-polygon-representation/exports/geojson'))

    filenames = [*DATASETS, *[f'roads{i}.json' for i in range(4)], 'vancouver-parks.json']
    raw = {name: json.loads((args.source_dir / name).read_text()) for name in filenames}
    basemap, geography = [], []
    # OGL-Canada NTS ocean polygons preserve islands and are clipped to the
    # display envelope. They are generalized geographic context, not boundaries.
    for f in raw['layer69.json']['features']:
        p = f['properties']
        if p['QCST_TAG'] == 'OCEAN':
            basemap.append(feature('water', 'ocean-' + str(p['OBJECTID']), '', clean_geometry(f['geometry'], True), BC + '/69', waterType='ocean', geometryQuality='generalized-1:250000'))
    for filename, prefix, namekey in [('layer66.json', 'bay', 'GNIS_NAME'), ('layer20.json', 'lake', 'GNIS_NAME_1'), ('layer17.json', 'river', 'GNIS_NAME_1')]:
        for f in raw[filename]['features']:
            p = f['properties']
            basemap.append(feature('water', prefix + '-' + str(p['OBJECTID']), p.get(namekey), clean_geometry(f['geometry'], True), DATASETS[filename][0], waterType=prefix, geometryQuality='official-simplified'))

    # Group genuine source segments by name and rank. Never invent connecting
    # lines or turn a collection of disjoint roads into one continuous route.
    road_groups = collections.defaultdict(list)
    seen_road_ids = set()
    for rank in range(4):
        for f in raw[f'roads{rank}.json']['features']:
            p = f['properties']
            if p['NGD_UID'] in seen_road_ids:
                raise ValueError('Duplicate road UID: ' + p['NGD_UID'])
            seen_road_ids.add(p['NGD_UID'])
            g = clean_geometry(f['geometry'])
            if g:
                road_groups[(road_name(p), int(p['RANK']))].extend(geometries(shape(g), 'LineString'))
    for (name, rank), lines in sorted(road_groups.items()):
        g = unary_union(lines)
        if g.geom_type == 'MultiLineString':
            g = linemerge(g)
        geometry = clean_geometry(g)
        identifier = hashlib.sha256(f'{name}:{rank}'.encode()).hexdigest()[:14]
        basemap.append(feature('road', 'road-' + identifier, name, geometry, ROADS, rank=rank,
                               classes=['Freeway' if rank <= 2 else 'Arterial Street'], geometryQuality='official-simplified', sourceSegmentCount=len(lines)))

    vancouver_names = {(f['properties'].get('park_name') or '').casefold() for f in raw['vancouver-parks.json']['features']}
    for f in raw['layer40.json']['features']:
        p = f['properties']
        name = p.get('PARK_NAME') or ''
        if name.casefold() in vancouver_names:
            continue
        geography.append(feature('park', 'bc-park-' + str(p['OBJECTID']), name, clean_geometry(f['geometry'], True), BC + '/40', named=bool(name), areaHa=round(p['FEATURE_AREA_SQM'] / 10000, 2), iconic=name in ICONIC, geometryQuality='official-simplified'))
    for f in raw['vancouver-parks.json']['features']:
        p = f['properties']
        hectares = float(p.get('area_hectare') or 0)
        if hectares < 5:
            continue
        name = p.get('park_name') or ''
        geography.append(feature('park', 'vancouver-park-' + str(p['object_id']), name, clean_geometry(f['geometry'], True), VANCOUVER_PARKS, named=bool(name), areaHa=hectares, iconic=name in ICONIC, geometryQuality='official-simplified'))
    for f in raw['layer44.json']['features']:
        p = f['properties']
        if p['TRACK_CLASSIFICATION'] not in ('Main', 'Connecting'):
            continue
        name = p.get('SUBDIVISION1_NAME') or ''
        geography.append(feature('railway', 'rail-' + str(p['OBJECTID']), '' if name == 'None' else name, clean_geometry(f['geometry']), BC + '/44', geometryQuality='official-simplified'))

    # Orientation points are generated inside official named park polygons.
    # These are label anchors, not visitor entrances or navigation destinations.
    landmarks = []
    for f in geography:
        if f and f['properties']['kind'] == 'park' and f['properties']['iconic']:
            p = f['properties']
            landmarks.append(feature('orientation_landmark', 'landmark-' + p['id'], p['name'], {'type': 'Point', 'coordinates': p['labelPoint']}, p['sourceUrl'], priority=800 + min(p['areaHa'], 500), geometryQuality='polygon-label-anchor'))
    # Keep a single anchor per named park; the area layer remains complete.
    landmarks = list({f['properties']['name']: f for f in sorted(landmarks, key=lambda x: x['properties']['priority'])}.values())

    output = {'basemap.geojson': collection(basemap), 'geographic-context.geojson': collection(geography), 'orientation-landmarks.geojson': collection(landmarks)}
    for name, data in output.items():
        for f in data['features']:
            g = shape(f['geometry'])
            if g.is_empty or not g.is_valid or not CLIP.buffer(0.000002).covers(g):
                raise ValueError('Invalid/empty/outside geometry: ' + f['properties']['id'])
        write(ROOT / 'public/data' / name, data)
    if not any(f['properties']['name'] == 'Stanley Park' for f in geography if f):
        raise ValueError('Stanley Park missing')
    if len(seen_road_ids) < 10000:
        raise ValueError('Incomplete road download')
    audit = {
        'preparedDate': args.snapshot_date, 'bounds': BOUNDS,
        'method': 'All geometries are real, licensed official source data clipped to the map envelope and simplified by at most 0.000045 degrees after the server query. Ocean is generalized NTS 1:250,000. Road ranks 1–4 (2021) are grouped without inventing connecting segments. Lakes smaller than 2 ha, river polygons smaller than 1 ha, parks smaller than 5 ha, and railway yards/spurs are omitted for map legibility.',
        'limitations': 'This geographic context can extend beyond census coverage. It is not a navigation service, complete vegetation map, park entrance map or current road inventory. Geographic source vintages differ from the census; no census counts are inferred from these layers.',
        'attribution': 'Contains information licensed under the Open Government Licence – Canada, Open Government Licence – British Columbia and Open Government Licence – Vancouver.',
        'sourceRoadSegmentCount': len(seen_road_ids),
        'input': {name: {'sha256': hashlib.sha256((args.source_dir / name).read_bytes()).hexdigest(), 'featureCount': len(raw[name]['features'])} for name in filenames},
        'output': {name: {'featureCount': len(data['features']), 'kinds': dict(collections.Counter(f['properties']['kind'] for f in data['features'])), 'sha256': hashlib.sha256((ROOT / 'public/data' / name).read_bytes()).hexdigest()} for name, data in output.items()},
        'sources': [
            {'label': 'Statistics Canada · 2021 Road Network File', 'url': ROADS, 'licence': CANADA_LICENCE},
            *[{'label': SOURCE_TITLES[name], 'url': service, 'catalogue': 'https://catalogue.data.gov.bc.ca/dataset/' + dataset, 'licence': CANADA_LICENCE if licence.endswith('Canada') else BC_LICENCE} for name, (service, where, dataset, licence) in DATASETS.items()],
            {'label': 'City of Vancouver · Parks polygons', 'url': VANCOUVER_PARKS, 'licence': VANCOUVER_LICENCE},
        ],
        'landmarkNames': [f['properties']['name'] for f in landmarks],
    }
    write(ROOT / 'data/audit/geography.json', audit, True)
    write(ROOT / 'data/source/geographic-metadata.json', {
        'geographyPreparedDate': args.snapshot_date,
        'geographyDefinition': '海岸、河流、湖泊、主要道路、公园和铁路来自加拿大统计局、自然资源部、卑诗省及温哥华市的开放地理资料。道路为 2021 年快照；海岸线使用 1:250,000 概化资料。只显示较大公园和水域，公园并非全部植被覆盖；地标点只是公园内的文字锚点，不是入口。背景范围可超出普查范围，不会据此推算人口或收入。',
        'definitionsEn': {
            'geographyDefinition': 'Coasts, rivers, lakes, major roads, parks and railway context come from open geographic data published by Statistics Canada, Natural Resources Canada, British Columbia and the City of Vancouver. Roads are a 2021 snapshot; coastline polygons are generalized at 1:250,000. Only larger parks and waterbodies are shown. Parks do not represent all vegetation, and landmark points are label anchors inside parks, not entrances. Geographic context can extend beyond census coverage without adding population or income estimates.'
        },
        'geographyLicense': audit['attribution'],
        'sources': [{'label': s['label'], 'url': s.get('catalogue', s['url'])} for s in audit['sources']] + [
            {'label': 'Geographic data · Open Government Licence – Canada', 'url': CANADA_LICENCE},
            {'label': 'Geographic data · Open Government Licence – British Columbia', 'url': BC_LICENCE},
            {'label': 'Geographic data · Open Government Licence – Vancouver', 'url': VANCOUVER_LICENCE},
        ],
    }, True)
    print(json.dumps(audit['output'], indent=2))


if __name__ == '__main__':
    main()
