// „Sichere Wahl“ für die Startseite: wenige Messer, mit denen man laut unserer Einschätzung wenig falsch macht – nach Stufen und mit
// Preis-Leistung. Reine Logik ohne DOM (in Node testbar). Grundlage sind die Schätzungen aus lib/predict.js.
//
// Annahmen für die Auswahl (stehen auch auf der Startseite und in der Messerkunde): kocht vegetarisch (viel Gemüse), schärft nicht
// selbst und pflegt ohne besondere Sorgfalt, kennt kein einseitig geschliffenes Messer, kauft in der Schweiz ein (CHF, Freigrenze).
//
// Zwei Kennzahlen:
//  * Sorglos      = niedrigster Wert der fünf Alltags-Skalen (kein schwacher Punkt).
//  * Preis-Leistung = Anteil der gleichwertigen Messer der Auswahl, die weniger kosten (5 Sterne: höchstens knapp jedes fünfte).
// Ehrlicher Hinweis: Bei den sorglosen Messern kauft Mehrpreis nach unseren Skalen keine bessere Leistung, sondern Ausstattung
// (Damast, Hammerschlag, Holzgriff). Darum erscheint eine teurere Stufe nur, wenn sie mehr Ausstattung oder eine bessere Wertung bietet.
import { estimateKpis, taskStars } from './predict.js';
import { highlights } from './insights.js';
import { convert } from '../format.js';

export const CURRENCY = 'CHF';
/** Preisstufen in CHF (Standardgröße); die letzte reicht bis zur Wertfreigrenze der Schweiz (site.json: customs.CH.limit). */
export const TIERS = [
  { id: 'einstieg', level: 'Einstieg', minChf: 0, maxChf: 120 },
  { id: 'kocht-gern', level: 'Kocht gern', minChf: 120, maxChf: 200 },
  { id: 'zum-schenken', level: 'Zum Schenken', minChf: 200, maxChf: null },
];
export const EXPERT = { id: 'kennt-sich-aus', level: 'Kennt sich aus' };
const DEFAULT_LIMIT_CHF = 300;

/** Typen, die für die Auswahl in Frage kommen (Gemüse-Eignung wird danach geprüft). */
const TYPES = new Set(['santoku', 'nakiri', 'gyuto']);
/** Standardlänge ± Toleranz in mm: keine Mini- oder Riesen-Varianten. */
const SIZE_BELOW = 15;
const SIZE_ABOVE = 30;
/** Hammerschlag: laut Händlern bleibt weniger Schnittgut haften (Kireaji, Chef Knives To Go) – für Gemüse ein halber Stern. */
const TSUCHIME_BONUS = 0.5;
const SAFE_SCALES = ['edge', 'sharpen', 'tough', 'rust', 'adapt'];
const CARE_SCALES = ['edge', 'sharpen', 'tough', 'adapt']; // Stufe „Kennt sich aus“: Pflege (Rost) wird in Kauf genommen
const clamp = (n) => Math.min(5, Math.max(1, n));

const cache = new WeakMap();

function standardSize(item, data) {
  const t = data.entry('types', item.type)?.typicalMm;
  const mid = t ? (t[0] + t[1]) / 2 : null;
  const candidates = item.sizes.map((size, index) => ({ size, index })).filter((x) => x.size.available && x.size.priceJpy != null);
  if (!candidates.length) return null;
  if (mid != null) candidates.sort((a, b) => Math.abs((a.size.mm ?? 0) - mid) - Math.abs((b.size.mm ?? 0) - mid));
  const best = candidates[0];
  const sizeOk = !t || (best.size.mm != null && best.size.mm >= t[0] - SIZE_BELOW && best.size.mm <= t[1] + SIZE_ABOVE);
  return { ...best, sizeOk };
}

function features(item, data) {
  const out = [];
  const finish = item.finish ?? [];
  if (finish.includes('damascus')) out.push('Damast-Muster');
  if (finish.includes('tsuchime')) out.push('Hammerschlag (Tsuchime)');
  if (finish.includes('nashiji')) out.push('Nashiji-Oberfläche');
  if (finish.includes('kurouchi')) out.push('Kurouchi-Oberfläche');
  if (item.grip?.style === 'wa') out.push(item.grip.material && item.grip.material !== 'steel' ? `Wa-Griff aus ${data.t('handleMaterials', item.grip.material)}` : 'Wa-Griff');
  return out;
}

const stat = (values) => (values.some((v) => v == null) ? { min: 0, mean: 0 } : { min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length });

