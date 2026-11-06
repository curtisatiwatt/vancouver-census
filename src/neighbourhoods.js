/** Official place names identify locations; every tract retains its own values. */
export function nameCensusTracts(features, neighbourhoods) {
  const byId = new Map((neighbourhoods?.features || []).map(f => [f.properties.id, f.properties]));
  return features.map(feature => {
    const p = feature.properties;
    const matches = (neighbourhoods?.tractNeighbourhoods?.[p.code] || []).map(match => ({ ...match, area: byId.get(match.id) })).filter(match => match.area);
    if (!matches.length) return feature;
    const significant = matches.filter(match => match.areaShare >= .12);
    const names = (significant.length ? significant : matches.slice(0, 1)).slice(0, 2).map(match => match.area.name);
    return { ...feature, properties: { ...p, name: names.join(' / '), censusDisplayName: p.name,
      neighbourhoodIds: matches.map(match => match.id), neighbourhoodNames: matches.map(match => match.area.name),
      aliases: [...(p.aliases || []), p.name, ...matches.flatMap(match => [match.area.name, ...(match.area.aliases || [])])],
      scopeNote: '数据属于所选普查小区，不代表整个具名社区。',
    } };
  });
}

export const NEIGHBOURHOOD_DETAIL_ZOOM = 14;

/** City names in overview, familiar neighbourhood names as soon as room allows. */
export function neighbourhoodLabelFeatures(neighbourhoods, censusFeatures, municipality = '') {
  const areas = (neighbourhoods?.features || []).filter(f => !municipality || f.properties.municipality === municipality);
  const namedCities = new Set(areas.map(f => f.properties.municipality));
  return [...areas.map(f => ({ ...f, properties: { ...f.properties,
    population: f.properties.statistics?.population?.value || 10000 } })),
    ...censusFeatures.filter(f => !namedCities.has(f.properties.municipality))];
}
