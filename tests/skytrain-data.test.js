import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const skytrain = read('public/data/skytrain.geojson');
const source = read('data/source/skytrain-gtfs.json');
const routes = skytrain.features.filter(f => f.properties.kind === 'transit_route');
const stations = skytrain.features.filter(f => f.properties.kind === 'transit_station');
const ids = ['expo', 'millennium', 'canada'];

test('SkyTrain includes three operating lines and 54 distinct physical stations', () => {
  assert.equal(skytrain.type, 'FeatureCollection');
  assert.equal(routes.length, 3);
  assert.deepEqual(new Set(routes.map(f => f.properties.lineId)), new Set(ids));
  assert.equal(stations.length, 54);
  assert.equal(new Set(stations.map(f => f.properties.id)).size, 54);
  assert.equal(new Set(stations.map(f => f.properties.name)).size, 54);
  for (const f of skytrain.features) {
    assert.equal(f.properties.status, 'operating');
    assert.ok(f.properties.sourceUrl.startsWith('https://'));
  }
  for (const [id, count] of Object.entries({ expo: 24, millennium: 17, canada: 17 })) {
    assert.equal(stations.filter(f => f.properties.lines.includes(id)).length, count, id);
  }
});

test('interchanges are shared stations rather than duplicate overlapping points', () => {
  const interchanges = stations.filter(f => f.properties.lines.length > 1);
  assert.equal(interchanges.length, 4);
  assert.deepEqual(new Set(interchanges.map(f => f.properties.name)), new Set([
    'Waterfront', 'Commercial-Broadway', 'Lougheed Town Centre', 'Production Way-University',
  ]));
  for (const f of stations) {
    assert.equal(f.properties.transfer, f.properties.lines.length > 1, f.properties.name);
    assert.equal(f.geometry.type, 'Point');
    assert.ok(f.properties.lines.every(id => ids.includes(id)));
  }
});

test('airport, Richmond, Surrey and Evergreen branches remain present', () => {
  for (const name of ['Capstan', 'King George', 'YVR-Airport', 'Richmond-Brighouse', 'VCC-Clark', 'Lafarge Lake-Douglas']) {
    assert.ok(stations.some(f => f.properties.name === name), name);
  }
  for (const f of routes) {
    assert.equal(f.geometry.type, 'MultiLineString');
    assert.equal(f.geometry.coordinates.length, f.properties.lineId === 'millennium' ? 1 : 2);
    for (const branch of f.geometry.coordinates) {
      assert.ok(branch.length > 100, `${f.properties.name}: real GTFS path detail`);
      for (const [lng, lat] of branch) assert.ok(lng > -123.4 && lng < -122.5 && lat > 49 && lat < 49.5);
    }
  }
});

test('routes and station locations preserve the exact official GTFS snapshot', () => {
  for (const f of routes) {
    assert.equal(f.properties.shapeIds.length, f.geometry.coordinates.length);
    for (const [i, id] of f.properties.shapeIds.entries()) {
      const expected = [...source.shapes[id]].sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence))
        .map(row => [Number(row.shape_pt_lon), Number(row.shape_pt_lat)]);
      assert.deepEqual(f.geometry.coordinates[i], expected, id);
    }
  }
  const sourceStops = new Map(source.stops.map(row => [row.stop_id, row]));
  for (const f of stations) {
    const original = sourceStops.get(f.properties.sourceStopId);
    assert.equal(original.location_type, '1');
    assert.deepEqual(f.geometry.coordinates, [Number(original.stop_lon), Number(original.stop_lat)], f.properties.name);
    assert.equal(f.properties.sourceStopName, original.stop_name);
  }
});

function distanceToSegment(point, a, b) {
  const scale = 111320;
  const lon = Math.cos(point[1] * Math.PI / 180) * scale;
  const x = (a[0] - point[0]) * lon, y = (a[1] - point[1]) * scale;
  const dx = (b[0] - a[0]) * lon, dy = (b[1] - a[1]) * scale;
  const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x + t * dx, y + t * dy);
}

test('each station is positioned near the actual shape of every line serving it', () => {
  for (const f of stations) for (const id of f.properties.lines) {
    const lines = routes.find(route => route.properties.lineId === id).geometry.coordinates;
    let distance = Infinity;
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      distance = Math.min(distance, distanceToSegment(f.geometry.coordinates, line[i - 1], line[i]));
    }
    assert.ok(distance < 300, `${f.properties.name} / ${id}: ${distance.toFixed(0)} m from its track`);
  }
});
