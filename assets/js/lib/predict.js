// Alltags-Einschätzung je Messer: Schätzungen nach festen, dokumentierten Regeln – reine Logik ohne DOM (in Node testbar).
//
// Grundsatz
//  * Das sind Schätzungen, keine Messungen und keine Herstellerangaben. Jede Schätzung nennt Grund und Quelle; die Regeln stehen
//    in der Messerkunde (Abschnitt „So entsteht die Einschätzung“) und werden dort aus den Konstanten dieser Datei erzeugt.
//  * Sterne zeigen die Lage im Katalog (5 = oberes Ende, 1 = unteres Ende), nicht eine absolute Güte. Die Schwellen sind so gesetzt,
//    dass sich die Stähle des Katalogs auf mehrere Stufen verteilen – nur so werden Unterschiede zwischen Messern sichtbar.
//  * Ohne bekannte Stahlsorte (Sammelbezeichnungen wie „Molybdenum Steel“) gibt es keine Schätzung zu Härte, Schärfen und Ausbrüchen.
//  * Nicht geschätzt: Schärfe ab Werk, Gewicht, Balance, Klingendicke und -höhe – der Katalog nennt sie nicht.
import { knifeHardness, hardnessNote, steelSharpening, compareInClass, priceSentence, hrcText } from './insights.js';

export const STAR_MAX = 5;

/** Schwellen der mittleren Härte (HRC) für 1–5 Sterne Schnitthaltigkeit; Gegenpol: Ausbruch-Festigkeit und Schärfbarkeit. */
export const EDGE_BREAKS = [58.5, 59.5, 61.5, 63.5];
/** Rost-Klasse laut Katalog → Sterne. */
export const RUST_STARS = { full: 5, clad: 3, none: 1 };
/** Einstufung des Typs (taxonomy.types.<id>.level) → Sterne für die Eingewöhnung (5 = kaum Umstellung). */
export const ADAPT_STARS = { 1: 5, 2: 3, 3: 1 };
/** Mindest-Anzahl anderer Messer desselben Typs für den Preisvergleich (wie in insights.js). */
export const MIN_PRICE_PEERS = 5;

const UNSPECIFIED = new Set(['unknown', 'stainless-unspecified', 'carbon-unspecified']);
const bucket = (value, breaks) => 1 + breaks.filter((b) => value >= b).length;
const clamp = (n) => Math.min(STAR_MAX, Math.max(1, n));
const num1 = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

/** Skalen: id, Name, Leitfrage, was 5 Sterne bedeuten, ob Schätzung oder Katalogangabe. */
export const KPI_DEFS = [
  { id: 'edge', label: 'Schnitthaltigkeit', ask: 'Wie lange bleibt die Schneide scharf?', five: 'Schneide bleibt am längsten scharf', kind: 'estimate', basis: 'Härte-Richtwert der Stahlsorte' },
  { id: 'sharpen', label: 'Schärfbarkeit', ask: 'Wie gut lässt sich die Schneide nachschärfen?', five: 'am leichtesten nachzuschärfen', kind: 'estimate', basis: 'Stahlsorte, Härte und Schliff' },
  { id: 'tough', label: 'Ausbruch-Festigkeit', ask: 'Wie gut hält die Schneide Belastung aus, ohne auszubrechen?', five: 'Ausbrüche am unwahrscheinlichsten', kind: 'estimate', basis: 'Härte-Richtwert, Typ und Spitze' },
  { id: 'rust', label: 'Rostschutz', ask: 'Wie gut ist die Klinge gegen Rost geschützt?', five: 'komplett rostfrei', kind: 'catalog', basis: 'Rost-Klasse laut Katalog' },
  { id: 'adapt', label: 'Eingewöhnung', ask: 'Wie groß ist die Umstellung gegenüber einem europäischen Kochmesser?', five: 'kaum Umstellung', kind: 'estimate', basis: 'Einstufung des Messertyps' },
  { id: 'price', label: 'Preis im Typ', ask: 'Wie günstig ist das Messer im Vergleich zu anderen seines Typs?', five: 'am günstigsten im Typ', kind: 'catalog', basis: 'Preise im Katalog' },
];

