import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchFeatures, searchMapFeatures } from '../src/map-utils.js';

const transit = JSON.parse(readFileSync(new URL('../public/data/skytrain.geojson', import.meta.url)));
const area = (code, name, aliases = []) => ({ properties: { code, name, aliases, income: 100000 } });
const areas = [area('9330001.00', 'Vancouver · CT 0001.00', ['温哥华']), area('9330012.00', 'Richmond · CT 0012.00')];

test('station names, punctuation and station suffixes return the real station without census values', () => {
  for (const query of ['Waterfront', 'waterfront station', 'Waterfront站', 'Broadway City Hall', 'YVR-Airport']) {
    const result = searchMapFeatures(areas, transit.features, query)[0];
    assert.equal(result.type, 'station', query);
    assert.equal(result.feature.geometry.type, 'Point');
    assert.ok(result.feature.properties.lines.length);
    assert.equal(result.feature.properties.income, undefined);
    assert.equal(result.feature.properties.code, undefined);
    assert.ok(transit.features.includes(result.feature));
  }
});

test('unified results preserve area search and let station names remain reachable within broad city matches', () => {
  assert.deepEqual(searchMapFeatures(areas, [], '9330001.00'), [{ type: 'area', feature: areas[0] }]);
  assert.equal(searchMapFeatures(areas, transit.features, '温哥华')[0].feature, areas[0]);
  assert.deepEqual(searchMapFeatures(areas, [], 'richmond').map(result => result.feature), searchFeatures(areas, 'richmond'));
  const manyAreas = Array.from({ length: 30 }, (_, i) => area(String(i), `Richmond · CT ${i}`));
  const results = searchMapFeatures(manyAreas, transit.features, 'Richmond');
  assert.equal(results.length, 12);
  assert.equal(results[0].type, 'station');
  assert.equal(results[0].feature.properties.name, 'Richmond-Brighouse');
  assert.ok(results.some(result => result.type === 'area'));
  // A municipality filter limits areas, but cannot hide a station in another city.
  assert.equal(searchMapFeatures([], transit.features, 'Metrotown')[0].type, 'station');
});

test('empty queries and absent, duplicate, planned or unusable transit features are safe', () => {
  assert.deepEqual(searchMapFeatures(areas, transit.features, ''), []);
  assert.deepEqual(searchMapFeatures(areas, undefined, 'Waterfront'), []);
  const station = transit.features.find(feature => feature.properties.name === 'Waterfront');
  const planned = { ...station, properties: { ...station.properties, id: 'planned', status: 'planned' } };
  const noLocation = { ...station, properties: { ...station.properties, id: 'bad' }, geometry: { type: 'Point', coordinates: [NaN, 49] } };
  const results = searchMapFeatures([], [...transit.features, station, planned, noLocation], 'Waterfront');
  assert.equal(results.length, 1);
  assert.equal(results[0].feature, station);
});
