import test from 'node:test';
import assert from 'node:assert/strict';
import { colorFor, bubbleRadius, searchFeatures, hashCode, summarize, safeUrl } from '../src/map-utils.js';

test('income boundaries stay separate from unavailable values', () => {
  assert.equal(colorFor(null), '#d6dcd9');
  assert.equal(colorFor(undefined), '#d6dcd9');
  assert.equal(colorFor(59999), '#3979b5');
  assert.equal(colorFor(60000), '#82b8d6');
  assert.equal(colorFor(100000), '#f1d66f');
  assert.equal(colorFor(200000), '#b83f42');
});

test('circle areas preserve population ratios in desktop and mobile modes', () => {
  for (const mobile of [false, true]) {
    const small = bubbleRadius(500, 4000, mobile);
    const large = bubbleRadius(2000, 4000, mobile);
    assert.ok(Math.abs(large ** 2 / small ** 2 - 4) < 1e-10);
    assert.equal(bubbleRadius(0, 4000, mobile), 0);
    assert.equal(bubbleRadius(null, 4000, mobile), 0);
  }
});

const features = [
  { properties: { code: '1', name: 'Windermere', income: 100000, chineseCount: 0, chinesePct: 0 } },
  { properties: { code: '2', name: 'Wîhkwêntôwin', aliases: ['Oliver'], income: null, chineseCount: null, chinesePct: null } },
];

test('search supports names, diacritics, renamed neighbourhoods and exact codes', () => {
  assert.equal(searchFeatures(features, 'winder')[0].properties.code, '1');
  assert.equal(searchFeatures(features, 'wihkwentowin')[0].properties.code, '2');
  assert.equal(searchFeatures(features, 'Oliver')[0].properties.code, '2');
  assert.equal(searchFeatures(features, '1')[0].properties.code, '1');
  assert.deepEqual(searchFeatures(features, ''), []);
});

test('coverage counts published zero as data; invalid deep links do not crash the app', () => {
  assert.equal(summarize(features).chinese, 1);
  assert.equal(summarize(features).income, 1);
  assert.equal(hashCode('#1', features), '1');
  assert.equal(hashCode('#%E0%A4%A', features), null);
  assert.equal(hashCode('#unrecognized', features), null);
});

test('source links cannot execute script or use insecure protocols', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('http://example.com'), null);
  assert.equal(safeUrl('https://www.edmonton.ca'), 'https://www.edmonton.ca/');
});
