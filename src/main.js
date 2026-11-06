import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import './mobile-ui.css';
import './mobile-dialogs.css';
import './community-sheet.css';
import './map-legibility.css';
import './desktop-ui.css';
import './map-controls.css';
import './skytrain-controls.css';
import './neighbourhoods.css';
import { initDesktopUI } from './desktop-ui.js';
import { initMobileUI, getMobileMapInsets } from './mobile-ui.js';
import { initCommunitySheet } from './community-sheet.js';
import { loadData } from './data.js';
import { t, currentLanguage, initLanguagePreference, applyStaticTranslations, localizeHtml } from './i18n.js';
import { initTheme, refreshThemeControl, isDarkTheme } from './theme.js';
import { createMapTooltip } from './map-tooltip.js';
import { createCommunityHighlight } from './community-highlight.js';
import { createContextLayers } from './context-layers.js';
import { SKYTRAIN_LINES } from './transit-layers.js';
import { createNeighbourhoodLayers } from './neighbourhood-layers.js';
import { neighbourhoodLabelFeatures } from './neighbourhoods.js';
import { renderNeighbourhoodProfile } from './neighbourhood-ui.js';
import { INCOME_BINS, isNumber, colorFor, money, number, percent, searchMapFeatures, summarize, escapeHtml as esc, safeUrl, hashCode } from './map-utils.js';
import { POPULATION_BINS, populationShare, populationSubtotal, hasPopulationData, populationColor, donutSvg } from './population-utils.js';

const $ = id => document.getElementById(id);
const mobile = () => window.matchMedia('(max-width: 760px)').matches;
const sidebar = document.querySelector('.sidebar');
const dialog = $('method-dialog');
const PALETTE = ['#518a7b', '#c29b4d', '#7e85af', '#5c8eac', '#b67768', '#8d9963', '#947cac', '#bb8c67', '#688b92', '#a18696', '#7f8990', '#b7a268', '#c2c9bd'];
const state = {
  features: [], byCode: new Map(), metadata: {}, counts: {}, data: null, basemap: null,
  geographicContext: null, orientationLandmarks: null, skytrain: null, neighbourhoods: null, municipality: '',
  roads: true, labels: true, landmarks: false, transit: false,
  groups: [], groupById: new Map(), selectedGroups: [], colors: {}, selected: null, selectionActive: false,
  mode: 'composition', income: false, contexts: [], comparisonContexts: [], composition: null,
  view: null, wholeCity: true, compareStart: 0, searchMatches: [], activeSearch: -1,
};
let syncing = false;
let syncFrame = null;
let lastMobile = mobile();
let lastComparisonPageSize = null;
let mobileUI;
let communitySheet;
let desktopUI;
let observedTextSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
const labelMeasure = document.createElement('canvas').getContext('2d');

function localize(...roots) { roots.filter(Boolean).forEach(root => applyStaticTranslations(root)); }

function selectedGroups() { return state.groups.filter(g => state.selectedGroups.includes(g.id)); }
const inMunicipality = feature => !state.municipality || (feature.properties.municipalities || [feature.properties.municipality]).includes(state.municipality);
function filteredFeatures() { return state.features.filter(inMunicipality); }
function populationRecord(code) { return state.data?.communities[code] || null; }
function activeContexts() { return state.mode === 'composition' ? [state.composition].filter(Boolean) : state.comparisonContexts; }
function closeTooltips(closePopups = true) { state.contexts.forEach(context => { context.tooltip.close(); context.highlights?.clearHover(); if (closePopups) context.map.closePopup(); }); }
function setCollapsed(collapsed) {
  if (mobile() && communitySheet && communitySheet.getState() !== 'closed') communitySheet.setSnap(collapsed ? 'peek' : 'half');
  mobileUI?.refresh();
}
function toggleGroups(open) {
  $('groups-panel').hidden = !open;
  $('groups-button').setAttribute('aria-expanded', String(open));
  if (open) { toggleLayers(false); if (!mobile()) $('group-search').focus(); }
  mobileUI?.refresh();
}

function toggleLayers(open) {
  $('layers-panel').hidden = !open;
  $('layers-button').setAttribute('aria-expanded', String(open));
  if (open) { toggleGroups(false); closeTooltips(); }
  mobileUI?.refresh();
}

function resizeMapsKeepingView() {
  const contexts = activeContexts();
  const current = contexts[0];
  if (!current?.map._loaded) return;
  const center = current.map.getCenter();
  const zoom = current.map.getZoom();
  cancelAnimationFrame(syncFrame); syncFrame = null;
  syncing = true;
  for (const context of contexts) {
    context.map.invalidateSize({ pan: false });
    // Leaflet's size change can shift the geographic centre even with pan disabled.
    context.map.setView(center, zoom, { animate: false });
  }
  syncing = false;
  syncMaps(current);
  contexts.forEach(updateLabels);
  updateDonuts();
}


function updateLayerVisibility() {
  closeTooltips();
  for (const context of state.contexts) {
    context.contextLayers?.setVisible({ roads: state.roads, landmarks: state.landmarks, transit: state.transit, communityLabels: state.labels });
    updateLabels(context);
  }
  $('transit-legend').hidden = state.mode !== 'composition' || !state.transit || !state.skytrain;
  const missingTransit = state.transit && !state.skytrain;
  $('transit-warning').hidden = !missingTransit;
  $('transit-toggle').setAttribute('aria-describedby', missingTransit ? 'transit-control-note transit-warning' : 'transit-control-note');
  mobileUI?.refresh();
}


