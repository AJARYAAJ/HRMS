import { useSelector } from 'react-redux';

// Validated categorical palette (fixed order, never cycled) with dedicated dark-mode steps.
const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function useChartTheme() {
  const dark = useSelector((s) => s.ui.theme) === 'dark';
  return {
    series: dark ? DARK : LIGHT,
    grid: dark ? '#26282d' : '#eceef2',
    axis: dark ? '#8b8f98' : '#6b7280',
    surface: dark ? '#0f172a' : '#ffffff',
    tooltip: {
      contentStyle: {
        background: dark ? '#1e293b' : '#ffffff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
        borderRadius: 12, fontSize: 12, boxShadow: '0 10px 30px -10px rgb(0 0 0 / 0.25)', color: dark ? '#e2e8f0' : '#0f172a',
      },
      labelStyle: { fontWeight: 600, color: dark ? '#f8fafc' : '#0f172a' },
      itemStyle: { color: dark ? '#cbd5e1' : '#334155' },
      cursor: { fill: dark ? 'rgb(148 163 184 / 0.08)' : 'rgb(148 163 184 / 0.12)' },
    },
  };
}

/** Fold everything past `max` categories into "Other" so no hue is ever generated. */
export function foldOther(rows, max = 7, key = 'value') {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max);
  const rest = rows.slice(max).reduce((a, r) => a + Number(r[key] || 0), 0);
  return [...head, { name: 'Other', [key]: rest }];
}
