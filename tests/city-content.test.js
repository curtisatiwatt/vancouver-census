import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerVancouverContent } from '../src/city-content.js';
import { translate } from '../src/i18n.js';

const read = name => JSON.parse(fs.readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
const features = read('communities.geojson').features;
const metadata = read('metadata.json');
registerVancouverContent({ metadata, features });

test('all source caveats retain a readable English equivalent', () => {
  for (const feature of features) {
    const { caveat, caveatEn, code } = feature.properties;
    if (!caveat) continue;
    assert.ok(caveatEn, `${code}: missing English caveat`);
    assert.equal(translate(caveat, 'en'), caveatEn);
    assert.doesNotMatch(caveatEn, /[\u3400-\u9fff]/u, code);
  }
});

test('statistical definitions and population categories are readable in both languages', () => {
  for (const field of ['populationDefinition', 'incomeDefinition', 'populationGroupsDefinition', 'latestCensusNote', 'boundaryNote', 'license', 'geographyDefinition', 'transitDefinition']) {
    assert.ok(metadata[field], field);
    const english = translate(metadata[field], 'en');
    assert.ok(english.length > 20, field);
    assert.doesNotMatch(english, /[\u3400-\u9fff]/u, `${field}: untranslated`);
  }
  for (const group of read('population-groups.json').groups) {
    assert.doesNotMatch(translate(group.label, 'en'), /[\u3400-\u9fff]/u, group.id);
  }
});

test('public application text contains no copied city-specific claims', () => {
  const root = new URL('../', import.meta.url);
  const paths = ['index.html', ...fs.readdirSync(new URL('src/', root)).filter(name => /\.(js|css)$/.test(name)).map(name => `src/${name}`)];
  for (const path of paths) {
    assert.doesNotMatch(fs.readFileSync(new URL(path, root), 'utf8'), /Edmonton|Calgary|Alberta|Garneau|Windermere|Horse Hill|Wîhkwêntôwin|YEG|埃德蒙顿|卡尔加里/i, path);
  }
});
