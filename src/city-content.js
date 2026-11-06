import { addTranslations, addTranslationPatterns, translate } from './i18n.js';

const phrases = {
  '大温人口地图 · 人口构成与分布': 'Metro Vancouver Census Atlas · Population & income',
  '大温人口地图首页': 'Metro Vancouver Census Atlas home',
  '探索大温哥华各城市与普查区的人口、族裔构成和家庭收入。基于加拿大统计局 2021 年普查官方资料。': 'Explore population, population groups and household income across Metro Vancouver using official Statistics Canada 2021 Census data.',
  '人口地图': 'Census Atlas',
  '总人口': 'Total population',
  '10–12.5 万': '$100–125k',
  '人群': 'Groups',
  '请启用 JavaScript 以查看互动地图。官方数据可从 https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E 查阅。': 'Enable JavaScript to view the interactive map. Official data: https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E',
  '采用 2021 年普查 Visible minority（Racialized population）分类。Chinese 不等于中国国籍、中国出生或普通话使用者；“非可见少数族裔”包括原住民等，不能改称白人或欧洲裔。初始不选人口群体，可自行选择一个或多个人口群体。': 'Uses the 2021 Census visible-minority (racialized-population) categories. Chinese is not citizenship, birthplace or language. Not a visible minority includes Indigenous people and cannot be called White or European. Select one or several groups to explore.',
  '部分人口类别或统计基数缺失，不合计为 0。': 'Some population categories or their denominator are unavailable; missing values are not added as zero.',
  '正在展开 Metro Vancouver': 'Opening Metro Vancouver',
  '搜索城市或普查区编号': 'Search places or census tract IDs',
  '城市 / 地区': 'City / area',
  '筛选城市或地区': 'Filter by city or area',
  '全部城市与地区': 'All cities and areas',
  '普查区': 'Census tract',
  '地区': 'Area',
  '总人口 · 2021 普查': 'Total population · 2021 Census',
  '官方': 'Official',
  '人口总数': 'population',
  '长表私人住户人口 · 2021': 'Private-household population · 2021 long form',
  '短表私人住户人口 · 2021': 'Private-household population · 2021 short form',
  '地理资料范围': 'Geographic coverage',
  '道路与地理参照': 'Roads and geographic context',
  '道路底图': 'Roads',
  '主要道路与道路名称': 'Major roads and road names',
  '地理底色不代表收入或人口占比。': 'Geographic colours do not represent income or population shares.',
  '可在“地图图层”切换道路、地区标注与地理地标。缩小时显示城市与地区名称，放大后显示普查区编号。地理底色仅用于定位，不表示人口或收入。': 'Map layers controls roads, area labels and geographic landmarks. At overview scale, labels show cities and areas; zoom in for census tract identifiers. Geographic colours provide orientation and do not represent population or income.',
  '大号人口数字是 2021 年普查总人口；族裔构成使用 25% 长表私人住户人口作为分母。儿童比例、平均住户人数和家庭收入来自 100% 数据。人口基数不同，不能混用。': 'The headline shows the 2021 Census total population. Population group shares use private-household population from the 25% long form. Child shares, average household size and household income come from 100% data. These population bases differ and cannot be interchanged.',
  '构成占比由公布人数除以同表私人住户人口计算，保留一位小数。分类人数经随机取整，合计可能与统计基数略有不同。少于统计基数时，圆环留白显示差额；超过时，仅圆环按分类合计缩放，详情与热度图保留原始占比。': 'Shares divide published group counts by private-household population in the same table and are shown to one decimal place. Random rounding can create a difference between category totals and the table population. A shortfall appears as a gap in the ring; an excess is scaled only in the ring. Details and distribution maps retain the original shares.',
  '普查区是加拿大统计局的统计边界，不等同于房地产社区或市府社区。城市 / 地区筛选包含市镇、原住民保留地与 Electoral Area A。': 'Census tracts are Statistics Canada statistical boundaries, not real-estate or municipal neighbourhoods. City / area filters include municipalities, Indigenous reserves and Electoral Area A.',
  '私人住户人口较少，百分比和收入中位数易受少数住户影响': 'Private-household population is small, so shares and median income may be sensitive to a few households',
  '家庭收入因保密规则被抑制，未填作 0': 'Household income is suppressed for confidentiality and has not been replaced with zero',
  '普查人数经随机取整': 'Census counts are randomly rounded',
  '显示 0 不表示绝对无人': 'A published zero does not establish that no residents are present',
};

/** Registers source-supplied English definitions alongside their exact Chinese text. */
export function registerVancouverContent({ metadata, features = [], groups = [] } = {}) {
  const translations = { ...phrases };
  for (const [key, english] of Object.entries(metadata?.definitionsEn || {})) {
    if (metadata[key] && typeof english === 'string') translations[metadata[key]] = english;
  }
  for (const feature of features) {
    const p = feature.properties;
    if (p.caveat && p.caveatEn) translations[p.caveat] = p.caveatEn;
  }
  for (const group of groups) if (group.label && group.name) translations[group.label] = group.name;
  addTranslations(translations);
}

registerVancouverContent();
addTranslationPatterns([
  [/^构成统计基数：(.+) 人（25% 长表私人住户人口）。$/, (_, count) => `Composition base: ${translate(count, 'en')} people (private-household population, 25% long form).`],
  [/^(.+) ↗$/, (_, source) => `${translate(source, 'en')} ↗`],
]);
