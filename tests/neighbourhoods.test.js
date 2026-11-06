import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { nameCensusTracts } from '../src/neighbourhoods.js';
import { searchMapFeatures } from '../src/map-utils.js';

const read = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url)));
const areas = read('public/data/neighbourhoods.json');
const census = read('public/data/communities.geojson').features;
const named = nameCensusTracts(census, areas);
const recordFiles = readdirSync(new URL('../data/source/municipal-neighbourhoods/', import.meta.url)).filter(name => name.endsWith('-profiles.json'));
const originals = new Map(recordFiles.flatMap(name => read(`data/source/municipal-neighbourhoods/${name}`).records).map(record => [record.id, record]));

test('official neighbourhood names change navigation, never census geometry or observations', () => {
  assert.equal(named.length, 535);
  for (let i = 0; i < census.length; i++) {
    assert.equal(named[i].geometry, census[i].geometry);
    for (const key of ['income', 'populationTotal', 'chineseCount', 'children', 'households', 'householdSize', 'sourceUrl']) assert.deepEqual(named[i].properties[key], census[i].properties[key]);
    if (named[i].properties.neighbourhoodIds) {
      assert.ok(named[i].properties.scopeNote);
      assert.ok(named[i].properties.aliases.includes(census[i].properties.name));
    }
  }
  assert.equal(census[0].properties.name, 'Vancouver · 0001.01', 'source snapshot is immutable');
});

test('community names take priority without a row of duplicate numbered tracts', () => {
  const results = searchMapFeatures(named, [], 'Kitsilano', areas.features);
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'neighbourhood');
  assert.equal(results[0].feature.properties.name, 'Kitsilano');
  const tract = named.find(feature => feature.properties.neighbourhoodNames?.includes('Kitsilano'));
  const exact = searchMapFeatures(named, [], tract.properties.code, areas.features);
  assert.equal(exact[0].type, 'area');
  assert.equal(exact[0].feature.properties.code, tract.properties.code);
});

test('each name association points to an official area in the tract municipality', () => {
  const byId = new Map(areas.features.map(f => [f.properties.id, f.properties]));
  assert.equal(byId.size, areas.features.length);
  for (const f of named) for (const id of f.properties.neighbourhoodIds || []) {
    assert.ok(byId.has(id));
    assert.ok(f.properties.municipalities.includes(byId.get(id).municipality), `${f.properties.code}: ${id}`);
  }
  for (const f of areas.features) {
    if (f.properties.anchorTractCode) assert.ok(census.some(ct => ct.properties.code === f.properties.anchorTractCode));
    assert.ok(f.properties.sourceUrl.startsWith('https://'));
  }
});

test('published community values and missing fields survive the offline build exactly', () => {
  for (const { properties: p } of areas.features) assert.deepEqual(p.statistics, originals.get(p.id).statistics, p.name);
  const get = id => areas.features.find(f => f.properties.id === id).properties;
  assert.equal(get('surrey-whalley').statistics.incomeMedian, null);
  assert.equal(get('surrey-whalley').statistics.incomeAverage.value, 111900);
  assert.equal(get('richmond-steveston').statistics.incomeMedian.value, 102000);
  assert.equal(get('burnaby-metrotown').statistics.population, null);
  assert.equal(get('vancouver-kitsilano').statistics.population.value, 44480);
});

test('Richmond place records do not redistribute municipal polygon boundaries', () => {
  const richmond = areas.features.filter(f => f.properties.municipality === 'Richmond');
  assert.ok(richmond.length >= 14);
  assert.ok(richmond.every(f => f.geometry.type === 'Point' && f.properties.locationOnly));
  const combined = richmond.find(f => f.properties.name === 'East Richmond / Fraser Lands');
  assert.equal(combined.properties.statistics.incomeMedian, null);
  assert.equal(combined.properties.statistics.subprofiles.length, 2);
});

test('unmapped jurisdictions retain their original names and exact statistics', () => {
  const source = census.find(f => f.properties.municipality === 'Semiahmoo');
  assert.ok(source);
  assert.equal(named.find(f => f.properties.code === source.properties.code), source);
});
