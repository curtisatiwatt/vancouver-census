#!/usr/bin/env python3
"""Build SkyTrain geometry from a compact, reproducible official GTFS snapshot.

Python 3.9+ standard library only. Offline: python3 scripts/build-skytrain.py
Refresh: python3 scripts/build-skytrain.py --refresh --snapshot-date YYYY-MM-DD
Existing download: add --gtfs-zip /path/to/google_transit.zip instead of --refresh.
The website reads only public/data/skytrain.geojson; no key or live API is needed.
"""
import argparse
import collections
import csv
import datetime
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'data/source/skytrain-gtfs.json'
FEED_URL = 'https://gtfs-static.translink.ca/gtfs/google_transit.zip'
TERMS_URL = 'https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data'
SCHEDULE_URL = 'https://www.translink.ca/schedules-and-maps/skytrain'
ATTRIBUTION = ('Route and arrival data used in this product or service is provided by permission of TransLink. '
               'TransLink assumes no responsibility for the accuracy or currency of the Data used in this product or service.')
LINES = {'Expo Line': 'expo', 'Millennium Line': 'millennium', 'Canada Line': 'canada'}
ORDER = ['expo', 'millennium', 'canada']


def write(path, data, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False,
                              indent=2 if pretty else None,
                              separators=None if pretty else (',', ':')) + '\n')


def extract(raw, snapshot_date):
    """Keep original GTFS rows sufficient to rebuild the selected network offline."""
    day = datetime.date.fromisoformat(snapshot_date)
    date_code = day.strftime('%Y%m%d')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        def rows(name):
            return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding='utf-8-sig'))

        feed = list(rows('feed_info.txt'))
        if not feed or not feed[0]['feed_start_date'] <= date_code <= feed[0]['feed_end_date']:
            raise ValueError('Requested snapshot date is outside this GTFS feed service window')
        routes = {r['route_id']: r for r in rows('routes.txt')
                  if r['route_type'] == '1' and r['route_long_name'] in LINES}
        if {r['route_long_name'] for r in routes.values()} != set(LINES):
            raise ValueError('Expected all three SkyTrain lines in the official feed')
        calendars = list(rows('calendar.txt'))
        exceptions = [r for r in rows('calendar_dates.txt') if r['date'] == date_code]
        active = {r['service_id'] for r in calendars
                  if r['start_date'] <= date_code <= r['end_date'] and r[day.strftime('%A').lower()] == '1'}
        for row in exceptions:
            if row['exception_type'] == '1':
                active.add(row['service_id'])
            else:
                active.discard(row['service_id'])
        trips = {r['trip_id']: r for r in rows('trips.txt')
                 if r['route_id'] in routes and r['service_id'] in active}
        stops = {r['stop_id']: r for r in rows('stops.txt')}
        stop_times = collections.defaultdict(list)
        for row in rows('stop_times.txt'):
            if row['trip_id'] in trips:
                stop_times[row['trip_id']].append(row)
        for trip_id in stop_times:
            stop_times[trip_id].sort(key=lambda row: int(row['stop_sequence']))
        members = collections.defaultdict(set)
        for trip_id, sequence in stop_times.items():
            for row in sequence:
                parent = stops[row['stop_id']]['parent_station']
                if not parent or stops[parent]['location_type'] != '1':
                    raise ValueError('SkyTrain platform has no valid official parent station')
                members[trips[trip_id]['route_id']].add(parent)

        # Choose complete trips from one direction using a greedy station-set cover.
        # Both branches of Expo and Canada are retained; short turns cannot replace
        # complete branches. All station memberships are checked against every
        # SkyTrain trip active on the snapshot date, not just these representatives.
        chosen = []
        for route_id in sorted(routes):
            candidates = {}
            for trip_id, trip in trips.items():
                if trip['route_id'] != route_id or trip['direction_id'] != '0':
                    continue
                sequence = stop_times[trip_id]
                parents = tuple(stops[row['stop_id']]['parent_station'] for row in sequence)
                key = (trip['shape_id'], parents)
                if key not in candidates or trip_id < candidates[key]['trip_id']:
                    candidates[key] = {'trip_id': trip_id, 'parents': set(parents)}
            remaining = members[route_id].copy()
            while remaining:
                candidate = max(candidates.values(), key=lambda item:
                                (len(remaining & item['parents']), len(item['parents']), item['trip_id']))
                gained = remaining & candidate['parents']
                if not gained:
                    raise ValueError('Direction 0 cannot cover every active station on ' + route_id)
                chosen.append(candidate['trip_id'])
                remaining -= gained
        selected_trips = [trips[trip_id] for trip_id in sorted(chosen)]
        selected_times = [row for trip in selected_trips for row in stop_times[trip['trip_id']]]
        shape_ids = {trip['shape_id'] for trip in selected_trips}
        shapes = collections.defaultdict(list)
        for row in rows('shapes.txt'):
            if row['shape_id'] in shape_ids:
                shapes[row['shape_id']].append(row)
        for shape_id in shapes:
            shapes[shape_id].sort(key=lambda row: int(row['shape_pt_sequence']))
        platform_ids = {row['stop_id'] for row in selected_times}
        station_ids = set.union(*members.values())
        return {
            'schemaVersion': 1, 'preparedDate': snapshot_date, 'sourceUrl': FEED_URL,
            'downloadSha256': hashlib.sha256(raw).hexdigest(), 'feedInfo': feed,
            'routes': [routes[rid] for rid in sorted(routes)],
            'trips': selected_trips, 'stopTimes': selected_times,
            'stops': [stops[sid] for sid in sorted(platform_ids | station_ids)],
            'shapes': {sid: shapes[sid] for sid in sorted(shapes)},
            'activeServiceIds': sorted(active),
            'calendar': [row for row in calendars if row['service_id'] in {t['service_id'] for t in selected_trips}],
            'calendarExceptionsOnSnapshotDate': exceptions,
            'activeSkyTrainTripCount': len(trips),
            'stationIdsByRouteFromAllActiveTrips': {rid: sorted(members[rid]) for rid in sorted(members)},
        }


