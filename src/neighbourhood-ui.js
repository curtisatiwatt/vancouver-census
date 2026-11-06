import { escapeHtml as esc, safeUrl } from './map-utils.js';

const copy = {
  zh: {
    population: '市府公布人口', income: '家庭收入', median: '家庭收入中位数', average: '家庭收入平均数',
    groups: '市府公布的族裔资料', missing: '尚无已核对的同范围数值',
    incomeNote: '中位数与平均数是不同指标；各项年份以官方原表为准。',
    groupsNote: '保留官方公布的类别、人数或百分比，不使用社区总人口推算缺失占比。',
    sources: '官方来源', profileSource: '社区统计资料', boundarySource: '社区边界',
    source: '来源', people: '人', notes: '资料说明',
    explore: '放大地图并点选街区，查看更细的人口和收入。',
  },
  en: {
    population: 'Municipal profile population', income: 'Household income', median: 'Median household income', average: 'Average household income',
    groups: 'Municipal profile categories', missing: 'No verified value is available for this exact area yet',
    incomeNote: 'Median and average are different measures. Each year follows the official source.',
    groupsNote: 'Categories, counts and percentages retain their published form. Missing shares are not estimated from the total population.',
    sources: 'Official sources', profileSource: 'Neighbourhood statistics', boundarySource: 'Neighbourhood boundary',
    source: 'Source', people: 'people', notes: 'Data notes',
    explore: 'Zoom in and select a local area to explore population and income in more detail.',
  },
};

const groupNamesZh = {
  White: '白人（White）', Caucasian: 'Caucasian（市府原文分类）', Other: '其他（Other）', Others: '其他（Others）',
  Multiple: '多个类别（Multiple）', 'Indigenous identity': '原住民身份（Indigenous identity）',
  'Not a Visible Minority': '非可见少数族裔（Not a Visible Minority）',
  'Other & Multiple Groups': '其他及多个类别（Other & Multiple Groups）',
  'Visible minority, n.i.e.': '其他可见少数族裔（Visible minority, n.i.e.）',
  'Multiple visible minorities': '多个可见少数族裔（Multiple visible minorities）',
  Chinese: '华裔（Chinese）', 'South Asian': '南亚裔（South Asian）', Black: '黑人（Black）',
  Filipino: '菲律宾裔（Filipino）', Arab: '阿拉伯裔（Arab）', 'Latin American': '拉丁美洲裔（Latin American）',
  'Southeast Asian': '东南亚裔（Southeast Asian）', 'West Asian': '西亚裔（West Asian）',
  Korean: '韩裔（Korean）', Japanese: '日裔（Japanese）',
  'Not a visible minority': '非可见少数族裔（Not a visible minority）',
};
const publishedNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const formatNumber = value => value.toLocaleString('en-CA', { maximumFractionDigits: 20 });
const yearText = record => /^\d{4}$/.test(String(record?.year ?? '')) ? String(record.year) : '';
const basisZh = {
  'Before-tax income of all private households; 25% sample': '所有私人住户的税前收入；25% 样本',
  'Before-tax income of all private households': '所有私人住户的税前收入',
  'All households; total income of household members': '所有住户；家庭成员总收入',
};

