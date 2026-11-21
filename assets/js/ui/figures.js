// Erklärende Inline-SVG-Diagramme der Messerkunde (Klingen-Querschnitte, schematisch, nicht maßstäblich).
//   figure(id) → <figure class="fig"> mit <svg role="img"> oder null, wenn die ID unbekannt ist.
//   FIGURE_IDS: Liste der bekannten IDs.
// Farben nur über Klassen (.fg-*) in assets/css/views/wissen.css (Token-Variablen, Dark Mode automatisch).
import { h } from '../dom.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 360;
const ROW = 168;

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/** Text mit Kanji-Teilen: parts = ['Ryōba ', { ja: '両刃' }, ' …'] */
function text(x, y, cls, parts, extra = {}) {
  const t = s('text', { x, y, class: cls, ...extra });
  for (const p of [].concat(parts)) t.append(typeof p === 'string' ? p : s('tspan', { lang: 'ja' }, p.ja));
  return t;
}

const SPEC = (id) => ({
  hatch: `${id}-hatch`,
  defs: s(
    'defs',
    {},
    s('pattern', { id: `${id}-hatch`, width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 7, height: 7, class: 'fg-hard-bg' }), s('line', { x1: 0, y1: 0, x2: 0, y2: 7, class: 'fg-hard-line' }))
  ),
});

// Querschnitt-Formen (lokale Koordinaten 0..100 × 0..115; Rücken oben, Schneide unten)
const SHAPES = {
  ryoba: '10,0 90,0 90,52 50,115 10,52',
  kataba: '20,0 80,0 80,50 20,115',
  urasuki: '20,0 80,0 80,50 20,115 24,80 24,45 20,38 20,0',
};

function shape(x, y, scale, body, { spine = true, edge = true, cut = 'Schneide' } = {}) {
  const g = s('g', { transform: `translate(${x} ${y}) scale(${scale})` }, body);
  return s('g', {}, g, spine ? text(x + 50 * scale, y - 6, 'fg-small fg-mid', 'Rücken', { 'text-anchor': 'middle' }) : null, edge ? text(x + 50 * scale, y + 115 * scale + 16, 'fg-small fg-mid', cut, { 'text-anchor': 'middle' }) : null);
}

function row(i, shapeNode, title, lines, care) {
  const y0 = i * ROW;
  const g = s('g', { transform: `translate(0 ${y0})` }, i ? s('line', { x1: 8, x2: W - 8, y1: 0, y2: 0, class: 'fg-rule' }) : null, shapeNode);
  g.append(text(140, 34, 'fg-title', title));
  lines.forEach((l, k) => g.append(text(140, 58 + k * 18, 'fg-text', l)));
  if (care) g.append(text(140, 58 + lines.length * 18 + 10, 'fg-care', care));
  return g;
}

function legend(y, items) {
  const g = s('g', { transform: `translate(0 ${y})` }, s('line', { x1: 8, x2: W - 8, y1: 0, y2: 0, class: 'fg-rule' }));
  let x = 14;
  items.forEach(([fill, label, w]) => {
    g.append(s('rect', { x, y: 14, width: 18, height: 18, rx: 3, class: fill }), text(x + 26, 28, 'fg-small fg-ink', label));
    x += w;
  });
  return g;
}

