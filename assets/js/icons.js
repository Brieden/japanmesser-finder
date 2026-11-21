// Inline-SVG-Icons (24×24, Strich). icon('search', { size: 20, title: 'Suchen' })
import { h } from './dom.js';

const PATHS = {
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.2-12.2-1.7 4.7-4.7 1.7 1.7-4.7 4.7-1.7Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4.5 4.5',
  book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Zm0 15A1.5 1.5 0 0 0 6.5 21H19v-3',
  bookmark: 'M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1Z',
  'bookmark-fill': 'M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1Z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  close: 'm6 6 12 12M18 6 6 18',
  'chevron-right': 'm9 5 7 7-7 7',
  'chevron-left': 'm15 5-7 7 7 7',
  'chevron-down': 'm5 9 7 7 7-7',
  'arrow-right': 'M5 12h14m-6-6 6 6-6 6',
  'arrow-left': 'M19 12H5m6-6-6 6 6 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.2v.2',
  alert: 'M12 4 2.8 20h18.4L12 4Zm0 6v5m0 2.8v.2',
  external: 'M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  drop: 'M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5Z',
  ruler: 'm3.5 15.5 12-12 5 5-12 12-5-5Zm3.5-1 2 2m1-5 2 2m1-5 2 2',
  hand: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v5m0-4.5a1.5 1.5 0 0 1 3 0V13m0-4a1.5 1.5 0 0 1 3 0v5.5A6.5 6.5 0 0 1 13.5 21h-1.2A6 6 0 0 1 8 19.2l-4.2-4.3a1.6 1.6 0 0 1 2.3-2.2L8 14.5',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Zm-4 6V5a1 1 0 0 1 1-1h10',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3m-10 0h10v4H7v-4Z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z',
  contrast: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-18v18',
  blade: 'M3 17.5 17.5 4a3 3 0 0 1 3 3L7 20.5l-4-3Zm3 .5 2.5 1.8',
  store: 'M4 9.5 5.5 4h13L20 9.5M4 9.5v10.5h16V9.5M4 9.5c0 1.7 1.3 2.5 2.7 2.5S9.3 11.2 9.3 9.5c0 1.7 1.3 2.5 2.7 2.5s2.7-.8 2.7-2.5c0 1.7 1.3 2.5 2.7 2.5S20 11.2 20 9.5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8.5a7 7 0 0 1 14 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m1.5-9a3 3 0 1 0 0-6m2.5 15a5.5 5.5 0 0 0-3.5-5.1',
  sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6m-6 4v6',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4m-12.5-5.5 2 2m6 6 2 2m0-10-2 2m-6 6-2 2',
  share: 'M12 4v11m0-11 4 4m-4-4-4 4M5 13v6h14v-6',
};

const FILLED = new Set(['bookmark-fill']);

export function icon(name, { size = 20, title = '', class: cls = '' } = {}) {
  const d = PATHS[name];
  if (!d) throw new Error(`Unbekanntes Icon: ${name}`);
  const filled = FILLED.has(name);
  const svg = h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: filled ? 'currentColor' : 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: ['icon', cls].filter(Boolean).join(' '),
      ...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true', focusable: 'false' }),
    },
    h('path', { d })
  );
  return svg;
}

/** Ersetzt <span data-icon="name"></span> in einem Container durch SVG-Icons. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (el.firstChild) continue;
    el.appendChild(icon(el.dataset.icon, { size: Number(el.dataset.size) || 22 }));
  }
}
