import { NEIGHBOURHOOD_DETAIL_ZOOM } from './neighbourhoods.js';

/** Municipal outlines are separate from the unchanged census choropleth. */
export function createNeighbourhoodLayers({ L, map, features, onSelect, isDark, inMunicipality, getSelected, allowSelection }) {
  const pane = map.createPane('municipalAreas');
  pane.style.zIndex = '435';
  const layers = new Map();
  const group = L.geoJSON({ type: 'FeatureCollection', features }, {
    pane: 'municipalAreas', bubblingMouseEvents: false,
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, { pane: 'municipalAreas', radius: 5, fillOpacity: .8 }),
    style: { fillOpacity: 0, weight: 1.2, dashArray: '5 4' },
    onEachFeature(feature, layer) {
      layers.set(feature.properties.code, layer);
      layer.on('click', () => {
        if (allowSelection() && map.getZoom() < NEIGHBOURHOOD_DETAIL_ZOOM && inMunicipality(feature)) onSelect(feature.properties.code);
      });
      layer.on('add', () => {
        const path = layer.getElement();
        path?.setAttribute('data-neighbourhood', feature.properties.id);
        path?.setAttribute('aria-label', `${feature.properties.name} · ${feature.properties.municipality}`);
      });
    },
  }).addTo(map);
  function update() {
    for (const [code, layer] of layers) {
      const visible = inMunicipality(layer.feature);
      const selected = getSelected() === code;
      layer.setStyle({ color: isDark() ? '#8abcb4' : '#58756c', opacity: visible ? (selected ? 1 : .55) : 0,
        weight: selected ? 2.5 : 1.2, fillOpacity: visible && layer.feature.geometry.type === 'Point' ? .8 : 0, dashArray: selected ? null : '5 4' });
      const path = layer.getElement();
      if (path) path.style.pointerEvents = visible && allowSelection() && map.getZoom() < NEIGHBOURHOOD_DETAIL_ZOOM ? 'auto' : 'none';
    }
  }
  map.on('zoomend', update);
  map.on('unload', () => map.off('zoomend', update));
  update();
  return { update, getLayer: code => layers.get(code), group };
}
