// „Einschätzung für den Alltag“ (Detailseite): Sterne mit kurzer Begründung je Skala. Logik: lib/predict.js.
import { h } from '../dom.js';
import { estimateKpis } from '../lib/predict.js';
import { stars } from './stars.js';
import { fillSources } from './sources.js';

const TAG = { estimate: 'Schätzung', catalog: 'Katalogangabe' };

export function kpiSection(data, item) {
  const est = estimateKpis(item, data);
  if (!est) return null;
  const slots = [];
  const rows = est.kpis.map((k) => {
    const slot = h('span', { class: 'kpi__src muted' });
    slots.push([slot, k.sources]);
    return h(
      'li',
      { class: ['kpi', k.stars == null && 'kpi--none'] },
      h('div', { class: 'kpi__head' }, h('h3', { class: 'kpi__label' }, k.label), h('span', { class: 'kpi__tag' }, TAG[k.kind]), stars(k.stars)),
      h('p', { class: 'kpi__ask muted' }, `${k.ask} 5 Sterne: ${k.five}.`),
      h('p', { class: 'kpi__text' }, k.text, slot)
    );
  });
  fillSources(slots);

  const { strengths, limits } = est.summary;
  const summary = strengths.length || limits.length
    ? h('p', { class: 'kpi-summary' }, strengths.length ? [h('strong', 'Stärken laut Schätzung (4–5 Sterne): '), strengths.join(', '), limits.length ? '. ' : '.'] : null, limits.length ? [h('strong', 'Abstriche (1–2 Sterne): '), limits.join(', '), '.'] : null)
    : null;

  const tasks = est.tasks.length
    ? h(
        'div',
        { class: 'kpi-tasks' },
        h('h3', { class: 'kpi__label' }, 'Eignung je Aufgabe'),
        h('p', { class: 'kpi__ask muted' }, `Aus den Aufgaben, die die Messerkunde dem Typ zuordnet (${data.t('types', item.type)}). 5 Sterne: Kernaufgabe des Typs.`),
        h('ul', { class: 'kpi-tasks__list' }, est.tasks.map((t) => h('li', h('span', t.label), stars(t.stars))))
      )
    : null;

  return h(
    'section',
    { class: 'detail__section kpis', 'aria-labelledby': 'detail-kpi' },
    h('h2', { id: 'detail-kpi' }, 'Einschätzung für den Alltag'),
    h('p', { class: 'muted small' }, 'Schätzung nach festen Regeln aus Stahlsorte, Härte-Richtwert, Schliff, Typ und Preis – keine Messung und keine Herstellerangabe. Die Sterne zeigen die Lage im Katalog: 5 = oberes Ende, 1 = unteres Ende; sie sagen nichts über die absolute Güte.'),
    summary,
    h('ul', { class: 'kpis__list' }, rows),
    tasks,
    h('p', { class: 'muted small' }, `Nicht geschätzt: ${est.notEstimated.join(', ')} – der Katalog nennt sie nicht. `, h('a', { href: '#/wissen/schaetzung' }, 'So entsteht die Einschätzung'))
  );
}