/** Alle Haushaltsmesser mit Schätzung, Standardgröße und Kennzahlen (einmal je data-Objekt). */
function rows(data) {
  if (cache.has(data)) return cache.get(data);
  const out = [];
  for (const item of data.knives) {
    if (item.segment !== 'home' || item.bevel !== 'double' || !item.available || !TYPES.has(item.type)) continue;
    const std = standardSize(item, data);
    if (!std || !std.sizeOk) continue;
    const est = estimateKpis(item, data);
    const st = Object.fromEntries(est.kpis.map((k) => [k.id, k.stars]));
    const tasks = Object.fromEntries(est.tasks.map((t) => [t.id, t.stars]));
    const jpyPrice = std.size.priceJpy;
    out.push({
      item,
      est,
      st,
      size: std.size,
      sizeIndex: std.index,
      jpy: jpyPrice,
      chf: convert(jpyPrice, CURRENCY, data.rates),
      gem: (tasks.gemuese ?? 0) + ((item.finish ?? []).includes('tsuchime') ? TSUCHIME_BONUS : 0),
      all: tasks.allround ?? 0,
      features: features(item, data),
      safe: stat(SAFE_SCALES.map((id) => st[id])),
      care: stat(CARE_SCALES.map((id) => st[id])),
      flagged: (item.flags ?? []).some((f) => /^(steel-family-conflict|left-signal-mismatch)/.test(String(f))),
    });
  }
  cache.set(data, out);
  return out;
}

const safeGate = (r) => !r.flagged && r.item.rust === 'full' && r.st.rust === 5 && r.st.adapt === 5 && r.safe.min >= 3 && r.all >= 4 && r.gem >= 4;
const careGate = (r) => !r.flagged && r.st.adapt === 5 && r.st.edge >= 4 && r.st.sharpen >= 3 && r.st.tough >= 2 && r.gem >= 4;

/** Preis-Leistung (1–5): Anteil der gleichwertigen Messer (gleiche oder bessere Wertung und Gemüse-Eignung), die weniger kosten. */
function valueStars(x, pool, scoreOf) {
  const peers = pool.filter((y) => scoreOf(y) >= scoreOf(x) && y.gem >= x.gem);
  const cheaper = peers.filter((y) => y.chf < x.chf).length;
  return clamp(5 - Math.floor((cheaper / peers.length) * 5));
}

const byHandle = (a, b) => a.item.handle.localeCompare(b.item.handle);
const cmpSafe = (a, b) => b.safe.min - a.safe.min || b.gem - a.gem || b.features.length - a.features.length || b.plSafe - a.plSafe || b.safe.mean - a.safe.mean || a.chf - b.chf || byHandle(a, b);
const cmpCare = (a, b) => b.care.mean - a.care.mean || b.gem - a.gem || b.plCare - a.plCare || b.features.length - a.features.length || a.chf - b.chf || byHandle(a, b);

const LEADS = [/^Komplett rostfrei/, /^Härte ca\./, /^Hammerschlag/, /^Wa-Griff/];
function reasonsOf(item, data) {
  const all = highlights(item, data);
  return LEADS.map((rx) => all.find((h) => rx.test(h.lead))).filter(Boolean);
}

function toPick(x, data, extra, pl) {
  return { ...extra, item: x.item, size: x.size, sizeIndex: x.sizeIndex, jpy: x.jpy, chf: x.chf, est: x.est, sorglos: x.safe.min, mean: x.safe.mean, careMean: x.care.mean, gem: x.gem, pl, features: x.features, reasons: reasonsOf(x.item, data) };
}

/**
 * Auswahl: { tiers: [{ tier, pick }], expert, dropped: [tier], limitChf, pool: { safe, care } }.
 * Eine teurere Stufe erscheint nur, wenn ihr Messer mehr Ausstattung oder eine bessere Wertung hat als das der Stufe davor.
 */
