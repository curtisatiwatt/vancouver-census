import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNeighbourhoodProfile } from '../src/neighbourhood-ui.js';

const feature = statistics => ({ properties: { name: 'Example', sourceUrl: 'https://example.ca/profile', boundarySourceUrl: 'https://example.ca/boundary', statistics } });
const value = (value, year = 2020) => ({ value, year, sourceUrl: 'https://example.ca/profile' });

test('official population, average and median preserve their own values and years', () => {
  const html = renderNeighbourhoodProfile(feature({ population: value(12500, 2016), incomeMedian: value(68000), incomeAverage: value(95700) }), { language: 'en' });
  assert.match(html, /Municipal profile population[\s\S]*?2016[\s\S]*?12,500 people/);
  assert.match(html, /Median household income[\s\S]*?2020[\s\S]*?\$68,000/);
  assert.match(html, /Average household income[\s\S]*?2020[\s\S]*?\$95,700/);
  assert.doesNotMatch(html, /before.tax|after.tax|2021/);
});

test('null and unavailable values never become zero and an empty profile remains brief', () => {
  const html = renderNeighbourhoodProfile(feature({ population: value(null), incomeMedian: value(null), incomeAverage: value(NaN), groups: [{ name: 'Chinese', value: null, unit: 'percent', year: 2021 }] }));
  assert.match(html, /尚无已核对的同范围数值/);
  assert.doesNotMatch(html, /放大地图并点选街区|neighbourhood-explore/);
  assert.equal((html.match(/尚无已核对的同范围数值/g) || []).length, 1);
  assert.doesNotMatch(html, /<dd>|0%|\$0|未公布/);
  const missingMedian = renderNeighbourhoodProfile(feature({ incomeMedian: value(null), incomeAverage: value(95000) }));
  assert.match(missingMedian, /家庭收入中位数[\s\S]*?尚无已核对/);
  assert.match(missingMedian, /家庭收入平均数[\s\S]*?\$95,000/);
  assert.doesNotMatch(missingMedian, /\$0/);
});

test('published municipal categories retain percentages and counts without normalization or inferred shares', () => {
  const html = renderNeighbourhoodProfile(feature({ population: value(10000, 2021), groups: [
    { name: 'Caucasian', value: 56, unit: 'percent', year: 2021 },
    { name: 'Chinese', value: 35, unit: 'percent', year: 2021 },
    { name: 'Other', value: 10, unit: 'percent', year: 2021 },
    { name: 'Count-only category', value: 1250, unit: 'count', year: 2021 },
    { name: 'Published zero', value: 0, unit: 'count', year: 2021 },
    { name: 'Suppressed', value: null, unit: 'percent', year: 2021 },
  ] }), { language: 'en' });
  assert.match(html, /Municipal profile categories/);
  for (const published of ['56%', '35%', '10%', '1,250 people', '0 people']) assert.ok(html.includes(published));
  assert.doesNotMatch(html, /12\.5%|55\.4%|White/);
  assert.match(html, /Suppressed[\s\S]*?No verified value/);
});

test('municipal groups sort by published values with stable ties and missing values last', () => {
  const f = feature({ groups: [
    { name: 'Missing first in data', value: null, unit: 'percent' },
    { name: 'Other & Multiple Groups', value: 6, unit: 'percent' },
    { name: 'Caucasian', value: 56, unit: 'percent' },
    { name: 'Chinese', value: 35, unit: 'percent' },
    { name: 'Tie one', value: 2, unit: 'percent' },
    { name: 'Tie two', value: 2, unit: 'percent' },
    { name: 'Published zero', value: 0, unit: 'percent' },
  ] });
  const before = JSON.stringify(f);
  const html = renderNeighbourhoodProfile(f, { language: 'en' });
  const orderedNames = ['Caucasian', 'Chinese', 'Other &amp; Multiple Groups', 'Tie one', 'Tie two', 'Published zero', 'Missing first in data'];
  const positions = orderedNames.map(name => html.indexOf(`<dt>${name}`));
  assert.ok(positions.every((position, i) => position >= 0 && (i === 0 || position > positions[i - 1])));
  assert.match(html, /width:56%/);
  assert.match(html, /width:35%/);
  assert.match(html, /width:0%/);
  assert.equal((html.match(/class="neighbourhood-group-track"/g) || []).length, 6);
  assert.equal(JSON.stringify(f), before);
});

test('an explicit source sequence overrides numeric ranking without changing the source categories', () => {
  const groups = [
    { name: 'Small category', value: 10, unit: 'count', sourceOrder: 2 },
    { name: 'Largest category', value: 500, unit: 'count', sourceOrder: 1 },
    { name: 'Medium category', value: 100, unit: 'count', sourceOrder: 0 },
  ];
  const explicit = renderNeighbourhoodProfile(feature({ groups, groupOrder: ['Small category', 'Medium category', 'Largest category'] }), { language: 'en' });
  assert.ok(explicit.indexOf('<dt>Small category') < explicit.indexOf('<dt>Medium category'));
  assert.ok(explicit.indexOf('<dt>Medium category') < explicit.indexOf('<dt>Largest category'));
  const numeric = renderNeighbourhoodProfile(feature({ groups }), { language: 'en' });
  assert.ok(numeric.indexOf('<dt>Medium category') < numeric.indexOf('<dt>Largest category'));
  assert.ok(numeric.indexOf('<dt>Largest category') < numeric.indexOf('<dt>Small category'));
  const original = renderNeighbourhoodProfile(feature({ groups, groupOrder: 'source' }), { language: 'en' });
  assert.ok(original.indexOf('<dt>Small category') < original.indexOf('<dt>Largest category'));
});

