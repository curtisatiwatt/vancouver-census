/** UI translations. Census values and geographic proper names are never rewritten. */
export const LANGUAGE_STORAGE_KEY = 'vancouver-census-language';
const languages = new Set(['zh', 'en']);
function storedLanguage() {
  try { const saved = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY); return languages.has(saved) ? saved : null; } catch { return null; }
}
function systemLanguage() {
  return /^zh\b/i.test(globalThis.navigator?.language || 'zh') ? 'zh' : 'en';
}
let explicitLanguage = storedLanguage();
let language = explicitLanguage || systemLanguage();
let languageInitialized = false;
export const currentLanguage = () => language;
export const getLanguagePreference = () => explicitLanguage || 'system';
export function refreshLanguagePreference() {
  if (typeof document === 'undefined') return;
  const select = document.getElementById('language-preference');
  if (select) select.value = getLanguagePreference();
}
function applyLanguage() {
  const previous = language;
  language = explicitLanguage || systemLanguage();
  if (typeof document !== 'undefined') document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  refreshLanguagePreference();
  if (previous !== language && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('atlas-languagechange', { detail: { language } }));
  }
  return language;
}
export function setLanguagePreference(value) {
  if (value !== 'system' && !languages.has(value)) return language;
  explicitLanguage = value === 'system' ? null : value;
  try {
    if (explicitLanguage) globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, explicitLanguage);
    else globalThis.localStorage?.removeItem(LANGUAGE_STORAGE_KEY);
  } catch { /* A manual choice remains usable within this session. */ }
  return applyLanguage();
}
export function setLanguage(value) { return setLanguagePreference(value === 'en' ? 'en' : 'zh'); }
export function initLanguagePreference() {
  if (typeof window === 'undefined' || languageInitialized) return;
  languageInitialized = true;
  applyLanguage();
  document.getElementById('language-preference')?.addEventListener('change', event => setLanguagePreference(event.target.value));
  window.addEventListener('languagechange', () => { if (!explicitLanguage) applyLanguage(); });
  window.addEventListener('storage', event => {
    if (event.key !== LANGUAGE_STORAGE_KEY && event.key !== null) return;
    explicitLanguage = languages.has(event.newValue) ? event.newValue : null;
    applyLanguage();
  });
}
const translations = {
  '常用五类': 'Top five groups',
  '人口视图采用市府地区档案的 13 个 Visible Minority（Racialized Population）互斥分类，初始不选人口群体，可自行选择一个或多个人口群体。非可见少数族裔为普查分类，包含原住民等人口，不可视作白人或欧洲裔。': 'The population view uses the 13 mutually exclusive visible-minority (racialized-population) categories from city census tract profiles. No population groups are selected initially; choose one or several groups to explore. “Not a visible minority” is a census category that includes Indigenous people and cannot be treated as White or European.',
  '人口视图采用市府 2021 年普查定制汇总的 13 个 Visible Minority（Racialized Population）互斥分类，初始不选人口群体，可自行选择一个或多个人口群体。非可见少数族裔为普查分类，包含原住民等人口，不可视作白人或欧洲裔。': 'The population view uses the 13 mutually exclusive visible-minority (racialized-population) categories from the city’s custom 2021 Census tabulation. No population groups are selected initially; choose one or several groups to explore. “Not a visible minority” is a census category that includes Indigenous people and cannot be treated as White or European.',

  '跟随系统': 'Use device setting', '白天': 'Light', '夜间': 'Dark', '选择语言': 'Choose language', '选择外观': 'Choose appearance',
  'theme.toDark': 'Switch to dark mode', 'theme.toLight': 'Switch to light mode',
  '地区观察': 'Census Atlas',
  'Vancouver 地区观察 · 人口构成与分布': 'Vancouver Census Atlas · Population & census tracts',
  'Vancouver 地区观察首页': 'Vancouver Census Atlas home',
  '探索 Vancouver 地区的人口构成、不同人口群体的分布和家庭收入。基于官方 2021 年人口普查地区资料。': 'Explore population composition, group distribution and household income across Vancouver census tracts using official 2021 Census profiles.',
  '搜索地区，例如 Richmond': 'Find an area, e.g. Richmond', '搜索大温哥华地区': 'Search Vancouver census tracts',
  '数据说明 ↗': 'About the data ↗', '地图视图与人口群体': 'Map views and population groups', '地图视图': 'Map view',
  '地区构成': 'Composition', '分布对比': 'Compare', '人口群体': 'Groups', '地图图层': 'Map layers', '收入底色': 'Income layer',
  '一个地区，一张构成图': 'One census tract, one composition chart', '同一色阶，查看聚居分布': 'A shared scale for comparing distributions',
  '选择地图图层': 'Choose map layers', '地区构成的地理参照': 'Context for the composition map', '关闭地图图层': 'Close map layers',
  '道路与铁路底图': 'Roads & railways', '主要道路、道路名称及铁路轨道': 'Major roads, road names and railway tracks',
  '地区标注': 'Area and tract labels', '随缩放逐步显示；自动避开重叠': 'More detail as you zoom; labels avoid overlap',
  '地理地标': 'Geographic landmarks', '机场、公园绿地及原住民保留区': 'Airport, parks and Indigenous reserves',
  '机场': 'Airport', '公园': 'Parks', '保留区': 'Reserves', '铁路': 'Railways',
  '地理底色不代表收入或人口占比。点击车站可查看线路与建设状态。': 'Geographic shading is separate from income and population. Select a station for its line and project status.',
  '选择人口群体': 'Choose population groups', '两个视图共用这份选择': 'Your selection applies to both views', '关闭人口群体选择': 'Close population groups',
  '搜索名称 / Search groups': 'Search groups', '搜索人口群体': 'Search population groups', '默认五类': 'Top five', '全选': 'Select all', '清空': 'Clear',
  '按普查原始分类展示；这些类别不等于国籍。“非可见少数族裔”包括原住民等，不能等同于白人。': 'These are original Census categories, not nationalities. “Not a visible minority” includes Indigenous people and must not be treated as “White”.',
  '地区详情': 'Census tract details', '展开或收起地区详情': 'Expand or collapse census tract details', '定位 ↗': 'Locate ↗',
  '正在载入地区': 'Loading census tract', '正在加载官方地区数据…': 'Loading official census tract data…', '地区': 'Census tract', '统计基数': 'population base',
  '已选地区': 'Selected census tract', '选中地区的人口构成': 'Selected census tract population composition', '人口构成': 'Population composition', '全区占比': 'Regional share',
  '0–14 岁': 'Ages 0–14', '平均每户': 'People / household', '正在加载…': 'Loading…',
  '查看官方地区档案 ↗': 'Official census profile ↗',
  '大温哥华互动地区地图': 'Interactive Metro Vancouver census map', '地区构成地图，可拖动缩放，也可以搜索选择地区': 'Composition map: pan, zoom or search to choose a census tract',
  '正在加载地区边界…': 'Loading census tract boundaries…', '每个圆代表一个地区': 'One ring per census tract', '扇区为占比 · 灰色为未选类别': 'Slices show shares · grey shows unselected groups',
  '放大地图可查看更多地区': 'Zoom in for more census tracts', '家庭年收入中位数': 'Median household income',
  '低于 6 万': 'Under $60k', '9.8 万': '$98k', '20 万以上': '$200k+', '无数据 · 税前 CAD · 2020': 'No data · before-tax CAD · 2020',
  '同一色阶，比较集中程度': 'Compare with one colour scale', '拖动与缩放同步 · 颜色表示地区内占比': 'Pan and zoom together · colour shows local share',
  '上一组人口地图': 'Previous population maps', '当前比较的人口群体': 'Population group currently compared', '下一组人口地图': 'Next population maps',
  '选择想比较的人口群体': 'Choose groups to compare', '可以选一种，也可以同时比较多种。': 'Explore one group or compare several.',
  '占地区人口比例': 'Share of census tract population', '所有地图使用相同色阶': 'Same scale on every map', '暂无数据，不是 0%': 'No data, not 0%',
  '查看整个大温哥华': 'View all Metro Vancouver', '全区 ⤢': 'Region ⤢', '放大地图': 'Zoom in', '缩小地图': 'Zoom out',
  '专注地图': 'Focus map', '退出专注': 'Exit focus',
  '正在展开 Vancouver': 'Opening Metro Vancouver', '读取官方地区边界与人口资料': 'Loading official boundaries and population data',
  '关闭数据说明': 'Close data guide', '这张地图怎样读？': 'How to read this map', '地区构成 / 分布对比': 'Composition / Compare',
  '“地区构成”用一个等大的圆展示一个地区，彩色扇区对应勾选类别，灰色是其余类别。圆的大小不代表人口多少；全区视角会避开重叠，放大可看到更多地区，未显示圆的地区仍可点击。“分布对比”用底色表示各类别在地区人口中的占比，所有地图共用固定色阶和地图位置。': 'Composition uses an equal-size ring for each census tract. Coloured slices show selected groups; grey shows the rest. Ring size does not represent population. Rings avoid overlap at regional scale; zoom in to reveal more, or select a boundary without a ring. Compare shades each census tract by its local group share, with a fixed shared scale and synchronized map positions.',
  '地图中的圆心只是地区内的显示位置，不是居民地址。': 'Ring centres are display positions within census tract boundaries, not residents’ addresses.',
  '道路、轨道与地理地标': 'Roads, transit and landmarks',
  '人口类别不等于国籍': 'Population categories are not nationalities',
  '采用 2021 年普查 Visible minority（Racialized population）分类。Chinese 不等于中国国籍、中国出生或普通话使用者；“非可见少数族裔”包括原住民等，不能改称白人或欧洲裔。默认勾选五个人数最多的可见少数族裔类别，也可选择其余类别。': 'The map uses 2021 Census visible-minority (racialized-population) categories. Chinese does not mean Chinese citizenship, birthplace or Mandarin use. “Not a visible minority” includes Indigenous people and cannot be renamed White or European. The five largest visible-minority groups are selected by default; other categories are also available.',
  '人数、占比与取整': 'Counts, shares and rounding',
  '详情与热度图的占比由公布人数除以同表的私人住户人口计算，保留一位小数；这与原 PDF 中已取整的整数百分比可能略有不同。官方人数通常按 5 人取整，各类别人数之和可能略偏离总人口。分类合计少于人口总数时，差额在圆环中单独留白；超过人口总数时，圆环按分类合计缩放。详情数值仍使用表中人口基数。': 'Detail and heat-map shares divide published counts by the private-household population in the same table, rounded to one decimal. They may differ slightly from whole percentages in the source PDF. Counts are generally rounded to multiples of five, so categories may not sum to population. A shortfall appears as a separate unfilled ring segment; if category totals exceed population, only the ring is scaled to close the circle. Detail shares keep the source population denominator.',
  '“其余类别”只包含未勾选的人口类别，不包含缺失数据。带点线的留白表示原表统计差额，不是一个人口类别。公布的 0 不代表可以确认绝对没有居民；灰色虚线边界和“暂无数据”表示资料缺失，不当作 0。': '“Other groups” contains unselected categories only, not missing data. The dotted unfilled segment represents a source-table discrepancy, not another population category. A published zero does not confirm that no residents are present. Dashed grey boundaries and “No data” mean missing information, not zero.',
  '年份与收入': 'Years and income',
  '收入底色蓝色较低、黄色居中、红色较高，使用固定区间；收入不是财富、房价或个人工资。“住户”也包括单人和合住者。': 'Income uses fixed bins: blue is lower, yellow is mid-range and red is higher. Income is not wealth, house price or individual salary. Households include people living alone and shared households.',
  '覆盖范围': 'Coverage',
  '原始来源': 'Original sources',
  '暂无数据': 'No data', '没有找到这个类别。': 'No matching group.', '其余类别': 'Other groups', '原表统计差额': 'Source-table discrepancy',
  '未选择人口群体 · 点击“人群”添加': 'No groups selected · choose Groups', '官方资料暂无同口径收入数值': 'No comparable income value is published',
  '这个区域暂无可用的人口分类资料，不能当作 0 人。': 'Population categories are unavailable for this area; this does not mean zero residents.',
  '点击“人群”选择想了解的类别。': 'Choose the categories you want to explore under Groups.',
  '占比按人数 ÷ 同表私人住户人口计算。灰色为未勾选类别，留白为原表统计差额。': 'Shares are counts divided by private-household population in the same table. Grey shows unselected groups; the unfilled segment shows the source-table discrepancy.',
  '原始人数经过统计取整。': 'Source counts are statistically rounded.',
  '点击固定地区，查看完整构成': 'Select to pin this census tract and see its full composition', '家庭收入': 'Household income', '人口': 'Population',
  '人口分类暂无数据': 'Population groups unavailable', '点击查看地区详情': 'Select for census tract details', '未选人口群体，暂不显示构成圆': 'No groups selected; composition rings are hidden',
  '没有找到地区，可输入英文名或地区代码。': 'No census tract found. Try its name or census tract code.',
  '地图暂时无法载入': 'The map could not load', '重新载入': 'Reload', '数据载入失败': 'Data failed to load',
  '南亚裔': 'South Asian', '华人': 'Chinese', '黑人': 'Black', '菲律宾裔': 'Filipino', '阿拉伯裔': 'Arab', '拉丁美洲裔': 'Latin American',
  '东南亚裔': 'Southeast Asian', '西亚裔': 'West Asian', '韩裔': 'Korean', '日裔': 'Japanese', '其他可见少数族裔': 'Visible minority, n.i.e.',
  '多重可见少数族裔': 'Multiple visible minorities', '非可见少数族裔': 'Not a visible minority',
  '东北区': 'Northeast', '东区': 'East', '东南区': 'Southeast', '中心区': 'Centre', '北区': 'North', '南区': 'South', '未注明': 'Unspecified', '西北区': 'Northwest', '西区': 'West',
  '住宅类': 'Residential', '剩余分区': 'Residual area', '大型公园': 'Major park', '工业类': 'Industrial',
  '运营中': 'In service', '建设中 · 未运营': 'Under construction · not in service', '规划中 · 未运营': 'Planned · not in service', '未运营': 'Not in service',
  ' · 远期规划 / 未获建设资金': ' · Future plan / construction funding not secured',
  '规划示意位置，非最终站位': 'Schematic planning position, not the final station location', '官方线路资料 ↗': 'Official line information ↗',
  '一期东南段': 'Phase 1 southeast', '一期市中心段': 'Phase 1 downtown', '远期北延线': 'Future north extension', '远期南延线': 'Future south extension',
  '2026-09-22 获批的市中心地面方案，处于规划设计阶段，尚未运营。': 'The downtown surface alignment approved on September 22, 2026 is in planning and design, and is not in service.',
  '东南段施工中，尚未运营。': 'The southeast segment is under construction and is not in service.',
  '官方规划点位；最终站址待设计确定。市中心地面方案于 2026-09-22 获批，尚未运营。': 'Official planning position; the final station location will be determined through design. The downtown surface alignment was approved on September 22, 2026 and is not in service.',
  '远期北延线，建设资金尚未落实；线位与站点可能调整。': 'Future north extension; construction funding is not secured and the alignment and stations may change.',
  '远期南延线，建设资金尚未落实；线位与站点可能调整。': 'Future south extension; construction funding is not secured and the alignment and stations may change.',
  '远期站点；与现阶段线路的连接尚未确定，建设资金尚未落实。': 'Future station; its connection to the current phase remains undetermined and construction funding is not secured.',
};
const chineseKeys = { 'theme.toDark': '切换至夜间模式', 'theme.toLight': '切换至白天模式' };
export function addTranslations(entries) { Object.assign(translations, entries); }
const patterns = [];
export function addTranslationPatterns(entries) { patterns.push(...entries); }
export function translate(value, lang = language) {
  const text = String(value ?? '');
  if (lang !== 'en') return chineseKeys[text] || text;
  const exact = translations[text];
  if (exact !== undefined) return exact;
  const trimmed = text.trim();
  if (translations[trimmed] !== undefined) return text.replace(trimmed, translations[trimmed]);
  for (const [pattern, replace] of patterns) if (pattern.test(text)) return text.replace(pattern, replace);
  return text;
}
export function t(key, params = {}) { return translate(key).replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match); }
const originalText = new WeakMap();
const originalAttributes = new WeakMap();
const translatedAttributes = ['aria-label', 'placeholder', 'title', 'alt', 'content'];
/** Keep original strings on actual DOM nodes so toggling never translates a translation. */
export function applyStaticTranslations(root = document) {
  if (typeof document === 'undefined') return;
  if (root === document) {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    refreshLanguagePreference();
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  do {
    if (node.nodeType === Node.TEXT_NODE && !['SCRIPT','STYLE','NOSCRIPT'].includes(node.parentElement?.tagName)) {
      const previous = originalText.get(node);
      const source = previous && node.nodeValue === previous.result ? previous.source : node.nodeValue;
      const result = translate(source);
      if (node.nodeValue !== result) node.nodeValue = result;
      originalText.set(node, { source, result });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const records = originalAttributes.get(node) || {};
      for (const attr of translatedAttributes) if (node.hasAttribute(attr)) {
        const value = node.getAttribute(attr); const previous = records[attr];
        const source = previous && value === previous.result ? previous.source : value;
        const result = translate(source);
        if (value !== result) node.setAttribute(attr, result);
        records[attr] = { source, result };
      }
      originalAttributes.set(node, records);
    }
  } while ((node = walker.nextNode()));
  const languageButton = document.getElementById('language-toggle');
  if (languageButton && root === document) {
    languageButton.textContent = language === 'zh' ? 'EN' : '中文';
    languageButton.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换为中文');
    languageButton.title = language === 'zh' ? 'Switch to English' : '切换为中文';
    languageButton.setAttribute('lang', language === 'zh' ? 'en' : 'zh-CN');
  }
}
export function localizeHtml(html) {
  if (language !== 'en' || typeof document === 'undefined') return html;
  const template = document.createElement('template'); template.innerHTML = html;
  applyStaticTranslations(template.content);
  return template.innerHTML;
}

addTranslationPatterns([
  [/^(\d{4}) 普查 · (\d{4}) 收入$/, '$1 Census · $2 income'],
  [/^(\d{4}) 年人口普查$/, '$1 Census'],
  [/^私人住户人口 · (\d{4})$/, 'Private-household population · $1'],
  [/^家庭税前年收入中位数 · (\d{4})$/, 'Median before-tax household income · $1'],
  [/^全区 (.+)$/, 'Region $1'], [/^全区占比 (.+)$/, 'Regional share $1'],
  [/^(\d+) 个区域 · (\d{4}) 普查$/, '$1 areas · $2 Census'],
  [/^人口资料来自 (\d{4}) 年人口普查，收入参考期为 (\d{4}) 年，不是今天的收入与人口。$/, 'Population data comes from the $1 Census and income refers to $2, not current population or income.'],
  [/^覆盖 (\d+) 个官方区域，(\d+) 个有可用人口分类，(\d+) 个有收入数据；保留缺失区域的边界。$/, 'Covers $1 official areas: $2 have usable population categories and $3 have income data. Boundaries remain visible where data is missing.'],
  [/^原始数据整理于 (.+)；本图为官方资料快照。$/, 'Source data prepared on $1; this map is a snapshot of official information.'],
  [/^已选 (\d+) \/ (\d+)$/, '$1 / $2 selected'],
  [/^人口 (.+) · 家庭收入 (.+)$/, (_, pop, income) => `Population ${translate(pop, 'en')} · Income ${translate(income, 'en')}`],
  [/^全区的 ([\d.]+) 倍 · 第 (\d+) \/ (\d+)$/, '$1× regional median · Rank $2 / $3'],
  [/^([\d.,]+) 人$/, '$1 people'],
  [/^ 分类合计 (.+)，表内人口 (.+)；原表存在差异，保留原数值。$/, ' Category total: $1; table population: $2. The original discrepancy and values are preserved.'],
  [/^已选择 (.+)。人口构成已更新。$/, '$1 selected. Population composition updated.'],
  [/^(.+) 人口构成$/, '$1 population composition'],
  [/^(.+)，点击查看人口构成$/, '$1: select to view population composition'],
  [/^当前显示 (\d+) 个构成圈 · 放大可查看更多$/, '$1 rings visible · zoom in for more'],
  [/^(.+)在 Metro Vancouver 各地区的占比地图$/, (_, group) => `${translate(group, 'en')} share by Metro Vancouver census tract`],
  [/^(.+)暂未载入，地区统计仍可使用。$/, (_, parts) => `${parts.split('、').map(p => translate(p, 'en')).join(', ')} could not load. Census tract statistics are still available.`],
  [/^低于 \$(.+)$/, 'Under $$$1'], [/^\$(.+) 及以上$/, '$$$1 and above'], [/^40% 及以上$/, '40% and above'],
  [/^家庭收入 (.+)$/, (_, value) => `Household income ${translate(value, 'en')}`], [/^人口 (.+)$/, (_, value) => `Population ${translate(value, 'en')}`],
  [/^(.+) 人 · 全区 (.+)$/, (_, count, share) => `${translate(count, 'en')} people · Region ${translate(share, 'en')}`],
  [/^(.+) · 未运营$/, '$1 · not in service'],
]);

addTranslations({
  "2021 年普查中的 2020 年私人住户税前总年收入中位数，单位为加元。不是个人工资、经济家庭收入、税后收入或当前收入。": "Median total before-tax income of private households in 2020, from the 2021 Census, in Canadian dollars. This is not individual salary, economic-family income, after-tax income or current income.",
  "底图使用数据整理时下载的官方地区边界名录；统计来自 2021 年地区档案，按地区代码／名称对应，未针对后续边界变化重新分配统计。圆心为经检查位于地区边界内的显示点，不是居民住址。": "The basemap uses official census tract boundaries downloaded during preparation. Statistics come from 2021 profiles matched by census tract code/name and have not been redistributed for later boundary changes. Ring centres are checked display points within boundaries, not residents’ addresses.",
  "2026 年联邦普查已完成采集，但截至 2026-11-03 尚未公布结果。首次人口结果计划于 2027-02-10 发布；收入为 2027-07-14；民族文化资料为 2027-10-27。本图仍使用已发布的 2021 年地区数据。": "The 2026 federal Census has completed collection, but no results had been published as of November 3, 2026. The first population release is scheduled for February 10, 2027, income for July 14, 2027, and ethnocultural data for October 27, 2027. This map continues to use published 2021 census tract data.",
  "人口视图采用市府地区档案的 13 个 Visible Minority（Racialized Population）互斥分类，默认勾选全区人数最多的五个可见少数族裔类别。非可见少数族裔为普查分类，包含原住民等人口，不可视作白人或欧洲裔。": "Population views use the 13 mutually classified visible-minority (racialized-population) categories in the city’s profiles. The five largest visible-minority categories citywide are selected by default. “Not a visible minority” includes Indigenous people and must not be interpreted as White or European.",
  "Statistics Canada · 2026 collection complete": "Statistics Canada · 2026 collection complete",
  "Statistics Canada · 2026 release schedule": "Statistics Canada · 2026 release schedule",
  "Natural Resources Canada · 原住民土地行政边界": "Natural Resources Canada · Indigenous land administrative boundaries"
});
addTranslations({
  '多个可见少数族裔': 'Multiple visible minorities', '非可见少数族裔（普查分类）': 'Not a visible minority (Census category)',
  '地区边界数据格式不完整': 'Census tract boundary data is incomplete', '地区人口分类数据格式不完整': 'Population category data is incomplete', '地区身份或显示坐标缺失': 'A census tract identifier or display coordinate is missing',
});
addTranslationPatterns([
  [/^无法载入 (.+)（(\d+)）$/, 'Could not load $1 ($2)'],
  [/^(.+) ([\d.]+%|暂无数据)$/, (_, group, value) => `${translate(group, 'en')} ${translate(value, 'en')}`],
  [/^(.+) 人 · 全区 (.+)$/, (_, count, share) => `${translate(count, 'en')} people · Region ${translate(share, 'en')}`],
  [/^(.+) · (.+) · (运营中|建设中 · 未运营|规划中 · 未运营)$/, (_, name, line, status) => `${name} · ${line} · ${translate(status, 'en')}`],
  [/^(一期东南段|一期市中心段|远期北延线|远期南延线) · 远期规划 \/ 未获建设资金$/, (_, phase) => `${translate(phase, 'en')} · Future plan / construction funding not secured`],
]);

addTranslationPatterns([[/^(东北区|东区|东南区|中心区|北区|南区|未注明|西北区|西区) · (住宅类|剩余分区|大型公园|工业类)$/, (_,sector,type) => `${translate(sector,'en')} · ${translate(type,'en')}`]]);

addTranslationPatterns([[/^(.+) ↗$/, (_, label) => `${translate(label, 'en')} ↗`]]);

addTranslations({
});

addTranslations({
  '人口不足1,000，取整或抑制会影响解读。': 'Population is below 1,000; rounding or suppression may affect interpretation.',
  '人口不足1,000，取整或抑制会影响解读。原表华人人数为0，不代表可确认绝对无人。': 'Population is below 1,000; rounding or suppression may affect interpretation. The source publishes a Chinese count of 0, which does not confirm that no Chinese residents are present.',
});
