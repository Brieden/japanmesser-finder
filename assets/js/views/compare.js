// #/vergleich?m=handle1,handle2,… – bis zu vier Messer nebeneinander: Eckdaten, Sterne-Skalen (Schätzung) und Eignung je Aufgabe.
// Die Sterne zeigen die Lage im Katalog (lib/predict.js); der Vergleich hebt hervor, wo sich die Messer wirklich unterscheiden.
import { h, loadCss, assetUrl } from '../dom.js';
import { icon } from '../icons.js';
import { shortlist } from '../shortlist.js';
import { splitList } from '../util.js';
import { jpy, sizeRangeText } from '../format.js';
import { itemHeadline } from '../ui/attrs.js';
import { productPhoto, availabilityText } from '../ui/card.js';
import { stars } from '../ui/stars.js';
import { estimateKpis, compareRows, KPI_DEFS } from '../lib/predict.js';

export const title = 'Messer vergleichen';

export const MAX_COMPARE = 4;
const LETTERS = ['A', 'B', 'C', 'D'];
const TAG = { estimate: 'Schätzung', catalog: 'Katalogangabe' };

/** Handles aus der URL: nur vorhandene Messer, ohne Dopplungen, höchstens MAX_COMPARE. */
export function compareHandles(raw, data) {
  return [...new Set(splitList(raw))].filter((handle) => data.byHandle.get(handle)?.category === 'knife').slice(0, MAX_COMPARE);
}

const href = (router, handles) => router.href('/vergleich', { m: handles });

function savedHandles(data) {
  const all = shortlist.all().flatMap((person) => person.picks.map((pick) => pick.handle));
  return compareHandles(all.join(','), data);
}

function emptyState(ctx, requested) {
  const { router, data } = ctx;
  const saved = savedHandles(data);
  return h(
    'section',
    { class: 'container section compare' },
    h('p', { class: 'eyebrow' }, 'Vergleich'),
    h('h1', 'Messer vergleichen'),
    h('div', { class: 'empty' }, [
      h('div', { class: 'empty__mark', lang: 'ja', 'aria-hidden': 'true' }, '比'),
      h('h2', requested.length ? 'Zu wenige Messer für einen Vergleich' : 'Noch nichts zum Vergleichen'),
      h('p', 'Für den Vergleich braucht es mindestens zwei Messer aus dem Katalog. Du kommst auf drei Wegen hierher: über „Ähnliche Messer“ auf der Seite eines Messers, über „Messer vergleichen“ bei einer Person in deiner Liste oder mit der Auswahl unten.'),
      h(
        'div',
        { class: 'cluster compare__empty-actions' },
        saved.length >= 2 ? h('a', { class: 'btn btn--primary', href: href(router, saved) }, icon('check', { size: 18 }), `Vorgemerkte Messer vergleichen (${saved.length})`) : null,
        h('a', { class: 'btn', href: router.href('/katalog') }, icon('search', { size: 18 }), 'Zum Katalog'),
        h('a', { class: 'btn btn--ghost', href: router.href('/liste') }, 'Meine Liste')
      ),
    ])
  );
}

const row = (label, cells, { head = null, className = '' } = {}) =>
  h('tr', { class: className }, h('th', { scope: 'row' }, label, head), cells.map((c) => h('td', c)));

function facts(data, items) {
  const t = (group, id) => (id ? data.t(group, id) : null);
  const steel = (it) => (it.steel ? data.entry('steels', it.steel.id)?.label ?? it.steel.id : null);
  const dash = (v) => v || h('span', { class: 'muted' }, 'nicht angegeben');
  return [
    row('Typ', items.map((it) => dash(t('types', it.type)))),
    row('Stahl', items.map((it) => dash(steel(it)))),
    row('Rost-Klasse', items.map((it) => dash(t('rust', it.rust)))),
    row('Klingenlänge', items.map((it) => dash(sizeRangeText(it)))),
    row('Schliff', items.map((it) => dash([t('bevels', it.bevel), it.handed === 'left' ? 'Linkshänder-Ausführung' : null].filter(Boolean).join(', ')))),
    row('Griff', items.map((it) => dash(it.grip && it.grip.style !== 'unknown' ? [t('handleStyles', it.grip.style), it.grip.material ? t('handleMaterials', it.grip.material) : null].filter(Boolean).join(', ') : null))),
    row('Preis ab', items.map((it) => dash(it.priceFrom != null ? jpy(it.priceFrom) : null))),
  ];
}

function kpiRows(rows, items) {
  return rows.map((r) =>
    h(
      'tr',
      { class: r.spread >= 2 ? 'compare__row--diff' : '' },
      h('th', { scope: 'row' }, r.def.label, h('span', { class: 'compare__tag' }, TAG[r.def.kind])),
      r.cells.map((c) => {
        const lead = r.spread > 0 && c.kpi?.stars === r.max;
        return h('td', { class: lead ? 'is-lead' : '' }, stars(c.kpi?.stars ?? null), lead ? h('span', { class: 'compare__lead' }, 'vorn') : null);
      })
    )
  );
}

function taskRows(ests, items) {
  const ids = [];
  for (const e of ests) for (const t of e.tasks) if (!ids.includes(t.id)) ids.push(t.id);
  const label = (id) => ests.flatMap((e) => e.tasks).find((t) => t.id === id)?.label;
  return ids.map((id) => {
    const values = ests.map((e) => e.tasks.find((t) => t.id === id)?.stars ?? null);
    const max = Math.max(...values.map((v) => v ?? 0));
    const spread = max - Math.min(...values.map((v) => v ?? 0));
    return h('tr', { class: spread >= 2 ? 'compare__row--diff' : '' }, h('th', { scope: 'row' }, label(id)), values.map((v) => h('td', { class: spread > 0 && v === max ? 'is-lead' : '' }, stars(v), spread > 0 && v === max ? h('span', { class: 'compare__lead' }, 'vorn') : null)));
  });
}

