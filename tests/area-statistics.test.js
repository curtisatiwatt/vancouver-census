import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { incomeForArea, incomeMetricLabel } from '../src/area-statistics.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url)));
const areas = read('neighbourhoods.json').features;
const get = id => areas.find(feature => feature.properties.id === id);

test('municipal income colours use the same published statistic shown in the profile', () => {
  const steveston = incomeForArea(get('richmond-steveston'));
  assert.equal(steveston.value, 102000);
  assert.equal(steveston.statistic, 'median');
  assert.equal(steveston.scope, 'neighbourhood');
  assert.equal(steveston.year, 2020);
  assert.equal(steveston.pattern, 'solid');
  assert.equal(steveston.sourceUrl, get('richmond-steveston').properties.statistics.incomeMedian.sourceUrl);
  assert.equal(incomeForArea(get('vancouver-kitsilano')).value, 87000);
});

test('Surrey averages retain their metric, year and a distinct pattern instead of becoming medians', () => {
  const whalley = incomeForArea(get('surrey-whalley'));
  assert.equal(whalley.value, 111900);
  assert.equal(whalley.statistic, 'average');
  assert.equal(whalley.pattern, 'diagonal');
  assert.equal(whalley.year, 2020);
  assert.equal(incomeMetricLabel(whalley), '家庭收入平均数 · 2020');
  assert.equal(incomeMetricLabel(whalley, 'en'), 'Average household income · 2020');
  assert.equal(areas.map(feature => incomeForArea(feature)).filter(metric => metric?.statistic === 'average').length, 7);
});

test('separate component incomes and missing municipal values cannot fabricate one area income', () => {
  const combined = get('richmond-east-richmond-fraser-lands');
  assert.equal(combined.properties.statistics.subprofiles.length, 2);
  assert.equal(incomeForArea(combined), null);
  const missing = structuredClone(get('burnaby-metrotown'));
  missing.properties.income = 123456;
  missing.properties.anchorTractCode = '9330226.03';
  assert.equal(incomeForArea(missing), null, 'a tract or anchor value cannot become a municipal statistic');
});

test('published zero survives, missing values stay missing, and source records are untouched', () => {
  const statistics = { incomeMedian: { value: 0, year: 2016, sourceUrl: 'https://example.org/median' }, incomeAverage: { value: 90000, year: 2020 } };
  const feature = { properties: { kind: 'neighbourhood', statistics } };
  const before = structuredClone(feature);
  assert.equal(incomeForArea(feature).value, 0);
  assert.equal(incomeForArea(feature).year, 2016);
  assert.equal(incomeForArea(feature).statistic, 'median');
  assert.deepEqual(feature, before);
  for (const value of [null, undefined, NaN, Infinity, '90000']) {
    assert.equal(incomeForArea({ properties: { kind: 'neighbourhood', statistics: { incomeMedian: { value } } } }), null);
  }
});

test('census fallback describes only its own tract and takes its year from explicit metadata', () => {
  const tract = read('communities.geojson').features[0];
  const metric = incomeForArea(tract, { incomeYear: 2020 });
  assert.equal(metric.value, tract.properties.income);
  assert.equal(metric.statistic, 'median');
  assert.equal(metric.scope, 'tract');
  assert.equal(metric.year, 2020);
  assert.equal(metric.pattern, 'solid');
  assert.equal(incomeForArea(tract).year, null);
  assert.equal(incomeMetricLabel(incomeForArea(tract), 'en'), 'Median household income');
  assert.equal(incomeForArea(null), null);
  assert.equal(incomeForArea({ properties: { income: null } }), null);
});
