// Interaktiver Messertyp-Atlas (aus taxonomy.types + Katalog). typeatlas(ctx) → Node
import { h } from '../dom.js';
import { silhouette } from './silhouette.js';
import { cmText, count as countText, jpy, dateDe } from '../format.js';
import { collator } from '../util.js';
import { typeStats } from '../lib/insights.js';

// Einstufung 1–3 beschreibt Schliff und Spezialisierung (Händlerangaben), keine Messung. Der Grund steht je Typ in taxonomy.types.<id>.levelReason.
export const LEVEL_DEFS = { 1: 'beidseitig geschliffen, kein Spezialmesser', 2: 'Spezialmesser oder besondere Klingenform', 3: 'einseitig geschliffen, händigkeitsgebunden' };
const num1 = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const TASK_MIN = 0.5; // ab diesem Gewicht gilt ein Typ als geeignet für die Aufgabe

export const rangeText = (r) => (Array.isArray(r) && r.length === 2 ? (r[0] === r[1] ? `${cmText(r[0])} cm` : `${cmText(r[0])}–${cmText(r[1])} cm`) : '');

function levelNode(level) {
  if (!LEVEL_DEFS[level]) return null;
  return h(
    'span',
    { class: 'atlas__level' },
    h('span', { class: 'atlas__dots', 'aria-hidden': 'true' }, [1, 2, 3].map((n) => h('i', { class: n <= level ? 'is-on' : '' }))),
    h('span', `Einstufung ${level} von 3: ${LEVEL_DEFS[level]}`)
  );
}

function rustText(r) {
  const parts = [`${r.full} komplett rostfrei`, `${r.clad} teilweise rostfrei`, `${r.none} nicht rostfrei`];
  if (r.unknown) parts.push(`${r.unknown} ohne Angabe`);
  return parts.join(', ');
}

