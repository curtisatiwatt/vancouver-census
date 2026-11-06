export const INCOME_BINS = [
  { max: 60000, color: '#3979b5', label: '低于 $60,000' },
  { max: 80000, color: '#82b8d6', label: '$60,000–79,999' },
  { max: 100000, color: '#d8e5cb', label: '$80,000–99,999' },
  { max: 125000, color: '#f1d66f', label: '$100,000–124,999' },
  { max: 150000, color: '#efaa5a', label: '$125,000–149,999' },
  { max: 200000, color: '#db714d', label: '$150,000–199,999' },
  { max: Infinity, color: '#b83f42', label: '$200,000 及以上' },
];

export const isNumber = value => typeof value === 'number' && Number.isFinite(value);
export const colorFor = value => isNumber(value)
  ? INCOME_BINS.find(bin => value < bin.max).color
  : '#d6dcd9';
export const number = value => isNumber(value) ? value.toLocaleString('en-CA') : '暂无数据';
export const money = value => isNumber(value) ? `$${number(value)}` : '暂无数据';
export const percent = value => isNumber(value)
  ? `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`
  : '暂无数据';

/** A fixed scale within each mode: circle AREA, not radius, represents the value. */
export function bubbleRadius(value, maximum, mobile = false) {
  if (!isNumber(value) || value <= 0 || !isNumber(maximum) || maximum <= 0) return 0;
  return Math.sqrt(value / maximum) * 24 * (mobile ? 0.7 : 1);
}

export function normalize(value) {
  return String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function areaSearchScore(feature, query) {
  const p = feature.properties;
  const name = normalize(p.name);
  const aliases = [...(p.aliases || []), ...(p.municipalities || []), p.municipality, p.sectorLabel, p.tractName, p.code].filter(Boolean).map(normalize);
  return name === query || normalize(p.code) === query ? 0
    : name.startsWith(query) ? 1
    : name.includes(query) ? 2
    : aliases.some(alias => alias.includes(query)) ? 3 : 99;
}

export function searchFeatures(features, query) {
  const q = normalize(query);
  if (!q) return [];
  return features.map(feature => ({ feature, score: areaSearchScore(feature, q) }))
    .filter(item => item.score < 99)
    .sort((a, b) => a.score - b.score || a.feature.properties.name.localeCompare(b.feature.properties.name))
    .slice(0, 12)
    .map(item => item.feature);
}

/** Search results retain their geographic type; a station never inherits census values. */
export function searchMapFeatures(areas, stations, query, neighbourhoods = []) {
  const q = normalize(query);
  if (!q) return [];
  const results = areas.map(feature => ({ type: 'area', feature, score: areaSearchScore(feature, q) }));
  for (const feature of neighbourhoods) results.push({ type: 'neighbourhood', feature, score: areaSearchScore(feature, q) });
  const seenStations = new Set();
  for (const feature of stations || []) {
    const p = feature.properties;
    if (p?.kind !== 'transit_station' || p.status !== 'operating' || !p.id || !p.name
        || feature.geometry?.type !== 'Point' || seenStations.has(p.id)) continue;
    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.slice(0, 2).every(Number.isFinite)) continue;
    seenStations.add(p.id);
    const name = normalize(p.name);
    const aliases = [p.sourceStopName, `${p.name} Station`, `${p.name}站`, ...(p.aliases || [])].filter(Boolean).map(normalize);
    const score = name === q || aliases.includes(q) ? 0
      : name.startsWith(q) ? 1 : name.includes(q) ? 2
      : aliases.some(alias => alias.includes(q)) ? 3 : 99;
    results.push({ type: 'station', feature, score });
  }
  const namedMatches = new Set(results.filter(result => result.type === 'neighbourhood' && result.score < 99).map(result => result.feature.properties.id));
  return results.filter(result => result.score < 99 && (result.type !== 'area' || /\d/.test(q)
    || !(result.feature.properties.neighbourhoodIds || []).some(id => namedMatches.has(id))))
    .sort((a, b) => a.score - b.score || ({ neighbourhood: 0, station: 1, area: 2 }[a.type] - { neighbourhood: 0, station: 1, area: 2 }[b.type])
      || a.feature.properties.name.localeCompare(b.feature.properties.name))
    .slice(0, 12)
    .map(({ type, feature }) => ({ type, feature }));
}

export function summarize(features) {
  const incomes = features.filter(f => isNumber(f.properties.income));
  return {
    total: features.length,
    income: incomes.length,
    chinese: features.filter(f => isNumber(f.properties.chineseCount)).length,
    maxCount: Math.max(1, ...features.map(f => f.properties.chineseCount || 0)),
    maxPercent: Math.max(0.01, ...features.map(f => f.properties.chinesePct || 0)),
  };
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function hashCode(hash, features) {
  try {
    const code = decodeURIComponent(hash.replace(/^#/, ''));
    return features.some(f => String(f.properties.code) === code) ? code : null;
  } catch {
    return null;
  }
}