/** Renders only source-published neighbourhood values; titles and map boundaries belong to the caller. */
export function renderNeighbourhoodProfile(feature, { language = 'zh' } = {}) {
  const lang = language === 'en' ? 'en' : 'zh';
  const text = copy[lang];
  const p = feature?.properties || {};
  const statistics = p.statistics || {};
  const sources = new Map();
  const localizedText = value => typeof value === 'string' ? value : typeof value?.[lang] === 'string' ? value[lang] : '';
  function reference(url, label, sourceLabel = label) {
    const href = safeUrl(url);
    if (!href) return '';
    if (!sources.has(href)) sources.set(href, { index: sources.size + 1, labels: new Set() });
    const source = sources.get(href);
    source.labels.add(sourceLabel);
    return `<a class="neighbourhood-source-ref" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`${label} · ${text.source} ${source.index}`)}">[${source.index}]</a>`;
  }
  function metric(record, label, { currency = false, unit = null, sourceLabel = label } = {}) {
    const available = publishedNumber(record?.value) && (unit !== 'percent' || record.value <= 100);
    const value = available
      ? `${currency ? '$' : ''}${formatNumber(record.value)}${unit === 'percent' ? '%' : unit === 'count' ? ` ${text.people}` : ''}`
      : text.missing;
    const year = yearText(record);
    const source = reference(record?.sourceUrl || p.sourceUrl, label, sourceLabel);
    const publishedBasis = localizedText(record?.basis);
    const basis = lang === 'zh' ? basisZh[publishedBasis] || publishedBasis : publishedBasis;
    return `<div class="neighbourhood-metric${available ? '' : ' is-missing'}"><dt>${esc(label)}${year ? `<span class="neighbourhood-year">${esc(year)}</span>` : ''}${source}</dt><dd>${esc(value)}${basis ? `<span class="neighbourhood-metric-basis">${esc(basis)}</span>` : ''}</dd></div>`;
  }

  function renderNotes(stats) {
    const notes = (Array.isArray(stats.notes) ? stats.notes : []).map(note => note?.[lang]).filter(note => typeof note === 'string' && note.trim());
    return notes.length ? `<div class="neighbourhood-notes" aria-label="${esc(text.notes)}">${notes.map(note => `<p>${esc(note)}</p>`).join('')}</div>` : '';
  }
  function renderStatistics(stats, nested = false) {
    // A shared planning boundary can contain separately published profiles.
    // Render those separately: their medians and category percentages cannot be added.
    const subprofiles = (Array.isArray(stats.subprofiles) ? stats.subprofiles : []).filter(profile => typeof profile?.name === 'string' && profile.statistics);
    const children = !nested ? subprofiles.map(profile => `<section class="neighbourhood-subprofile"><h2>${esc(profile.name)}</h2>${renderStatistics(profile.statistics, true)}</section>`).join('') : '';
    const compact = nested || Boolean(children);
    const heading = nested ? 'h3' : 'h2';
    const groups = (Array.isArray(stats.groups) ? stats.groups : []).filter(group => typeof group?.name === 'string' && group.name.trim() && ['count', 'percent'].includes(group.unit));
    const hasGroups = groups.some(group => publishedNumber(group.value) && (group.unit !== 'percent' || group.value <= 100));
    const hasPopulation = publishedNumber(stats.population?.value);
    const hasIncome = publishedNumber(stats.incomeMedian?.value) || publishedNumber(stats.incomeAverage?.value);
    if (!hasPopulation && !hasIncome && !hasGroups) return `${children ? '' : `<p class="neighbourhood-missing neighbourhood-empty">${esc(text.missing)}${lang === 'zh' ? '。' : '.'}</p>`}${renderNotes(stats)}${children}`;
    const populationLabel = localizedText(stats.population?.label) || text.population;
    const population = hasPopulation ? `<dl class="neighbourhood-population">${metric(stats.population, populationLabel, { unit: 'count' })}</dl>` : compact ? '' : `<p class="neighbourhood-missing neighbourhood-empty">${esc(populationLabel)} · ${esc(text.missing)}</p>`;
    const income = [
      stats.incomeMedian ? metric(stats.incomeMedian, text.median, { currency: true }) : '',
      stats.incomeAverage ? metric(stats.incomeAverage, text.average, { currency: true }) : '',
    ].join('');
    const groupRows = hasGroups ? groups.map(group => metric(group, lang === 'zh' ? groupNamesZh[group.name] || group.name : group.name, { unit: group.unit, sourceLabel: text.groups })).join('') : '';
    return `${population}
      ${hasIncome || !compact ? `<section class="neighbourhood-section" aria-label="${esc(text.income)}"><${heading}>${esc(text.income)}</${heading}>${hasIncome ? `<dl class="neighbourhood-income">${income}</dl><p class="neighbourhood-note">${esc(text.incomeNote)}</p>` : `<p class="neighbourhood-missing">${esc(text.missing)}</p>`}</section>` : ''}
      ${hasGroups || !compact ? `<section class="neighbourhood-section" aria-label="${esc(text.groups)}"><${heading}>${esc(text.groups)}</${heading}>${groupRows ? `<dl class="neighbourhood-groups">${groupRows}</dl><p class="neighbourhood-note">${esc(text.groupsNote)}</p>` : `<p class="neighbourhood-missing">${esc(text.missing)}</p>`}</section>` : ''}
      ${renderNotes(stats)}${children}`;
  }
  const profile = renderStatistics(statistics);
  reference(p.sourceUrl, text.profileSource);
  reference(p.boundarySourceUrl, text.boundarySource);
  const sourceList = [...sources.entries()].map(([href, source]) => `<li><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc([...source.labels].join(' · '))} ↗</a></li>`).join('');

  return `<div class="neighbourhood-profile" lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
    ${profile}
    <p class="neighbourhood-explore">${esc(text.explore)}</p>
    ${sourceList ? `<section class="neighbourhood-section neighbourhood-sources" aria-label="${esc(text.sources)}"><h2>${esc(text.sources)}</h2><ol>${sourceList}</ol></section>` : ''}
  </div>`;
}
