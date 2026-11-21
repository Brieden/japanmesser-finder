// Vergleiche im Katalog und belegte Besonderheiten je Messer – reine Logik ohne DOM (in Node testbar).
//
// Grundsatz: Es wird nichts geschätzt, was die Quellen nicht hergeben.
//  * Schärfe selbst (Geometrie, Schliff ab Werk) ist im Katalog nicht bekannt → keine Sterne dafür.
//  * Belegt sind: typische Härte der Stahlsorte (HRC), Aussagen von Herstellern/Händlern je Stahl und die Härte-Skala
//    von Knives and Stones. Daraus entstehen Einordnungen wie „härter als 80 % der anderen Gyuto im Katalog“.
//  * Fehlt die Stahlsorte (Sammelbezeichnungen wie „Molybdenum Steel“), gibt es keine Einordnung.
import { jpy } from '../format.js';

const cache = new WeakMap();

export const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const hrcRange = (steel) => (Array.isArray(steel?.hardnessHrc) && steel.hardnessHrc.length === 2 ? steel.hardnessHrc : null);
export const hrcMid = (range) => (range ? (range[0] + range[1]) / 2 : null);
/** Spannen über mehr als 4 HRC (z. B. Molybdän-Vanadium: 54–60) sind für eine Einordnung zu breit. */
export const HRC_MAX_WIDTH = 4;
const MAX_WIDTH = HRC_MAX_WIDTH;
export const hrcText = (range) => (range ? (range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`) : '');

/** Härteklasse nach der Skala von Knives and Stones (taxonomy.hardnessScale); unterhalb von 55 gilt „weich“. */
export function hardnessClass(hrc, taxonomy) {
  const classes = taxonomy.hardnessScale?.classes;
  if (hrc == null || !classes?.length) return null;
  let found = classes[0];
  for (const c of classes) if (hrc >= c.min) found = c;
  return found;
}

/** Typische Härte der Stahlsorte eines Messers: { range, mid, cls, steel } oder null (Stahlsorte/Härte nicht bekannt). */
export function knifeHardness(item, data) {
  if (item.category !== 'knife' || !item.steel) return null;
  const steel = data.entry('steels', item.steel.id);
  const range = hrcRange(steel);
  if (!range || range[1] - range[0] > MAX_WIDTH) return null;
  const mid = hrcMid(range);
  return { range, mid, cls: hardnessClass(mid, data.taxonomy), steel };
}

/** Hinweis, wenn die Stahlsorte zwar eine Härtespanne hat, diese aber zu breit für eine Einordnung ist. */
export function hardnessNote(item, data) {
  if (item.category !== 'knife' || !item.steel) return null;
  const range = hrcRange(data.entry('steels', item.steel.id));
  if (!range || range[1] - range[0] <= MAX_WIDTH) return null;
  return { range, text: `Die Händlertabelle nennt für diese Stahlsorte ${hrcText(range)} HRC; die Spanne ist zu breit für eine Einordnung.` };
}

/**
 * Aussage zum Schärfaufwand – nur, wenn belegt:
 *  1. Aussage der Quellen zu genau diesem Stahl (steel.sharpen), sonst
 *  2. bei rostfreien Stählen der Satz zur Härteklasse (Knives and Stones),
 *  3. sonst nichts. (Die Härteklassen-Aussage passt nicht auf Weiß-/Blaustahl: Ichimonji nennt Weißstahl trotz Härte leicht schärfbar.)
 */
export function steelSharpening(steel, taxonomy) {
  const range = hrcRange(steel);
  if (!range || range[1] - range[0] > MAX_WIDTH) return null;
  if (steel.sharpen?.text) return { text: steel.sharpen.text, level: steel.sharpen.level, scope: 'steel', source: steel.sharpen.source };
  const cls = hardnessClass(hrcMid(range), taxonomy);
  if (steel.family === 'stainless' && cls?.sharpening) return { text: `${cls.sharpening} (Härteklasse „${cls.label}“, Knives and Stones)`, level: null, scope: 'class', source: taxonomy.hardnessScale.source };
  return null;
}

export function sharpeningStatement(item, data) {
  const h = knifeHardness(item, data);
  return h ? steelSharpening(h.steel, data.taxonomy) : null;
}

/** Haushaltsmesser des Katalogs mit vorberechneten Vergleichswerten (einmal je data-Objekt). */
function pool(data) {
  if (!cache.has(data)) {
    cache.set(
      data,
      data.knives.filter((k) => k.segment === 'home').map((item) => ({ item, hard: knifeHardness(item, data), price: item.priceFrom }))
    );
  }
  return cache.get(data);
}

const minOf = (a) => (a.length ? Math.min(...a) : null);
const maxOf = (a) => (a.length ? Math.max(...a) : null);

function summarize(rows) {
  const mids = rows.map((r) => r.hard?.mid).filter((v) => v != null);
  const prices = rows.map((r) => r.price).filter((v) => v != null);
  return { n: rows.length, hrcKnown: mids.length, hrcMedian: median(mids), hrcMin: minOf(mids), hrcMax: maxOf(mids), priceMedian: median(prices), priceMin: minOf(prices), priceMax: maxOf(prices) };
}

/** Katalog-Kennzahlen je Messertyp (Haushaltsmesser): Anzahl, Rost-Klassen, Härte, Preis, häufigste Stähle. */
export function typeStats(typeId, data) {
  const rows = pool(data).filter((r) => r.item.type === typeId);
  const rust = { full: 0, clad: 0, none: 0, unknown: 0 };
  const steels = new Map();
  for (const r of rows) {
    rust[r.item.rust ?? 'unknown'] += 1;
    const id = r.item.steel?.id;
    if (id) steels.set(id, (steels.get(id) ?? 0) + 1);
  }
  const topSteels = [...steels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, count]) => ({ id, count }));
  return { ...summarize(rows), rust, topSteels };
}

/** Katalog-Kennzahlen je Rost-Klasse (full | clad | none). */
export function rustClassStats(data) {
  const out = {};
  for (const cls of ['full', 'clad', 'none']) out[cls] = summarize(pool(data).filter((r) => r.item.rust === cls));
  return out;
}

const MIN_COMPARE = 5;
const band = (p, n) => (p == null || n < MIN_COMPARE ? null : p >= 2 / 3 ? 'oberes Drittel' : p <= 1 / 3 ? 'unteres Drittel' : 'mittleres Drittel');
const pct = (x) => Math.round(x * 100);

/**
 * Vergleich eines Messers mit den anderen Haushaltsmessern DESSELBEN Typs im Katalog (Härte und Preis).
 * percentile = (Anzahl mit kleinerem Wert + halbe Gleichstände) / Anzahl der Vergleichsmesser.
 */
export function compareInClass(item, data) {
  if (item.category !== 'knife' || !item.type || item.segment !== 'home') return null;
  const rows = pool(data).filter((r) => r.item.type === item.type);
  const others = rows.filter((r) => r.item.handle !== item.handle);
  const typeLabel = data.t('types', item.type);
  const result = { type: item.type, typeLabel, n: rows.length, hardness: null, price: null };

  const hard = knifeHardness(item, data);
  if (hard) {
    const known = others.filter((r) => r.hard);
    const below = known.filter((r) => r.hard.mid < hard.mid).length;
    const ties = known.filter((r) => r.hard.mid === hard.mid).length;
    const percentile = known.length ? (below + ties / 2) / known.length : null;
    result.hardness = { range: hard.range, mid: hard.mid, cls: hard.cls, nKnown: known.length, below, ties, percentile, band: band(percentile, known.length), median: median(known.map((r) => r.hard.mid)) };
  }

  if (item.priceFrom != null) {
    const priced = others.filter((r) => r.price != null);
    const below = priced.filter((r) => r.price < item.priceFrom).length;
    const ties = priced.filter((r) => r.price === item.priceFrom).length;
    const percentile = priced.length ? (below + ties / 2) / priced.length : null;
    result.price = { value: item.priceFrom, n: priced.length, below, ties, percentile, band: band(percentile, priced.length), median: median(priced.map((r) => r.price)) };
  }
  return result;
}

/** Ein Satz zur Härte im Vergleich, z. B. „Härter als 80 % der übrigen 82 Gyuto mit bekannter Härte (oberes Drittel).“ */
export function hardnessSentence(cmp) {
  const h = cmp?.hardness;
  if (!h) return null;
  if (h.nKnown < MIN_COMPARE) return `Zu wenige andere ${cmp.typeLabel} mit bekannter Härte im Katalog (${h.nKnown}) für einen Vergleich.`;
  const parts = [`Härter als ${pct(h.below / h.nKnown)} % der übrigen ${h.nKnown} ${cmp.typeLabel} mit bekannter Härte`];
  if (h.ties > 0) parts.push(`gleich hart wie ${pct(h.ties / h.nKnown)} %`);
  return `${parts.join(', ')} (${h.band}).`;
}

/** Ein Satz zum Preis im Vergleich, z. B. „Preis ab ¥32.000: günstiger als 60 % der übrigen 116 Gyuto (mittleres Drittel); Median ¥31.000.“ */
export function priceSentence(cmp) {
  const p = cmp?.price;
  if (!p) return null;
  if (p.n < MIN_COMPARE) return null;
  const cheaper = p.n - p.below - p.ties;
  const rel = cheaper >= p.below ? `günstiger als ${pct(cheaper / p.n)} %` : `teurer als ${pct(p.below / p.n)} %`;
  return `Preis ab ${jpy(p.value)}: ${rel} der übrigen ${p.n} ${cmp.typeLabel} (${p.band}); Median ${jpy(Math.round(p.median))}.`;
}

// ───────────────────────────── Besonderheiten je Messer ─────────────────────────────

const WOOD = new Set(['magnolia', 'walnut', 'rosewood', 'ebony', 'oak', 'teak', 'ironwood', 'yew', 'elm', 'mahogany', 'satine', 'zelkova', 'cherry', 'tagayasan', 'wenge', 'hinoki', 'burl', 'wood']);

/**
 * Belegte Besonderheiten: [{ lead, text, sources: [Quellen-IDs] }]. Jede Aussage stammt aus einer Quelle der Messerkunde;
 * die Folge für den Alltag steht im selben Satz. „Bitte beachten“-Hinweise (Rost, Händigkeit, Ausbruch, Lagerstand) stehen in der Detailansicht separat.
 */
export function highlights(item, data) {
  if (item.category !== 'knife') return [];
  const out = [];
  const add = (lead, text, sources = []) => out.push({ lead, text, sources: [...new Set(sources)] });
  const tax = data.taxonomy;
  const hard = knifeHardness(item, data);
  const type = item.type ? data.entry('types', item.type) : null;

  if (item.rust === 'full') {
    add('Komplett rostfrei.', 'Klinge samt Schneide bestehen aus rostfreiem Stahl. Es bildet sich keine Patina, und vergessenes Abtrocknen wirkt sich weniger aus als bei Kohlenstoffstahl, weil rostfreier Stahl weit weniger reaktiv ist (Japanese Knife Imports). In einer geschlossenen, feuchten Umgebung kann aber auch rostfreier Stahl rosten.', ['jki-faq']);
  }

  const wide = !hard ? hardnessNote(item, data) : null;
  if (wide) add('Härte nicht einzuordnen.', wide.text, [tax.hardnessScale.source]);
  if (hard) {
    const { cls, range, steel } = hard;
    const sharp = sharpeningStatement(item, data);
    const scale = [cls.retention, cls.toughness].filter(Boolean).join(' ');
    const sharpText = sharp ? (sharp.scope === 'class' ? cls.sharpening : sharp.text) : null;
    const text = [`Nach der Skala von Knives and Stones: ${scale}`, sharpText, 'Richtwert der Stahlsorte, nicht am einzelnen Messer gemessen.'].filter(Boolean).join(' ');
    add(`Härte ca. ${hrcText(range)} HRC (${cls.label}).`, text, [tax.hardnessScale.source, ...(sharp?.source ? [sharp.source] : [])]);
    for (const f of (steel.facts ?? []).slice(0, 2)) add(`Zum Stahl (${steel.short ?? steel.label}).`, f.t, [f.s]);
  }

  if (item.grip?.style === 'wa') {
    const wood = item.grip.material && WOOD.has(item.grip.material);
    add('Wa-Griff.', `Er wiegt weniger als ein westlicher Griff und verlagert den Schwerpunkt nach vorn zur Klinge; ausgelegt ist er für den Pinch-Grip, bei dem Daumen und Zeigefinger die Klinge direkt vor dem Griff fassen.${item.grip.shape === 'octagonal' ? ' Der achteckige Querschnitt ist symmetrisch.' : ''}${wood ? ' Beim Holzgriff können Hitze, Wasser und Reiniger Größe und Form verändern (Japanese Knife Imports): nicht in die Spülmaschine.' : ''}`, ['cktg-guide', 'jki-faq']);
  } else if (item.grip?.style === 'yo') {
    add('Yō-Griff.', 'Er wiegt mehr als ein Wa-Griff und ist in der Regel vollständig vernietet (Japanese Knife Imports).', ['jki-faq']);
  } else if (item.grip?.style === 'steel') {
    add('Griff aus Edelstahl.', 'Kein Holz, dessen Größe und Form durch Wasser oder Hitze veränderlich ist (Japanese Knife Imports zu Holzgriffen).', ['jki-faq']);
  }

  const finish = item.finish ?? [];
  if (finish.includes('damascus')) add('Damast-Muster.', 'Das Muster liegt im Mantel, die Schneide bildet der Kernstahl (Chef Knives To Go). Wie scharf das Messer wird und wie lange die Schneide hält, bestimmen Kernstahl und Geometrie, nicht das Muster.', ['cktg-damascus']);
  if (finish.includes('tsuchime')) add('Hammerschlag (Tsuchime).', 'Laut Händlern (Kireaji, Chef Knives To Go) bleibt weniger Schnittgut an der Klinge haften.', ['kireaji-hammered', 'cktg-glossary']);
  if (finish.includes('kurouchi')) add('Kurouchi.', 'Die dunkle Schmiedehaut ist Optik und nutzt sich im Gebrauch allmählich ab (Chef Knives To Go).', ['cktg-glossary']);
  if (finish.includes('nashiji')) add('Nashiji („Birnenhaut“).', 'Fein strukturierte Oberfläche; Optik (Chef Knives To Go).', ['cktg-glossary']);

  if (item.tip === 'kiritsuke') add('Kiritsuke-Spitze (K-Tip).', 'Die Spitze ist schräg abgeschnitten und laut Knifewear empfindlicher als eine normale Spitze: nicht zum Aufhebeln benutzen.', ['knifewear-ktip']);

  if (item.type === 'gyuto') {
    const mms = item.sizes.map((s) => s.mm).filter((v) => v != null);
    if (mms.some((v) => v === 210 || v === 240)) add('Gängige Länge.', '21 und 24 cm sind laut Knifewear und Chef Knives To Go die häufigsten Gyuto-Längen; Chef Knives To Go nennt 21 cm die beliebteste Größe für Hobbyköche und den besten Startpunkt.', ['knifewear-shapes', 'cktg-guide']);
    if (mms.some((v) => v >= 270)) add('Lange Klinge.', 'Ab 27 cm gilt das Gyuto laut Chef Knives To Go als Spezialistenbereich für Profis und Enthusiasten, die Reichweite brauchen; als erstes japanisches Messer sei es nicht die richtige Wahl. Die längere Klinge hilft bei großen Gemüsen, Braten und großen Mengen und verlangt ein großes Schneidbrett.', ['cktg-guide']);
  }
  if (item.type === 'santoku') add('Hohe Klinge.', 'Sie hält die Knöchel weit über dem Brett (Korin); das ist für große Hände relevant.', ['korin-santoku']);

  const maker = item.maker ? data.entry('makers', item.maker) : null;
  if (maker?.note) add(`Hersteller: ${data.t('makers', item.maker)}.`, maker.note, maker.sources ?? []);

  return out;
}
