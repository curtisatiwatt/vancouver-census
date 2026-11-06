import { escapeHtml as esc, safeUrl } from './map-utils.js';

export const SKYTRAIN_LINES = Object.freeze({
  expo: { name: 'Expo Line', color: '#0033a0' },
  millennium: { name: 'Millennium Line', color: '#ffcd00' },
  canada: { name: 'Canada Line', color: '#007c9f' },
});
export const TRANSIT_ATTRIBUTION = 'Route and arrival data used in this product or service is provided by permission of TransLink. TransLink assumes no responsibility for the accuracy or currency of the Data used in this product or service.';

const linesFor = properties => [...new Set(properties.lines || [])].filter(id => SKYTRAIN_LINES[id]);
const interchange = properties => linesFor(properties).length > 1;

export function stationContent(properties, language = 'zh') {
  const english = language === 'en';
  const source = safeUrl(properties.sourceUrl);
  const lines = linesFor(properties).map(id => SKYTRAIN_LINES[id].name).join(' / ');
  return `<strong>${esc(properties.name)}</strong><span class="station-lines">${esc(lines)}</span><span class="station-status">${english ? 'Operating SkyTrain station' : '运营中的 SkyTrain 车站'}${interchange(properties) ? english ? ' · Interchange' : ' · 换乘站' : ''}</span>${source ? `<a class="station-source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">${english ? 'Official transit information ↗' : '官方交通资料 ↗'}</a>` : ''}`;
}

