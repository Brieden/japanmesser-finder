// Startseiten-Modul „Sichere Wahl“: wenige Messer mit guter Preis-Leistung nach unserer Einschätzung. Logik: lib/picks.js.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { sichereWahl, pickRules } from '../lib/picks.js';
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

function pickCard(data, pick, { expert = false, prev = null, slots }) {
  const item = pick.item;
  const hl = itemHeadline(data, item);
  const href = `#/messer/${encodeURIComponent(item.handle)}`;
  const byId = Object.fromEntries(pick.est.kpis.map((k) => [k.id, k]));

  const reasonItems = pick.reasons.map((r) => {
    const slot = h('span', { class: 'pick__src muted' });
    slots.push([slot, r.sources]);
    return h('li', h('strong', r.lead), ' ', r.text, slot);
  });

  let upgrade = null;
  if (pick.upgrade && prev) {
    const diff = Math.round(pick.chf - prev.chf);
    upgrade = h('p', { class: 'pick__upgrade' }, h('strong', `Gegenüber „${prev.tier.level}“ (+${chf(diff)}): `), pick.upgrade.sameStars ? 'gleiche Sterne' : 'andere Sterne', pick.upgrade.added.length ? `, zusätzlich ${pick.upgrade.added.join(', ')}.` : '.');
  }

  return h(
    'article',
    { class: ['card', 'pick', expert && 'pick--expert'], 'aria-labelledby': `pick-${pick.tier.id}` },
    h('div', { class: 'card__body pick__body' },
      h('p', { class: 'pick__level' }, h('span', { id: `pick-${pick.tier.id}` }, pick.tier.level), h('span', { class: 'pick__budget' }, expert ? 'braucht Pflege' : budgetText(pick.tier))),
      h('a', { class: 'pick__photo', href, tabindex: '-1', 'aria-hidden': 'true' }, productPhoto(item)),
      h('h3', { class: 'pick__title' }, h('a', { href }, hl.title), h('span', { class: 'muted' }, ` · ${cmText(pick.size.mm)} cm`)),
      h('p', { class: 'pick__orig muted', lang: 'en' }, item.title),
      h('p', { class: 'pick__price' }, h('strong', `ca. ${chf(pick.chf)}`), h('span', { class: 'muted' }, ` (${jpy(pick.jpy)})`)),
      h('p', { class: 'pick__avail muted small' }, availabilityText(item)),
      h('dl', { class: 'pick__kpis' },
        expert ? null : h('div', h('dt', 'Sorglos'), h('dd', stars(pick.sorglos))),
        h('div', h('dt', 'Preis-Leistung'), h('dd', stars(pick.pl)))
      ),
      expert ? h('p', { class: 'pick__care small' }, `Kohlenstoffstahl oder Mantel: Rostschutz ${byId.rust.stars} von 5 Sternen. Nach dem Schneiden abtrocknen, gelegentlich schärfen.`) : null,
      h('ul', { class: 'pick__scales', 'aria-label': 'Sterne je Skala' }, SCALES.map(([id, label]) => h('li', h('span', label), stars(byId[id].stars, { number: false })))),
      pick.features.length ? h('p', { class: 'pick__feat small' }, h('strong', 'Ausstattung: '), pick.features.join(', ')) : null,
      upgrade,
      h('details', { class: 'pick__why' }, h('summary', 'Warum dieses Messer?'), h('ul', reasonItems)),
      h('div', { class: 'pick__actions' }, h('a', { class: 'btn btn--sm', href }, 'Details', icon('arrow-right', { size: 16 })), pickButton(item, { data, sizeIndex: pick.sizeIndex }))
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
  if (!w.tiers.length && !w.expert) return null;
  const slots = [];
  const cards = w.tiers.map(({ pick }, i) => pickCard(data, pick, { prev: i ? w.tiers[i - 1].pick : null, slots }));
  if (w.expert) cards.push(pickCard(data, w.expert, { expert: true, slots }));
  fillSources(slots);

  const handles = [...new Set([...w.tiers.map((t) => t.pick.item.handle), w.expert?.item.handle].filter(Boolean))].slice(0, 4);
  const lastLevel = w.tiers.at(-1)?.pick.tier.level;
  const droppedNote = w.dropped.length
    ? h('p', { class: 'picks__note' }, `${w.dropped.map((d) => `Zwischen ${chf(d.minChf)} und ${num(d.maxChf)}`).join(' und ')} gibt es gleichwertige Messer, aber keines mit besserer Wertung oder mehr Ausstattung als „${lastLevel}“. Mehrpreis bezahlt dort vor allem Optik und Holzgriffe.`)
    : null;

  return h(
    'section',
    { class: 'container picks', 'aria-labelledby': 'picks-h' },
    h('p', { class: 'eyebrow' }, 'Sichere Wahl'),
    h('h2', { id: 'picks-h' }, 'Messer, mit denen man wenig falsch macht'),
    h('p', { class: 'lede' }, 'Für Freunde in der Schweiz, die vor allem Gemüse schneiden: wenige Messer mit guter Preis-Leistung nach unserer Einschätzung – komplett rostfrei, beidseitig geschliffen, auf keiner Skala eine schwache Stelle. Die Karte „Kennt sich aus“ ist die Ausnahme: Sie braucht Pflege.'),
    h('div', { class: 'picks__grid' }, cards),
    w.maxSorglos && w.maxSorglos < 5 ? h('p', { class: 'picks__scale muted small' }, `„Sorglos“ ${w.maxSorglos} von 5 ist der Höchstwert, den ein komplett rostfreies Messer im Katalog erreicht: Je härter der Stahl, desto länger hält die Schneide, aber desto eher bricht sie aus und desto schwerer lässt sie sich schärfen.`) : null,
    droppedNote,
    h('p', { class: 'picks__actions' }, handles.length >= 2 ? h('a', { class: 'btn', href: `#/vergleich?m=${handles.map(encodeURIComponent).join(',')}` }, icon('check', { size: 18 }), 'Die Auswahl nebeneinander vergleichen') : null, h('a', { class: 'btn btn--ghost', href: '#/finder' }, icon('compass', { size: 18 }), 'Genauer eingrenzen im Finder')),
    howItWorks(data, w)
  );
}
