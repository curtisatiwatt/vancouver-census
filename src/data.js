import { isNumber } from './map-utils.js';
import { registerVancouverContent } from './city-content.js';

const cityAliases = {
  Vancouver: ['温哥华', '溫哥華'], Richmond: ['列治文'], Burnaby: ['本拿比'], Surrey: ['素里'],
  'New Westminster': ['新西敏'], Coquitlam: ['高贵林', '高貴林'], 'Port Coquitlam': ['高贵林港', '高貴林港'],
  'North Vancouver': ['北温', '北溫'], 'West Vancouver': ['西温', '西溫'], Langley: ['兰里', '蘭里'],
  Delta: ['三角洲'], 'White Rock': ['白石'], 'Maple Ridge': ['枫树岭', '楓樹嶺'],
  'Pitt Meadows': ['匹特草原'], 'Port Moody': ['满地宝', '滿地寶'], Anmore: ['安莫尔'], Belcarra: ['贝尔卡拉'],
  'Bowen Island': ['宝云岛', '寶雲島'], 'Metro Vancouver A': ['大学区', '大學區', 'UBC', 'Electoral Area A'],
};

async function readJson(path) {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  if (!response.ok) throw new Error(`无法载入 ${path}（${response.status}）`);
  return response.json();
}

export async function loadData() {
  const [metadata, communities, populationData, basemap, geographicContext, orientationLandmarks] = await Promise.all([
    readJson('metadata.json'),
    readJson('communities.geojson'),
    readJson('population-groups.json'),
    readJson('basemap.geojson').catch(() => null),
    readJson('geographic-context.geojson').catch(() => null),
    readJson('orientation-landmarks.geojson').catch(() => null),
  ]);
  if (communities.type !== 'FeatureCollection' || !communities.features?.length) throw new Error('地区边界数据格式不完整');
  if (populationData.schemaVersion !== 1 || !populationData.groups?.length || !populationData.communities) throw new Error('地区人口分类数据格式不完整');
  const features = communities.features.map(feature => {
    const p = feature.properties;
    if (!p.name || p.code === undefined || !Array.isArray(p.centroid)) throw new Error('地区身份或显示坐标缺失');
    const names = p.municipalities || [p.municipality];
    const aliases = [...new Set([...(p.aliases || []), ...names.flatMap(name => cityAliases[name?.replace(/ \([^)]*\)$/, '')] || [])])];
    return { ...feature, properties: { ...p, code: String(p.code), aliases, sectorLabel: p.municipality || p.sectorLabel || '' } };
  });
  // Preserve the original 100% short-form population. Composition records carry
  // their own 25% long-form denominator; no census values are overwritten.
  const ranked = features.filter(f => isNumber(f.properties.income)).sort((a, b) => b.properties.income - a.properties.income);
  let previousIncome;
  let rank;
  for (const [i, feature] of ranked.entries()) {
    if (feature.properties.income !== previousIncome) rank = i + 1;
    feature.properties.incomeRank = rank;
    previousIncome = feature.properties.income;
  }
  registerVancouverContent({ metadata, features, groups: populationData.groups });
  return { metadata, features, populationData, basemap, geographicContext, orientationLandmarks };
}
