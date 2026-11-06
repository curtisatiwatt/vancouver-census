import { isNumber } from './map-utils.js';

/**
 * Read an area's own published income. A municipal profile never inherits a
 * neighbouring tract, a component area's median, or an average of medians.
 * The statistic travels with the value so renderers can distinguish averages.
 */
export function incomeForArea(feature, { incomeYear = null } = {}) {
  const p = feature?.properties;
  if (!p) return null;
  if (p.kind === 'neighbourhood') {
    const statistics = p.statistics || {};
    for (const [field, statistic] of [['incomeMedian', 'median'], ['incomeAverage', 'average']]) {
      const record = statistics[field];
      if (!isNumber(record?.value)) continue;
      return {
        value: record.value,
        statistic,
        scope: 'neighbourhood',
        year: record.year ?? null,
        basis: record.basis ?? null,
        currency: record.currency ?? 'CAD',
        sourceUrl: record.sourceUrl || p.sourceUrl || null,
        pattern: statistic === 'average' ? 'diagonal' : 'solid',
      };
    }
    return null;
  }
  if (!isNumber(p.income)) return null;
  return {
    value: p.income,
    statistic: 'median',
    scope: 'tract',
    year: p.incomeYear ?? incomeYear,
    basis: {
      zh: '所有私人住户的税前收入；100% 普查数据',
      en: 'Before-tax income of all private households; 100% census data',
    },
    currency: 'CAD',
    sourceUrl: p.sourceUrl || null,
    pattern: 'solid',
  };
}

/** Short, explicit tooltip/legend wording; unknown years are never inferred. */
export function incomeMetricLabel(metric, language = 'zh') {
  if (!metric) return language === 'en' ? 'Income unavailable' : '收入暂无数据';
  const english = language === 'en';
  const label = metric.statistic === 'average'
    ? english ? 'Average household income' : '家庭收入平均数'
    : english ? 'Median household income' : '家庭收入中位数';
  return /^\d{4}$/.test(String(metric.year ?? '')) ? `${label} · ${metric.year}` : label;
}