/** Regeln als Text (für die Messerkunde): je Skala eine Zeile, aus den Konstanten erzeugt. */
export function kpiRules() {
  const b = EDGE_BREAKS;
  const edge = `Mittlere Härte der Stahlsorte: 1 Stern unter ${num1(b[0])} HRC, 2 Sterne ab ${num1(b[0])}, 3 Sterne ab ${num1(b[1])}, 4 Sterne ab ${num1(b[2])}, 5 Sterne ab ${num1(b[3])} HRC.`;
  return {
    edge,
    sharpen: 'Gegenpol zur Schnitthaltigkeit (6 minus Sterne der Schnitthaltigkeit). Ausnahmen mit Quelle: Weißstahl mindestens 4 Sterne (Ichimonji: trotz Härte relativ leicht schärfbar), Blue Super höchstens 2 Sterne (Feinschliff schwierig). Einseitiger Schliff: 1 Stern Abzug; Brotmesser mit Wellenschliff: 1 Stern.',
    tough: 'Gegenpol zur Schnitthaltigkeit (6 minus Sterne der Schnitthaltigkeit). Abzug von 1 Stern bei Typen und Spitzen mit belegter Empfindlichkeit (Honesuki, Mioroshi, K-Tip-Spitze).',
    rust: 'Komplett rostfrei 5 Sterne, teilweise rostfrei 3, nicht rostfrei 1; 1 Stern Abzug, wenn der Shop selbst „rusts easily“ schreibt.',
    adapt: 'Einstufung des Typs 1 = 5 Sterne (beidseitig geschliffen, kein Spezialmesser), 2 = 3 Sterne (Spezialmesser oder besondere Klingenform), 3 = 1 Stern (einseitig geschliffen).',
    price: `Anteil der übrigen Messer desselben Typs, die teurer sind: je 20 Prozentpunkte ein Stern (mindestens ${MIN_PRICE_PEERS} Vergleichsmesser nötig).`,
  };
}

const stat = (id, stars, text, { sources = [], extra = null } = {}) => {
  const def = KPI_DEFS.find((d) => d.id === id);
  return { id, label: def.label, ask: def.ask, five: def.five, kind: def.kind, basis: def.basis, stars, text, sources: [...new Set(sources)], ...(extra ?? {}) };
};

function noHardness(id, item, data) {
  const note = hardnessNote(item, data);
  if (note) return stat(id, null, `Keine Schätzung: ${note.text}`, { sources: [data.taxonomy.hardnessScale.source] });
  const steel = item.steel && !UNSPECIFIED.has(item.steel.id) ? data.entry('steels', item.steel.id) : null;
  if (!steel) return stat(id, null, 'Keine Schätzung: Der Shop nennt keine genaue Stahlsorte.');
  return stat(id, null, `Keine Schätzung: Zur Stahlsorte „${steel.label ?? item.steel.id}“ liegt keine Härteangabe vor.`);
}

const isSerrated = (type) => type?.group === 'brot';

function edgeKpi(item, data, hard) {
  if (!hard) return noHardness('edge', item, data);
  const stars = bucket(hard.mid, EDGE_BREAKS);
  return stat('edge', stars, `${hrcText(hard.range)} HRC (Klasse „${hard.cls.label}“): ${hard.cls.retention}`, { sources: [data.taxonomy.hardnessScale.source, 'kns-tungsten'] });
}

function chipAdjust(item, data, type) {
  const out = [];
  if (type?.chip) out.push(type.chip);
  if (item.tip === 'kiritsuke' && data.taxonomy.kpi?.chip?.kTip) out.push(data.taxonomy.kpi.chip.kTip);
  return out;
}

function toughKpi(item, data, hard, type) {
  if (!hard) return noHardness('tough', item, data);
  const base = STAR_MAX + 1 - bucket(hard.mid, EDGE_BREAKS);
  const adjust = chipAdjust(item, data, type);
  const stars = clamp(base - adjust.length);
  const scaleText = hard.cls.toughness ?? 'Die Skala sagt zu dieser Klasse nichts; die Schätzung liegt zwischen „weich: verzeiht rauen Umgang“ und „sehr hart: spröder“.';
  const parts = [`${hrcText(hard.range)} HRC (Klasse „${hard.cls.label}“): ${scaleText}`];
  for (const c of adjust) parts.push(`Ein Stern Abzug: ${c.text}`);
  return stat('tough', stars, parts.join(' '), { sources: [data.taxonomy.hardnessScale.source, ...adjust.flatMap((c) => c.sources ?? [])] });
}

function sharpenKpi(item, data, hard, type) {
  if (isSerrated(type)) {
    return stat('sharpen', 1, type.sharpenNote ?? 'Wellenschliff: Die Zähne lassen sich kaum auf dem Wasserstein schärfen.', { sources: ['koi-pankiri'] });
  }
  if (!hard) return noHardness('sharpen', item, data);
  let stars = STAR_MAX + 1 - bucket(hard.mid, EDGE_BREAKS);
  const st = steelSharpening(hard.steel, data.taxonomy);
  const parts = [];
  if (st) {
    if (st.scope === 'steel' && st.level === 'easy') stars = Math.max(stars, 4);
    if (st.scope === 'steel' && st.level === 'harder') stars = Math.min(stars, 2);
    parts.push(st.text);
  } else {
    parts.push('Zu dieser Stahlsorte liegt keine belegte Aussage vor; die Schätzung folgt dem Grundsatz „je verschleißfester, desto schwerer zu schärfen“ (Knife Steel Nerds).');
  }
  const sources = [data.taxonomy.hardnessScale.source, 'kns-tungsten', ...(st?.source ? [st.source] : [])];
  if (item.bevel === 'single') {
    stars -= 1;
    parts.push('Einseitiger Schliff: Händler sehen beim Nachschliff mehr Übungsbedarf als bei beidseitigem Schliff (1 Stern Abzug).');
  }
  return stat('sharpen', clamp(stars), parts.join(' '), { sources });
}