function renderMunicipalities() {
  const select = $('municipality-filter');
  const municipalities = [...new Set(state.features.flatMap(feature => feature.properties.municipalities || [feature.properties.municipality]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.replaceChildren(new Option(t('全部城市与地区'), ''), ...municipalities.map(name => new Option(name, name)));
  select.value = state.municipality;
}

function setMunicipality(value) {
  state.municipality = value;
  closeSearch();
  closeTooltips();
  if (state.selected && !inMunicipality(state.byCode.get(state.selected))) {
    state.selectionActive = false;
    desktopUI?.clearSelection();
    communitySheet?.close();
    state.selected = filteredFeatures()[0]?.properties.code || null;
    renderDetail();
    try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* embedded preview */ }
  }
  refreshStyles();
  renderComparisonHeadings();
  mobileUI?.closeTransient();
  fitCity();
  const count = filteredFeatures().length;
  $('coverage-text').textContent = t(`${count} 个区域 · ${state.metadata.populationYear} 普查`);
}

function renderMetadata() {
  const m = state.metadata;
  $('data-edition').textContent = `${m.populationYear} 普查 · ${m.incomeYear} 收入`;
  $('income-detail-label').textContent = `家庭税前年收入中位数 · ${m.incomeYear}`;
  $('city-income').textContent = `全区 ${money(m.cityIncomeMedian)}`;
  $('coverage-text').textContent = `${filteredFeatures().length} 个区域 · ${m.populationYear} 普查`;
  $('year-definition').textContent = `人口资料来自 ${m.populationYear} 年人口普查，收入参考期为 ${m.incomeYear} 年，不是今天的收入与人口。`;
  $('income-definition').textContent = m.incomeDefinition || '';
  $('latest-census-note').textContent = m.latestCensusNote || '';
  $('geography-definition').textContent = m.geographyDefinition || '';
  $('transit-definition').textContent = m.transitDefinition || 'SkyTrain 线路与车站用于地理参照。显示运营线路；不提供实时班次、到站时间或服务中断信息。';
  if (m.populationGroupsDefinition) $('population-groups-definition').textContent = m.populationGroupsDefinition.replace('默认勾选全区人数最多的五个可见少数族裔类别', '初始不选人口群体，可自行选择一个或多个人口群体');
  $('coverage-definition').textContent = `覆盖 ${state.counts.total} 个官方区域，${Object.values(state.data.communities).filter(hasPopulationData).length} 个有可用人口分类，${state.counts.income} 个有收入数据；保留缺失区域的边界。`;
  $('boundary-note').textContent = m.boundaryNote || '';
  $('prepared-note').textContent = m.preparedDate ? `原始数据整理于 ${m.preparedDate}；本图为官方资料快照。` : '';
  $('license-note').textContent = m.license || '';
  $('source-list').replaceChildren();
  for (const source of m.sources || []) {
    const url = safeUrl(source.url);
    if (!url) continue;
    const link = document.createElement('a');
    Object.assign(link, { href: url, textContent: `${t(source.label)} ↗`, target: '_blank', rel: 'noopener noreferrer' });
    $('source-list').append(link);
  }
  for (const source of state.neighbourhoods?.municipalSources || []) {
    const url = safeUrl(source.url);
    if (!url) continue;
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = source.label;
    $('source-list').append(link);
  }
  $('municipal-licences').textContent = state.neighbourhoods?.attributions?.join(' ') || '';
  $('income-ramp').innerHTML = INCOME_BINS.map(bin => `<span style="background:${bin.color}" title="${esc(bin.label)}"></span>`).join('');
  $('population-ramp').innerHTML = POPULATION_BINS.map(bin => `<span style="background:${bin.color}" title="${esc(bin.label)}"></span>`).join('');
  localize(document.querySelector('.app-header'), dialog, $('income-legend'), $('population-legend'), $('transit-legend'), document.querySelector('.map-status'));
}

function refreshGroupControl() {
  const groups = selectedGroups();
  const english = currentLanguage() === 'en';
  const selection = groups.length === 1 ? t(groups[0].label) : english ? `${groups.length}` : `${groups.length} 类`;
  const label = $('group-selection-label');
  if (label) label.textContent = groups.length ? `${english ? 'Groups: ' : '人群：'}${selection}` : (english ? 'Choose groups' : '选择人群');
  $('groups-button').setAttribute('aria-label', `${english ? 'Choose population groups' : '选择人口群体'}${groups.length ? ` · ${selection}` : ''}`);
}

function renderGroupList() {
  const query = $('group-search').value.trim().toLowerCase();
  const groups = state.groups.filter(g => `${g.label} ${g.name}`.toLowerCase().includes(query));
  $('group-list').innerHTML = groups.length ? groups.map(g => `<label class="group-option" for="group-${g.id}"><input type="checkbox" id="group-${g.id}" data-group="${g.id}" ${state.selectedGroups.includes(g.id) ? 'checked' : ''}><span class="group-name">${esc(g.label)}<small>${esc(currentLanguage() === 'zh' ? g.name : '')}</small></span><span class="group-city">${percent(populationShare(state.data.city, g.id))}</span></label>`).join('') : '<p class="no-results">没有找到这个类别。</p>';
  $('filter-count').textContent = t(`已选 ${state.selectedGroups.length} / ${state.groups.length}`);
  localize($('group-list'));
  refreshGroupControl();
}

function updateGroupSelection(ids, rerender = true) {
  state.selectedGroups = [...new Set(ids)].filter(id => state.groupById.has(id));
  state.compareStart = Math.min(state.compareStart, Math.max(0, state.selectedGroups.length - 1));
  $('group-count').textContent = state.selectedGroups.length;
  $('filter-count').textContent = t(`已选 ${state.selectedGroups.length} / ${state.groups.length}`);
  if (rerender) renderGroupList();
  refreshGroupControl();
  renderDonutKey();
  renderDetail();
  state.contexts.forEach(context => context.neighbourhoodLayers?.update());
  updateDonuts();
  if (state.mode === 'distribution') rebuildComparison();
}

function renderDonutKey() {
  const groups = selectedGroups();
  $('composition-key').hidden = !groups.length;
  $('donut-key').innerHTML = groups.map(g => `<span><i style="background:${state.colors[g.id]}"></i>${esc(g.label)}</span>`).join('') + (groups.length ? '<span><i style="background:#d5dbd5"></i>其余类别</span><span><i style="background:#fff;border:1px dotted #819080"></i>原表统计差额</span>' : '<span>未选择人口群体 · 点击“人群”添加</span>');
  localize($('donut-key'));
}

function renderDetail() {
  const feature = state.byCode.get(state.selected);
  if (!feature) return;
  const p = feature.properties;
  const municipal = p.kind === 'neighbourhood';
  $('neighbourhood-detail').hidden = !municipal;
  $('tract-detail').hidden = municipal;
  if (municipal) {
    $('community-name').textContent = p.name;
    $('community-meta').innerHTML = `<span>${esc(p.municipality)}</span><span>${t('市府社区')}</span>`;
    $('collapsed-summary').textContent = t('官方社区资料');
    $('neighbourhood-detail').innerHTML = `<button class="neighbourhood-explore" type="button" data-explore-neighbourhood="${esc(p.code)}">${t('查看社区内的街区统计')} ↗</button>`
      + renderNeighbourhoodProfile(feature, { language: currentLanguage() });
    return;
  }
  const record = populationRecord(p.code);
  $('community-name').textContent = p.name;
  $('community-meta').innerHTML = [p.municipality || p.sectorLabel, p.typeLabel, `CT ${p.code}`].filter(Boolean).map(tag => `<span>${esc(tag)}</span>`).join('');
  $('tract-scope').hidden = !p.scopeNote;
  $('tract-scope').innerHTML = p.scopeNote ? `${t(p.scopeNote)} ${p.neighbourhoodIds?.length ? `<button class="neighbourhood-parent-link" type="button" data-open-neighbourhood="N:${esc(p.neighbourhoodIds[0])}">${t('查看社区概况')} ↗</button>` : ''}` : '';
  $('population').textContent = number(p.populationTotal ?? p.population);
  $('population-detail-label').textContent = '总人口 · 2021 普查';
  $('collapsed-summary').textContent = `人口 ${number(p.populationTotal ?? p.population)} · 家庭收入 ${money(p.income)}`;
  $('income-value').textContent = money(p.income);
  $('income-value').classList.toggle('missing', !isNumber(p.income));
  $('income-context').textContent = isNumber(p.income)
    ? `全区的 ${(p.income / state.metadata.cityIncomeMedian).toFixed(2)} 倍 · 第 ${p.incomeRank} / ${state.counts.income}`
    : '官方资料暂无同口径收入数值';
  $('children').textContent = percent(p.children);
  $('household').textContent = isNumber(p.householdSize) ? `${p.householdSize.toFixed(1)} 人` : '暂无数据';
  $('data-caveat').textContent = p.caveat || '';
  $('data-caveat').hidden = !p.caveat;
  const sourceUrl = safeUrl(record?.sourceUrl || p.sourceUrl);
  $('source-link').hidden = !sourceUrl;
  if (sourceUrl) $('source-link').href = sourceUrl;
  else $('source-link').removeAttribute('href');
  const groups = selectedGroups();
  if (!hasPopulationData(record)) {
    $('composition-bars').innerHTML = '<p class="detail-empty">这个区域暂无可用的人口分类资料，不能当作 0 人。</p>';
    $('composition-basis').textContent = '';
    localize(sidebar);
    return;
  }
  if (!groups.length) {
    $('composition-bars').innerHTML = '<p class="detail-empty">点击“人群”选择想了解的类别。</p>';
    $('composition-basis').textContent = t(`构成统计基数：${number(record.population)} 人（25% 长表私人住户人口）。`);
    localize(sidebar);
    return;
  }
  const rows = groups.map(g => ({ ...g, count: record.counts[g.id], share: populationShare(record, g.id), city: populationShare(state.data.city, g.id), color: state.colors[g.id] }));
  const remainder = state.groups.filter(g => !state.selectedGroups.includes(g.id));
  if (remainder.length) {
    const ids = remainder.map(group => group.id);
    const subtotal = populationSubtotal(record, ids);
    rows.push({ id: 'other', label: '其余类别', ...subtotal,
      city: populationSubtotal(state.data.city, ids).share, color: '#bcc7bd' });
  }
  $('composition-bars').innerHTML = rows.map(row => `<div class="composition-row" data-detail-group="${row.id}"><div class="bar-heading"><span>${esc(row.label)}</span><span><small>${isNumber(row.count) ? `${number(row.count)} 人` : '暂无数据'}</small><strong>${percent(row.share)}</strong></span></div><div class="bar-track"><span class="bar-fill" style="width:${Math.min(100, Math.max(0, (row.share || 0) * 100))}%;background:${row.color}"></span>${isNumber(row.city) ? `<i class="city-reference" style="left:${Math.min(100, Math.max(0, row.city * 100))}%" title="全区 ${percent(row.city)}"></i>` : ''}</div><span class="sr-only">全区占比 ${percent(row.city)}</span></div>`).join('');
  const sum = populationSubtotal(record, state.groups.map(group => group.id)).count;
  const difference = isNumber(sum) && record.population > 0 ? Math.abs(sum - record.population) : null;
  $('composition-basis').textContent = t(`构成统计基数：${number(record.population)} 人（25% 长表私人住户人口）。`) + ' ' + t('占比按人数 ÷ 同表私人住户人口计算。灰色为未勾选类别，留白为原表统计差额。') + ' ' + (difference === null ? t('部分人口类别或统计基数缺失，不合计为 0。') : difference > 35 || difference / record.population > 0.01 ? t(` 分类合计 ${number(sum)}，表内人口 ${number(record.population)}；原表存在差异，保留原数值。`) : t('原始人数经过统计取整。'));
  localize(sidebar);
}

function styleFor(context, feature) {
  const p = feature.properties;
  if (!inMunicipality(feature)) return { opacity: 0, fillOpacity: 0, weight: 0 };
  const value = context.groupId ? populationShare(populationRecord(p.code), context.groupId) : p.income;
  const missing = context.groupId ? value === null : state.income && !isNumber(value);
  const dark = isDarkTheme();
  return {
    color: missing ? (dark ? '#5a7075' : '#a7b3ac') : (dark ? '#5a7075' : '#fafbf5'),
    weight: 0.75, opacity: 1,
    fillColor: missing ? (dark ? '#263b42' : '#d6dcd9') : context.groupId ? populationColor(value) : state.income ? colorFor(value) : (dark ? '#263b42' : '#e0e8dc'),
    fillOpacity: missing ? 0.35 : context.groupId ? (dark ? 0.72 : 0.64) : state.income ? (dark ? 0.62 : 0.67) : 0.72,
    dashArray: missing ? '3 3' : null,
  };
}

function refreshStyles() {
  for (const context of state.contexts) {
    for (const layer of context.layers.values()) {
      layer.setStyle(styleFor(context, layer.feature));
      const path = layer.getElement();
      if (path) path.style.pointerEvents = inMunicipality(layer.feature) ? '' : 'none';
    }
    context.highlights?.setSelected(state.selectionActive ? state.selected : null);
    context.highlights?.refresh();
    context.neighbourhoodLayers?.update();
    updateLabels(context);
  }
}

function tooltipContent(feature, context) {
  const p = feature.properties;
  const record = populationRecord(p.code);
  if (context.groupId) {
    const group = state.groupById.get(context.groupId);
    if (!hasPopulationData(record) || !isNumber(record.counts[group.id])) {
      return localizeHtml(`<strong>${esc(p.name)}</strong>${esc(group.label)}<br>人口分类暂无数据<span class="tip-note">点击查看地区详情</span>`);
    }
    return localizeHtml(`<strong>${esc(p.name)}</strong>${esc(group.label)} ${percent(populationShare(record, group.id))}<br>${number(record?.counts[group.id])} 人 · 全区 ${percent(populationShare(state.data.city, group.id))}<span class="tip-note">点击固定地区，查看完整构成</span>`);
  }
  return localizeHtml(`<strong>${esc(p.name)}</strong><small>CT ${esc(p.code)} · ${t('普查小区统计')}</small><br>家庭收入 ${money(p.income)}<br>人口 ${number(p.populationTotal ?? p.population)}${hasPopulationData(record) ? selectedGroups().slice(0, 5).map(g => `<br>${esc(g.label)} ${percent(populationShare(record, g.id))}`).join('') : '<br>人口分类暂无数据'}<span class="tip-note">点击查看地区详情</span>`);
}

function createMap(element, groupId = null) {
  const map = L.map(element, { zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 7, maxZoom: 17, attributionControl: false });
  const context = { map, groupId, layers: new Map(), donuts: L.layerGroup(), labels: L.layerGroup(), donutCount: 0 };
  context.tooltip = createMapTooltip({ map, tooltip: L.tooltip({ className: 'community-tooltip', direction: 'top', opacity: 0.98 }), enabled: () => !mobile(), hoverEnabled: () => window.matchMedia('(any-hover: hover)').matches });
  for (const [name, zIndex] of [['water', 410], ['roads', 420], ['donuts', 450], ['labels', 470]]) {
    map.createPane(name);
    map.getPane(name).style.zIndex = zIndex;
    if (name !== 'donuts') map.getPane(name).style.pointerEvents = 'none';
  }
  context.highlights = createCommunityHighlight({ L, map, features: state.features, isDark: isDarkTheme, hoverEnabled: () => !mobile() && window.matchMedia('(any-hover: hover)').matches });
  context.highlights.setSelected(state.selectionActive ? state.selected : null);
  context.donuts.addTo(map);
  context.labels.addTo(map);
  context.boundaries = L.geoJSON({ type: 'FeatureCollection', features: state.features }, {
    style: feature => styleFor(context, feature),
    onEachFeature(feature, layer) {
      const code = feature.properties.code;
      context.layers.set(code, layer);
      layer.on('add', () => { const path = layer.getElement(); path?.setAttribute('data-community', code); path?.setAttribute('aria-label', feature.properties.name); if (path) path.style.pointerEvents = inMunicipality(feature) ? '' : 'none'; });
      layer.on('click', () => {
        if (!inMunicipality(feature)) return;
        const place = state.byCode.get('N:' + feature.properties.neighbourhoodIds?.[0]);
        const namedLocation = !groupId && !state.income && !state.selectedGroups.length && map.getZoom() < 14 && place?.properties.locationOnly;
        selectCommunity(namedLocation ? place.properties.code : code, false); toggleGroups(false);
      });
      context.highlights.bind(layer, code);
      context.tooltip.bind(layer, { content: () => tooltipContent(feature, context), anchor: event => event?.latlng || layer.getBounds().getCenter() });
    },
  }).addTo(map);
  context.neighbourhoodLayers = createNeighbourhoodLayers({ L, map, features: state.neighbourhoods?.features || [],
    onSelect: code => { selectCommunity(code, false); toggleGroups(false); }, isDark: isDarkTheme, inMunicipality,
    getSelected: () => state.selectionActive ? state.selected : null,
    allowSelection: () => !groupId && !state.income && !state.selectedGroups.length });
  if (!groupId) {
    context.contextLayers = createContextLayers({ context, basemap: state.basemap, geography: state.geographicContext, orientationLandmarks: state.orientationLandmarks, skytrain: state.skytrain, communityNames: state.features.map(f => f.properties.name), visible: { roads: state.roads, landmarks: state.landmarks, transit: state.transit, communityLabels: state.labels }, getLabelObstacles: () => mapLabelObstacles(map), getPopupInsets: () => {
      if (!mobile()) return desktopUI?.getInsets();
      // Station activation collapses the sheet; use its destination height
      // instead of the larger height during the closing animation.
      return { ...getMobileMapInsets(), bottom: (communitySheet?.getTargetInset() || 0) + 14 };
    }, onStationOpen: () => { closeTooltips(false); toggleGroups(false); toggleLayers(false); if (mobile()) setCollapsed(true); } });
  } else {
    renderComparisonBasemap(context);
  }
  state.contexts.push(context);
  map.on('movestart zoomstart', () => {
    context.tooltip.close();
    if (!syncing) closeTooltips(false);
  });
  map.on('dragstart', () => { state.wholeCity = false; });
  map.on('zoomstart', () => { if (!syncing) state.wholeCity = false; });
  map.on('move', () => {
    if (syncing || !activeContexts().includes(context)) return;
    cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => syncMaps(context));
  });
  map.on('moveend', () => {
    if (syncing || !activeContexts().includes(context)) return;
    syncMaps(context);
    for (const c of activeContexts()) updateLabels(c);
    if (context === state.composition) updateDonuts();
  });
  return context;
}


function renderComparisonBasemap(context) {
  if (!state.basemap?.features) return;
  const water = L.geoJSON(state.basemap, { filter: f => f.properties.kind === 'water', pane: 'water', interactive: false }).addTo(context.map);
  const roadEdges = L.geoJSON(state.basemap, { filter: f => f.properties.kind === 'road', pane: 'roads', interactive: false }).addTo(context.map);
  const roads = L.geoJSON(state.basemap, { filter: f => f.properties.kind === 'road', pane: 'roads', interactive: false }).addTo(context.map);
  context.refreshBasemap = () => {
    const dark = isDarkTheme();
    water.setStyle({ color: dark ? '#3e6976' : '#8bb8c1', weight: .55, fillColor: dark ? '#234958' : '#b5d3d8', fillOpacity: .75 });
    roadEdges.setStyle({ color: dark ? '#223239' : '#737b80', weight: 3, opacity: .8 });
    roads.setStyle({ color: dark ? '#a6b0b5' : '#ffffff', weight: 1.6, opacity: .95 });
  };
  context.refreshBasemap();
}

function syncMaps(source) {
  if (!state.contexts.includes(source) || !activeContexts().includes(source) || !source.map._loaded || syncing) return;
  syncing = true;
  const center = source.map.getCenter();
  const zoom = source.map.getZoom();
  state.view = { center: [center.lat, center.lng], zoom };
  for (const context of activeContexts()) if (context !== source) context.map.setView(center, zoom, { animate: false });
  syncing = false;
}

function mapLabelObstacles(map) {
  const { top, bottom, left, right } = mobile() ? getMobileMapInsets() : (desktopUI?.getInsets() || { top: 0, bottom: 0, left: 0, right: 0 });
  const size = map.getSize();
  const mapRect = map.getContainer().getBoundingClientRect();
  const controls = [...document.querySelectorAll('.map-tools, #mobile-legend-button')].filter(node => node.offsetWidth && node.offsetHeight).map(node => {
    const r = node.getBoundingClientRect();
    return { x: r.left - mapRect.left - 5, y: r.top - mapRect.top - 5, w: r.width + 10, h: r.height + 10 };
  });
  return [{ x: 0, y: 0, w: size.x, h: top }, { x: 0, y: size.y - bottom, w: size.x, h: bottom }, { x: 0, y: 0, w: left, h: size.y }, { x: size.x - right, y: 0, w: right, h: size.y }, ...controls];
}

function fitPadding(map, community = false) {
  if (!mobile()) {
    const inset = desktopUI?.getInsets() || { top: 24, right: 24, bottom: 24, left: 24 };
    return { paddingTopLeft: [inset.left + 24, inset.top + 24], paddingBottomRight: [inset.right + 24, Math.max(100, inset.bottom + 24)] };
  }
  const { top, left, right } = getMobileMapInsets();
  // Fit to the destination stop, rather than the old height during its animation.
  const bottom = (communitySheet?.getTargetInset() || 0) + 14;
  const size = map.getSize();
  const available = Math.max(0, size.y - 120);
  const total = top + bottom + 32;
  const scale = total > available ? available / total : 1;
  return { paddingTopLeft: [Math.max(16, left || 0), (top + 16) * scale], paddingBottomRight: [Math.max(16, right || 0), (bottom + 16) * scale] };
}

function fitCity() {
  const contexts = activeContexts();
  if (!contexts.length) return;
  closeTooltips();
  syncing = true;
  const first = contexts[0];
  const selectedBounds = L.featureGroup([...first.layers.values()].filter(layer => inMunicipality(layer.feature))).getBounds();
  first.map.fitBounds(selectedBounds, { ...fitPadding(first.map), animate: false });
  syncing = false;
  syncMaps(first);
  state.wholeCity = true;
  contexts.forEach(updateLabels);
  updateDonuts();
}

function fitCommunity(code, collapse = true) {
  const contexts = activeContexts();
  const layer = contexts[0]?.layers.get(code) || contexts[0]?.neighbourhoodLayers?.getLayer(code);
  if (!layer) return;
  if (mobile() && collapse) setCollapsed(true);
  syncing = true;
  const bounds = layer.getBounds ? layer.getBounds() : layer.getLatLng().toBounds(2200);
  contexts[0].map.fitBounds(bounds, { ...fitPadding(contexts[0].map, true), maxZoom: String(code).startsWith('N:') ? 13.75 : 15, animate: false });
  syncing = false;
  state.wholeCity = false;
  syncMaps(contexts[0]);
  contexts.forEach(updateLabels);
  updateDonuts();
}

function selectCommunity(code, zoom = true, expand = true) {
  if (!state.byCode.has(code)) return;
  if (state.byCode.get(code).properties.kind === 'neighbourhood' && state.mode !== 'composition') selectView('composition');
  closeTooltips();
  state.selected = code;
  if (expand) state.selectionActive = true;
  renderDetail();
  if (expand) {
    desktopUI?.setSelection();
    if (mobile()) communitySheet.open('half');
    else desktopUI?.openDetails();
  } else communitySheet?.refresh();
  refreshStyles();
  updateDonuts();
  renderComparisonHeadings();
  if (zoom) fitCommunity(code, false);
  else if (expand && !mobile()) {
    const centroid = state.byCode.get(code).properties.centroid;
    const context = activeContexts()[0];
    if (centroid && context) context.map.panInside([centroid[1], centroid[0]], { ...fitPadding(context.map, true), animate: false });
  }
  if (expand) $('announcer').textContent = t(`已选择 ${state.byCode.get(code).properties.name}。人口构成已更新。`);
  try { if (expand) history.replaceState(null, '', `#${encodeURIComponent(code)}`); } catch { /* embedded preview */ }
}

function updateDonuts() {
  const context = state.composition;
  if (!context || state.mode !== 'composition' || !context.map._loaded) return;
  context.tooltip.close();
  context.donuts.clearLayers();
  const groups = selectedGroups();
  if (!groups.length) { $('donut-status').textContent = t('未选人口群体，暂不显示构成圆'); return; }
  const map = context.map;
  const size = mobile() ? 28 : 32;
  const hitSize = mobile() ? 44 : size;
  const obstacles = mapLabelObstacles(map);
  const occupied = [];
  const candidates = filteredFeatures().filter(f => hasPopulationData(populationRecord(f.properties.code)) && map.getBounds().contains([f.properties.centroid[1], f.properties.centroid[0]]))
    .sort((a, b) => (a.properties.code === state.selected ? -1 : b.properties.code === state.selected ? 1 : (populationRecord(b.properties.code)?.population || 0) - (populationRecord(a.properties.code)?.population || 0)));
  let shown = 0;
  for (const feature of candidates) {
    const p = feature.properties;
    const point = map.latLngToContainerPoint([p.centroid[1], p.centroid[0]]);
    if (point.x < hitSize / 2 || point.y < hitSize / 2 || point.x > map.getSize().x - hitSize / 2 || point.y > map.getSize().y - hitSize / 2) continue;
    if (obstacles.some(b => point.x + hitSize / 2 > b.x && point.x - hitSize / 2 < b.x + b.w && point.y + hitSize / 2 > b.y && point.y - hitSize / 2 < b.y + b.h)) continue;
    if (occupied.some(other => point.distanceTo(other) < hitSize + 14) && p.code !== state.selected) continue;
    const html = donutSvg(populationRecord(p.code), state.selectedGroups, state.colors, size);
    if (!html) continue;
    occupied.push(point);
    const marker = L.marker([p.centroid[1], p.centroid[0]], {
      icon: L.divIcon({ className: `population-donut${p.code === state.selected ? ' selected-donut' : ''}`, html, iconSize: [hitSize, hitSize], iconAnchor: [hitSize / 2, hitSize / 2] }),
      pane: 'donuts', keyboard: true, title: t(`${p.name} 人口构成`), alt: t(`${p.name} 人口构成`), riseOnHover: false,
    }).addTo(context.donuts);
    marker.getElement()?.setAttribute('data-population-code', p.code);
    marker.getElement()?.setAttribute('aria-label', t(`${p.name}，点击查看人口构成`));
    marker.on('click', () => { selectCommunity(p.code, false); toggleGroups(false); });
    context.highlights.bind(marker, p.code);
    context.tooltip.bind(marker, { content: () => tooltipContent(feature, context), anchor: () => marker.getLatLng(), offset: [0, -size / 2] });
    shown++;
  }
  context.donutCount = shown;
  $('donut-status').textContent = t(`当前显示 ${shown} 个构成圈 · 放大可查看更多`);
}

function municipalityLabels(features) {
  const inventory = state.metadata.municipalities;
  if (Array.isArray(inventory) && inventory.length) {
    return inventory.filter(area => !state.municipality || area.name === state.municipality).flatMap(area => {
      if (!Array.isArray(area.centroid)) return [];
      const members = features.filter(feature => (feature.properties.municipalities || [feature.properties.municipality]).includes(area.name));
      if (!members.length) return [];
      return [{ ...members[0], properties: { ...members[0].properties, code: `CSD:${area.code}`,
        name: area.name, centroid: area.centroid,
        // This weight only prioritizes labels; no CSD statistics are inferred.
        population: members.reduce((sum, feature) => sum + (feature.properties.populationTotal ?? feature.properties.population ?? 0), 0) } }];
    });
  }
  const grouped = new Map();
  for (const feature of features) {
    for (const name of [feature.properties.municipality]) {
      if (!name) continue;
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(feature);
    }
  }
  return [...grouped.entries()].map(([name, members]) => {
    const populated = members.filter(f => (f.properties.populationTotal ?? f.properties.population ?? 0) > 0);
    const points = populated.length ? populated : members;
    const mean = points.reduce((sum, f) => [sum[0] + f.properties.centroid[0] / points.length, sum[1] + f.properties.centroid[1] / points.length], [0, 0]);
    const representative = points.reduce((best, f) => Math.hypot(f.properties.centroid[0] - mean[0], f.properties.centroid[1] - mean[1]) < Math.hypot(best.properties.centroid[0] - mean[0], best.properties.centroid[1] - mean[1]) ? f : best);
    const official = state.metadata.municipalities?.find(area => area.name === name);
    return { ...representative, properties: { ...representative.properties, name, centroid: official?.centroid || representative.properties.centroid, population: members.reduce((sum, f) => sum + (f.properties.populationTotal ?? f.properties.population ?? 0), 0) } };
  });
}

function updateLabels(context) {
  const map = context.map;
  if (!map._loaded) return;
  context.contextLayers?.update();
  context.neighbourhoodLayers?.update();
  context.labels.clearLayers();
  const comparison = Boolean(context.groupId);
  if (!comparison && !state.labels) return;
  const zoom = map.getZoom();
  const viewport = map.getSize();
  const tier = zoom < 11.5 ? { cap: 32, pixels: 28000, minPopulation: 9000 }
    : zoom < 12.5 ? { cap: 45, pixels: 22000, minPopulation: 3500 }
      : zoom < 13.5 ? { cap: 70, pixels: 16000, minPopulation: 0 }
        : { cap: 100, pixels: 12000, minPopulation: 0 };
  const textScale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
  const density = (comparison ? 1.7 : 1.2) * textScale * textScale;
  const cap = Math.max(3, Math.min(Math.round(tier.cap / density), Math.floor(viewport.x * viewport.y / (tier.pixels * density))));
  const fontSize = (zoom < 12 ? 12 : 13) * textScale;
  const labelFeatures = zoom < 10.75 ? municipalityLabels(filteredFeatures()) : zoom < 14
    ? neighbourhoodLabelFeatures(state.neighbourhoods, filteredFeatures(), state.municipality) : filteredFeatures();
  const candidates = labelFeatures.filter(feature => {
    const p = feature.properties;
    if (!map.getBounds().contains([p.centroid[1], p.centroid[0]])) return false;
    if (p.code === state.selected) return true;
    if (/^\d/.test(p.name)) return false;
    return true;
  }).map(feature => {
    const p = feature.properties;
    const bounds = context.layers.get(p.code)?.getBounds();
    const area = bounds ? Math.abs((bounds.getEast() - bounds.getWest()) * (bounds.getNorth() - bounds.getSouth())) : 0;
    return { feature, priority: (p.population || 0) + area * 400000 };
  }).sort((a, b) => Number(b.feature.properties.code === state.selected) - Number(a.feature.properties.code === state.selected)
    || b.priority - a.priority || a.feature.properties.code.localeCompare(b.feature.properties.code));
  const occupied = [...(context.contextLayers?.labelBoxes || mapLabelObstacles(map))];
  let shown = 0;
  const namedLabels = new Set();
  for (const { feature } of candidates) {
    if (shown >= cap) break;
    const p = feature.properties;
    const prominent = state.selectionActive && p.code === state.selected;
    const label = p.name.toUpperCase();
    if (namedLabels.has(label)) continue;
    const size = fontSize;
    const maxWidth = Math.min(210 * textScale, viewport.x * .65);
    labelMeasure.font = `600 ${size}px ${getComputedStyle(document.documentElement).fontFamily}`;
    const lines = [''];
    for (const word of label.split(' ')) {
      const current = lines.length - 1;
      const next = lines[current] ? `${lines[current]} ${word}` : word;
      if (lines[current] && labelMeasure.measureText(next).width > maxWidth) lines.push(word);
      else lines[current] = next;
    }
    const width = Math.ceil(Math.max(54, ...lines.map(line => labelMeasure.measureText(line).width)) + 6);
    const height = Math.ceil(lines.length * size * 1.22);
    const point = map.latLngToContainerPoint([p.centroid[1], p.centroid[0]]);
    let offset = comparison ? -height / 2 : 20;
    const overlaps = box => occupied.some(a => box.x < a.x + a.w + 8 && box.x + box.w + 8 > a.x && box.y < a.y + a.h + 6 && box.y + box.h + 6 > a.y);
    if (prominent) offset = [offset, -height - 18, 32].find(candidate => !overlaps({ x: point.x - width / 2, y: point.y + candidate, w: width, h: height })) ?? offset;
    const box = { x: point.x - width / 2, y: point.y + offset, w: width, h: height };
    if ((box.x < 6 || box.y < 8 || box.x + width > viewport.x - 6 || box.y + height > viewport.y - 18)) continue;
    const gapX = zoom < 12 ? 16 : 10;
    const gapY = zoom < 12 ? 12 : 7;
    if (occupied.some(a => box.x < a.x + a.w + gapX && box.x + box.w + gapX > a.x && box.y < a.y + a.h + gapY && box.y + box.h + gapY > a.y)) continue;
    occupied.push(box);
    namedLabels.add(label);
    L.marker([p.centroid[1], p.centroid[0]], {
      icon: L.divIcon({ className: `community-label hierarchy-community-label${prominent ? ' focus-label' : ''}`, html: `<span style="font-size:${size}px;line-height:1.22;font-weight:600">${lines.map(esc).join('<br>')}</span>`, iconSize: [width, height], iconAnchor: [width / 2, -offset] }),
      interactive: false, keyboard: false, pane: 'labels', zIndexOffset: prominent ? 1000 : 0,
    }).addTo(context.labels);
    shown++;
  }
}

function comparisonPageSize() { return 1; }
function renderMobileSummary() {
  const p = state.byCode.get(state.selected)?.properties;
  if (!p) return;
  if (state.mode === 'distribution' && p.kind !== 'neighbourhood') {
    const group = selectedGroups()[state.compareStart];
    $('collapsed-summary').textContent = group ? `${t(group.label)} ${t(percent(populationShare(populationRecord(p.code), group.id)))} · ${t('全区占比')} ${t(percent(populationShare(state.data.city, group.id)))}` : t('选择人口群体');
  }
  mobileUI?.refresh();
}

function renderComparisonHeadings() {
  for (const context of state.comparisonContexts) {
    const group = state.groupById.get(context.groupId);
    const value = populationShare(populationRecord(state.selected), group.id);
    const selected = state.byCode.get(state.selected)?.properties;
    const name = selected?.kind === 'neighbourhood' ? '' : selected?.name || '';
    const node = document.querySelector(`[data-map-heading="${group.id}"]`);
    if (node) node.innerHTML = `<div><h2>${esc(group.label)}</h2><span>全区 ${percent(populationShare(state.data.city, group.id))}</span></div>${state.selectionActive && name ? `<p title="${esc(name)}">${esc(name)} <strong>${percent(value)}</strong></p>` : ''}`;
  }
  localize($('comparison-maps'), $('comparison-select'));
  renderMobileSummary();
}

function rebuildComparison({ preserveView = true } = {}) {
  cancelAnimationFrame(syncFrame); syncFrame = null;
  closeTooltips();
  for (const context of state.comparisonContexts) {
    context.highlights.destroy(); context.tooltip.destroy(); context.map.remove();
    state.contexts = state.contexts.filter(c => c !== context);
  }
  state.comparisonContexts = [];
  const groups = selectedGroups();
  const size = comparisonPageSize();
  lastComparisonPageSize = size;
  state.compareStart = Math.floor(Math.min(state.compareStart, Math.max(0, groups.length - 1)) / size) * size;
  const shown = groups.slice(state.compareStart, state.compareStart + size);
  $('comparison-empty').hidden = groups.length !== 0;
  $('population-legend').hidden = groups.length === 0;
  $('comparison-select').innerHTML = groups.map((g, index) => `<option value="${index}" ${index === state.compareStart ? 'selected' : ''}>${esc(g.label)}</option>`).join('');
  $('comparison-select').disabled = !groups.length;
  $('comparison-page').textContent = groups.length ? `${state.compareStart + 1} / ${groups.length}` : '0 / 0';
  $('previous-groups').disabled = state.compareStart === 0;
  $('next-groups').disabled = state.compareStart + size >= groups.length;
  $('comparison-maps').style.setProperty('--map-columns', String(Math.max(1, shown.length)));
  $('comparison-maps').innerHTML = shown.map(g => `<section class="comparison-card"><header class="comparison-card-heading" data-map-heading="${g.id}"></header><div id="compare-${g.id}" class="comparison-map" role="region" aria-label="${esc(g.label)}在 Metro Vancouver 各地区的占比地图"></div></section>`).join('');
  if (!groups.length) { renderMobileSummary(); return; }
  syncing = true;
  state.comparisonContexts = shown.map(g => createMap(`compare-${g.id}`, g.id));
  for (const context of state.comparisonContexts) if (state.view) context.map.setView(state.view.center, state.view.zoom, { animate: false });
  syncing = false;
  renderComparisonHeadings();
  requestAnimationFrame(() => {
    if (preserveView && state.view) { resizeMapsKeepingView(); return; }
    for (const context of state.comparisonContexts) context.map.invalidateSize({ pan: false });
    if (state.wholeCity || !state.view) fitCity();
    else { refreshStyles(); state.comparisonContexts.forEach(updateLabels); }
  });
}

function selectView(mode) {
  if (state.mode === mode) return;
  cancelAnimationFrame(syncFrame); syncFrame = null;
  const current = activeContexts()[0];
  if (current?.map._loaded) syncMaps(current);
  closeTooltips();
  state.mode = mode;
  renderDetail(); renderMobileSummary();
  for (const candidate of ['composition', 'distribution']) {
    const active = candidate === mode;
    $(`${candidate}-tab`).classList.toggle('active', active);
    $(`${candidate}-tab`).setAttribute('aria-selected', String(active));
    $(`${candidate}-tab`).tabIndex = active ? 0 : -1;
    $(`${candidate}-view`).hidden = !active;
  }
  $('income-control').hidden = mode !== 'composition';
  $('layers-button').hidden = mode !== 'composition';
  $('transit-legend').hidden = mode !== 'composition' || !state.transit || !state.skytrain;
  toggleLayers(false);
  $('mode-description').textContent = t(mode === 'composition' ? '一个地区，一张构成图' : '同一色阶，查看聚居分布');
  document.querySelector('.map-workspace').classList.toggle('comparing', mode === 'distribution');
  mobileUI?.refresh();
  if (mode === 'distribution') rebuildComparison();
  else requestAnimationFrame(() => {
    syncing = true;
    state.composition.map.invalidateSize({ pan: false });
    if (state.view) state.composition.map.setView(state.view.center, state.view.zoom, { animate: false });
    syncing = false;
    if (state.wholeCity) fitCity();
    else { updateLabels(state.composition); updateDonuts(); }
  });
}

function closeSearch() {
  $('search-results').hidden = true;
  $('search').setAttribute('aria-expanded', 'false');
  $('search').removeAttribute('aria-activedescendant');
  state.activeSearch = -1; state.searchMatches = [];
}
function renderSearch() {
  const query = $('search').value.trim();
  state.searchMatches = searchMapFeatures(filteredFeatures(), state.skytrain?.features || [], query, state.neighbourhoods?.features || []); state.activeSearch = -1;
  if (!query) return closeSearch();
  $('search-results').hidden = false; $('search').setAttribute('aria-expanded', 'true');
  $('search-results').innerHTML = state.searchMatches.length ? state.searchMatches.map((result, i) => {
    const p = result.feature.properties;
    const station = result.type === 'station';
    const context = result.type === 'neighbourhood' ? `${p.municipality} · ${t('市府社区')}` : station
      ? [t('SkyTrain 车站'), (p.lines || []).map(id => SKYTRAIN_LINES[id]?.name).filter(Boolean).join(' / ')].filter(Boolean).join(' · ')
      : [p.sectorLabel, p.typeLabel, `CT ${p.code}`].filter(Boolean).map(tag => t(tag)).join(' · ');
    const value = result.type === 'neighbourhood' ? t('社区概况') : station ? t('定位车站') : money(p.income);
    return `<button class="search-result" id="search-option-${i}" role="option" aria-selected="false" data-search-index="${i}"><span><strong>${esc(p.name)}</strong><small>${esc(context)}</small></span><span>${esc(value)}</span></button>`;
  }).join('') : '<p class="no-results">没有找到社区或车站，也可以输入普查区编号。</p>';
  localize($('search-results'));
}

function focusStation(feature) {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  closeTooltips();
  // Stations provide an orientation point, not a statistical-area assignment.
  // Clear stale filters/details so the surrounding census areas remain selectable.
  state.municipality = '';
  state.selectionActive = false;
  state.selected = null;
  desktopUI?.clearSelection();
  communitySheet?.close();
  state.wholeCity = false;
  renderMunicipalities();
  renderMetadata();
  renderComparisonHeadings();
  try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* embedded preview */ }
  if (state.mode !== 'composition') selectView('composition');
  mobileUI?.closeTransient();
  state.transit = true;
  $('transit-toggle').checked = true;
  updateLayerVisibility();
  refreshStyles();
  // The composition canvas may have just replaced the comparison canvas.
  requestAnimationFrame(() => {
    const context = state.composition;
    context.map.invalidateSize({ pan: false });
    context.map.setView([lat, lng], 15, { animate: false });
    state.wholeCity = false;
    syncMaps(context);
    updateLabels(context);
    updateDonuts();
    context.contextLayers?.openStation(p.id);
    $('announcer').textContent = currentLanguage() === 'en'
      ? `Located ${p.name} SkyTrain station. Select a surrounding census area to view population and income.`
      : `已定位 SkyTrain 车站 ${p.name}。点击周边普查区域查看人口与收入。`;
  });
}

