import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeighbourhoodLayers } from '../src/neighbourhood-layers.js';

class Events {
  handlers = new Map();
  on(types, handler) { for (const type of types.split(' ')) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(handler); } return this; }
  off(types, handler) { for (const type of types.split(' ')) this.handlers.get(type)?.delete(handler); return this; }
  fire(type, event = {}) { for (const handler of this.handlers.get(type) || []) handler(event); return this; }
  addEventListener(type, handler) { this.on(type, handler); }
  removeEventListener(type, handler) { this.off(type, handler); }
}

function setup() {
  const panes = new Map(), svgs = new Map(), mounted = new Set(), selectedEvents = [], bound = [];
  let enabled = true, dark = false, municipality = '', selected = null;
  const document = { createElementNS: (_, tag) => node(tag) };
  function node(tag = 'path') {
    return Object.assign(new Events(), { tag, attrs: {}, style: {}, children: [], ownerDocument: document,
      setAttribute(name, value) { this.attrs[name] = String(value); },
      appendChild(child) { this.children.push(child); child.parent = this; child.ownerSVGElement = this.tag === 'svg' ? this : this.ownerSVGElement; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
    });
  }
  const map = Object.assign(new Events(), {
    getPane: name => panes.get(name),
    createPane(name) { const pane = node('div'); panes.set(name, pane); return pane; },
    getZoom() { throw new Error('Named community selection must not depend on map zoom'); },
    removeLayer(group) { mounted.delete(group); for (const layer of group.members) layer.fire('remove'); },
  });
  function path(feature, options) {
    const element = node();
    if (!svgs.has(options.pane)) svgs.set(options.pane, node('svg'));
    svgs.get(options.pane).appendChild(element);
    return Object.assign(new Events(), { feature, options: { ...options }, element,
      getElement: () => element,
      setStyle(style) { Object.assign(this.options, style); return this; },
      getBounds: () => ({ getCenter: () => ({ lat: 49, lng: -123 }) }),
    });
  }
  const L = {
    geoJSON(data, options) {
      const members = data.features.map(feature => {
        const layer = path(feature, options);
        options.onEachFeature?.(feature, layer);
        return layer;
      });
      return { members, addTo() { mounted.add(this); for (const layer of members) layer.fire('add'); return this; } };
    },
  };
  const feature = (id, city = 'Vancouver', boundaryType) => ({ type: 'Feature',
    properties: { id, code: `N:${id}`, name: id, municipality: city, boundaryType },
    geometry: { type: 'Polygon', coordinates: [[[-123, 49], [-122, 49], [-122, 50], [-123, 49]]] } });
  const features = [feature('median'), feature('average', 'Surrey'), feature('missing'), feature('approximate', 'Richmond', 'approximate-census-tract-union')];
  const getFillStyle = area => enabled && ['median', 'average'].includes(area.properties.id)
    ? { fillColor: '#f1d66f', fillOpacity: .8, incomeMetric: { statistic: area.properties.id } } : null;
  const controller = createNeighbourhoodLayers({ L, map, features, isDark: () => dark,
    inMunicipality: feature => !municipality || feature.properties.municipality === municipality,
    getSelected: () => selected, getFillStyle,
    onSelect: (...args) => selectedEvents.push(args), onBind: (layer, feature) => bound.push([layer, feature]),
    allowSelection: () => false, // The retired mode/zoom gate must not disable named areas.
  });
  return { controller, map, panes, svgs, mounted, selectedEvents, bound, features,
    upper: id => controller.getLayer(`N:${id}`),
    fill: id => controller.fills.members.find(layer => layer.feature.properties.id === id),
    enabled(value) { enabled = value; }, dark(value) { dark = value; },
    municipality(value) { municipality = value; }, select(value) { selected = value; },
  };
}

test('municipal income fills stay below water and roads while whole communities remain clickable above them', () => {
  const s = setup();
  assert.equal(s.panes.get('municipalFills').style.zIndex, '405');
  assert.equal(s.panes.get('municipalAreas').style.zIndex, '435');
  assert.equal(s.panes.get('municipalFills').style.pointerEvents, 'none');
  assert.equal(s.fill('median').options.fillColor, '#f1d66f');
  assert.equal(s.fill('median').options.fillOpacity, .8);
  assert.equal(s.fill('missing').options.fillOpacity, 0, 'missing municipal income leaves underlying tract colours visible');
  assert.equal(s.upper('median').options.fillOpacity, 0, 'hit targets cannot cover water or roads');
  assert.equal(s.upper('median').element.style.pointerEvents, 'auto');
  assert.equal(s.bound.length, s.features.length);
  const event = { latlng: { lat: 49.2, lng: -123.1 } };
  s.upper('median').fire('click', event);
  assert.deepEqual(s.selectedEvents[0], ['N:median', event, s.features[0]]);
  s.enabled(false); s.controller.update();
  assert.equal(s.fill('median').options.fillOpacity, 0);
  s.upper('median').fire('click', event);
  assert.equal(s.selectedEvents.length, 2, 'income mode never controls geographic selection');
});

test('average income uses a real SVG hatch with unique map IDs and reusable theme-aware patterns', () => {
  const s = setup();
  const average = s.fill('average');
  assert.match(average.options.fillColor, /^url\(#municipal-average-\d+-\d+\)$/);
  const defs = s.svgs.get('municipalFills').children.find(child => child.tag === 'defs');
  assert.equal(defs.children.length, 1);
  assert.equal(defs.children[0].children[0].attrs.fill, '#f1d66f');
  assert.equal(defs.children[0].children[1].attrs['stroke-opacity'], '.42');
  assert.equal(average.element.attrs['data-income-statistic'], 'average');
  const initialFill = average.options.fillColor;
  s.controller.update();
  assert.equal(defs.children.length, 1, 'ordinary redraws reuse the pattern');
  s.dark(true); s.controller.update();
  assert.notEqual(average.options.fillColor, initialFill);
  assert.equal(defs.children[1].children[1].attrs.stroke, '#ecf6f2');
  assert.notEqual(setup().fill('average').options.fillColor, initialFill, 'comparison maps cannot collide on pattern IDs');
});

test('municipality filters remove both fill and interaction including keyboard selection', () => {
  const s = setup();
  s.municipality('Vancouver'); s.controller.update();
  const hidden = s.upper('average');
  assert.equal(s.fill('average').options.fillOpacity, 0);
  assert.equal(hidden.options.opacity, 0);
  assert.equal(hidden.element.style.pointerEvents, 'none');
  assert.equal(hidden.element.attrs.tabindex, '-1');
  assert.equal(hidden.element.attrs['aria-hidden'], 'true');
  hidden.fire('click');
  hidden.element.fire('keydown', { key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(s.selectedEvents.length, 0);
  s.municipality(''); s.controller.update();
  assert.equal(hidden.element.attrs.tabindex, '0');
  hidden.element.fire('keydown', { key: ' ', preventDefault() {}, stopPropagation() {} });
  assert.equal(s.selectedEvents[0][0], 'N:average');
});

test('approximate outlines remain visibly distinct and selection survives hover and movement', () => {
  const s = setup();
  assert.equal(s.upper('approximate').options.dashArray, '4 4');
  assert.equal(s.upper('median').options.dashArray, null);
  s.select('N:approximate'); s.controller.update();
  assert.equal(s.upper('approximate').options.dashArray, '4 4');
  assert.equal(s.upper('approximate').element.attrs['aria-pressed'], 'true');
  s.upper('median').fire('mouseover');
  assert.equal(s.upper('median').options.weight, 2.5);
  s.map.fire('movestart');
  assert.equal(s.upper('median').options.weight, 1.2);
  assert.equal(s.upper('approximate').options.weight, 2.5);
  s.upper('median').element.fire('focus');
  assert.equal(s.upper('median').options.weight, 2.5);
  s.upper('median').element.fire('blur');
  assert.equal(s.upper('median').options.weight, 1.2);
});

test('destroy removes both geographic layers, SVG definitions and keyboard listeners', () => {
  const s = setup();
  const element = s.upper('average').element;
  s.controller.destroy();
  assert.equal(s.mounted.size, 0);
  assert.equal(element.handlers.get('keydown').size, 0);
  assert.equal(s.svgs.get('municipalFills').children.filter(child => child.tag === 'defs').length, 0);
  s.upper('average').fire('click');
  assert.equal(s.selectedEvents.length, 0);
  s.controller.destroy();
});
