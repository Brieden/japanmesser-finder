// Stahl-Übersicht aus taxonomy.steels + Katalog. steeltable(ctx, sources) → Node
// Härte: typische Werte der Stahlsorte laut Händler-/Herstellerangaben; Klasse nach Knives and Stones.
// Schärfen: nur Aussagen, die eine Quelle zur Stahlsorte oder (bei rostfreien Stählen) zur Härteklasse macht.
import { h } from '../dom.js';
import { collator } from '../util.js';
import { hrcRange, hrcText, hrcMid, hardnessClass, steelSharpening, HRC_MAX_WIDTH } from '../lib/insights.js';
import { hardnessMeter } from './meter.js';

const unspecified = (id) => /unspecified|unknown/.test(id);

// Die Aussagen nennen ihre Quelle im Satz („… (Sakai Ichimonji)“); der Link führt zur Seite selbst.
function sourceLink(id, sources) {
  const s = sources?.[id];
  if (!s?.url) return null;
  return h('a', { class: 'steel-row__src', href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.title }, 'Zur Quelle', h('span', { class: 'visually-hidden' }, ' (öffnet in neuem Tab)'));
}

export function steeltable(ctx, sources = {}) {
  const { data, router } = ctx;
  const tax = data.taxonomy;
  const steels = tax.steels ?? {};
  const counts = {};
  for (const it of data.items) if (it.category === 'knife' && it.segment === 'home' && it.steel?.id) counts[it.steel.id] = (counts[it.steel.id] || 0) + 1;

  const rank = (s) => (unspecified(s.id) ? 2 : s.family === 'stainless' ? 0 : s.family === 'carbon' ? 1 : 2);
  const rows = Object.keys(counts)
    .map((id) => ({ id, ...(steels[id] ?? { label: id }) }))
    .sort((a, b) => rank(a) - rank(b) || counts[b.id] - counts[a.id] || collator.compare(a.label, b.label));

  const cell = (label, ...kids) => h('td', { 'data-label': label }, ...kids);
  const none = (text) => h('span', { class: 'muted' }, text);

  const hardnessCell = (s) => {
    const range = hrcRange(s);
    if (!range) return none('nicht angegeben');
    if (range[1] - range[0] > HRC_MAX_WIDTH) return [hrcText(range), h('span', { class: 'steel-row__sub muted' }, 'Spanne zu breit für eine Einordnung')];
    const cls = hardnessClass(hrcMid(range), tax);
    return [h('strong', hrcText(range)), h('span', { class: 'steel-row__sub' }, `Klasse „${cls.label}“`), hardnessMeter({ range, taxonomy: tax, compact: true })];
  };

  const sharpenCell = (s) => {
    const st = steelSharpening(s, tax);
    return st ? [st.text, ' ', sourceLink(st.source, sources)] : none('keine belegte Aussage');
  };

  const body = rows.map((s) => {
    const fam = s.family === 'stainless' ? h('span', { class: 'rust rust--full' }, 'Rostfrei') : s.family === 'carbon' ? h('span', { class: 'rust rust--none' }, 'Kohlenstoffstahl') : none('nicht angegeben');
    const facts = s.facts ?? [];
    const more = s.summary || facts.length;
    return h(
      'tr',
      { class: 'steel-row' },
      h(
        'th',
        { scope: 'row', class: 'steel-row__name' },
        s.label,
        more
          ? h('details', { class: 'steel-row__more' }, h('summary', 'Belegte Eigenschaften'), s.summary ? h('p', s.summary) : null, facts.length ? h('ul', facts.map((f) => h('li', f.t, ' ', sourceLink(f.s, sources)))) : null)
          : null
      ),
      cell('Klasse', fam),
      cell('Härte (HRC)', hardnessCell(s)),
      cell('Schärfen', sharpenCell(s)),
      cell('Zusammensetzung', s.composition ?? none('nicht angegeben')),
      cell('Im Katalog', h('a', { href: router.href('/katalog', { steel: s.id }) }, `${counts[s.id]} Artikel`))
    );
  });

  return h(
    'div',
    { class: 'steeltable table-wrap' },
    h(
      'table',
      { class: 'table steeltable__table' },
      h('caption', { class: 'steeltable__cap' }, 'Stähle im Katalog (Anzahl Artikel). Härte: typische Werte der Stahlsorte laut Hersteller- und Händlerangaben, nicht am einzelnen Messer gemessen; Klassen nach Knives and Stones.'),
      h('thead', h('tr', ['Stahl', 'Klasse', 'Härte (HRC)', 'Schärfen', 'Zusammensetzung', 'Im Katalog'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', body)
    )
  );
}