export function typeatlas(ctx) {
  const { data, router } = ctx;
  const tax = data.taxonomy;
  const counts = {};
  const leftCounts = {};
  for (const it of data.items) {
    if (it.category !== 'knife' || it.segment !== 'home' || !it.type) continue;
    counts[it.type] = (counts[it.type] || 0) + 1;
    if (it.handed === 'left') leftCounts[it.type] = (leftCounts[it.type] || 0) + 1;
  }
  const all = Object.entries(tax.types ?? {}).filter(([id]) => counts[id]).map(([id, t]) => ({ id, ...t }));
  const rich = all.filter((t) => t.summary);
  const plain = all.filter((t) => !t.summary).sort((a, b) => collator.compare(a.label, b.label));

  const state = { task: '', group: '', sort: 'level' };
  const grid = h('div', { class: 'atlas__grid' });
  const status = h('p', { class: 'atlas__status muted', role: 'status', 'aria-live': 'polite' });

  const chipRow = (label, key, options) => {
    const buttons = [];
    const make = (value, text) => {
      const b = h('button', { type: 'button', class: 'chip-select', 'aria-pressed': String(state[key] === value), onClick: () => { state[key] = value; sync(); update(); } }, text);
      buttons.push([value, b]);
      return b;
    };
    const sync = () => buttons.forEach(([v, b]) => b.setAttribute('aria-pressed', String(state[key] === v)));
    return h('div', { class: 'atlas__filter', role: 'group', 'aria-label': label }, h('span', { class: 'atlas__filter-label' }, label), h('div', { class: 'atlas__chips' }, make('', 'Alle'), options.map(([v, t]) => make(v, t))));
  };

  const taskOptions = Object.entries(tax.tasks ?? {}).map(([id, t]) => [id, t.label]).filter(([id]) => rich.some((t) => (t.tasks?.[id] ?? 0) >= TASK_MIN));
  const groupOptions = Object.entries(tax.typeGroups ?? {}).map(([id, g]) => [id, g.label]).filter(([id]) => rich.some((t) => t.group === id));

  const sortSelect = h(
    'select',
    { id: 'atlas-sort', class: 'select', onChange: (e) => { state.sort = e.target.value; update(); } },
    h('option', { value: 'level' }, 'Einstufung 1 → 3 (beidseitig geschliffen zuerst)'),
    h('option', { value: 'name' }, 'Alphabetisch'),
    h('option', { value: 'count' }, 'Nach Anzahl im Katalog')
  );

  function card(t) {
    const bevel = t.bevel ? data.t('bevels', t.bevel) : '';
    const typical = rangeText(t.typicalMm);
    const range = rangeText(t.lengthMm);
    const left = leftCounts[t.id];
    const single = t.bevel === 'single';
    const fact = (k, v) => (v ? h('div', h('dt', k), h('dd', v)) : null);
    const st = typeStats(t.id, data);
    const catalogFacts = [
      fact('Härte der Stahlsorten', st.hrcKnown ? `Median ${num1(st.hrcMedian)} HRC, Spanne ${num1(st.hrcMin)}–${num1(st.hrcMax)} (bei ${st.hrcKnown} von ${st.n} Artikeln bekannt)` : `bei keinem der ${st.n} Artikel bekannt`),
      st.priceMedian != null ? fact('Preis ab', `Median ${jpy(Math.round(st.priceMedian))}, Spanne ${jpy(st.priceMin)}–${jpy(st.priceMax)}`) : null,
      fact('Rost', rustText(st.rust)),
      st.topSteels.length ? fact('Häufigste Stähle', st.topSteels.map((x) => `${data.t('steels', x.id)} (${x.count})`).join(', ')) : null,
    ];
    return h(
      'article',
      { class: 'card atlas__card', id: `typ-${t.id}` },
      h(
        'div',
        { class: 'card__body atlas__body' },
        h('div', { class: 'atlas__head' }, h('div', { class: 'atlas__sil' }, silhouette(t.id, { width: 150 })), h('div', h('h3', { class: 'atlas__name' }, t.label, t.kanji ? [' ', h('span', { class: 'atlas__kanji', lang: 'ja' }, t.kanji)] : null), t.gloss ? h('p', { class: 'muted atlas__gloss' }, t.gloss) : null, levelNode(t.level))),
        t.levelReason ? h('p', { class: 'atlas__why' }, t.levelReason) : null,
        h('dl', { class: 'atlas__facts' }, fact('Schliff', bevel), fact('Typische Länge', typical ? (range && range !== typical ? `${typical} (im Katalog-Bereich ${range})` : typical) : range)),
        h('p', t.summary),
        t.uses?.length ? h('div', h('h4', { class: 'atlas__sub' }, 'Wofür'), h('ul', t.uses.map((u) => h('li', u)))) : null,
        t.avoid ? h('div', h('h4', { class: 'atlas__sub' }, 'Weniger geeignet'), h('p', t.avoid)) : null,
        t.fun ? h('div', h('h4', { class: 'atlas__sub' }, 'Spaßfaktor'), h('p', t.fun)) : null,
        t.sharpenNote ? h('div', h('h4', { class: 'atlas__sub' }, 'Schärfen'), h('p', t.sharpenNote)) : null,
        h('div', h('h4', { class: 'atlas__sub' }, `Im Katalog (${countText(counts[t.id], 'Artikel', 'Artikel')})`), h('dl', { class: 'atlas__facts atlas__stats' }, catalogFacts)),
        single
          ? h('p', { class: 'atlas__left notice notice--info' }, h('span', [h('strong', 'Linkshänder: '), t.leftHandNote || 'Einseitig geschliffene Messer sind nicht symmetrisch; Standard ist die Rechtshänder-Ausführung.', left ? ` Im Katalog ${left === 1 ? 'ist 1 Artikel' : `sind ${left} Artikel`} als Linkshänder-Ausführung angegeben.` : ' Im Katalog ist keine Linkshänder-Ausführung angegeben.']))
          : null,
        h('p', { class: 'atlas__foot' }, h('a', { class: 'btn btn--sm', href: router.href('/katalog', { type: t.id }) }, 'Im Katalog ansehen'))
      )
    );
  }

  function update() {
    let list = rich.filter((t) => (!state.task || (t.tasks?.[state.task] ?? 0) >= TASK_MIN) && (!state.group || t.group === state.group));
    const sorters = {
      level: (a, b) => (a.level ?? 9) - (b.level ?? 9) || (counts[b.id] - counts[a.id]) || collator.compare(a.label, b.label),
      name: (a, b) => collator.compare(a.label, b.label),
      count: (a, b) => counts[b.id] - counts[a.id] || collator.compare(a.label, b.label),
    };
    list = [...list].sort(sorters[state.sort]);
    grid.replaceChildren(...(list.length ? list.map(card) : [h('p', { class: 'empty' }, 'Kein Messertyp passt zu dieser Kombination. Wähle „Alle“ bei Aufgabe oder Gruppe.')]));
    status.textContent = `${list.length} von ${rich.length} Messertypen`;
  }

  update();
  return h(
    'div',
    { class: 'atlas' },
    h('div', { class: 'atlas__controls' }, taskOptions.length ? chipRow('Aufgabe', 'task', taskOptions) : null, groupOptions.length ? chipRow('Gruppe', 'group', groupOptions) : null, h('div', { class: 'atlas__sort' }, h('label', { for: 'atlas-sort' }, 'Sortierung'), sortSelect), status),
    h('p', { class: 'atlas__legend muted' }, `Einstufung nach Schliff und Spezialisierung (Händlerangaben, nicht gemessen): ${Object.entries(LEVEL_DEFS).map(([n, d]) => `${n} = ${d}`).join('; ')}. Die Kennzahlen „Im Katalog“ stammen aus dem Katalogstand vom ${dateDe(data.meta?.fetchedAt)} und gelten nur für Haushaltsmesser.`),
    grid,
    plain.length
      ? h('div', { class: 'atlas__plain' }, h('h3', 'Weitere Spezialtypen im Katalog'), h('p', { class: 'muted' }, 'Zu diesen Typen gibt es noch keinen Erklärtext.'), h('ul', { class: 'atlas__plainlist' }, plain.map((t) => h('li', h('a', { href: router.href('/katalog', { type: t.id }) }, t.label), t.kanji ? [' ', h('span', { lang: 'ja', class: 'muted' }, t.kanji)] : null, h('span', { class: 'muted' }, ` (${counts[t.id]})`)))))
      : null
  );
}