test('count bars compare counts without manufacturing population shares', () => {
  const html = renderNeighbourhoodProfile(feature({ population: value(1000000), populationGroupBase: value(100000), groups: [
    { name: 'Small count', value: 1000, unit: 'count' },
    { name: 'Largest count', value: 4000, unit: 'count' },
    { name: 'Withheld count', value: null, unit: 'count' },
  ] }), { language: 'en' });
  assert.match(html, /4,000 people/);
  assert.match(html, /1,000 people/);
  assert.match(html, /width:100%/);
  assert.match(html, /width:25%/);
  assert.equal((html.match(/class="neighbourhood-group-track"/g) || []).length, 2);
  assert.match(html, /Bars compare published counts/);
  assert.doesNotMatch(html, />[^<]*\d+(?:\.\d+)?%/);
  assert.doesNotMatch(html, /Zoom in and select a local area|neighbourhood-explore/);
});

test('inline census fallback names its own source and shows only supplied missing metrics', () => {
  const censusGroups = feature({ groups: [{ name: 'Chinese', value: 1200, unit: 'count', year: 2021 }] });
  const zh = renderNeighbourhoodProfile(censusGroups, { language: 'zh', sourceKind: 'census' });
  assert.match(zh, /当前位置普查族裔资料/);
  assert.match(zh, /普查资料/);
  assert.match(zh, /普查范围/);
  assert.doesNotMatch(zh, /市府|家庭收入|尚无已核对|当前位置普查人口/);
  const en = renderNeighbourhoodProfile(feature({ population: value(4400, 2021) }), { language: 'en', sourceKind: 'census' });
  assert.match(en, /Census population at this location/);
  assert.match(en, /Census data/);
  assert.match(en, /Census geography/);
  assert.doesNotMatch(en, /Municipal|Household income|No verified value|population groups at this location/);
});

test('separate official subprofiles do not synthesize one population or median for a merged boundary', () => {
  const html = renderNeighbourhoodProfile(feature({ subprofiles: [
    { name: 'West Cambie', statistics: { population: value(2000, 2021), incomeMedian: value(70000) } },
    { name: 'East Cambie', statistics: { population: value(3000, 2021), incomeMedian: value(90000) } },
  ], notes: [{ zh: '边界合并，统计分别公布。', en: 'One boundary, separately published profiles.' }] }), { language: 'en' });
  assert.match(html, /<h2>West Cambie<\/h2>[\s\S]*?2,000 people[\s\S]*?\$70,000/);
  assert.match(html, /<h2>East Cambie<\/h2>[\s\S]*?3,000 people[\s\S]*?\$90,000/);
  assert.doesNotMatch(html, /5,000 people|\$80,000|\$160,000/);
  assert.match(html, /One boundary, separately published profiles/);
});

test('combined-area population and groups survive alongside separately published subarea incomes', () => {
  const html = renderNeighbourhoodProfile(feature({
    population: { ...value(6950, 2021), label: { zh: '联合范围人口', en: 'Population for the combined area' } },
    groups: [{ name: 'Chinese', value: 42.3, unit: 'percent', year: 2021 }],
    subprofiles: [
      { name: 'East Richmond', statistics: { incomeMedian: value(69000), population: null, groups: [] } },
      { name: 'Fraser Lands', statistics: { incomeMedian: value(91000), population: null, groups: [] } },
    ],
  }), { language: 'en' });
  assert.match(html, /Population for the combined area[\s\S]*?6,950 people/);
  assert.match(html, /42\.3%[\s\S]*?<h2>East Richmond<\/h2>[\s\S]*?\$69,000[\s\S]*?<h2>Fraser Lands<\/h2>[\s\S]*?\$91,000/);
  assert.doesNotMatch(html, /No verified value|\$80,000/);
  assert.equal((html.match(/6,950 people/g) || []).length, 1);
});

test('municipal population labels and bases remain distinct from federal total population', () => {
  const f = feature({ population: { ...value(33520, 2021), label: { zh: '市府公布人口', en: 'Municipal profile population' }, basis: { zh: '采用市府资料原口径。', en: 'Uses the municipal profile population base.' } } });
  for (const language of ['zh', 'en']) {
    const html = renderNeighbourhoodProfile(f, { language });
    assert.doesNotMatch(html, /总人口|Total population/);
    assert.match(html, /33,520/);
    assert.ok(html.includes(language === 'zh' ? '采用市府资料原口径。' : 'Uses the municipal profile population base.'));
  }
  f.properties.statistics.population.label = '<img src=x>';
  f.properties.statistics.population.basis = '<script>bad()</script>';
  const escaped = renderNeighbourhoodProfile(f);
  assert.match(escaped, /&lt;img src=x&gt;/);
  assert.match(escaped, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(escaped, /<img|<script/);
});

test('source-provided category names, notes, subprofile headings and URLs cannot inject markup', () => {
  const f = feature({ subprofiles: [{ name: '<img src=x onerror=bad()>', statistics: { groups: [{ name: '<script>bad()</script>', value: 5, unit: 'count', sourceUrl: 'javascript:bad()' }], notes: [{ zh: '<svg onload=bad()>', en: '<iframe src=x>' }] } }] });
  f.properties.sourceUrl = 'javascript:bad()'; f.properties.boundarySourceUrl = 'http://insecure.example/';
  for (const language of ['zh', 'en']) {
    const html = renderNeighbourhoodProfile(f, { language });
    assert.doesNotMatch(html, /<script|<img|<svg|<iframe|href=/);
    assert.match(html, /&lt;img/);
    assert.match(html, /&lt;script/);
  }
  const links = renderNeighbourhoodProfile(feature({ population: value(1) }), { language: 'en' });
  assert.equal((links.match(/<li>/g) || []).length, 2);
  assert.match(links, /rel="noopener noreferrer"/);
});
