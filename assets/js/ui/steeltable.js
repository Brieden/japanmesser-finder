// Stahl-Übersicht aus taxonomy.steels + Katalog. steeltable(ctx) → Node
import { h } from '../dom.js';
import { collator } from '../util.js';

const CARE = { low: 'gering', medium: 'mittel', high: 'hoch' };
const unspecified = (id) => /unspecified|unknown/.test(id);

export function steeltable(ctx) {
  const { data, router } = ctx;
  const steels = data.taxonomy.steels ?? {};
  const counts = {};
  for (const it of data.items) if (it.category === 'knife' && it.segment === 'home' && it.steel?.id) counts[it.steel.id] = (counts[it.steel.id] || 0) + 1;

  const rank = (s) => (unspecified(s.id) ? 2 : s.family === 'stainless' ? 0 : s.family === 'carbon' ? 1 : 2);
  const rows = Object.keys(counts)
    .map((id) => ({ id, ...(steels[id] ?? { label: id }) }))
    .sort((a, b) => rank(a) - rank(b) || counts[b.id] - counts[a.id] || collator.compare(a.label, b.label));

  const cell = (label, ...kids) => h('td', { 'data-label': label }, ...kids);
  const body = rows.map((s) => {
    const fam = s.family === 'stainless' ? h('span', { class: 'rust rust--full' }, 'Rostfrei') : s.family === 'carbon' ? h('span', { class: 'rust rust--none' }, 'Kohlenstoffstahl') : h('span', { class: 'muted' }, 'nicht angegeben');
    const hrc = Array.isArray(s.hardnessHrc) ? (s.hardnessHrc[0] === s.hardnessHrc[1] ? `${s.hardnessHrc[0]}` : `${s.hardnessHrc[0]}–${s.hardnessHrc[1]}`) : null;
    return h(
      'tr',
      { class: 'steel-row' },
      h('th', { scope: 'row', class: 'steel-row__name' }, s.label, s.summary ? h('details', { class: 'steel-row__more' }, h('summary', 'Kurzbeschreibung'), h('p', s.summary)) : null),
      cell('Klasse', fam),
      cell('Härte (HRC)', hrc ?? h('span', { class: 'muted' }, 'nicht angegeben')),
      cell('Zusammensetzung', s.composition ?? h('span', { class: 'muted' }, 'nicht angegeben')),
      cell('Pflegeaufwand', CARE[s.care] ?? h('span', { class: 'muted' }, 'nicht angegeben')),
      cell('Im Katalog', h('a', { href: router.href('/katalog', { steel: s.id }) }, `${counts[s.id]} Artikel`))
    );
  });

  return h(
    'div',
    { class: 'steeltable table-wrap' },
    h(
      'table',
      { class: 'table steeltable__table' },
      h('caption', { class: 'steeltable__cap' }, 'Stähle im Katalog (Anzahl Artikel; Angaben zu Härte und Zusammensetzung laut Hersteller- oder Händlerangaben)'),
      h('thead', h('tr', ['Stahl', 'Klasse', 'Härte (HRC)', 'Zusammensetzung', 'Pflegeaufwand', 'Im Katalog'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', body)
    )
  );
}
