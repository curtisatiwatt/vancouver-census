#!/usr/bin/env python3
"""Build Metro Vancouver's map from auditable Statistics Canada snapshots.

Default is an offline rebuild. --refresh downloads official 2021 profile data
and cartographic boundaries, validates characteristic labels, then rebuilds.
Install requirements-data.txt in a virtual environment first.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import date
import hashlib
import io
import json
from pathlib import Path
import time
import xml.etree.ElementTree as ET

import requests
from pyproj import Transformer
from shapely.geometry import shape
from shapely import transform, union_all

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/source'
OUT = ROOT / 'public/data'
AUDIT = ROOT / 'data/audit'
BOUNDARY = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer'
SDMX = 'https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest'
VERSION = '1.3'
CHAR_IDS = [1, 2, 3, 5, 6, 7, 8, 9, 35, 56, 57, 228, 229, 237, *range(1669, 1684)]
EXPECTED_LABELS = {
    '1': 'Population, 2021',
    '8': 'Total - Age groups of the population - 100% data',
    '9': '0 to 14 years',
    '35': '0 to 14 years',
    '56': 'Average household size',
    '57': 'Number of persons in private households',
    '228': 'Total - Income statistics for private households - 100% data',
    '229': 'Median total income of household in 2020 ($)',
    '1669': 'Total - Visible minority for the population in private households - 25% sample data',
    '1672': 'Chinese',
}
GROUPS = [
    ('south_asian', '南亚裔', 'South Asian'), ('chinese', '华人', 'Chinese'),
    ('black', '黑人', 'Black'), ('filipino', '菲律宾裔', 'Filipino'),
    ('arab', '阿拉伯裔', 'Arab'), ('latin_american', '拉丁美洲裔', 'Latin American'),
    ('southeast_asian', '东南亚裔', 'Southeast Asian'), ('west_asian', '西亚裔', 'West Asian'),
    ('korean', '韩裔', 'Korean'), ('japanese', '日裔', 'Japanese'),
    ('visible_minority_nie', '其他可见少数族裔', 'Visible minority, n.i.e.'),
    ('multiple_visible_minorities', '多个可见少数族裔', 'Multiple visible minorities'),
    ('not_visible_minority', '非可见少数族裔（普查分类）', 'Not a visible minority'),
]
BOUNDARY_QUERIES = {
    'ct': (11, "CTUID LIKE '933%'"), 'csd': (9, "CSDUID LIKE '5915%'"),
    'cd': (4, "CDUID='5915'"), 'cma': (6, "CMAUID='933'"),
}


def write_json(path, data, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False,
                               indent=2 if pretty else None,
                               separators=None if pretty else (',', ':')) + '\n')


def get(url, **kwargs):
    for attempt in range(4):
        try:
            response = requests.get(url, timeout=60, **kwargs)
            response.raise_for_status()
            return response
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def profile_url(dguid):
    return ('https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/page.cfm'
            '?Lang=E&DGUIDlist=' + dguid + '&GENDERlist=1&STATISTIClist=1&HEADERlist=0')


def number(raw):
    if raw in ('', None):
        return None
    value = float(raw)
    return int(value) if value.is_integer() else value


def normalize_rows(rows):
    records = {}
    for row in rows:
        if int(row['CHARACTERISTIC']) not in CHAR_IDS:
            continue
        assert row['TIME_PERIOD'] == '2021' and row['GENDER'] == '1' and row['STATISTIC'] == '1'
        code = row['ALT_GEO_CODE']
        record = records.setdefault(code, {
            'dguid': row['GEO_DESC'].replace('_', '.'), 'values': {}, 'flags': {},
            'confidenceIntervals': {}, 'dataQualityFlag': row['DATA_QUALITY_FLAG'],
            'tnrLongForm': number(row['TNR_LF']), 'tnrShortForm': number(row['TNR_SF']),
        })
        characteristic = row['CHARACTERISTIC']
        assert characteristic not in record['values'], (code, characteristic, 'duplicate observation')
        record['values'][characteristic] = number(row['OBS_VALUE'])
        record['flags'][characteristic] = row['FLAG']
        if row['CI_LOW'] or row['CI_HIGH']:
            record['confidenceIntervals'][characteristic] = [number(row['CI_LOW']), number(row['CI_HIGH'])]
    return {key: records[key] for key in sorted(records)}


def parse_metadata(xml):
    tree = ET.fromstring(xml)
    ns = {'s': 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure',
          'c': 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common'}
    def codelist(name):
        result = {}
        for code in tree.findall(f'.//s:Codelist[@id="{name}"]/s:Code', ns):
            label = code.find('c:Name[@{http://www.w3.org/XML/1998/namespace}lang="en"]', ns)
            result[code.attrib['id']] = label.text
        return result
    labels = codelist('CL_CHARACTERISTIC')
    for key, expected in EXPECTED_LABELS.items():
        assert labels.get(key) == expected, f'Characteristic {key} changed: {labels.get(key)}'
    for i, (_, _, label) in enumerate(GROUPS, 1671):
        assert labels[str(i)] == label, (i, label)
    return {str(i): labels[str(i)] for i in CHAR_IDS}, codelist('CL_FLAG')


def fetch_profile(level, dguids):
    # SDMX uses underscores in CT geographic codes because '.' separates dimensions.
    geos = '+'.join(d.replace('.', '_') for d in dguids)
    members = '+'.join(map(str, CHAR_IDS))
    url = f'{SDMX}/data/STC_CP,DF_{level},{VERSION}/A5.{geos}.1.{members}.1'
    response = get(url, headers={'Accept': 'text/csv'})
    assert response.text.startswith('DATAFLOW,'), f'Unexpected profile response for {level}'
    return list(csv.DictReader(io.StringIO(response.text)))


def refresh():
    print('Downloading official 2021 boundaries and profile metadata...', flush=True)
    boundaries = {}
    for key, (layer, where) in BOUNDARY_QUERIES.items():
        response = get(f'{BOUNDARY}/{layer}/query', params={
            'where': where, 'outFields': '*', 'returnGeometry': 'true', 'outSR': 4326,
            'geometryPrecision': 6, 'maxAllowableOffset': 0.00003, 'f': 'geojson',
        })
        boundary = response.json()
        assert boundary.get('type') == 'FeatureCollection' and boundary.get('features')
        assert not boundary.get('exceededTransferLimit'), 'Incomplete boundary response'
        boundaries[key] = boundary
        write_json(SOURCE / f'{key}-boundaries.geojson', boundary)
    labels, flags = parse_metadata(get(f'{SDMX}/dataflow/STC_CP/DF_CT/{VERSION}?references=all').text)
    ids = sorted(f['properties']['DGUID'] for f in boundaries['ct']['features'])
    batches = [ids[i:i + 30] for i in range(0, len(ids), 30)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        chunks = list(pool.map(lambda batch: fetch_profile('CT', batch), batches))
    csd_ids = sorted(f['properties']['DGUID'] for f in boundaries['csd']['features'])
    snapshot = {
        'version': VERSION, 'retrievedAt': date.today().isoformat(),
        'characteristics': labels, 'flags': flags,
        'ct': normalize_rows(row for chunk in chunks for row in chunk),
        'csd': normalize_rows(fetch_profile('CSD', csd_ids)),
        'region': normalize_rows(fetch_profile('CMACA', ['2021S0503933']))['933'],
        'api': SDMX, 'scope': 'Greater Vancouver regional district (CD 5915)',
    }
    write_json(SOURCE / 'census-values.json', snapshot)


def csd_name(properties):
    name, kind = properties['CSDNAME'], properties['CSDTYPE']
    if name in ('Langley', 'North Vancouver'):
        return f'{name} ({"City" if kind == "CY" else "Township" if name == "Langley" else "District"})'
    return name


def population_record(record):
    values = record['values']
    base = values.get('1669')
    counts = {group[0]: values.get(str(i)) for i, group in enumerate(GROUPS, 1671)}
    return {
        'population': base, 'counts': counts,
        'publishedPct': {key: count / base if count is not None and base else None for key, count in counts.items()},
        'sourceUrl': profile_url(record['dguid']),
    }


def build():
    snapshot = json.loads((SOURCE / 'census-values.json').read_text())
    for key, label in EXPECTED_LABELS.items():
        assert snapshot['characteristics'][key] == label
    boundaries = {key: json.loads((SOURCE / f'{key}-boundaries.geojson').read_text()) for key in BOUNDARY_QUERIES}
    assert len(boundaries['ct']['features']) == 535
    assert len(boundaries['csd']['features']) == 38
    # Independent official CD and CMA queries prove the intended Metro boundary.
    cd = boundaries['cd']['features'][0]
    cma = boundaries['cma']['features'][0]
    assert cd['geometry'] == cma['geometry'], 'Vancouver CMA and Greater Vancouver CD no longer match; review scope'
    assert set(snapshot['ct']) == {f['properties']['CTUID'] for f in boundaries['ct']['features']}
    assert set(snapshot['csd']) == {f['properties']['CSDUID'] for f in boundaries['csd']['features']}

    project = Transformer.from_crs('EPSG:4326', 'EPSG:3347', always_xy=True).transform
    unproject = Transformer.from_crs('EPSG:3347', 'EPSG:4326', always_xy=True).transform
    basemap_path = OUT / 'basemap.geojson'
    water = None
    if basemap_path.exists():
        basemap = json.loads(basemap_path.read_text())
        water = union_all([transform(shape(f['geometry']), project, interleaved=False)
                           for f in basemap['features'] if f['properties'].get('kind') == 'water'])

    def display_anchor(geometry, use_centroid=True):
        point = geometry.centroid if use_centroid else geometry.representative_point()
        method = 'projected-centroid' if use_centroid else 'projected-interior-point'
        if not geometry.covers(point):
            point, method = geometry.representative_point(), 'projected-interior-point'
        if water is not None and water.covers(point):
            land = geometry.difference(water)
            if not land.is_empty and land.area > 1:
                if hasattr(land, 'geoms'):
                    land = max(land.geoms, key=lambda g: g.area)
                point, method = land.representative_point(), 'projected-land-interior-point'
        return transform(point, unproject, interleaved=False), method

    csds = [(f, transform(shape(f['geometry']), project, interleaved=False)) for f in boundaries['csd']['features']]
    features, joins = [], []
    for original in sorted(boundaries['ct']['features'], key=lambda f: f['properties']['CTUID']):
        p = original['properties']
        code = p['CTUID']
        record = snapshot['ct'][code]
        values = record['values']
        geometry = transform(shape(original['geometry']), project, interleaved=False)
        if not geometry.is_valid:
            raise ValueError(f'Invalid CT geometry: {code}')
        intersections = []
        for municipal_feature, municipal_geometry in csds:
            if not geometry.intersects(municipal_geometry):
                continue
            overlap = geometry.intersection(municipal_geometry).area
            if overlap <= 0:
                continue
            intersections.append((municipal_feature, overlap / geometry.area, overlap / municipal_geometry.area))
        intersections.sort(key=lambda row: -row[1])
        assert intersections
        # Ignore small slivers from independently generalized boundaries. Preserve
        # small villages contained in a large shared CT (e.g. CT 9330250.02).
        members = [row for i, row in enumerate(intersections) if i == 0 or row[1] >= .01 or row[2] >= .95]
        names = [csd_name(row[0]['properties']) for row in members]
        municipality_codes = [row[0]['properties']['CSDUID'] for row in members]
        anchor, anchor_method = display_anchor(geometry)
        base, chinese = values.get('1669'), values.get('1672')
        shared = len(members) > 1
        caveat = ('本普查区跨越多个市镇／地区，统计值适用于完整普查区，不能拆分为各市镇数值。' if shared else '')
        caveat_en = ('This census tract spans several municipalities/areas. Its statistics describe the entire tract and cannot be split into municipal values.' if shared else '')
        if record['dataQualityFlag'].startswith('1') and values.get('1') is None:
            caveat = '本保留区的 2021 年住户普查未能完成，未发布 2021 年人口；空值不代表人口为零。'
            caveat_en = 'Dwelling enumeration could not be completed for this reserve in 2021. Its 2021 population was not published; missing data do not mean zero population.'
        output = {
            'code': code, 'ctuid': code, 'dguid': record['dguid'],
            'name': ' / '.join(names) + ' · ' + p['CTNAME'],
            'sourceName': code, 'censusName': code, 'boundaryName': code,
            'type': 'Census tract', 'typeLabel': '普查区', 'ctName': p['CTNAME'],
            'municipality': names[0], 'municipalities': names, 'municipalityCode': municipality_codes[0],
            'municipalityCodes': municipality_codes, 'sectorLabel': names[0],
            'centroid': [round(anchor.x, 7), round(anchor.y, 7)],
            'anchorMethod': anchor_method,
            'boundaryYear': 2021, 'boundarySourceUrl': f'{BOUNDARY}/11',
            'population': values.get('1'), 'populationTotal': values.get('1'),
            'populationPrivate': values.get('57'), 'population2016': values.get('2'),
            'populationChangePct': values.get('3'), 'density': values.get('6'), 'landArea': values.get('7'),
            'income': values.get('229'), 'chineseCount': chinese,
            'chinesePopulationBase': base,
            'chinesePct': chinese / base if chinese is not None and base else None,
            'children': values['35'] / 100 if values.get('35') is not None else None,
            'childrenCount': values.get('9'), 'agePopulationBase': values.get('8'),
            'householdSize': values.get('56'), 'households': values.get('228'),
            'householdsLongForm': values.get('237'),
            'incomeStatus': 'published' if values.get('229') is not None else 'suppressed' if record['flags'].get('229') == '6' else 'unavailable',
            'chineseStatus': 'published' if chinese is not None else 'suppressed' if record['flags'].get('1672') == '6' else 'unavailable',
            'nonresponseRateLongForm': record['tnrLongForm'] / 100 if record['tnrLongForm'] is not None else None,
            'dataQualityFlag': record['dataQualityFlag'],
            'sourceUrl': profile_url(record['dguid']), 'shortSourceUrl': profile_url(record['dguid']),
            'caveat': caveat,
            'caveatEn': caveat_en,
        }
        features.append({'type': 'Feature', 'geometry': original['geometry'], 'properties': output})
        joins.append({'ctuid': code, 'dguid': record['dguid'], 'municipalities': municipality_codes,
                      'overlaps': [{'csduid': f['properties']['CSDUID'], 'ctAreaShare': round(ct_share, 8),
                                    'csdAreaShare': round(csd_share, 8)} for f, ct_share, csd_share in members]})
    memberships = {m for f in features for m in f['properties']['municipalityCodes']}
    assert memberships == set(snapshot['csd']), 'Municipality filter must cover every CSD, including shared-tract villages'
    write_json(OUT / 'communities.geojson', {'type': 'FeatureCollection', 'features': features})
    group_data = {
        'schemaVersion': 1, 'censusYear': 2021, 'variable': 'visible_minority',
        'denominatorLabel': '私人住户人口（25% 长表）',
        'percentageBasis': 'derived_from_published_counts',
        'groups': [{'id': key, 'label': zh, 'name': en} for key, zh, en in GROUPS],
        'defaultGroupIds': ['chinese', 'south_asian', 'filipino', 'west_asian', 'korean'],
        'city': population_record(snapshot['region']),
        'communities': {code: population_record(record) for code, record in snapshot['ct'].items()},
    }
    write_json(OUT / 'population-groups.json', group_data)
    municipal_features = []
    for feature, geometry in csds:
        p = feature['properties']
        record = snapshot['csd'][p['CSDUID']]
        anchor, _ = display_anchor(geometry, use_centroid=False)
        municipal_features.append({'type': 'Feature', 'geometry': feature['geometry'], 'properties': {
            'code': p['CSDUID'], 'name': csd_name(p), 'officialName': p['CSDNAME'],
            'type': p['CSDTYPE'], 'dguid': p['DGUID'], 'populationTotal': record['values'].get('1'),
            'income': record['values'].get('229'), 'centroid': [round(anchor.x, 7), round(anchor.y, 7)],
            'sourceUrl': profile_url(p['DGUID']),
        }})
    write_json(OUT / 'municipalities.geojson', {'type': 'FeatureCollection', 'features': municipal_features})
    region_feature = {'type': 'Feature', 'geometry': cd['geometry'], 'properties': {
        'code': '5915', 'name': 'Metro Vancouver', 'officialName': 'Greater Vancouver', 'type': 'Regional district',
        'sourceUrl': f'{BOUNDARY}/4',
    }}
    write_json(OUT / 'region-boundary.geojson', {'type': 'FeatureCollection', 'features': [region_feature]})
    metadata = make_metadata(snapshot, features, municipal_features)
    for filename in ['geographic-metadata.json', 'skytrain-metadata.json']:
        extra_metadata = SOURCE / filename
        if not extra_metadata.exists():
            continue
        extras = json.loads(extra_metadata.read_text())
        metadata['sources'].extend(extras.pop('sources', []))
        metadata['definitionsEn'].update(extras.pop('definitionsEn', {}))
        for key, value in extras.items():
            assert key.startswith(('geography', 'transit')), f'Unexpected context metadata key: {key}'
            metadata[key] = value
    write_json(OUT / 'metadata.json', metadata, pretty=True)
    checksums = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in sorted(SOURCE.iterdir()) if path.is_file()}
    output_checksums = {str(OUT.joinpath(name).relative_to(ROOT)): hashlib.sha256(OUT.joinpath(name).read_bytes()).hexdigest()
                       for name in ['communities.geojson', 'population-groups.json', 'municipalities.geojson', 'region-boundary.geojson']}
    write_json(AUDIT / 'join.json', {
        'scope': 'Greater Vancouver regional district (CD 5915), 2021 boundaries',
        'cma933EqualsCd5915Geometry': True, 'ctCount': 535, 'csdCount': 38,
        'profileJoin': 'CTUID to ALT_GEO_CODE; preserve null values and suppression flags',
        'municipalities': 'Derived from EPSG:3347 area intersections. Keep primary CSD, overlaps >=1% of CT area, and CSDs >=95% contained in CT. Geographic filters retain the whole tract; no census values are apportioned.',
        'populationSum': sum(f['properties']['populationTotal'] or 0 for f in features),
        'regionalPopulation': snapshot['region']['values']['1'],
        'sharedTracts': [row for row in joins if len(row['municipalities']) > 1],
        'sourceSha256': checksums, 'outputSha256': output_checksums, 'joins': joins,
        'anchorWaterInput': {'path': 'public/data/basemap.geojson', 'sha256': hashlib.sha256(basemap_path.read_bytes()).hexdigest()} if water is not None else None,
    }, pretty=True)
    print(f'Built {len(features)} census tracts and {len(municipal_features)} census subdivisions.', flush=True)
    print(json.dumps(metadata['coverage'], ensure_ascii=False), flush=True)


def make_metadata(snapshot, features, municipalities):
    values = snapshot['region']['values']
    notes = {
        'populationDefinition': '人口为 2021 年普查总人口（100% 数据，特征 1），包括集体住所居民；不是私人住户人口。私人住户短表人口和族裔长表分母另存，三者不得混用。',
        'incomeDefinition': '2020 年私人住户税前总年收入中位数（加元），来自 2021 Census Profile 的 100% 数据（特征 229）；不是个人收入、税后收入或当前收入。',
        'chineseDefinition': 'Chinese 为 2021 普查 visible minority 分类之一（25% 长表加权估计），不是国籍、语言或祖源。占比以同一长表私人住户人口（特征 1669）为分母。',
        'childrenDefinition': '0–14 岁占比使用 Census Profile 直接发布百分比（特征 35），分母为年龄统计总人口（100% 数据），包括集体住所居民。',
        'householdSizeDefinition': '平均私人住户人数，2021 Census Profile 100% 数据（特征 56）。',
        'boundaryNote': '覆盖 Greater Vancouver 区域局（CD 5915，即大温哥华）的全部 535 个 2021 普查区。官方 Vancouver CMA 933 边界与此区域边界一致。38 个 Census subdivisions 包括市镇、原住民保留区和选举区，不代表 38 个城市。普查区不是市府命名社区；名称由市镇／地区与官方普查区编号组成。',
        'municipalityNote': '市镇／地区标签由官方 CSD 与普查区边界相交确定。CT 9330250.02 同时覆盖 Metro Vancouver A、Anmore、Belcarra 和 Lions Bay；筛选其中任何地区都会显示完整普查区，其统计值不可拆分。',
        'missingDataNote': '保密抑制、不适用或未发布值保留为空，不以 0 替代。Barnston Island 3 在 2021 年未能完成住户普查，未发布人口。灰色区域不表示无人居住、低收入或族裔人数为零。',
        'roundingNote': '普查分类人数按保密规则随机取整，25% 长表为加权估计。类别之和与分母可能略有差异。总人口与私人住户人口口径不同；市镇和区域收入中位数直接采用官方值，不平均普查区中位数。',
        'populationGroupsDefinition': '族裔视图使用 13 个互斥 visible minority 分类，起始未选择类别；“常用五类”可选中大温哥华人数最多的五个可见少数族裔类别。非可见少数族裔包括原住民等人口，不可等同于白人或欧洲裔。',
        'newCensusNote': '本应用使用已发布的 2021 年人口普查资料；人口参考年为 2021，收入参考年为 2020。',
    }
    en = {
        'populationDefinition': 'Population is the 2021 Census total population (100% data, characteristic 1), including collective-dwelling residents. Private-household population and the long-form population-group denominator are stored separately.',
        'incomeDefinition': 'Median total annual income of private households in 2020, before tax, in Canadian dollars (2021 Census Profile, 100% data, characteristic 229). This is not personal, after-tax or current income.',
        'chineseDefinition': 'Chinese is a 2021 Census visible-minority category from weighted 25% sample data, not a nationality, language or ancestry. Shares use the same long-form private-household denominator (characteristic 1669).',
        'childrenDefinition': 'The age 0–14 share is the published Census Profile percentage (characteristic 35). Its denominator is total age-group population, including collective dwellings (100% data).',
        'householdSizeDefinition': 'Average number of persons per private household, 2021 Census Profile 100% data (characteristic 56).',
        'boundaryNote': 'All 535 census tracts in the Greater Vancouver regional district (CD 5915), on 2021 boundaries. Official Vancouver CMA 933 geometry matches this regional boundary. The 38 census subdivisions include municipalities, Indigenous reserves and an electoral area; they are not 38 cities. Census tracts are not named municipal neighbourhoods.',
        'municipalityNote': 'Municipality/area labels are derived from intersections with official CSD boundaries. CT 9330250.02 covers Metro Vancouver A, Anmore, Belcarra and Lions Bay. Filtering any of these areas retains the entire tract; its statistics cannot be divided between them.',
        'missingDataNote': 'Suppressed, inapplicable and unpublished values remain null, never zero. Barnston Island 3 was incompletely enumerated in 2021, so its population was not published. Grey areas do not imply zero population, low income or absence of a population group.',
        'roundingNote': 'Census category counts are randomly rounded; long-form counts are weighted estimates. Group counts may not sum exactly to the denominator. Total population differs from private-household population. Regional and municipal income medians are official values, not averages of tract medians.',
        'populationGroupsDefinition': 'The population-group view uses 13 mutually exclusive visible-minority categories. No groups are initially selected; the Common five shortcut selects the five largest racialized groups in Metro Vancouver. Not a visible minority includes Indigenous people and must not be equated with White or European ancestry.',
        'newCensusNote': 'This application uses published 2021 Census data. The population reference year is 2021 and the income reference year is 2020.',
    }
    props = [f['properties'] for f in features]
    coverage = {
        'boundaryCount': len(features), 'publishedNeighbourhoodRows': len(features), 'censusTractCount': len(features),
        'censusSubdivisionCount': len(municipalities),
        'incomePublished': sum(p['income'] is not None for p in props),
        'chinesePublished': sum(p['chineseCount'] is not None for p in props),
        'populationTotalPublished': sum(p['populationTotal'] is not None for p in props),
        'populationPrivatePublished': sum(p['populationPrivate'] is not None for p in props),
        'householdSizePublished': sum(p['householdSize'] is not None for p in props),
        'zeroChineseCount': sum(p['chineseCount'] == 0 for p in props),
        'boundariesWithoutStatistics': sum(p['populationTotal'] is None for p in props),
        'boundariesMissingIncome': sum(p['income'] is None for p in props),
        'boundariesMissingChinese': sum(p['chineseCount'] is None for p in props),
    }
    return {
        'city': 'Metro Vancouver', 'cityName': 'Metro Vancouver', 'regionCode': '5915',
        'censusYear': 2021, 'incomeYear': 2020, 'populationYear': 2021,
        'verifiedAt': snapshot['retrievedAt'], 'preparedDate': snapshot['retrievedAt'],
        'cityIncomeMedian': values['229'], 'cityChineseCount': values['1672'],
        'cityChinesePct': values['1672'] / values['1669'], 'cityChinesePopulationBase': values['1669'],
        'cityPopulationPrivate': values['57'], 'cityPopulationTotal': values['1'],
        'cityChildrenPct': values['35'] / 100, 'cityHouseholdSize': values['56'],
        'populationLabel': '总人口', **notes, 'definitionsEn': en,
        'latestCensusNote': notes['newCensusNote'],
        'populationGroupsCoverage': coverage['chinesePublished'], 'populationGroupsBase': values['1669'],
        'coverage': coverage,
        'municipalities': [{'code': f['properties']['code'], 'name': f['properties']['name'],
                            'type': f['properties']['type'], 'centroid': f['properties']['centroid']} for f in municipalities],
        'attribution': 'Adapted from Statistics Canada, 2021 Census of Population and 2021 Cartographic Boundary Files. This does not constitute an endorsement by Statistics Canada of this product.',
        'license': 'Statistical data: Statistics Canada Open Licence. Cartographic boundaries: Open Government Licence – Canada. This product is not endorsed by Statistics Canada. Basemap and context sources are listed separately.',
        'sources': [
            {'label': 'Statistics Canada · Metro Vancouver 2021 Census Profile', 'url': profile_url('2021S0503933')},
            {'label': 'Statistics Canada · 2021 Census Profile SDMX API', 'url': f'{SDMX}/dataflow/STC_CP/DF_CT/{VERSION}?references=all'},
            {'label': 'Statistics Canada · 2021 Census tract boundaries', 'url': f'{BOUNDARY}/11'},
            {'label': 'Statistics Canada · 2021 Census subdivision boundaries', 'url': f'{BOUNDARY}/9'},
            {'label': 'Statistics Canada · 2021 Regional district boundaries', 'url': f'{BOUNDARY}/4'},
            {'label': 'Statistics Canada · 2021 Census metropolitan area boundaries', 'url': f'{BOUNDARY}/6'},
            {'label': 'Statistics Canada · Boundary files reference guide', 'url': 'https://www150.statcan.gc.ca/n1/pub/92-160-g/92-160-g2021002-eng.htm'},
            {'label': 'Statistics Canada · Incompletely enumerated reserves and settlements', 'url': 'https://www12.statcan.gc.ca/census-recensement/2021/ref/98-304/98-304-x2021001-eng.pdf'},
            {'label': 'Statistics Canada Open Licence', 'url': 'https://www.statcan.gc.ca/en/reference/licence'},
            {'label': 'Open Government Licence – Canada', 'url': 'https://open.canada.ca/en/open-government-licence-canada'},
        ],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='Refresh official source snapshots before building')
    args = parser.parse_args()
    if args.refresh:
        refresh()
    build()
