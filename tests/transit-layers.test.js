import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransitLayers, stationContent, TRANSIT_ATTRIBUTION, SKYTRAIN_LINES } from '../src/transit-layers.js';

class Events {
  handlers = new Map();
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); return this; }
  off(type, fn) { this.handlers.get(type)?.delete(fn); return this; }
  fire(type, event = {}) { for (const fn of this.handlers.get(type) || []) fn(event); return this; }
  addEventListener(type, fn) { this.on(type, fn); }
  removeEventListener(type, fn) { this.off(type, fn); }
}
const rect = () => ({ left: 0, top: 0, width: 0, height: 0 });
function element() {
  return Object.assign(new Events(), { style: {}, attrs: {}, classList: { add() {} }, getBoundingClientRect: rect,
    setAttribute(name, value) { this.attrs[name] = value; } });
}
const station = (id, lng, lines = ['expo']) => ({ type: 'Feature', properties: { id, name: id, lines, status: 'operating', kind: 'transit_station', sourceUrl: 'https://www.translink.ca/' }, geometry: { type: 'Point', coordinates: [lng, 49] } });
function setup({ getPopupInsets, onStationOpen } = {}) {
  const panes = new Map();
  const layers = new Set();
  const objects = [];
  const controls = new Set();
  let zoom = 10.5, dark = false, language = 'en', opened = 0;
  const container = { getBoundingClientRect: rect, ownerDocument: { defaultView: { matchMedia: () => ({ matches: false }) } } };
  const map = Object.assign(new Events(), {
    _loaded: true, getContainer: () => container, getPane: name => panes.get(name),
    createPane(name) { const pane = { style: {} }; panes.set(name, pane); return pane; },
    getZoom: () => zoom, getSize: () => ({ x: 1000, y: 800 }),
    getBounds: () => ({ contains: point => point.lng > -124 && point.lng < -122 }),
    latLngToContainerPoint: point => ({ x: (point.lng + 124) * 300, y: (50 - point.lat) * 400 }),
    hasLayer: layer => layers.has(layer),
    removeLayer(layer) { layers.delete(layer); layer.fire?.('remove'); },
    closePopup(popup) { layers.delete(popup); },
  });
  function make(type, data, options = {}) {
    const item = Object.assign(new Events(), { type, data, options, element: element(), members: new Set(),
      addTo(target) { if (target.members) target.members.add(this); else layers.add(this); this.fire('add'); return this; },
      getElement() { return this.element; },
      getLatLng() { return Array.isArray(data) ? { lat: data[0], lng: data[1] } : data; },
      setStyle(value) { this.options = { ...this.options, ...value }; return this; },
      clearLayers() { this.members.clear(); },
    });
    objects.push(item);
    return item;
  }
  const L = {
    geoJSON: (data, options) => make('route', data, options),
    marker: (data, options) => make('marker', data, options),
    divIcon: options => options,
    layerGroup: () => make('group'),
    popup(options) {
      return Object.assign(make('popup', null, options), {
        setLatLng(point) { this.point = point; return this; },
        setContent(content) { this.content = content; return this; },
        openOn() { layers.add(this); return this; },
      });
    },
    control: { attribution() { const node = element(); return {
      addAttribution(text) { this.text = text; }, getContainer: () => node,
      addTo() { controls.add(this); return this; }, remove() { controls.delete(this); },
    }; } },
  };
  const routeFeatures = Object.keys(SKYTRAIN_LINES).map(lineId => ({ type: 'Feature', properties: { kind: 'transit_route', lineId, status: 'operating' }, geometry: { type: 'LineString', coordinates: [[-123.5, 49], [-122.5, 49]] } }));
  const skytrain = { type: 'FeatureCollection', features: [...routeFeatures, station('Interchange', -123, ['expo', 'millennium']), station('Close', -123.01), station('Far', -123.4), station('Outside', -125)] };
  const controller = createTransitLayers({ L, context: { map, tooltip: { close() {} } }, skytrain, getPopupInsets, onStationOpen: () => { opened++; onStationOpen?.(); }, isDark: () => dark, language: () => language });
  const markers = () => objects.filter(o => o.options.pane === 'stations');
  return { controller, map, panes, layers, objects, controls, markers, skytrain, opened: () => opened,
    zoom(value) { zoom = value; }, dark(value) { dark = value; }, language(value) { language = value; } };
}

test('SkyTrain is initially hidden, closes its popup when disabled and removes hidden keyboard targets', () => {
  const s = setup();
  assert.equal(s.panes.get('stations').style.display, 'none');
  assert.equal(s.controls.size, 0);
  for (const marker of s.markers()) assert.equal(marker.element.attrs.tabindex, '-1');
  s.controller.setVisible(true);
  s.controller.update();
  assert.equal(s.controls.size, 1);
  assert.equal([...s.controls][0].text, TRANSIT_ATTRIBUTION);
  const marker = s.markers()[0];
  marker.fire('click');
  assert.equal(s.opened(), 1);
  assert.equal([...s.layers].filter(layer => layer.type === 'popup').length, 1);
  s.controller.setVisible(false);
  marker.fire('click');
  assert.equal(s.opened(), 1);
  assert.equal([...s.layers].filter(layer => layer.type === 'popup').length, 0);
  assert.equal(s.controls.size, 0);
  for (const marker of s.markers()) assert.equal(marker.element.attrs.tabindex, '-1');
});

