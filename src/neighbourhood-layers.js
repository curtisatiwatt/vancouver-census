let controllerSequence = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Fill below water/roads; transparent hit areas stay above them at every zoom. */
export function createNeighbourhoodLayers({ L, map, features = [], incomeAreas = [], onSelect, onBind,
  isDark = () => false, inMunicipality = () => true, getSelected = () => null,
  getFillStyle = () => null }) {
  const controllerId = ++controllerSequence;
  for (const [name, zIndex] of [['municipalFills', 405], ['municipalAreas', 435]]) {
    const pane = map.getPane(name) || map.createPane(name);
    pane.style.zIndex = String(zIndex);
    if (name === 'municipalFills') pane.style.pointerEvents = 'none';
  }
  const layers = new Map();
  const fillLayers = new Map();
  const domBindings = new Map();
  const patternRoots = new Map();
  let hovered = null;
  let focused = null;
  let destroyed = false;
  let patternSequence = 0;

  function averagePattern(layer, color) {
    const path = layer.getElement();
    const svg = path?.ownerSVGElement;
    const document = path?.ownerDocument;
    if (!svg || !document?.createElementNS) return color;
    let root = patternRoots.get(svg);
    if (!root) {
      const defs = document.createElementNS(SVG_NS, 'defs');
      svg.appendChild(defs);
      root = { defs, patterns: new Map() };
      patternRoots.set(svg, root);
    }
    const key = `${color}:${isDark()}`;
    if (!root.patterns.has(key)) {
      const id = `municipal-average-${controllerId}-${++patternSequence}`;
      const pattern = document.createElementNS(SVG_NS, 'pattern');
      for (const [name, value] of Object.entries({ id, width: '8', height: '8', patternUnits: 'userSpaceOnUse' })) pattern.setAttribute(name, value);
      const background = document.createElementNS(SVG_NS, 'rect');
      for (const [name, value] of Object.entries({ width: '8', height: '8', fill: color })) background.setAttribute(name, value);
      const stripes = document.createElementNS(SVG_NS, 'path');
      for (const [name, value] of Object.entries({ d: 'M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4',
        stroke: isDark() ? '#ecf6f2' : '#223d36', 'stroke-width': '1.5', 'stroke-opacity': '.42', fill: 'none' })) stripes.setAttribute(name, value);
      pattern.appendChild(background);
      pattern.appendChild(stripes);
      root.defs.appendChild(pattern);
      root.patterns.set(key, id);
    }
    return `url(#${root.patterns.get(key)})`;
  }

  function updateFill(layer, feature) {
    const visible = inMunicipality(feature);
    const style = getFillStyle(feature) || {};
    const color = style.fillColor || 'transparent';
    const fillColor = style.incomeMetric?.statistic === 'average' ? averagePattern(layer, color) : color;
    layer.setStyle({ ...style, stroke: false, interactive: false, fillColor,
      fillOpacity: visible ? (style.fillOpacity ?? 0) : 0 });
    const path = layer.getElement();
    if (path) {
      path.style.pointerEvents = 'none';
      path.setAttribute('aria-hidden', 'true');
      path.setAttribute('data-neighbourhood-fill', feature.properties.id);
      path.setAttribute('data-income-statistic', style.incomeMetric?.statistic || 'none');
    }
  }

  function updateOutline(layer, feature) {
    const code = feature.properties.code;
    const visible = inMunicipality(feature);
    const selected = getSelected() === code;
    const active = selected || hovered === code || focused === code;
    const approximate = Boolean(feature.properties.approximateBoundary) || /approx/i.test(feature.properties.boundaryType || '');
    layer.setStyle({ color: isDark() ? '#a2cdc2' : '#3d6155', opacity: visible ? (active ? 1 : .65) : 0,
      weight: active ? 2.5 : 1.2, fill: true, fillColor: isDark() ? '#a2cdc2' : '#3d6155',
      fillOpacity: visible && feature.geometry.type === 'Point' ? .8 : 0,
      dashArray: approximate ? '4 4' : null });
    const path = layer.getElement();
    if (path) {
      path.style.pointerEvents = visible ? 'auto' : 'none';
      path.style.cursor = visible ? 'pointer' : '';
      path.setAttribute('tabindex', visible ? '0' : '-1');
      path.setAttribute('aria-hidden', String(!visible));
      path.setAttribute('aria-pressed', String(selected));
    }
  }

  const fills = L.geoJSON({ type: 'FeatureCollection', features: [...features, ...incomeAreas] }, {
    pane: 'municipalFills', interactive: false, bubblingMouseEvents: false,
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, { pane: 'municipalFills', radius: 5, interactive: false }),
    style: { stroke: false, fillOpacity: 0 },
    onEachFeature(feature, layer) {
      fillLayers.set(feature.properties.code, layer);
      layer.on('add', () => updateFill(layer, feature));
    },
  }).addTo(map);

  const group = L.geoJSON({ type: 'FeatureCollection', features }, {
    pane: 'municipalAreas', bubblingMouseEvents: false,
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, { pane: 'municipalAreas', radius: 6 }),
    style: { fillOpacity: 0, weight: 1.2 },
    onEachFeature(feature, layer) {
      const code = feature.properties.code;
      layers.set(code, layer);
      const activate = event => {
        if (!destroyed && inMunicipality(feature)) onSelect?.(code, event, feature);
      };
      layer.on('click', activate);
      layer.on('mouseover', event => {
        if (!inMunicipality(feature) || event.originalEvent?.pointerType === 'touch' || event.originalEvent?.buttons) return;
        const previous = layers.get(hovered);
        hovered = code; updateOutline(layer, feature);
        if (previous && previous !== layer) updateOutline(previous, previous.feature);
      });
      layer.on('mouseout', () => {
        if (hovered === code) hovered = null;
        updateOutline(layer, feature);
      });
      const detach = () => {
        const binding = domBindings.get(code);
        if (!binding) return;
        for (const [type, handler] of Object.entries(binding.handlers)) binding.path.removeEventListener(type, handler);
        domBindings.delete(code);
      };
      const attach = () => {
        detach();
        const path = layer.getElement();
        if (!path) return;
        path.setAttribute('data-neighbourhood', feature.properties.id);
        path.setAttribute('role', 'button');
        path.setAttribute('aria-label', `${feature.properties.name} · ${feature.properties.municipality}`);
        const handlers = {
          keydown: event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault(); event.stopPropagation();
            const point = feature.properties.centroid;
            activate({ originalEvent: event, latlng: point ? { lat: point[1], lng: point[0] } : layer.getLatLng?.() || layer.getBounds?.().getCenter() });
          },
          focus: () => { focused = code; updateOutline(layer, feature); },
          blur: () => { if (focused === code) focused = null; updateOutline(layer, feature); },
        };
        for (const [type, handler] of Object.entries(handlers)) path.addEventListener(type, handler);
        domBindings.set(code, { path, handlers });
        updateOutline(layer, feature);
      };
      layer.on('add', attach).on('remove', detach);
      onBind?.(layer, feature);
    },
  }).addTo(map);

  function update() {
    if (destroyed) return;
    for (const layer of fillLayers.values()) updateFill(layer, layer.feature);
    for (const layer of layers.values()) updateOutline(layer, layer.feature);
  }
  function clearHover() {
    const layer = layers.get(hovered);
    hovered = null;
    if (layer) updateOutline(layer, layer.feature);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    map.off('movestart zoomstart', clearHover);
    map.off('unload', destroy);
    for (const { path, handlers } of domBindings.values()) for (const [type, handler] of Object.entries(handlers)) path.removeEventListener(type, handler);
    domBindings.clear();
    for (const { defs } of patternRoots.values()) defs.remove();
    patternRoots.clear();
    map.removeLayer(group);
    map.removeLayer(fills);
  }
  map.on('movestart zoomstart', clearHover);
  map.on('unload', destroy);
  update();
  return { update, getLayer: code => layers.get(code), group, fills, destroy };
}
