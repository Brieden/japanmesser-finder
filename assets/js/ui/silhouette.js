// Messer-Silhouetten (Seitenansicht, Griff links, Spitze rechts, Schneide unten, Rücken oben).
//
//   silhouette(typeId, { width = 160, title = '' }) → <svg class="sil">   (dekorativ; mit title → role="img")
//   silhouetteRow(typeIds, { width = 640, title = '' }) → <svg class="sil sil--row">  (Größenvergleich, gemeinsamer Maßstab)
//   SILHOUETTE_META[typeId] = { lengthMm, heightMm }                      (Klingenmaße der gezeichneten Form)
//
// Maßstab: 1 SVG-Einheit = 1 mm. Der Griff (Wa, 125 x 22 mm) ist bei allen Typen gleich und
// bündig mit dem Klingenrücken. Stil: Klinge = currentColor, Griff = var(--ink-3) über CSS.
import { h } from '../dom.js';

const HANDLE_LEN = 125;
const HANDLE_H = 22;
const PAD = 1;
const ROW_GAP = 12;
const HANDLE_D = `M0 4 Q0 0 5 0 H${HANDLE_LEN + 2} V${HANDLE_H} H10 Q0 ${HANDLE_H - 1} 0 ${HANDLE_H - 5} Z`;

const r = (n) => Math.round(n * 10) / 10;

// Spitze am Rücken abfallend, Schneide mit Bauch. ds = Länge der Rückenkurve, ty = Spitzenhöhe (Anteil H), bel = Länge des Schneidenbauchs
const pointed = ({ ds, ty, bel }) => (L, H) =>
  `M0 0 H${r(L - ds)} Q${r(L - ds * 0.3)} 0 ${L} ${r(ty * H)} C${r(L - bel * 0.15)} ${r(ty * H + (H - ty * H) * 0.8)} ${r(L - bel * 0.6)} ${H} ${r(L - bel)} ${H} H0 Z`;

// Rechteckige Klinge mit leicht gerundeten Ecken (cr) und optionaler Schräge der Stirn (slant)
const boxy = ({ cr = 3, slant = 0 }) => (L, H) =>
  `M0 0 H${r(L - cr)} Q${L} 0 ${L} ${cr} L${r(L - slant)} ${r(H - cr)} Q${r(L - slant)} ${H} ${r(L - slant - cr)} ${H} H0 Z`;

// Honesuki/Garasuki: Dreieck, Rücken fällt gerade zur tiefen Spitze ab
const triangle = ({ from, ty, bel }) => (L, H) =>
  `M0 0 H${r(L * from)} L${L} ${r(ty * H)} Q${r(L - 2)} ${H} ${r(L - bel)} ${H} H0 Z`;