function chooseSearchResult(result) {
  if (!result) return;
  if (mobile()) $('search').blur();
  $('search').value = '';
  closeSearch();
  $('search').blur();
  toggleGroups(false);
  if (result.type === 'station') focusStation(result.feature);
  else {
    if (result.type === 'neighbourhood' && state.municipality && state.municipality !== result.feature.properties.municipality) {
      state.municipality = ''; renderMunicipalities(); renderMetadata(); refreshStyles();
    }
    selectCommunity(result.feature.properties.code);
  }
}

function setReady(ready) {
  document.querySelectorAll('.view-tabs button,#groups-button,#group-search,#default-groups,#all-groups,#clear-groups,#income-toggle,#layers-button,#roads-toggle,#labels-toggle,#landmarks-toggle,#transit-toggle,#municipality-filter,#search,#fit-city,#zoom-in,#zoom-out,#focus-community').forEach(control => { control.disabled = !ready; });
}

function initializeControls() {
  setReady(false);
  window.addEventListener('atlas-languagechange', () => {
    closeTooltips();
    applyStaticTranslations(); refreshThemeControl(); mobileUI?.refresh();
    if (state.data) {
      renderMetadata(); renderMunicipalities(); renderGroupList(); renderDonutKey(); renderDetail(); renderComparisonHeadings(); communitySheet?.refresh();
      $('mode-description').textContent = t(state.mode === 'composition' ? '一个地区，一张构成图' : '同一色阶，查看聚居分布');
      updateDonuts(); state.contexts.forEach(updateLabels);
      if ($('search').value) renderSearch();
    }
  });
  window.addEventListener('atlas-themechange', () => { closeTooltips(); refreshStyles(); state.contexts.forEach(context => context.refreshBasemap?.()); });
  for (const mode of ['composition', 'distribution']) $(`${mode}-tab`).addEventListener('click', () => selectView(mode));
  document.querySelector('.view-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const mode = event.key === 'Home' ? 'composition' : event.key === 'End' ? 'distribution' : state.mode === 'composition' ? 'distribution' : 'composition';
    selectView(mode); $(`${mode}-tab`).focus();
  });
  $('layers-button').addEventListener('click', () => toggleLayers($('layers-panel').hidden));
  $('close-layers').addEventListener('click', () => { toggleLayers(false); (mobile() ? $('mobile-more') : $('layers-button')).focus(); });
  for (const layer of ['roads', 'labels', 'landmarks', 'transit']) $(`${layer}-toggle`).addEventListener('change', event => { state[layer] = event.target.checked; updateLayerVisibility(); });
  $('groups-button').addEventListener('click', () => toggleGroups($('groups-panel').hidden));
  $('close-groups').addEventListener('click', () => { toggleGroups(false); (mobile() ? $('mobile-more') : $('groups-button')).focus({ preventScroll: true }); });
  $('empty-choose-groups').addEventListener('click', () => { toggleGroups(true); });
  $('municipality-filter').addEventListener('change', event => setMunicipality(event.target.value));
  $('group-search').addEventListener('input', renderGroupList);
  $('group-list').addEventListener('change', event => {
    const id = event.target.dataset.group;
    if (!id) return;
    updateGroupSelection(event.target.checked ? [...state.selectedGroups, id] : state.selectedGroups.filter(value => value !== id), false);
  });
  $('default-groups').addEventListener('click', () => updateGroupSelection(state.data.defaultGroupIds));
  $('all-groups').addEventListener('click', () => updateGroupSelection(state.groups.map(g => g.id)));
  $('clear-groups').addEventListener('click', () => updateGroupSelection([]));
  $('income-toggle').addEventListener('change', event => { state.income = event.target.checked; $('income-legend').hidden = !state.income; refreshStyles(); mobileUI?.refresh(); });
  $('previous-groups').addEventListener('click', () => { state.compareStart -= comparisonPageSize(); rebuildComparison(); });
  $('next-groups').addEventListener('click', () => { state.compareStart += comparisonPageSize(); rebuildComparison(); });
  $('comparison-select').addEventListener('change', event => { state.compareStart = Number(event.target.value); rebuildComparison(); });
  $('fit-city').addEventListener('click', fitCity);
  $('zoom-in').addEventListener('click', () => activeContexts()[0]?.map.zoomIn(0.5));
  $('zoom-out').addEventListener('click', () => activeContexts()[0]?.map.zoomOut(0.5));
  $('focus-community').addEventListener('click', () => fitCommunity(state.selected));
  $('detail-body').addEventListener('click', event => {
    const parent = event.target.closest('[data-open-neighbourhood]');
    if (parent) return selectCommunity(parent.dataset.openNeighbourhood);
    const explore = event.target.closest('[data-explore-neighbourhood]');
    if (!explore) return;
    const feature = state.byCode.get(explore.dataset.exploreNeighbourhood);
    const code = feature?.properties.anchorTractCode;
    if (code && state.byCode.has(code)) selectCommunity(code);
    else if (feature) {
      const p = feature.properties;
      if (mobile()) setCollapsed(true); else desktopUI.closeDetails();
      activeContexts()[0]?.map.setView([p.centroid[1], p.centroid[0]], 15, { animate: false });
    }
  });
  $('method-button').addEventListener('click', () => { toggleGroups(false); toggleLayers(false); closeTooltips(); dialog.showModal(); });
  $('close-method').addEventListener('click', () => { dialog.close(); (mobile() ? $('mobile-more') : $('method-button')).focus({ preventScroll: true }); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  $('search').addEventListener('input', renderSearch);
  $('search').addEventListener('focus', () => { if ($('search').value) renderSearch(); });
  $('search-results').addEventListener('click', event => { const button = event.target.closest('[data-search-index]'); if (button) chooseSearchResult(state.searchMatches[Number(button.dataset.searchIndex)]); });
  $('search').addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeSearch(); $('search').blur(); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && state.searchMatches.length) {
      event.preventDefault(); const count = state.searchMatches.length;
      state.activeSearch = state.activeSearch < 0 ? (event.key === 'ArrowDown' ? 0 : count - 1) : (state.activeSearch + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      document.querySelectorAll('.search-result').forEach((button, i) => { button.classList.toggle('active', i === state.activeSearch); button.setAttribute('aria-selected', String(i === state.activeSearch)); });
      const option = $(`search-option-${state.activeSearch}`); $('search').setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && state.searchMatches.length) { event.preventDefault(); chooseSearchResult(state.searchMatches[Math.max(0, state.activeSearch)]); }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.search-wrap')) closeSearch();
    if (!event.target.closest('#layers-panel') && !event.target.closest('#layers-button')) toggleLayers(false);
    if (!event.target.closest('#groups-panel') && !event.target.closest('#groups-button') && !event.target.closest('#empty-choose-groups')) toggleGroups(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
      closeTooltips();
      if (!$('layers-panel').hidden) { toggleLayers(false); (mobile() ? $('mobile-more') : $('layers-button')).focus(); }
      else if (!$('groups-panel').hidden) { toggleGroups(false); (mobile() ? $('mobile-more') : $('groups-button')).focus({ preventScroll: true }); }
      else if (!mobile()) desktopUI?.closeDetails();
    }
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {
      event.preventDefault(); $('search').focus();
    }
  });
  window.addEventListener('hashchange', () => { const code = hashCode(location.hash, [...state.byCode.values()]); if (code && (!state.selectionActive || code !== state.selected)) selectCommunity(code); });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const changed = lastMobile !== mobile(); lastMobile = mobile();
      // Keyboard and browser chrome resize the viewport. Preserve the user's camera.
      mobileUI?.refresh();
      if (state.mode === 'distribution' && (changed || lastComparisonPageSize !== comparisonPageSize())) rebuildComparison({ preserveView: true });
      else {
        resizeMapsKeepingView();
        if (changed && state.wholeCity) fitCity();
      }
    }, 150);
  });
}