function frame(id, titleText, descText, height, nodes, caption) {
  const svg = s('svg', { class: 'fig__svg', viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-labelledby': `${id}-t ${id}-d`, focusable: 'false' }, s('title', { id: `${id}-t` }, titleText), s('desc', { id: `${id}-d` }, descText), SPEC(id).defs, nodes);
  return h('figure', { class: 'fig', id: `fig-${id}` }, svg, caption ? h('figcaption', { class: 'fig__caption' }, caption) : null);
}

// 1) Rost-Stufen
function rustTiers(c) {
  const id = 'f-rust';
  const hatch = `url(#${id}-hatch)`;
  const full = s('polygon', { points: SHAPES.ryoba, class: 'fg-soft' });
  const clad = [
    s('polygon', { points: SHAPES.ryoba, class: 'fg-soft' }),
    s('polygon', { points: '40,0 60,0 60,52 50,115 40,52', fill: hatch, class: 'fg-hard-edge' }),
    s('circle', { cx: 50, cy: 108, r: 9, class: 'fg-mark' }),
  ];
  const none = [
    s('polygon', { points: SHAPES.ryoba, fill: hatch, class: 'fg-hard-edge' }),
    s('circle', { cx: 30, cy: 30, r: 4, class: 'fg-patina' }),
    s('circle', { cx: 66, cy: 44, r: 5, class: 'fg-patina' }),
    s('circle', { cx: 44, cy: 70, r: 3.5, class: 'fg-patina' }),
  ];
  const nodes = [
    row(0, shape(30, 20, 1, full, {}), 'Komplett rostfrei', ['Alles rostfreier Stahl,', 'auch die Schneide.'], 'Pflege: spülen, abtrocknen.'),
    row(1, shape(30, 20, 1, clad, {}), 'Teilweise rostfrei', ['Rostfreier Mantel; Kern und', 'Schneide: Kohlenstoffstahl.'], 'Pflege: Schneide trocknen.'),
    row(2, shape(30, 20, 1, none, {}), 'Nicht rostfrei', ['Kohlenstoffstahl; bildet Patina,', 'kann rosten.'], 'Pflege: sofort abtrocknen, ölen.'),
    legend(3 * ROW, [['fg-swatch-soft', 'rostfreier Stahl', 150], ['fg-swatch-hard', 'Kohlenstoffstahl', 150]]),
  ];
  // Markierung der Schneide im mittleren Diagramm als Text
  nodes[1].append(text(140, 58 + 2 * 18 + 28, 'fg-small fg-shu', 'Kreis: Schneide'));
  return frame(id, 'Drei Rost-Stufen im Klingen-Querschnitt', 'Drei schematische Querschnitte: komplett rostfreie Klinge, teilweise rostfreie Klinge mit Kohlenstoffstahl-Kern und -Schneide, und nicht rostfreie Klinge aus Kohlenstoffstahl mit Patina.', 3 * ROW + 46, nodes, c);
}

// 2) Bauweise
function construction(c) {
  const id = 'f-bau';
  const hatch = `url(#${id}-hatch)`;
  const solid = s('polygon', { points: SHAPES.ryoba, class: 'fg-soft' });
  const wari = [s('polygon', { points: SHAPES.ryoba, class: 'fg-soft' }), s('polygon', { points: '40,0 60,0 60,52 50,115 40,52', fill: hatch, class: 'fg-hard-edge' })];
  const kasumi = [s('polygon', { points: SHAPES.kataba, class: 'fg-soft' }), s('polygon', { points: '20,36 36,36 36,98 20,115', fill: hatch, class: 'fg-hard-edge' })];
  const nodes = [
    row(0, shape(30, 20, 1, solid, {}), ['Monostahl'], ['Die ganze Klinge besteht', 'aus einem einzigen Stahl.'], null),
    row(1, shape(30, 20, 1, wari, {}), ['Warikomi ', { ja: '割込' }], ['Harter Kern liegt zwischen', 'zwei Lagen weicherem Stahl.'], null),
    row(2, shape(30, 20, 1, kasumi, {}), ['Kasumi ', { ja: '霞' }], [['Hartstahl (', { ja: '鋼' }, ') auf weichem'], ['Eisen (', { ja: '地金' }, '); Schneide hart.']]),
    legend(3 * ROW, [['fg-swatch-hard', 'Hartstahl', 110], ['fg-swatch-soft', 'weicherer Stahl / Eisen', 160]]),
  ];
  return frame(id, 'Drei Bauweisen im Klingen-Querschnitt', 'Drei schematische Querschnitte: Monostahl aus einem Stahl, Warikomi mit hartem Kern zwischen zwei weicheren Lagen, und Kasumi mit einer Hartstahl-Schicht auf weichem Eisen.', 3 * ROW + 46, nodes, c);
}

// 3) Schliff
function bevel(c) {
  const id = 'f-schliff';
  const ryoba = s('polygon', { points: SHAPES.ryoba, class: 'fg-soft' });
  const kataba = s('polygon', { points: SHAPES.urasuki, class: 'fg-soft' });
  const mirror = (n) => s('g', { transform: 'translate(100 0) scale(-1 1)' }, s('polygon', { points: SHAPES.kataba, class: 'fg-soft' }));
  const hand = s(
    'g',
    {},
    shape(8, 20, 0.5, s('polygon', { points: SHAPES.kataba, class: 'fg-soft' }), { cut: '' }),
    shape(66, 20, 0.5, mirror(), { cut: '', spine: false }),
    text(33, 20 + 57 + 16, 'fg-small fg-ink', 'rechts', { 'text-anchor': 'middle' }),
    text(91, 20 + 57 + 16, 'fg-small fg-ink', 'links', { 'text-anchor': 'middle' })
  );
  const nodes = [
    row(0, shape(30, 20, 1, ryoba, {}), ['Ryōba ', { ja: '両刃' }, ': beidseitig'], ['Fase auf beiden Seiten; die', 'Klinge ist symmetrisch.'], 'Händigkeit: egal.'),
    row(1, shape(30, 20, 1, kataba, {}), ['Kataba ', { ja: '片刃' }, ': einseitig'], ['Fase nur auf einer Seite, die', 'Rückseite ist flach oder', ['hohlgeschliffen (urasuki ', { ja: '裏すき' }, ').']]),
    row(2, hand, 'Händigkeit', ['Einseitige Messer sind nicht', 'symmetrisch: Standard ist die', 'Rechtshänder-Ausführung, für', 'Linkshänder gibt es gespiegelte.']),
  ];
  return frame(id, 'Beidseitiger und einseitiger Schliff im Querschnitt', 'Schematische Querschnitte: Ryōba mit Fase auf beiden Seiten, Kataba mit Fase auf einer Seite und flacher oder hohler Rückseite (Urasuki), sowie die gespiegelte Ausführung für Linkshänder.', 3 * ROW, nodes, c);
}

const BUILDERS = { 'rust-tiers': rustTiers, construction, bevel };
export const FIGURE_IDS = Object.keys(BUILDERS);

export function figure(id, caption) {
  const build = BUILDERS[id];
  return build ? build(caption) : null;
}