def build(snapshot):
    routes = {r['route_id']: r for r in snapshot['routes']}
    trips = {t['trip_id']: t for t in snapshot['trips']}
    stops = {s['stop_id']: s for s in snapshot['stops']}
    sequences = collections.defaultdict(list)
    for row in snapshot['stopTimes']:
        sequences[row['trip_id']].append(row)
    for sequence in sequences.values():
        sequence.sort(key=lambda row: int(row['stop_sequence']))
    by_route = collections.defaultdict(list)
    memberships = collections.defaultdict(set)
    terminal_ids = set()
    for trip_id, trip in trips.items():
        by_route[trip['route_id']].append(trip)
        parents = [stops[r['stop_id']]['parent_station'] for r in sequences[trip_id]]
        terminal_ids.update([parents[0], parents[-1]])
        for parent in parents:
            memberships[parent].add(LINES[routes[trip['route_id']]['route_long_name']])
    features = []
    route_audit = []
    for route_id, route in sorted(routes.items(), key=lambda pair: ORDER.index(LINES[pair[1]['route_long_name']])):
        line_id = LINES[route['route_long_name']]
        selected = sorted(by_route[route_id], key=lambda trip: trip['shape_id'])
        route_stations = {sid for sid, lines in memberships.items() if line_id in lines}
        if route_stations != set(snapshot['stationIdsByRouteFromAllActiveTrips'][route_id]):
            raise ValueError('Selected shapes omit active station memberships on ' + line_id)
        lines = []
        branches = []
        for trip in selected:
            points = snapshot['shapes'][trip['shape_id']]
            coords = [[float(p['shape_pt_lon']), float(p['shape_pt_lat'])] for p in points]
            if len(coords) < 2:
                raise ValueError('Missing official trip shape')
            lines.append(coords)
            parents = [stops[r['stop_id']]['parent_station'] for r in sequences[trip['trip_id']]]
            branches.append({'shapeId': trip['shape_id'], 'tripId': trip['trip_id'],
                             'fromStationId': parents[0], 'toStationId': parents[-1],
                             'stationIds': parents, 'pointCount': len(coords)})
        features.append({'type': 'Feature', 'geometry': {'type': 'MultiLineString', 'coordinates': lines},
                         'properties': {'id': 'skytrain-' + line_id, 'kind': 'transit_route',
                                        'lineId': line_id, 'name': route['route_long_name'],
                                        'status': 'operating', 'color': '#' + route['route_color'],
                                        'sourceRouteId': route_id, 'shapeIds': [t['shape_id'] for t in selected],
                                        'sourceUrl': SCHEDULE_URL}})
        route_audit.append({'lineId': line_id, 'sourceRouteId': route_id,
                            'stationCount': len(route_stations), 'branches': branches})
    for station_id, lines in sorted(memberships.items(), key=lambda pair: stops[pair[0]]['stop_name']):
        station = stops[station_id]
        ordered_lines = [line for line in ORDER if line in lines]
        features.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates':
                         [float(station['stop_lon']), float(station['stop_lat'])]},
                         'properties': {'id': station_id, 'kind': 'transit_station',
                                        'name': station['stop_name'].removesuffix(' Station'),
                                        'sourceStopName': station['stop_name'], 'sourceStopId': station_id,
                                        'lines': ordered_lines, 'status': 'operating',
                                        'transfer': len(lines) > 1, 'terminal': station_id in terminal_ids,
                                        'branch': station_id in {'99907', '99946'},
                                        'sourceUrl': SCHEDULE_URL}})
    for feature in features:
        coords = feature['geometry']['coordinates']
        points = [coords] if feature['geometry']['type'] == 'Point' else [p for line in coords for p in line]
        if not all(-123.25 < lng < -122.7 and 49.1 < lat < 49.4 for lng, lat in points):
            raise ValueError('Transit geometry outside expected operating network extent')
    output = {'type': 'FeatureCollection', 'schemaVersion': 1,
              'preparedDate': snapshot['preparedDate'], 'attribution': ATTRIBUTION,
              'sourceUrl': FEED_URL, 'feedVersion': snapshot['feedInfo'][0]['feed_version'],
              'features': features}
    output_path = ROOT / 'public/data/skytrain.geojson'
    write(output_path, output)
    sources = [
        {'label': 'TransLink · GTFS Static Data and licence', 'url': TERMS_URL},
        {'label': 'TransLink · Official SkyTrain routes and stations', 'url': SCHEDULE_URL},
        {'label': 'TransLink · Capstan Station', 'url': 'https://www.translink.ca/plans-and-projects/projects/rapid-transit-projects/capstan-station'},
        {'label': 'TransLink · Broadway Subway extension (not yet open)', 'url': 'https://www.translink.ca/plans-and-projects/projects/rapid-transit-projects/broadway-subway-project'},
        {'label': 'TransLink · Surrey Langley extension (not yet open)', 'url': 'https://www.translink.ca/plans-and-projects/projects/rapid-transit-projects/surrey-langley-skytrain'},
    ]
    metadata = {
        'transitPreparedDate': snapshot['preparedDate'],
        'transitDefinition': 'SkyTrain 图层显示 Expo、Millennium 和 Canada 三条运营线路与 54 座车站（包括 Capstan），采用 TransLink 官方 GTFS 的 ' + snapshot['preparedDate'] + ' 运营快照。线路直接取自班次形状，换乘站按官方 parent station 合并；不表示实时班次、服务中断或步行入口。Broadway Subway 与 Surrey–Langley 扩建尚未开放，不画作运营线路；不包括 SeaBus 或 West Coast Express。',
        'definitionsEn': {'transitDefinition': 'The SkyTrain layer shows the operating Expo, Millennium and Canada lines and 54 stations, including Capstan, from the official TransLink GTFS service snapshot for ' + snapshot['preparedDate'] + '. Routes use actual trip shapes and interchange platforms are grouped by official parent station. This is not live arrival, disruption or walking-entrance information. The Broadway Subway and Surrey–Langley extensions are not yet open and are not shown as operating lines. SeaBus and West Coast Express are excluded.'},
        'transitAttribution': ATTRIBUTION,
        'transitLicense': 'TransLink GTFS Static Data Terms and Conditions',
        'sources': sources,
    }
    write(ROOT / 'data/source/skytrain-metadata.json', metadata, True)
    audit = {
        'preparedDate': snapshot['preparedDate'], 'feed': snapshot['feedInfo'][0],
        'sourceUrl': FEED_URL, 'termsUrl': TERMS_URL, 'attribution': ATTRIBUTION,
        'sourceZipSha256': snapshot['downloadSha256'],
        'snapshotSha256': hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest(),
        'outputSha256': hashlib.sha256(output_path.read_bytes()).hexdigest(),
        'activeSkyTrainTripCount': snapshot['activeSkyTrainTripCount'],
        'method': 'Resolve calendar.txt and calendar_dates.txt for the snapshot date; select only route_type=1 routes named Expo Line, Millennium Line or Canada Line. Select complete direction-0 trips covering all active parent-station memberships. Preserve their original shapes point-for-point and all branch paths. Group platforms by parent_station and use the unchanged official parent point. No station-to-station interpolation, invented path or external geocoder is used.',
        'limitations': 'One representative direction per branch; geometry is a service alignment, not a survey of every rail. Shared trunk segments can repeat within a route feature. Parent-station points can be displaced from individual platforms, particularly Waterfront. Static schedule snapshot; not live operational status or an accessible entrance map. Planned extensions, SeaBus and West Coast Express are excluded.',
        'routeCount': len(routes), 'stationCount': len(memberships),
        'interchangeStationIds': sorted(sid for sid, lines in memberships.items() if len(lines) > 1),
        'routes': route_audit, 'sources': sources,
    }
    write(ROOT / 'data/audit/skytrain.json', audit, True)
    print(json.dumps({'routeCount': audit['routeCount'], 'stationCount': audit['stationCount'],
                      'stationsByLine': {r['lineId']: r['stationCount'] for r in route_audit},
                      'branchCount': sum(len(r['branches']) for r in route_audit),
                      'feedVersion': snapshot['feedInfo'][0]['feed_version']}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--gtfs-zip', type=Path)
    parser.add_argument('--snapshot-date', default='2026-11-06')
    args = parser.parse_args()
    if args.refresh or args.gtfs_zip:
        if args.gtfs_zip:
            raw = args.gtfs_zip.read_bytes()
        else:
            with urllib.request.urlopen(FEED_URL, timeout=120) as response:
                raw = response.read()
        write(SNAPSHOT, extract(raw, args.snapshot_date))
    if not SNAPSHOT.exists():
        parser.error('No retained snapshot; use --refresh or --gtfs-zip first')
    build(json.loads(SNAPSHOT.read_text()))


if __name__ == '__main__':
    main()
