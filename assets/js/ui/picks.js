// Startseiten-Modul „Sichere Wahl“: neun Messer in drei Typen (Spalten) und drei Preisstufen, mit Preis-Leistung und der Angabe, was sich
// gegenüber dem günstigeren Messer ändert. Logik: lib/picks.js.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { sichereWahl, pickRules, describeDiff, signedChf, allPicks } from '../lib/picks.js';
import { stars } from './stars.js';
import { fillSources } from './sources.js';
import { productPhoto, availabilityText, pickButton } from './card.js';
import { itemHeadline } from './attrs.js';
import { jpy, num, cmText, dateDe } from '../format.js';

const SCALES = [
  ['edge', 'Schnitthaltigkeit'],
  ['sharpen', 'Schärfbarkeit'],
  ['tough', 'Ausbruch-Festigkeit'],
  ['rust', 'Rostschutz'],
  ['adapt', 'Eingewöhnung'],
];
const chf = (v) => `CHF ${num(Math.round(v))}`;
const budgetText = (t) => (t.minChf ? `${chf(t.minChf)} bis ${num(t.maxChf)}` : `bis ${chf(t.maxChf)}`);
const starsOf = (pick, id) => pick.est.kpis.find((k) => k.id === id)?.stars ?? null;
const compareHref = (picks) => `#/vergleich?m=${picks.map((p) => encodeURIComponent(p.item.handle)).join(',')}`;
const TONE_MARK = { up: '▲', down: '▼', same: '＝', plain: '•' };
const TONE_WORD = { up: 'besser: ', down: 'schlechter: ', same: '', plain: '' };

/** Wogegen verglichen wird: „Einstieg“ (gleicher Typ, günstigere Stufe) oder das günstigste „Ausgewogen“-Messer. */
function againstLabel(pick) {
  const d = pick.diff;
  return d.kind === 'step' ? `„${d.against.tier.level}“ (${chf(d.against.chf)})` : `„${d.against.lane.name} · ${d.against.tier.level}“ (${chf(d.against.chf)})`;
}

function diffBlock(pick) {
  const d = pick.diff;
  const { lead, lines } = describeDiff(d);
  return h(
    'div',
    { class: ['pick__diff', `pick__diff--${d.kind}`] },
    h('p', { class: 'pick__diff-title' }, h('strong', `Unterschied zu ${againstLabel(pick)}`), h('span', { class: 'pick__diff-price' }, h('span', { class: 'visually-hidden' }, d.deltaChf < 0 ? 'Preis: ' : 'Mehrpreis: '), signedChf(d.deltaChf))),
    h('p', { class: 'pick__diff-lead' }, lead),
    h('ul', { class: 'pick__diff-list' },
      lines.map((l) => h('li', { class: `is-${l.tone}` }, h('span', { class: 'pick__mark', 'aria-hidden': 'true' }, TONE_MARK[l.tone]), l.kind === 'perf' && TONE_WORD[l.tone] ? h('span', { class: 'visually-hidden' }, TONE_WORD[l.tone]) : null, l.text))
    )
  );
}