/** Static route geometry and station interaction, independent of census selection. */
export function createTransitLayers({ L, context, skytrain, visible = false, onStationOpen, getPopupInsets, isDark = () => false, language = () => 'zh' }) {
  const map = context.map;
  const features = skytrain?.type === 'FeatureCollection' ? skytrain.features || [] : [];
  const routes = features.filter(f => f.properties?.kind === 'transit_route' && f.properties.status === 'operating' && SKYTRAIN_LINES[f.properties.lineId]);
  const stations = features.filter(f => f.properties?.kind === 'transit_station' && f.properties.status === 'operating' && f.geometry?.type === 'Point' && linesFor(f.properties).length)
    .sort((a, b) => Number(interchange(b.properties)) - Number(interchange(a.properties)) || Number(Boolean(b.properties.terminal)) - Number(Boolean(a.properties.terminal)) || String(a.properties.name).localeCompare(String(b.properties.name)));
  const panes = [['transit', 440], ['stations', 480], ['stationLabels', 485]];
  for (const [name, zIndex] of panes) {
    const pane = map.getPane(name) || map.createPane(name);
    pane.style.zIndex = zIndex;
    pane.style.pointerEvents = name === 'stations' ? '' : 'none';
  }
  const labels = L.layerGroup().addTo(map);
  const routeLayers = [];
  const stationLayers = [];
  let shown = false;
  let destroyed = false;
  let popup = null;
  let popupProperties = null;
  let styleKey = null;

  // Draw every casing before any colour. Expo remains visible beside Millennium
  // on their shared Lougheed–Production Way segment without inventing an offset.
  for (const casing of [true, false]) for (const id of Object.keys(SKYTRAIN_LINES)) {
    for (const feature of routes.filter(f => f.properties.lineId === id)) {
      const layer = L.geoJSON(feature, { pane: 'transit', interactive: false, bubblingMouseEvents: false,
        style: { color: SKYTRAIN_LINES[id].color, weight: 3, opacity: 1, lineCap: 'round', lineJoin: 'round', className: 'skytrain-route' } }).addTo(map);
      routeLayers.push({ layer, id, casing });
    }
  }
  const attribution = L.control.attribution({ position: 'bottomleft', prefix: false });
  attribution.addAttribution(TRANSIT_ATTRIBUTION);

  function closePopup() {
    if (popup) map.closePopup(popup);
    popup = null;
    popupProperties = null;
  }

  for (const feature of stations) {
    const p = feature.properties;
    const ids = linesFor(p);
    const shared = interchange(p);
    const colour = SKYTRAIN_LINES[ids[0]].color;
    const marker = L.marker([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], {
      pane: 'stations', keyboard: true, bubblingMouseEvents: false, riseOnHover: true,
      title: p.name, alt: p.name,
      icon: L.divIcon({ className: `skytrain-station${shared ? ' skytrain-interchange' : ''}`,
        html: `<span class="skytrain-station-dot" style="--station-color:${colour}" aria-hidden="true"></span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
    }).addTo(map);
    let element = null;
    const open = () => {
      if (!shown || destroyed || marker.getElement()?.style.display === 'none') return false;
      onStationOpen?.();
      context.tooltip?.close();
      closePopup();
      popupProperties = p;
      const mobile = map.getContainer().ownerDocument.defaultView?.matchMedia?.('(max-width: 760px)').matches;
      // Read after onStationOpen so mobile sheet changes and desktop drawers
      // define the usable map viewport at the moment this station is opened.
      const insets = getPopupInsets?.() || { top: 60, right: 0, bottom: mobile ? 148 : 24, left: 0 };
      const paddingTopLeft = [(insets.left || 0) + 12, (insets.top || 0) + 12];
      const paddingBottomRight = [(insets.right || 0) + 12, (insets.bottom || 0) + 12];
      // Leaflet's maxWidth excludes content margins and the wrapper's padding.
      const maxWidth = Math.max(80, Math.min(280, map.getSize().x - paddingTopLeft[0] - paddingBottomRight[0] - 40));
      popup = L.popup({ className: 'station-popup skytrain-popup', maxWidth, autoPan: true,
        autoPanPaddingTopLeft: paddingTopLeft, autoPanPaddingBottomRight: paddingBottomRight,
        closeButton: true, autoClose: true, closeOnClick: true })
        .setLatLng(marker.getLatLng()).setContent(stationContent(p, language())).openOn(map);
      return true;
    };
    // Leaflet already handles Enter on keyboard markers; Space is the button
    // counterpart and must not scroll the document or click a census polygon.
    const keydown = event => {
      if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); open(); }
    };
    const detach = () => { element?.removeEventListener('keydown', keydown); element = null; };
    const attach = () => {
      detach();
      element = marker.getElement();
      element?.setAttribute('role', 'button');
      element?.setAttribute('data-station-id', p.id);
      element?.setAttribute('tabindex', shown ? '0' : '-1');
      element?.addEventListener('keydown', keydown);
    };
    marker.on('click', open).on('add', attach).on('remove', detach);
    attach();
    stationLayers.push({ marker, properties: p, shared, detach, open, attach });
  }

  function setVisible(value) {
    shown = Boolean(value && routes.length && stations.length && !destroyed);
    for (const [name] of panes) map.getPane(name).style.display = shown ? '' : 'none';
    for (const { marker } of stationLayers) {
      const element = marker.getElement();
      element?.setAttribute('tabindex', shown ? '0' : '-1');
      element?.setAttribute('aria-hidden', String(!shown));
    }
    if (shown) {
      attribution.addTo(map);
      attribution.getContainer()?.classList.add('skytrain-attribution');
    } else {
      labels.clearLayers();
      closePopup();
      attribution.remove();
    }
  }

  function update({ reserveBox, measureLabel, labelBoxes = [] } = {}) {
    if (destroyed || !map._loaded) return;
    labels.clearLayers();
    if (!shown) return;
    const zoom = map.getZoom();
    const dark = isDark();
    const detail = zoom >= 13;
    const nextStyle = `${detail}:${dark}`;
    if (nextStyle !== styleKey) {
      styleKey = nextStyle;
      for (const { layer, id, casing } of routeLayers) {
        const width = id === 'expo' ? (detail ? 5.4 : 4.8) : (detail ? 3.6 : 3.1);
        layer.setStyle({ color: casing ? (dark ? '#d6e8ef' : id === 'millennium' ? '#6d633c' : '#fff') : SKYTRAIN_LINES[id].color,
          weight: width + (casing ? 1.8 : 0), opacity: casing ? .9 : 1 });
      }
    }
    if (popup && popupProperties && map.hasLayer(popup)) popup.setContent(stationContent(popupProperties, language()));
    const control = attribution.getContainer();
    if (control && labelBoxes) {
      const rect = control.getBoundingClientRect();
      const origin = map.getContainer().getBoundingClientRect();
      if (rect.width && rect.height) labelBoxes.push({ x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height });
    }
    const bounds = map.getBounds();
    const occupied = [];
    const visibleStations = [];
    const minGap = zoom < 11.5 ? 23 : zoom < 13 ? 18 : zoom < 14 ? 12 : 0;
    for (const item of stationLayers) {
      const { marker, properties } = item;
      const point = map.latLngToContainerPoint(marker.getLatLng());
      const inView = bounds.contains(marker.getLatLng());
      const display = inView && !occupied.some(other => Math.hypot(other.x - point.x, other.y - point.y) < minGap);
      if (display) { occupied.push(point); visibleStations.push({ ...item, point }); }
      const element = marker.getElement();
      if (element) {
        element.style.display = display ? '' : 'none';
        element.setAttribute('tabindex', display ? '0' : '-1');
        element.setAttribute('aria-hidden', String(!display));
        element.setAttribute('aria-label', `${properties.name} · ${linesFor(properties).map(id => SKYTRAIN_LINES[id].name).join(' / ')} · ${language() === 'en' ? 'Operating SkyTrain station' : '运营中的 SkyTrain 车站'}`);
      }
    }
    if (!reserveBox || !measureLabel || zoom < 11) return;
    let count = 0;
    const size = map.getSize();
    const limit = Math.min(detail ? 32 : 8, Math.max(3, Math.floor(size.x * size.y / (detail ? 20000 : 80000))));
    for (const { marker, properties, shared, point } of visibleStations) {
      if (count >= limit) break;
      if (!detail && !shared && !properties.terminal) continue;
      const { width, height } = measureLabel(properties.name, 11);
      const options = [
        { x: point.x + 12, y: point.y - height / 2, anchor: [-12, height / 2] },
        { x: point.x - width - 12, y: point.y - height / 2, anchor: [width + 12, height / 2] },
        { x: point.x - width / 2, y: point.y - height - 12, anchor: [width / 2, height + 12] },
      ];
      const placement = options.find(box => reserveBox({ x: box.x, y: box.y, w: width, h: height }));
      if (!placement) continue;
      count++;
      L.marker(marker.getLatLng(), { pane: 'stationLabels', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'station-label skytrain-station-label', html: `<span>${esc(properties.name)}</span>`, iconSize: [width, height], iconAnchor: placement.anchor }) }).addTo(labels);
    }
  }

  function destroy() {
    if (destroyed) return;
    setVisible(false);
    destroyed = true;
    for (const { marker, detach, open, attach } of stationLayers) {
      detach(); marker.off('click', open).off('add', attach).off('remove', detach); map.removeLayer(marker);
    }
    for (const { layer } of routeLayers) map.removeLayer(layer);
    map.removeLayer(labels);
    map.off('unload', destroy);
  }
  map.on('unload', destroy);
  setVisible(visible);
  const openStation = id => stationLayers.find(item => item.properties.id === id)?.open() ?? false;
  return { setVisible, update, destroy, openStation, stationCount: stations.length };
}
