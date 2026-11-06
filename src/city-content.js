import { addTranslations, addTranslationPatterns, translate } from './i18n.js';

const phrases = {
  '地区详情': 'Area details',
  '已选地区': 'Selected area',
  '展开或收起地区详情': 'Expand or collapse area details',
  '显示地区详情': 'Show area details',
  '隐藏地区详情': 'Hide area details',
  '关闭地区详情': 'Close area details',
  '先在地图上选择一个地区': 'Select an area on the map first',
  '地区详情，摘要。向上滑动展开': 'Area details, summary. Swipe up to expand',
  '地区详情，半屏。向上滑动展开，向下滑动收起': 'Area details, half screen. Swipe up to expand or down to collapse',
  '地区详情，展开。向下滑动收起': 'Area details, expanded. Swipe down to collapse',
  '选中地区的人口构成': 'Selected area population composition',
  '地区构成地图，可拖动缩放，也可以搜索选择地区': 'Composition map: pan, zoom or search to choose an area',
  '点击查看地区详情': 'Select for area details',
  '搜索社区、城市或车站': 'Search neighbourhoods, cities or stations',
  '没有找到社区或车站，也可以输入普查区编号。': 'No neighbourhoods or stations found. You can also enter a census tract ID.',
  '市府社区': 'Municipal neighbourhood',
  '官方社区资料': 'Official neighbourhood profile',
  '家庭年收入': 'Annual household income',
  '全区中位数': 'Regional median',
  '实色：中位数': 'Solid: median',
  '斜纹：平均数': 'Hatched: average',
  '社区收入优先；缺少时保留各普查区底色。': 'Neighbourhood income takes priority; otherwise tract shading remains.',
  '定位范围为近似边界': 'Approximate location boundary',
  '当前位置的补充统计': 'Additional statistics at this location',
  '社区资料未提供的项目，直接显示所选位置的普查数据；这些数值不代表整个社区。': 'For fields missing from the neighbourhood profile, census data for the selected location appears below. These figures do not describe the whole neighbourhood.',
  '保留原表分类，按人数从多到少排列。': 'Original source categories, ordered from largest to smallest count.',
  '区域内部底色使用各普查区收入': 'Shading within this area uses individual census-tract incomes',
  '点击社区即可查看资料；缩放或开启图层不会改变社区的点击范围。': 'Select a neighbourhood to view its profile. Zooming and map layers keep the same selectable community area.',
  '社区收入优先用于底色：实色表示中位数，斜纹表示平均数，不将两者混为同一指标。缺少社区收入时保留各普查区底色。族裔详情保留各来源分类，按公布值从大到小排列；分布图仍采用同口径的联邦普查分类。': 'Neighbourhood income takes priority: solid colours show medians, hatching shows averages, and these remain distinct measures. Where neighbourhood income is unavailable, individual tract shading remains. Profiles retain source categories, ordered by published value; distribution maps use consistent federal census categories.',
  '市府缺少的项目会直接补充当前位置的普查资料，注明范围；不把小区数值冒充整个社区，不合并或平均收入中位数。Richmond 的点击范围按开放普查边界近似，仅用于定位，不是市府原始规划边界。': 'Missing municipal fields are supplemented directly with census data for the selected location, with its scope identified. Tract values are never relabelled as whole-neighbourhood statistics and medians are not combined or averaged. Richmond uses approximate location footprints assembled from open census boundaries, not original municipal planning boundaries.',
  '社区概况': 'Neighbourhood profile',
  '查看社区概况': 'View neighbourhood profile',
  '查看社区内的街区统计': 'Explore census statistics within this neighbourhood',
  '数据属于所选普查小区，不代表整个具名社区。': 'These figures describe the selected census tract, not the whole named neighbourhood.',
  '普查小区统计': 'Census tract statistics',
  '优先显示市府社区名称；放大后可点选街区查看细分统计。': 'Municipal neighbourhood names appear first. Zoom in and select a census area for detailed statistics.',
  '市府社区与普查范围': 'Municipal neighbourhoods and census geography',
  '社区名称和边界来自各市政府。市府社区资料按原文公布的范围、年份和指标显示；地图收入底色与族裔分布仍使用 2021 普查小区资料。社区与普查小区不是同一边界，不把小区数值冒充整个社区，不合并或平均收入中位数。': 'Neighbourhood names and boundaries come from municipal governments. Municipal profiles retain their published geography, year and measures; income shading and population-group maps use 2021 census tracts. Neighbourhood and tract boundaries differ. Tract values are not presented as whole-neighbourhood statistics and income medians are never merged or averaged.',
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
  '搜索城市、普查区或车站': 'Search areas, tracts or stations',
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
  '道路、SkyTrain 与地理参照': 'Roads, SkyTrain and geographic context',
  'SkyTrain 线路与车站': 'SkyTrain lines and stations',
  'SkyTrain 车站': 'SkyTrain station',
  '定位车站': 'Locate station',
  '没有找到地区或车站，可输入城市、普查区编号或车站名。': 'No areas or stations found. Try a city, census tract ID or station name.',
  'Expo / Millennium / Canada · 运营线路': 'Expo / Millennium / Canada · operating lines',
  'SkyTrain 线路图例': 'SkyTrain route legend',
  'SkyTrain 运营线路': 'Operating SkyTrain lines',
  '车站': 'Station',
  '换乘站': 'Interchange station',
  'SkyTrain 资料暂未载入，重新载入页面可重试；人口统计仍可使用。': 'SkyTrain data could not load. Reload the page to try again; census statistics remain available.',
  'SkyTrain 线路与车站用于地理参照。显示运营线路；不提供实时班次、到站时间或服务中断信息。': 'SkyTrain lines and stations provide geographic context. Operating lines are shown; this map does not provide live schedules, arrivals or service disruptions.',
  '点击车站查看名称与所属线路，放大可显示更多车站名称。线路和站点用于定位，不会改变普查统计范围。': 'Select a station for its name and lines, and zoom in for more station labels. Routes and stations provide orientation without changing census coverage.',
  '道路底图': 'Roads',
  '主要道路与道路名称': 'Major roads and road names',
  '地理底色不代表收入或人口占比。': 'Geographic colours do not represent income or population shares.',
  '可在“地图图层”切换道路、地区标注、SkyTrain 与地理地标。缩小时显示城市与地区名称，放大后显示普查区编号。地理底色仅用于定位，不表示人口或收入。': 'Map layers controls roads, area labels, SkyTrain and geographic landmarks. Municipal neighbourhood names identify places; census identifiers appear as secondary details. Geographic colours provide orientation and do not represent population or income.',
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
