import test from 'node:test';
import assert from 'node:assert/strict';
import { containsLocation, localCensusFallback } from '../src/selection-statistics.js';

const tract = { properties: { code: '933001', populationTotal: 500, income: 82000, sourceUrl: 'https://example.com/census' } };
const record = { population: 490, counts: { chinese: 120, black: null } };
const groups = [{ id: 'chinese', name: 'Chinese' }, { id: 'black', name: 'Black' }];
const area = statistics => ({ properties: { statistics } });

test('automatic local fallback preserves exact source values and their own scope', () => {
  const result = localCensusFallback(area({}), tract, record, groups);
  assert.equal(result.properties.code, '933001');
  assert.equal(result.properties.statistics.population.value, 500);
  assert.equal(result.properties.statistics.incomeMedian.value, 82000);
  assert.deepEqual(result.properties.statistics.groups.map(g => g.value), [120, null]);
  assert.ok(result.properties.statistics.notes[0].en.includes('490'));
  assert.equal(tract.properties.statistics, undefined);
});

test('published municipal values and separate subprofiles are never replaced by local values', () => {
  const stats = { population: { value: 5000 }, incomeAverage: { value: 110000 }, groups: [{ value: 12 }] };
  assert.equal(localCensusFallback(area(stats), tract, record, groups), null);
  const combined = { population: { value: 5000 }, groups: [{ value: 12 }], subprofiles: [{ statistics: { incomeMedian: { value: 70000 } } }] };
  assert.equal(localCensusFallback(area(combined), tract, record, groups), null);
});

test('partial municipal profiles only supplement absent fields and retain published zero', () => {
  const result = localCensusFallback(area({ population: { value: 0 }, groups: [{ value: 0 }] }), tract, record, groups);
  assert.equal(result.properties.statistics.population, null);
  assert.deepEqual(result.properties.statistics.groups, []);
  assert.equal(result.properties.statistics.incomeMedian.value, 82000);
  assert.equal(localCensusFallback(area({}), null, null, groups), null);
});

test('map click lookup respects holes and separate polygon parts', () => {
  const ring = (a,b,c,d) => [[a,b],[c,b],[c,d],[a,d],[a,b]];
  const feature = { geometry: { type: 'MultiPolygon', coordinates: [[ring(0,0,10,10), ring(3,3,7,7)], [ring(20,0,30,10)]] } };
  assert.equal(containsLocation(feature, { lng: 1, lat: 1 }), true);
  assert.equal(containsLocation(feature, { lng: 5, lat: 5 }), false);
  assert.equal(containsLocation(feature, { lng: 15, lat: 5 }), false);
  assert.equal(containsLocation(feature, { lng: 25, lat: 5 }), true);
  assert.equal(containsLocation(feature, null), false);
});