/** Wo unterscheiden sich die Messer? Nur Skalen mit mindestens 2 Sternen Abstand; Rest knapp zusammengefasst. */
function differences(rows, items) {
  const letter = (it) => LETTERS[items.indexOf(it)];
  const big = rows.filter((r) => r.spread >= 2);
  const same = rows.filter((r) => r.max != null && r.spread === 0).map((r) => r.def.label);
  const none = rows.filter((r) => r.max == null).map((r) => r.def.label);
  const lines = big.map((r) => {
    const lead = r.best.map(letter).join(' und ');
    const rest = r.cells.filter((c) => c.kpi?.stars != null && c.kpi.stars !== r.max).sort((a, b) => b.kpi.stars - a.kpi.stars).map((c) => `${letter(c.item)} ${c.kpi.stars}`).join(', ');
    return h('li', h('strong', `${r.def.label}: `), `${lead} vorn (${r.max} Sterne); ${rest}.`);
  });
  return h(
    'section',
    { class: 'compare__diff', 'aria-labelledby': 'compare-diff' },
    h('h2', { id: 'compare-diff' }, 'Wo sich die Messer unterscheiden'),
    lines.length ? h('ul', lines) : h('p', 'Auf keiner Skala liegen die Messer mehr als einen Stern auseinander.'),
    same.length ? h('p', { class: 'muted small' }, `Gleich bewertet: ${same.join(', ')}.`) : null,
    none.length ? h('p', { class: 'muted small' }, `Nicht für alle schätzbar: ${none.join(', ')}.`) : null
  );
}

export async function render(ctx) {
  await loadCss(assetUrl('assets/css/views/compare.css'));
  const { data, router, query } = ctx;
  const handles = compareHandles(query.m, data);
  if (handles.length < 2) return emptyState(ctx, splitList(query.m));
  const items = handles.map((handle) => data.byHandle.get(handle));
  const ests = items.map((item) => estimateKpis(item, data));
  const rows = compareRows(items.map((item, i) => ({ item, est: ests[i] })));

  const head = items.map((item, i) => {
    const hl = itemHeadline(data, item);
    const rest = handles.filter((x) => x !== item.handle);
    return h(
      'th',
      { scope: 'col', class: 'compare__knife' },
      h('span', { class: 'compare__letter', 'aria-hidden': 'true' }, LETTERS[i]),
      h('div', { class: 'compare__photo' }, productPhoto(item, { width: 240 })),
      h('a', { class: 'compare__name', href: `#/messer/${encodeURIComponent(item.handle)}` }, `${LETTERS[i]}: ${hl.title}`),
      h('span', { class: 'compare__orig muted', lang: 'en' }, item.title),
      h('span', { class: 'compare__avail muted' }, availabilityText(item)),
      items.length > 2 ? h('a', { class: 'compare__remove', href: href(router, rest) }, 'Entfernen', h('span', { class: 'visually-hidden' }, ` ${LETTERS[i]} aus dem Vergleich`)) : null
    );
  });

  const col = items.length + 1;
  const group = (name, note) => h('tr', { class: 'compare__group' }, h('th', { scope: 'colgroup', colspan: String(col) }, name, note ? h('span', { class: 'muted' }, ` ${note}`) : null));
  const tasks = taskRows(ests, items);

  const reasons = h(
    'details',
    { class: 'disclosure compare__reasons' },
    h('summary', 'Was die Skalen bedeuten und warum die Messer so abschneiden'),
    h(
      'div',
      { class: 'disclosure__body' },
      KPI_DEFS.map((def) =>
        h(
          'div',
          { class: 'compare__reason' },
          h('h3', def.label),
          h('p', { class: 'compare__ask muted' }, `${def.ask} 5 Sterne: ${def.five}.`),
          h('ul', items.map((item, i) => h('li', h('strong', `${LETTERS[i]}: `), ests[i].kpis.find((k) => k.id === def.id).text)))
        )
      )
    )
  );

  return h(
    'section',
    { class: 'container section compare' },
    h('a', { class: 'compare__back', href: router.href('/katalog') }, icon('arrow-left', { size: 18 }), 'Zum Katalog'),
    h('p', { class: 'eyebrow' }, 'Vergleich'),
    h('h1', 'Messer vergleichen'),
    h('p', { class: 'lede' }, 'Die Sterne zeigen die Lage im Katalog (5 = oberes Ende, 1 = unteres Ende). Sie sind Schätzungen nach festen Regeln, keine Messungen.'),
    differences(rows, items),
    h(
      'div',
      { class: 'table-wrap compare__wrap', tabindex: '0', role: 'region', 'aria-label': 'Vergleichstabelle der Messer' },
      h(
        'table',
        { class: 'table compare__table' },
        h('caption', { class: 'visually-hidden' }, `Vergleich von ${items.length} Messern: Eckdaten, Sterne-Skalen und Eignung je Aufgabe`),
        h('thead', h('tr', h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Eigenschaft')), head)),
        h('tbody', group('Eckdaten'), facts(data, items)),
        h('tbody', group('Einschätzung für den Alltag', '(Sterne)'), kpiRows(rows, items)),
        tasks.length ? h('tbody', group('Eignung je Aufgabe', '(aus dem Typ)'), tasks) : null
      )
    ),
    reasons,
    h('p', { class: 'muted small' }, 'Nicht geschätzt: Schärfe ab Werk, Gewicht und Balance, Klingendicke und -höhe – der Katalog nennt sie nicht. ', h('a', { href: '#/wissen/schaetzung' }, 'So entsteht die Einschätzung'))
  );
}
