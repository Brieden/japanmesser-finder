// Darstellung der Artikel-Attribute: Überschrift, Rost-Stufe, Chips. Gemeinsam genutzt von Karte, Detail, Finder, Liste.
import { h } from '../dom.js';
import { sizeRangeText } from '../format.js';

/** { title: 'Gyuto', subtitle: 'VG-10 · komplett rostfrei', sizes: '18–27 cm' } – deutsche Kurzbezeichnung */
export function itemHeadline(data, item) {
  const typeName = item.type ? data.t('types', item.type) : data.t('categories', item.category);
  const tip = item.tip === 'kiritsuke' && item.type !== 'kiritsuke' ? ' (K-Tip)' : '';
  const steel = item.steel ? data.entry('steels', item.steel.id)?.short ?? '' : '';
  return { title: `${typeName}${tip}`, steel, sizes: sizeRangeText(item) };
}

/** Rost-Stufe als Punkt + Text (Farbe nie als einziges Signal). full = komplett, clad = teilweise, none = nicht rostfrei */
export function rustBadge(data, item, { long = false } = {}) {
  if (!item.rust) return null;
  const e = data.entry('rust', item.rust);
  return h('span', { class: ['rust', `rust--${item.rust}`], title: e?.explain ?? '' }, long ? e?.label : e?.short ?? e?.label);
}

const FINISH_ORDER = ['damascus', 'tsuchime', 'kurouchi', 'nashiji', 'fine-finish', 'mirror', 'kasumi', 'dimple'];

/** Chips in Prioritätsreihenfolge (Stahl, Griff, Schliff/Händigkeit, Optik, Linie). max begrenzt die Anzahl. */
export function attrChips(data, item, { max = 6 } = {}) {
  const chips = [];
  const chip = (text, cls = '') => chips.push(h('span', { class: ['chip', cls].filter(Boolean).join(' ') }, text));

  if (item.steel) chip(data.entry('steels', item.steel.id)?.short ?? item.steel.id);
  if (item.grip?.style && item.grip.style !== 'unknown') {
    const style = data.entry('handleStyles', item.grip.style)?.short ?? item.grip.style;
    const material = item.grip.material && item.grip.style !== 'steel' ? data.t('handleMaterials', item.grip.material).replace(/ \(.*\)$/, '') : '';
    chip(material ? `${style} · ${material}` : style);
  }
  if (item.bevel === 'single') chip(data.entry('bevels', 'single')?.short ?? 'Einseitig', 'chip--info');
  if (item.handed === 'left') chip('Linkshänder', 'chip--info');
  for (const f of FINISH_ORDER) if (item.finish?.includes(f)) chip(data.entry('finishes', f)?.short ?? f, 'chip--outline');
  if (item.segment === 'gastro') chip('Gastro-Linie', 'chip--outline');
  if (item.series) chip(item.series, 'chip--outline');
  return chips.slice(0, max);
}
