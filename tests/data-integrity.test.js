import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { populationShare, compositionSegments } from '../src/population-utils.js';

const read = path => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const source = read('data/source/census-values.json');
const features = read('public/data/communities.geojson').features;
const population = read('public/data/population-groups.json');
const metadata = read('public/data/metadata.json');
const groups = {
  south_asian: '1671', chinese: '1672', black: '1673', filipino: '1674', arab: '1675',
  latin_american: '1676', southeast_asian: '1677', west_asian: '1678', korean: '1679',
  japanese: '1680', visible_minority_nie: '1681', multiple_visible_minorities: '1682',
  not_visible_minority: '1683',
};

test('all 535 census tracts retain their own official counts and household income', () => {
  assert.equal(features.length, 535);
  assert.equal(Object.keys(source.ct).length, 535);
  assert.equal(new Set(features.map(f => f.properties.code)).size, 535);
  for (const { properties: p } of features) {
    const original = source.ct[p.code];
    assert.ok(original, p.code);
    for (const [field, characteristic] of Object.entries({ populationTotal: '1', income: '229', householdSize: '56' })) {
      assert.equal(p[field], original.values[characteristic], `${p.code}: ${field}`);
    }
    const expectedChildren = original.values['35'] === null ? null : original.values['35'] / 100;
    assert.equal(p.children, expectedChildren, `${p.code}: published child share`);
  }
});

test('population shares preserve the 25% table denominator and every original group value', () => {
  for (const { properties: p } of features) {
    const values = source.ct[p.code].values;
    const record = population.communities[p.code];
    if (!record) {
      assert.ok(values['1669'] === null || values['1669'] === 0 || Object.values(groups).some(id => values[id] === null), `${p.code}: complete record unexpectedly omitted`);
      continue;
    }
    assert.equal(record.population, values['1669'], `${p.code}: long-form base`);
    for (const [group, id] of Object.entries(groups)) {
      assert.equal(record.counts[group], values[id], `${p.code}: ${group}`);
      const share = populationShare(record, group);
      assert.equal(share, values[id] !== null && values['1669'] > 0 ? values[id] / values['1669'] : null);
    }
    if (Object.values(record.counts).some(value => value === null)) assert.deepEqual(compositionSegments(record, ['chinese']), []);
  }
});

test('regional comparisons use published regional values rather than averaging tracts', () => {
  assert.equal(metadata.populationYear, 2021);
  assert.equal(metadata.incomeYear, 2020);
  assert.equal(metadata.cityPopulationTotal, 2642825);
  assert.equal(metadata.cityIncomeMedian, 90000);
  assert.equal(metadata.cityIncomeMedian, source.region.values['229']);
  assert.equal(population.city.population, 2607010);
  assert.equal(population.city.counts.chinese, 512260);
  assert.notEqual(population.city.population, metadata.cityPopulationTotal);
  for (const [group, id] of Object.entries(groups)) assert.equal(population.city.counts[group], source.region.values[id], group);
});

test('area filtering retains all statistical subdivisions and identifies shared tracts', () => {
  const memberships = new Set(features.flatMap(f => f.properties.municipalities || [f.properties.municipality]));
  assert.equal(Object.keys(source.csd).length, 38);
  assert.equal(memberships.size, 38);
  for (const name of ['Vancouver', 'Richmond', 'Burnaby', 'Surrey']) assert.ok(memberships.has(name), name);
  const shared = features.filter(f => f.properties.municipalities?.length > 1);
  assert.ok(shared.length > 0, 'Known cross-municipality tracts must be identified');
  for (const f of shared) assert.ok(f.properties.caveat && f.properties.caveatEn, f.properties.code);
  for (const code of Object.keys(source.csd)) assert.match(code, /^5915\d{3}$/);
});

test('the census metropolitan area matches the requested Metro Vancouver regional boundary', () => {
  const cma = read('data/source/cma-boundaries.geojson').features[0];
  const cd = read('data/source/cd-boundaries.geojson').features[0];
  assert.equal(cd.properties.CDUID, '5915');
  assert.equal(cma.properties.CMAPUID, '59933');
  assert.deepEqual(cma.geometry, cd.geometry);
});