function pickCard(data, pick, { slots }) {
  const item = pick.item;
  const hl = itemHeadline(data, item);
  const href = `#/messer/${encodeURIComponent(item.handle)}`;
  const byId = Object.fromEntries(pick.est.kpis.map((k) => [k.id, k]));
  const id = `pick-${pick.lane.id}-${pick.tier.id}`;

  const reasonItems = pick.reasons.map((r) => {
    const slot = h('span', { class: 'pick__src muted' });
    slots.push([slot, r.sources]);
    return h('li', h('strong', r.lead), ' ', r.text, slot);
  });

  const scales = SCALES.map(([sid, label]) => {
    const delta = pick.diff ? (byId[sid].stars ?? 0) - (starsOf(pick.diff.against, sid) ?? 0) : 0;
    const marker = delta
      ? h('span', { class: ['pick__delta', delta > 0 ? 'pick__delta--up' : 'pick__delta--down'] }, h('span', { 'aria-hidden': 'true' }, delta > 0 ? `+${delta}` : `−${-delta}`), h('span', { class: 'visually-hidden' }, ` (${delta > 0 ? 'besser' : 'schlechter'} als ${againstLabel(pick)})`))
      : null;
    return h('li', { class: delta ? 'is-changed' : '' }, h('span', label, marker), stars(byId[sid].stars, { number: false }));
  });

  return h(
    'article',
    { class: ['card', 'pick', `pick--${pick.lane.id}`], 'aria-labelledby': id },
    h('div', { class: 'card__body pick__body' },
      h('p', { class: 'pick__level' }, h('span', { id }, pick.tier.level), h('span', { class: 'pick__budget' }, budgetText(pick.tier))),
      h('a', { class: 'pick__photo', href, tabindex: '-1', 'aria-hidden': 'true' }, productPhoto(item)),
      h('h4', { class: 'pick__title' }, h('a', { href }, hl.title), h('span', { class: 'muted' }, ` · ${cmText(pick.size.mm)} cm`)),
      h('p', { class: 'pick__orig muted', lang: 'en' }, item.title),
      h('p', { class: 'pick__price' }, h('strong', `ca. ${chf(pick.chf)}`), h('span', { class: 'muted' }, ` (${jpy(pick.jpy)})`)),
      h('p', { class: 'pick__avail muted small' }, availabilityText(item)),
      pick.diff ? diffBlock(pick) : null,
      h('dl', { class: 'pick__kpis' },
        pick.lane.id === 'ausgewogen' ? h('div', h('dt', 'Sorglos'), h('dd', stars(pick.sorglos))) : null,
        h('div', h('dt', 'Preis-Leistung'), h('dd', stars(pick.pl)))
      ),
      pick.lane.id === 'scharf' && byId.rust.stars < 5 ? h('p', { class: 'pick__care small' }, `${item.rust === 'clad' ? 'Schneide aus Kohlenstoffstahl, Mantel rostfrei' : 'Klinge aus Kohlenstoffstahl, nicht rostfrei'}: Rostschutz ${byId.rust.stars} von 5 Sternen. Nach dem Schneiden abtrocknen, gelegentlich schärfen.`) : null,
      h('ul', { class: 'pick__scales', 'aria-label': 'Sterne je Skala' }, scales),
      pick.features.length ? h('p', { class: 'pick__feat small' }, h('strong', 'Ausstattung: '), pick.features.join(', ')) : null,
      h('details', { class: 'pick__why' }, h('summary', 'Warum dieses Messer?'), h('ul', reasonItems)),
      h('div', { class: 'pick__actions' }, h('a', { class: 'btn btn--sm', href }, 'Details', icon('arrow-right', { size: 16 })), pickButton(item, { data, sizeIndex: pick.sizeIndex }))
    )
  );
}

function gapNote(lane, gaps) {
  if (!gaps.length) return null;
  const parts = gaps.map((g) => `${g.level} (${budgetText(g)}): ${g.pick ? 'Das beste Messer dort bietet nicht mehr als das Messer davor' : 'kein Messer erfüllt die Regeln'}`);
  return h('p', { class: 'picks__note' }, `${lane.name}: ${parts.join('; ')}. Darum steht dort keine Karte.`);
}

function laneColumn(data, entry, slots) {
  const { lane, picks, gaps } = entry;
  return h(
    'section',
    { class: ['picklane', `picklane--${lane.id}`], 'aria-labelledby': `lane-${lane.id}` },
    h('header', { class: 'picklane__head' },
      h('h3', { id: `lane-${lane.id}` }, lane.name),
      h('p', { class: 'picklane__claim' }, lane.claim),
      h('p', { class: 'picklane__who muted small' }, `Passt, wenn ${lane.who}`)
    ),
    h('div', { class: 'picklane__cards' }, picks.map((pick) => pickCard(data, pick, { slots }))),
    gapNote(lane, gaps),
    picks.length >= 2 ? h('p', { class: 'picklane__actions' }, h('a', { class: 'btn btn--ghost btn--sm', href: compareHref(picks) }, icon('check', { size: 16 }), `Diese ${picks.length} nebeneinander vergleichen`)) : null
  );
}