test('overview prioritizes interchanges while zooming reveals nearby stations with real 24px hit targets', () => {
  const s = setup();
  s.controller.setVisible(true); s.controller.update();
  const byName = new Map(s.markers().map(marker => [marker.options.title, marker]));
  assert.equal(byName.get('Interchange').element.style.display, '');
  assert.equal(byName.get('Close').element.style.display, 'none');
  assert.equal(byName.get('Outside').element.style.display, 'none');
  assert.deepEqual(byName.get('Interchange').options.icon.iconSize, [24, 24]);
  assert.equal(byName.get('Interchange').options.bubblingMouseEvents, false);
  s.zoom(14); s.controller.update();
  assert.equal(byName.get('Close').element.style.display, '');
  assert.equal(byName.get('Close').element.attrs.tabindex, '0');
  assert.match(byName.get('Interchange').element.attrs['aria-label'], /Expo Line \/ Millennium Line/);
  let prevented = false, stopped = false;
  byName.get('Close').element.fire('keydown', { key: ' ', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.ok(prevented && stopped);
  assert.equal(s.opened(), 1);
});

test('shared track keeps both official colours and theme changes preserve popup data without resetting the view', () => {
  const s = setup();
  const before = JSON.stringify(s.skytrain);
  s.controller.setVisible(true); s.controller.update();
  const routes = s.objects.filter(o => o.type === 'route');
  const colours = routes.slice(3);
  assert.deepEqual(colours.map(route => route.options.color), Object.values(SKYTRAIN_LINES).map(line => line.color));
  assert.ok(colours[0].options.weight > colours[1].options.weight);
  assert.equal(s.panes.get('transit').style.zIndex, 440);
  s.markers()[0].fire('click');
  const popup = [...s.layers].find(layer => layer.type === 'popup');
  s.language('zh'); s.dark(true); s.controller.update();
  assert.match(popup.content, /换乘站/);
  assert.match(s.markers()[0].element.attrs['aria-label'], /运营中的/);
  assert.equal(JSON.stringify(s.skytrain), before);
  s.controller.destroy();
  assert.equal(s.controls.size, 0);
  assert.equal([...s.layers].length, 0);
  assert.equal(s.markers()[0].element.handlers.get('keydown').size, 0);
});

test('station popups escape source names and cannot introduce executable URLs', () => {
  const html = stationContent({ name: '<img src=x onerror=alert(1)>', lines: ['canada', 'made-up'], sourceUrl: 'javascript:alert(1)' }, 'en');
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|href=|made-up/);
  assert.match(html, /Canada Line/);
});

test('search opens a named station after it is visible and does not invent an unknown station', () => {
  const s = setup();
  assert.equal(s.controller.openStation('Close'), false);
  s.controller.setVisible(true); s.controller.update();
  assert.equal(s.controller.openStation('Close'), false);
  s.zoom(15); s.controller.update();
  assert.equal(s.controller.openStation('Close'), true);
  const popup = [...s.layers].find(layer => layer.type === 'popup');
  assert.match(popup.content, /Close/);
  assert.deepEqual(popup.point, { lat: 49, lng: -123.01 });
  assert.equal(s.opened(), 1);
  assert.equal(s.controller.openStation('Not a station'), false);
  s.controller.destroy();
  assert.equal(s.controller.openStation('Close'), false);
});

test('station popups fit the current drawer viewport and read sheet insets after activation', () => {
  let insets = { left: 92, right: 24, top: 76, bottom: 24 };
  let afterOpen = () => {};
  const s = setup({ getPopupInsets: () => insets, onStationOpen: () => afterOpen() });
  s.map.getSize = () => ({ x: 761, y: 800 });
  s.controller.setVisible(true); s.controller.update();
  const marker = s.markers()[0];
  const currentPopup = () => [...s.layers].find(layer => layer.type === 'popup');
  marker.fire('click');
  const closedPadding = currentPopup().options.autoPanPaddingTopLeft[0];

  insets = { ...insets, left: 448 };
  marker.fire('click');
  const drawerPopup = currentPopup().options;
  assert.ok(drawerPopup.autoPanPaddingTopLeft[0] > insets.left);
  assert.ok(drawerPopup.autoPanPaddingTopLeft[0] > closedPadding);
  assert.ok(drawerPopup.maxWidth + 40 + drawerPopup.autoPanPaddingTopLeft[0] + drawerPopup.autoPanPaddingBottomRight[0] <= s.map.getSize().x);

  insets = { left: 12, right: 12, top: 96, bottom: 400 };
  afterOpen = () => { insets = { ...insets, bottom: 150 }; };
  marker.fire('click');
  const sheetPopup = currentPopup().options;
  assert.ok(sheetPopup.autoPanPaddingTopLeft[1] > insets.top);
  assert.ok(sheetPopup.autoPanPaddingBottomRight[1] > 150);
  assert.ok(sheetPopup.autoPanPaddingBottomRight[1] < 400);
});
