const available = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Point lookup follows polygon rings, including holes and multipart areas. */
export function containsLocation(feature, location) {
  if (!location || !feature?.geometry) return false;
  const point = [location.lng, location.lat];
  function ringContains(ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i], [a, b] = ring[j];
      if ((y > point[1]) !== (b > point[1]) && point[0] < (a - x) * (point[1] - y) / (b - y) + x) inside = !inside;
    }
    return inside;
  }
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates]
    : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
  return polygons.some(rings => ringContains(rings[0]) && !rings.slice(1).some(ringContains));
}

/** Missing municipal figures are shown alongside, never relabelled as community totals. */
export function localCensusFallback(neighbourhood, tract, record, groups, { populationYear = 2021, incomeYear = 2020 } = {}) {
  if (!tract) return null;
  const official = neighbourhood.properties.statistics || {};
  const profiles = [official, ...(official.subprofiles || []).map(p => p.statistics || {})];
  const has = key => profiles.some(stats => available(stats[key]?.value));
  const hasGroups = profiles.some(stats => stats.groups?.some(g => available(g.value)));
  const p = tract.properties;
  const sourceUrl = record?.sourceUrl || p.sourceUrl;
  const metric = (value, year) => available(value) ? { value, year, sourceUrl } : null;
  const statistics = {
    population: has('population') ? null : metric(p.populationTotal ?? p.population, populationYear),
    incomeMedian: has('incomeMedian') || has('incomeAverage') ? null : metric(p.income, incomeYear),
    groups: hasGroups ? [] : groups.map(group => ({ name: group.name, value: record?.counts?.[group.id] ?? null, unit: 'count', year: populationYear, sourceUrl })),
    notes: [],
  };
  if (!statistics.population && !statistics.incomeMedian && !statistics.groups.some(g => available(g.value))) return null;
  if (statistics.incomeMedian) statistics.incomeMedian.basis = { zh: '私人住户税前家庭年收入', en: 'Before-tax annual income of private households' };
  if (statistics.groups.some(g => available(g.value))) statistics.notes.push({
    zh: `族裔人数来自私人住户人口的 25% 长表资料，统计基数为 ${available(record?.population) ? record.population.toLocaleString('en-CA') : '未公布'} 人。`,
    en: `Category counts use the 25% long-form private-household population, with a published base of ${available(record?.population) ? record.population.toLocaleString('en-CA') : 'unavailable'} people.`,
  });
  return { ...tract, properties: { ...p, sourceUrl, boundarySourceUrl: p.sourceUrl, statistics } };
}
