// Härte-Skala (HRC) mit den vier Klassen von Knives and Stones; markiert die Härtespanne einer Stahlsorte.
// hardnessMeter({ range, taxonomy, compact }) → Node. Die Skala ordnet nur ein, sie bewertet nicht („härter“ ist nicht „besser“).
import { h } from '../dom.js';
import { hrcText, hardnessClass } from '../lib/insights.js';

const SCALE_MIN = 54;
const SCALE_MAX = 68;
const pct = (v) => ((Math.min(SCALE_MAX, Math.max(SCALE_MIN, v)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
const bandRange = (c) => (c.max == null ? `ab ${c.min}` : `${c.min}–${c.max}`);

/** Beschriftung der Skala als Text (für Screenreader und title). */
export function scaleText(taxonomy) {
  return (taxonomy.hardnessScale?.classes ?? []).map((c) => `${c.label} ${bandRange(c)}`).join(', ');
}

export function hardnessMeter({ range, taxonomy, compact = false }) {
  const classes = taxonomy.hardnessScale?.classes ?? [];
  if (!range || !classes.length) return null;
  const cls = hardnessClass((range[0] + range[1]) / 2, taxonomy);
  const bands = classes.map((c, i) => {
    const from = i === 0 ? SCALE_MIN : c.min;
    const to = classes[i + 1] ? classes[i + 1].min : SCALE_MAX;
    return { c, left: pct(from), width: pct(to) - pct(from) };
  });
  const label = `Härte ${hrcText(range)} HRC, Klasse „${cls.label}“. Skala von Knives and Stones: ${scaleText(taxonomy)} HRC.`;
  const left = pct(range[0]);
  const width = Math.max(pct(range[1]) - left, 0);
  return h(
    'div',
    compact ? { class: 'meter meter--compact', 'aria-hidden': 'true' } : { class: 'meter', role: 'img', 'aria-label': label },
    h(
      'div',
      { class: 'meter__track' },
      bands.map((b, i) => h('i', { class: `meter__band meter__band--${i}`, style: { left: `${b.left}%`, width: `${b.width}%` } })),
      h('i', { class: 'meter__range', style: { left: `${left}%`, width: `${width}%` } })
    ),
    compact
      ? null
      : [
          h('div', { class: 'meter__ticks', 'aria-hidden': 'true' }, bands.map((b) => h('span', { style: { left: `${pct(b.c.min)}%` } }, String(b.c.min)))),
          h('ul', { class: 'meter__legend', 'aria-hidden': 'true' }, bands.map((b, i) => h('li', h('i', { class: `meter__sw meter__band--${i}` }), `${b.c.label} ${bandRange(b.c)}`))),
        ]
  );
}