async function init() {
  applyStaticTranslations();
  initTheme();
  communitySheet = initCommunitySheet({ onChange: () => mobileUI?.refresh(), onClose: closeTooltips });
  initializeControls();
  initLanguagePreference();
  mobileUI = initMobileUI({ onLayoutChange: () => {
    const nextTextSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const changedText = nextTextSize !== observedTextSize;
    observedTextSize = nextTextSize;
    if (changedText && state.wholeCity && activeContexts().length) fitCity();
    activeContexts().forEach(updateLabels);
    updateDonuts();
  } });
  desktopUI = initDesktopUI({ onLayoutChange: () => { activeContexts().forEach(updateLabels); updateDonuts(); } });
  try {
    const data = await loadData();
    state.metadata = data.metadata; state.features = data.features; state.data = data.populationData; state.basemap = data.basemap;
    state.geographicContext = data.geographicContext; state.orientationLandmarks = data.orientationLandmarks; state.skytrain = data.skytrain; state.neighbourhoods = data.neighbourhoods;
    state.byCode = new Map([...data.features, ...(data.neighbourhoods?.features || [])].map(f => [f.properties.code, f])); state.counts = summarize(data.features);
    state.groups = data.populationData.groups; state.groupById = new Map(state.groups.map(g => [g.id, g]));
    state.colors = Object.fromEntries(state.groups.map((g, i) => [g.id, PALETTE[i % PALETTE.length]]));
    state.selectedGroups = [];
    const linkedCode = hashCode(location.hash, [...state.byCode.values()]);
    state.selected = linkedCode || data.features.find(f => f.properties.municipality === 'Vancouver')?.properties.code || data.features[0].properties.code;
    renderMunicipalities();
    renderMetadata(); renderGroupList(); renderDonutKey(); renderDetail();
    $('group-count').textContent = state.selectedGroups.length;
    state.composition = createMap('composition-map');
    const unavailable = [[data.basemap, '道路与河流'], [data.geographicContext, '铁路与地理地标']].filter(([loaded]) => !loaded).map(([, label]) => label);
    if (unavailable.length) { $('map-warning').textContent = `${unavailable.join('、')}暂未载入，地区统计仍可使用。`; $('map-warning').hidden = false; localize($('map-warning')); }
    $('loading-overlay').hidden = true;
    mobileUI.refresh();
    if (data.metadata.initialBounds) {
      state.composition.map.fitBounds(data.metadata.initialBounds, { ...fitPadding(state.composition.map), animate: false });
      syncMaps(state.composition); state.wholeCity = false;
    } else {
      state.composition.map.fitBounds([[49.0, -123.46], [49.44, -122.4]], { ...fitPadding(state.composition.map), animate: false });
      syncMaps(state.composition); state.wholeCity = false;
    }
    selectCommunity(state.selected, false, false);
    if (linkedCode) selectCommunity(linkedCode, true, true);
    setReady(true);
  } catch (error) {
    $('loading-overlay').hidden = false;
    $('loading-overlay').innerHTML = `<strong>地图暂时无法载入</strong><span>${esc(error.message)}</span><button class="map-button" id="retry">重新载入</button>`;
    $('retry').addEventListener('click', () => location.reload());
    $('coverage-text').textContent = '数据载入失败';
    localize($('loading-overlay'), $('coverage-text'));
  }
}

init();
