import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POPULATION_GROUP_IDS, populationShare } from '../src/population-utils.js';

const read = file => JSON.parse(fs.readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8'));
const areas = read('communities.geojson');
const data = read('population-groups.json');
const metadata = read('metadata.json');
assert.equal(areas.type, 'FeatureCollection');
assert.equal(areas.features.length, 535, 'All 2021 Vancouver CMA census tracts must be retained');
assert.equal(metadata.populationYear, 2021);
assert.equal(metadata.incomeYear, 2020);
assert.equal(metadata.cityPopulationTotal, 2642825);
assert.equal(metadata.cityIncomeMedian, 90000);
assert.equal(data.schemaVersion, 1);
assert.deepEqual(new Set(data.groups.map(group => group.id)), new Set(POPULATION_GROUP_IDS));
assert.equal(data.city.population, 2607010);
assert.equal(data.city.counts.chinese, 512260);

const codes = new Set();
const numeric = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
function coordinates(value, label) {
  if (typeof value[0] === 'number') {
    assert.ok(value.length >= 2 && value.every(Number.isFinite), `${label}: invalid coordinate`);
    assert.ok(value[0] >= -124.5 && value[0] <= -121.5 && value[1] >= 48.5 && value[1] <= 50.5, `${label}: outside Metro Vancouver context`);
  } else {
    assert.ok(value.length, `${label}: empty geometry`);
    value.forEach(item => coordinates(item, label));
  }
}
for (const feature of areas.features) {
  const p = feature.properties;
  assert.ok(!codes.has(p.code), `Duplicate tract ${p.code}`);
  codes.add(p.code);
  assert.match(p.code, /^933\d{4}\.\d{2}$/);
  assert.ok(p.name && p.municipality && p.sourceUrl?.startsWith('https://'));
  assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
  coordinates(feature.geometry.coordinates, p.code);
  coordinates(p.centroid, p.code);
  for (const field of ['population', 'populationTotal', 'income', 'children', 'householdSize', 'chineseCount']) {
    assert.ok(numeric(p[field]), `${p.code}: invalid ${field}`);
  }
  assert.ok(p.children === null || p.children <= 1);
}
for (const [code, record] of Object.entries(data.communities)) {
  assert.ok(codes.has(code), `Orphan population record ${code}`);
  assert.ok(numeric(record.population), `${code}: invalid long-form population`);
  for (const id of POPULATION_GROUP_IDS) {
    assert.ok(numeric(record.counts[id]), `${code}: invalid ${id}`);
    const share = populationShare(record, id);
    if (record.population > 0 && record.counts[id] !== null) {
      assert.equal(share, record.counts[id] / record.population, `${code}: wrong denominator`);
    } else assert.equal(share, null);
  }
}
for (const file of ['basemap.geojson', 'geographic-context.geojson', 'orientation-landmarks.geojson', 'skytrain.geojson']) {
  const collection = read(file);
  assert.equal(collection.type, 'FeatureCollection', file);
  for (const feature of collection.features) coordinates(feature.geometry.coordinates, `${file}: ${feature.properties.name}`);
}
assert.ok(metadata.sources.length >= 2 && metadata.sources.every(source => source.url.startsWith('https://')));
console.log(`Verified ${codes.size} census tracts, ${Object.keys(data.communities).length} population records, 13 groups, official regional benchmarks and local geography.`);
