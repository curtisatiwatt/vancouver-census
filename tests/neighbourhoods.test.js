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
const insideRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const insidePolygon = (point, geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
  .some(rings => insideRing(point, rings[0]) && !rings.slice(1).some(ring => insideRing(point, ring)));

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

test('Richmond whole-community selection uses public census blocks and retains original point sources', () => {
  const richmond = areas.features.filter(f => f.properties.municipality === 'Richmond');
  const blocks = read('data/source/municipal-neighbourhoods/richmond-census-blocks.geojson').features;
  assert.equal(richmond.length, 15);
  assert.equal(blocks.length, 921);
  const usedBlocks = new Set();
  for (const f of richmond) {
    const p = f.properties;
    const original = originals.get(p.id);
    assert.equal(original.geometry.type, 'Point', 'municipal source geometry stays point-only');
    assert.equal(original.locationOnly, true);
    assert.deepEqual(p.sourceGeometry, original.geometry);
    assert.ok(['Polygon', 'MultiPolygon'].includes(f.geometry.type), p.name);
    assert.equal(p.locationOnly, false);
    assert.equal(p.boundaryType, 'census-approximation');
    assert.equal(p.boundaryLabel, '社区定位范围（按普查边界近似）');
    assert.ok(insidePolygon(p.centroid, f.geometry), `${p.name}: label stays within its selectable footprint`);
    const expected = blocks.filter(b => b.properties.neighbourhoodId === p.id).map(b => b.properties.code).sort();
    assert.ok(expected.length > 0, p.name);
    assert.deepEqual(p.locationBlockCodes, expected);
    for (const code of expected) {
      assert.ok(!usedBlocks.has(code), `A census block cannot select two communities: ${code}`);
      usedBlocks.add(code);
    }
  }
  assert.equal(usedBlocks.size, blocks.length);
  const combined = richmond.find(f => f.properties.name === 'East Richmond / Fraser Lands');
  assert.equal(combined.properties.statistics.incomeMedian, null);
  assert.equal(combined.properties.statistics.subprofiles.length, 2);
});

test('Richmond separate income footprints use published child incomes without fabricating a combined median', () => {
  const parent = areas.features.find(f => f.properties.id === 'richmond-east-richmond-fraser-lands');
  assert.equal(areas.incomeAreas.length, 2);
  const expectedMedians = { 'East Richmond': 78500, 'Fraser Lands': 70000 };
  const children = new Map(parent.properties.statistics.subprofiles.map(p => [p.name, p.statistics]));
  for (const { properties: p, geometry } of areas.incomeAreas) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(geometry.type));
    assert.equal(p.parentCode, parent.properties.code);
    assert.ok(p.code.startsWith('I:'));
    assert.equal(p.kind, 'neighbourhood');
    assert.equal(p.boundaryType, 'census-approximation');
    assert.equal(p.statistics.incomeMedian.value, expectedMedians[p.name]);
    assert.deepEqual(p.statistics, children.get(p.name));
    assert.ok(!areas.features.some(f => f.properties.code === p.code), 'fill-only income areas do not add duplicate selectable communities');
  }
  assert.equal(parent.properties.statistics.incomeMedian, null);
});

test('unmapped jurisdictions retain their original names and exact statistics', () => {
  const source = census.find(f => f.properties.municipality === 'Semiahmoo');
  assert.ok(source);
  assert.equal(named.find(f => f.properties.code === source.properties.code), source);
});