/** Gegenüberstellung der drei Typen: Sterne-Spannen je Skala, Stahl und Härte. */
function typeTable(data, w) {
  const cell = (c) => (c.min == null ? h('td', '–') : c.min === c.max ? h('td', stars(c.min, { number: false })) : h('td', h('span', { class: 'picks__range' }, `${c.min}–${c.max}`), h('span', { class: 'visually-hidden' }, ' von 5 Sternen')));
  const head = h('tr', h('th', { scope: 'col' }, 'Skala'), w.lanes.map(({ lane }) => h('th', { scope: 'col' }, lane.name)));
  const body = [
    ...w.compare.map((row) => h('tr', h('th', { scope: 'row' }, row.label), row.cells.map(cell))),
    h('tr', h('th', { scope: 'row' }, 'Stahl'), w.lanes.map(({ steels }) => h('td', steels.labels.join(', ')))),
    h('tr', h('th', { scope: 'row' }, 'Härte (HRC)'), w.lanes.map(({ steels }) => h('td', steels.hrc ?? '–'))),
  ];
  const scale = data.taxonomy.hardnessScale;
  const soft = scale?.classes?.find((c) => c.id === 'soft');
  const hard = scale?.classes?.find((c) => c.id === 'hard');
  const firsts = w.lanes.map((l) => l.picks[0]).filter(Boolean);
  return h(
    'div',
    { class: 'picks__types' },
    h('h3', { class: 'picks__types-h' }, 'Die drei Typen im Vergleich'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table picks__table' }, h('caption', { class: 'visually-hidden' }, 'Sterne der ausgewählten Messer je Typ'), h('thead', head), h('tbody', body))),
    h('p', { class: 'muted small picks__types-note' },
      'Je Typ die Spanne der Sterne seiner drei Messer. ',
      soft && hard ? `Grundlage ist die Härteskala von Knives and Stones. Klasse „weich“: ${soft.retention} ${soft.sharpening} ${soft.toughness} Klasse „hart“: ${hard.retention} ${hard.sharpening} ` : '',
      firsts.length >= 2 ? h('a', { href: compareHref(firsts) }, `Die ${firsts.length} Einstiegsmesser nebeneinander vergleichen`) : null
    )
  );
}

function howItWorks(data, w) {
  const rules = pickRules(w.limitChf);
  const list = (items) => h('ul', items.map((t) => h('li', t)));
  return h(
    'details',
    { class: 'disclosure picks__how' },
    h('summary', 'So wählen wir aus: Annahmen, Kennzahlen, Regeln'),
    h(
      'div',
      { class: 'disclosure__body' },
      h('h3', 'Annahmen'),
      list(rules.assumptions),
      h('h3', 'Kennzahlen'),
      h('dl', { class: 'picks__defs' }, rules.kpis.map(([k, v]) => h('div', h('dt', k), h('dd', v)))),
      h('h3', 'Auswahl'),
      list(rules.selection),
      h('p', { class: 'muted small' }, `Die Sterne sind Schätzungen nach festen Regeln, keine Messung. Kurs: 1 CHF = ¥${data.rates.CHF} (${data.site?.rates?.source ?? 'Referenzkurs'}, Stand ${dateDe(data.site?.rates?.asOf)}); Bestand laut Online-Katalog. `, h('a', { href: '#/wissen/schaetzung' }, 'So entsteht die Einschätzung'))
    )
  );
}

export function picksSection(data) {
  const w = sichereWahl(data);
  const total = allPicks(w).length;
  if (!total) return null;
  const slots = [];
  const lanes = w.lanes.filter((l) => l.picks.length).map((entry) => laneColumn(data, entry, slots));
  fillSources(slots);

  return h(
    'section',
    { class: 'container picks', 'aria-labelledby': 'picks-h' },
    h('p', { class: 'eyebrow' }, 'Sichere Wahl'),
    h('h2', { id: 'picks-h' }, `${total} Messer für drei Typen und drei Budgets`),
    h('p', { class: 'lede' }, 'Für Freunde in der Schweiz, die vor allem Gemüse schneiden. Der Typ entscheidet, wie sich das Messer im Alltag verhält: Schneide, Schärfen, Pflege. Die Preisstufe (Einstieg, Kocht gern, Zum Schenken) entscheidet über Ausstattung und Preis. Auf jeder Karte steht, was sich gegenüber dem günstigeren Messer tatsächlich ändert – oft ist es nur der Griff.'),
    typeTable(data, w),
    h('div', { class: 'picks__lanes' }, lanes),
    w.maxSorglos && w.maxSorglos < 5 ? h('p', { class: 'picks__scale muted small' }, `„Sorglos“ ${w.maxSorglos} von 5 ist der Höchstwert, den ein komplett rostfreies Messer im Katalog erreicht: Je härter der Stahl, desto länger hält die Schneide, aber desto eher bricht sie aus und desto schwerer lässt sie sich schärfen.`) : null,
    h('p', { class: 'picks__actions' }, h('a', { class: 'btn btn--ghost', href: '#/finder' }, icon('compass', { size: 18 }), 'Genauer eingrenzen im Finder')),
    howItWorks(data, w)
  );
}