export function sichereWahl(data) {
  const limit = data.site?.customs?.CH?.limit ?? DEFAULT_LIMIT_CHF;
  const all = rows(data);
  const safe = all.filter(safeGate);
  for (const x of safe) x.plSafe = valueStars(x, safe, (y) => y.safe.min);
  const care = all.filter(careGate);
  for (const x of care) x.plCare = valueStars(x, care, (y) => y.care.mean);

  const tiers = [];
  const dropped = [];
  let prev = null;
  TIERS.forEach((tier, i) => {
    const max = tier.maxChf ?? limit;
    const last = i === TIERS.length - 1;
    const band = safe.filter((x) => x.chf >= tier.minChf && (last ? x.chf <= max : x.chf < max)).sort(cmpSafe);
    const best = band[0];
    if (!best) return;
    const adds = !prev || best.features.length > prev.features.length || best.safe.min > prev.safe.min || best.gem > prev.gem;
    if (!adds) {
      dropped.push({ ...tier, maxChf: max, pick: toPick(best, data, { tier: { ...tier, maxChf: max } }, best.plSafe) });
      return;
    }
    const pick = toPick(best, data, { tier: { ...tier, maxChf: max } }, best.plSafe);
    if (prev) {
      const same = SAFE_SCALES.every((id) => prev.st[id] === best.st[id]);
      const added = best.features.filter((f) => !prev.features.includes(f));
      pick.upgrade = { sameStars: same, added };
    }
    tiers.push({ tier: pick.tier, pick });
    prev = best;
  });

  const expertBest = care.sort(cmpCare)[0];
  const expert = expertBest ? toPick(expertBest, data, { tier: { ...EXPERT, maxChf: limit } }, expertBest.plCare) : null;
  // Höchster „Sorglos“-Wert, den irgendein Messer des Katalogs erreicht (Härte und Robustheit sind gegenläufig, daher meist 3)
  const maxSorglos = Math.max(0, ...all.filter((r) => r.item.rust === 'full').map((r) => r.safe.min));
  return { tiers, expert, dropped, limitChf: limit, maxSorglos, pool: { safe: safe.length, care: care.length } };
}

/** Regeln als Text (für Startseite und Messerkunde), aus den Konstanten erzeugt. */
export function pickRules(limitChf = DEFAULT_LIMIT_CHF) {
  const bands = TIERS.map((t, i) => (i === 0 ? `${t.level}: bis ${t.maxChf} CHF` : `${t.level}: ${t.minChf}–${t.maxChf ?? limitChf} CHF`));
  return {
    assumptions: [
      'Kocht vegetarisch: viel Gemüse, kein Fisch oder Fleisch zu zerlegen. Verlangt wird mindestens 4 von 5 Sternen Eignung fürs Gemüse (Hammerschlag zählt einen halben Stern mehr, weil laut Händlern weniger Schnittgut haften bleibt).',
      'Schärft nicht selbst und pflegt ohne besondere Sorgfalt: komplett rostfrei (5 Sterne Rostschutz) und auf keiner der fünf Alltags-Skalen unter 3 Sternen.',
      'Kennt kein einseitig geschliffenes Messer: beidseitig geschliffen (5 Sterne Eingewöhnung) und ein Allrounder (mindestens 4 von 5 Sternen Eignung für den Alltag).',
      `Kauft in der Schweiz ein: Preise in CHF zum Kurs der Seite, Obergrenze ${limitChf} CHF (Wertfreigrenze pro Person und Tag, nur Orientierung).`,
      `Standardlänge des Typs (Toleranz −${SIZE_BELOW} bis +${SIZE_ABOVE} mm), laut Katalog vorrätig, Stahlsorte bekannt (sonst gibt es keine Schätzung).`,
    ],
    kpis: [
      ['Sorglos', 'Niedrigster Wert der fünf Alltags-Skalen (Schnitthaltigkeit, Schärfbarkeit, Ausbruch-Festigkeit, Rostschutz, Eingewöhnung): „kein schwacher Punkt“.'],
      ['Preis-Leistung', 'Anteil der gleichwertigen Messer der Auswahl (gleiche oder bessere Sorglos- und Gemüse-Wertung), die weniger kosten. 5 Sterne: höchstens knapp jedes fünfte ist günstiger; jede weiteren 20 Prozentpunkte kosten einen Stern.'],
    ],
    selection: [
      `Stufen nach Preis der Standardgröße: ${bands.join('; ')}.`,
      'In jeder Stufe gewinnt das Messer mit der besten Sorglos-Wertung, dann der besten Gemüse-Eignung, dann der meisten Ausstattung (Damast, Hammerschlag, Holzgriff), dann dem besten Preis-Leistungs-Wert und zuletzt dem niedrigsten Preis.',
      'Eine teurere Stufe erscheint nur, wenn ihr Messer mehr Ausstattung oder eine bessere Wertung hat als das der Stufe davor. Bei den sorglosen Messern kauft Mehrpreis laut unseren Skalen keine bessere Leistung, sondern Ausstattung.',
      '„Kennt sich aus“: Hier ist Pflege in Ordnung (Kohlenstoffstahl möglich). Verlangt werden mindestens 4 Sterne Schnitthaltigkeit, 3 Sterne Schärfbarkeit und 2 Sterne Ausbruch-Festigkeit; es gewinnt der beste Mittelwert dieser Skalen.',
    ],
  };
}
