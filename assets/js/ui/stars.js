// Sterne-Anzeige für die Alltags-Einschätzung. stars(n) → Node; n = 1–5 oder null (keine Schätzung).
// Zugänglich: ein Bild-Element mit Textalternative („4 von 5 Sternen“); die Glyphen selbst sind für Screenreader verborgen.
import { h } from '../dom.js';
import { STAR_MAX } from '../lib/predict.js';

export function stars(n, { max = STAR_MAX, number = true } = {}) {
  if (n == null) return h('span', { class: 'stars stars--none' }, h('span', { 'aria-hidden': 'true' }, '–'), h('span', { class: 'visually-hidden' }, 'keine Schätzung'));
  return h(
    'span',
    { class: 'stars', role: 'img', 'aria-label': `${n} von ${max} Sternen` },
    h('span', { class: 'stars__row', 'aria-hidden': 'true' }, Array.from({ length: max }, (_, i) => h('i', { class: i < n ? 'is-on' : '' }, i < n ? '★' : '☆'))),
    number ? h('span', { class: 'stars__num', 'aria-hidden': 'true' }, `${n}/${max}`) : null
  );
}