function rustKpi(item, data) {
  const base = RUST_STARS[item.rust];
  if (!base) return stat('rust', null, 'Der Katalog nennt keine Rost-Klasse.');
  const easy = (item.notes ?? []).includes('rusts-easily-per-shop');
  const maker = item.maker ? data.entry('makers', item.maker) : null;
  const text = {
    full: 'Komplett rostfrei: Klinge samt Schneide aus rostfreiem Stahl; vergessenes Abtrocknen wirkt sich weniger aus als bei Kohlenstoffstahl (Japanese Knife Imports).',
    clad: 'Teilweise rostfrei: Der Mantel ist rostfrei, die Schneide besteht aus Kohlenstoffstahl und kann Patina ansetzen oder rosten.',
    none: 'Nicht rostfrei: Kohlenstoffstahl bildet Patina und kann bei Nässe rosten; nach jedem Gebrauch abtrocknen.',
  }[item.rust];
  const parts = [text];
  if (easy) parts.push('Der Shop schreibt „rusts easily“ (1 Stern Abzug).');
  if (maker?.rustNote) parts.push(maker.rustNote);
  return stat('rust', clamp(base - (easy ? 1 : 0)), parts.join(' '), { sources: ['jki-faq', ...(maker?.rustNote ? (maker.sources ?? []) : [])] });
}

function adaptKpi(item, data, type) {
  const stars = ADAPT_STARS[type?.level];
  if (!stars) return stat('adapt', null, 'Für diesen Typ liegt keine Einstufung vor.');
  return stat('adapt', stars, `Einstufung ${type.level} von 3. ${type.levelReason ?? ''}`.trim(), { sources: type.levelSources ?? type.sources ?? [] });
}

function priceKpi(item, data) {
  const cmp = compareInClass(item, data);
  if (!cmp) return stat('price', null, 'Kein Preisvergleich: Nur Haushaltsmesser werden mit ihrem Typ verglichen.');
  const p = cmp.price;
  if (!p || p.n < MIN_PRICE_PEERS) return stat('price', null, `Kein Preisvergleich: Zu wenige andere ${cmp.typeLabel} im Katalog.`);
  const pricier = (p.n - p.below - p.ties + p.ties / 2) / p.n; // Anteil der übrigen Messer, die teurer sind (Gleichstände halb)
  return stat('price', clamp(1 + Math.floor(pricier * STAR_MAX)), priceSentence(cmp));
}

/** Eignung je Aufgabe aus den Gewichten des Typs (taxonomy.types.<id>.tasks): Gewicht × 5, gerundet. */
export function taskStars(item, data, min = 0.3) {
  const type = item.type ? data.entry('types', item.type) : null;
  const weights = type?.tasks;
  if (!weights) return [];
  return Object.entries(weights)
    .filter(([id, w]) => Number(w) >= min && data.taxonomy.tasks?.[id])
    .sort((a, b) => b[1] - a[1])
    .map(([id, w]) => ({ id, label: data.taxonomy.tasks[id].label, stars: clamp(Math.round(Number(w) * STAR_MAX)) }));
}

/**
 * Einschätzung eines Messers: { kpis[], tasks[], summary: { strengths[], limits[] }, notEstimated[] } oder null (kein Messer).
 * stars = 1–5 oder null (keine Schätzung möglich, Grund steht in text).
 */
export function estimateKpis(item, data) {
  if (item.category !== 'knife') return null;
  const type = item.type ? data.entry('types', item.type) : null;
  const hard = knifeHardness(item, data);
  const kpis = [edgeKpi(item, data, hard), sharpenKpi(item, data, hard, type), toughKpi(item, data, hard, type), rustKpi(item, data), adaptKpi(item, data, type), priceKpi(item, data)];
  const strengths = kpis.filter((k) => k.stars != null && k.stars >= 4).map((k) => k.label);
  const limits = kpis.filter((k) => k.stars != null && k.stars <= 2).map((k) => k.label);
  return { kpis, tasks: taskStars(item, data), summary: { strengths, limits }, notEstimated: ['Schärfe ab Werk', 'Gewicht und Balance', 'Klingendicke und -höhe'] };
}

/** Für den Vergleich: je Skala höchster und niedrigster Wert und wer vorne liegt. items → [{ item, est }] */
export function compareRows(entries) {
  return KPI_DEFS.map((def) => {
    const cells = entries.map(({ item, est }) => ({ item, kpi: est?.kpis.find((k) => k.id === def.id) ?? null }));
    const known = cells.filter((c) => c.kpi?.stars != null);
    const max = known.length ? Math.max(...known.map((c) => c.kpi.stars)) : null;
    const min = known.length ? Math.min(...known.map((c) => c.kpi.stars)) : null;
    const spread = max != null && known.length >= 2 ? max - min : 0;
    return { def, cells, max, min, spread, best: spread > 0 ? known.filter((c) => c.kpi.stars === max).map((c) => c.item) : [] };
  });
}