const SHAPES = {
  gyuto: { L: 210, H: 48, d: pointed({ ds: 80, ty: 0.62, bel: 130 }) },
  santoku: {
    L: 170, H: 46,
    d: (L, H) => `M0 0 H${L - 55} C${L - 22} 0 ${L} ${r(H * 0.2)} ${L} ${r(H * 0.52)} Q${L} ${r(H * 0.9)} ${L - 28} ${H} H0 Z`,
  },
  bunka: {
    L: 170, H: 47,
    d: (L, H) => `M0 0 H${L - 42} L${L} ${r(H * 0.26)} L${L - 3} ${r(H * 0.62)} Q${L - 8} ${H} ${L - 40} ${H} H0 Z`,
  },
  kiritsuke: {
    L: 240, H: 45,
    d: (L, H) => `M0 0 H${L - 4} Q${L} 0 ${L} 4 L${L - 38} ${H} H0 Z`,
  },
  petty: { L: 135, H: 30, d: pointed({ ds: 55, ty: 0.5, bel: 85 }) },
  paring: { L: 90, H: 22, d: pointed({ ds: 36, ty: 0.5, bel: 55 }) },
  nakiri: { L: 170, H: 50, d: boxy({ cr: 3 }) },
  usuba: { L: 195, H: 52, d: boxy({ cr: 2 }) },
  sujihiki: { L: 270, H: 32, d: pointed({ ds: 110, ty: 0.55, bel: 140 }) },
  honesuki: { L: 150, H: 32, d: triangle({ from: 0.38, ty: 0.78, bel: 30 }) },
  garasuki: { L: 180, H: 42, d: triangle({ from: 0.3, ty: 0.8, bel: 34 }) },
  yanagiba: {
    L: 270, H: 32,
    d: (L, H) => `M0 0 H${L - 2} Q${L} 0 ${L} 2 Q${L - 25} ${r(H * 0.9)} ${L - 110} ${H} H0 Z`,
  },
  takohiki: { L: 270, H: 31, d: boxy({ cr: 2, slant: 3 }) },
  fuguhiki: {
    L: 270, H: 28,
    d: (L, H) => `M0 0 H${L - 2} Q${L} 0 ${L} 2 Q${L - 25} ${r(H * 0.9)} ${L - 110} ${H} H0 Z`,
  },
  deba: { L: 165, H: 55, d: pointed({ ds: 115, ty: 0.58, bel: 55 }) },
  'ai-deba': { L: 150, H: 45, d: pointed({ ds: 95, ty: 0.58, bel: 55 }) },
  mioroshi: { L: 210, H: 50, d: pointed({ ds: 70, ty: 0.55, bel: 60 }) },
  bread: {
    L: 230, H: 32,
    d: (L, H) => {
      let s = `M0 0 H${L - 6} Q${L} 0 ${L} 6 V${H - 6} Q${L} ${H} ${L - 6} ${H}`;
      const w = 6;
      const n = Math.floor((L - 10) / w);
      let x = L - 6;
      for (let i = 0; i < n; i++) {
        s += ` L${r(x - w / 2)} ${H - 3.5} L${r(x - w)} ${H}`;
        x -= w;
      }
      return `${s} H0 Z`;
    },
  },
  cleaver: {
    L: 220, H: 95,
    d: (L, H) => `M0 0 H${L - 5} Q${L} 0 ${L} 5 V${H - 6} Q${L} ${H} ${L - 6} ${H} H0 Z M${L - 22} 12 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 Z`,
    evenodd: true,
  },
};
const GENERIC = { L: 180, H: 40, d: pointed({ ds: 70, ty: 0.55, bel: 100 }) };

export const SILHOUETTE_META = Object.fromEntries(Object.entries(SHAPES).map(([id, s]) => [id, { lengthMm: s.L, heightMm: s.H }]));

const shapeOf = (typeId) => (Object.prototype.hasOwnProperty.call(SHAPES, typeId) ? SHAPES[typeId] : GENERIC);

// Pfade eines Typs in Koordinaten ab (0,0); Klinge um HANDLE_LEN nach rechts verschoben
function parts(typeId, dy = 0) {
  const s = shapeOf(typeId);
  const attrs = (x, y) => ({ transform: `translate(${x} ${y})` });
  return {
    w: HANDLE_LEN + s.L,
    h: Math.max(s.H, HANDLE_H),
    nodes: [
      h('path', { class: 'sil__handle', d: HANDLE_D, ...(dy ? attrs(0, dy) : {}) }),
      h('path', { class: 'sil__blade', d: s.d(s.L, s.H), ...(s.evenodd ? { 'fill-rule': 'evenodd' } : {}), ...attrs(HANDLE_LEN, dy) }),
    ],
  };
}

const a11y = (title) => (title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true', focusable: 'false' });

export function silhouette(typeId, { width = 160, title = '' } = {}) {
  const p = parts(typeId);
  const vw = p.w + 2 * PAD;
  const vh = p.h + 2 * PAD;
  return h(
    'svg',
    { class: 'sil', viewBox: `${-PAD} ${-PAD} ${vw} ${vh}`, width, height: Math.round((width * vh) / vw), ...a11y(title) },
    ...p.nodes
  );
}

// Mehrere Typen untereinander, linksbündig (Griffenden fluchten), im gemeinsamen Maßstab.
export function silhouetteRow(typeIds, { width = 640, title = '' } = {}) {
  const ids = Array.isArray(typeIds) ? typeIds : [];
  let y = 0;
  let maxW = HANDLE_LEN + 1;
  const nodes = [];
  ids.forEach((id, i) => {
    const p = parts(id, y);
    nodes.push(...p.nodes);
    maxW = Math.max(maxW, p.w);
    y += p.h + (i < ids.length - 1 ? ROW_GAP : 0);
  });
  const vw = maxW + 2 * PAD;
  const vh = Math.max(y, 1) + 2 * PAD;
  return h(
    'svg',
    { class: 'sil sil--row', viewBox: `${-PAD} ${-PAD} ${vw} ${vh}`, width, height: Math.round((width * vh) / vw), ...a11y(title) },
    ...nodes
  );
}
