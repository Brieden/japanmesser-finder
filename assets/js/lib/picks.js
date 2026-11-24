// „Sichere Wahl“ für die Startseite: neun Messer in drei Typen und drei Preisstufen, mit Preis-Leistung und einer genauen Gegenüberstellung
// („was ändert sich gegenüber dem günstigeren Messer?“). Reine Logik ohne DOM (in Node testbar). Grundlage sind die Schätzungen aus lib/predict.js.
//
// Annahmen für die Auswahl (stehen auch auf der Startseite und in der Messerkunde): kocht vegetarisch (viel Gemüse), kennt kein einseitig
// geschliffenes Messer, kauft in der Schweiz ein (CHF, Freigrenze). Der Typ („Spalte“) entscheidet über die Leistung, die Preisstufe („Zeile“)
// über Ausstattung und Preis:
//  * Ausgewogen    = komplett rostfrei, keine Skala unter 3 Sternen (schärft nicht selbst, pflegt ohne besondere Sorgfalt).
//  * Robust        = komplett rostfrei, weicher Stahl: Schnitthaltigkeit höchstens 2 Sterne, dafür Schärfbarkeit und Ausbruch-Festigkeit mindestens 4.
//  * Länger scharf = Schneide aus hartem (Kohlenstoff-)Stahl: Schnitthaltigkeit mindestens 4 Sterne, dafür Pflege (Rostschutz darf niedrig sein).
// Die drei Typen schließen einander aus (Schnitthaltigkeit ≤2 / 3 / ≥4): Kein Messer steht in zwei Spalten.
//
// Zwei Kennzahlen:
//  * Sorglos      = niedrigster Wert der fünf Alltags-Skalen (kein schwacher Punkt); aussagekräftig nur beim Typ „Ausgewogen“.
//  * Preis-Leistung = Anteil der gleichwertigen Messer desselben Typs, die weniger kosten (5 Sterne: höchstens knapp jedes fünfte).
// Ehrlicher Hinweis: Innerhalb eines Typs kauft Mehrpreis nach unseren Skalen meist keine bessere Leistung, sondern Ausstattung
// (Damast, Hammerschlag, Holzgriff). Darum zeigt jede Karte, was sich gegenüber der günstigeren Stufe tatsächlich ändert (diffPicks).
import { estimateKpis, KPI_DEFS } from './predict.js';
import { highlights, knifeHardness, hrcText } from './insights.js';
import { convert, cmText } from '../format.js';

export const CURRENCY = 'CHF';
/** Preisstufen in CHF (Standardgröße); die letzte reicht bis zur Wertfreigrenze der Schweiz (site.json: customs.CH.limit). */
export const TIERS = [
  { id: 'einstieg', level: 'Einstieg', minChf: 0, maxChf: 120 },
  { id: 'kocht-gern', level: 'Kocht gern', minChf: 120, maxChf: 180 },
  { id: 'zum-schenken', level: 'Zum Schenken', minChf: 180, maxChf: null },
];
/** Die drei Typen (Spalten); die Reihenfolge ist die Anzeige-Reihenfolge. */
export const LANES = [
  { id: 'ausgewogen', name: 'Ausgewogen', claim: 'Rostfrei, kein schwacher Punkt', who: 'du nicht selbst schärfst und das Messer ohne besondere Sorgfalt pflegst.' },
  { id: 'robust', name: 'Robust', claim: 'Weicher Stahl: leicht nachzuschärfen, verzeiht rauen Umgang', who: 'du ab und zu nachschärfst (oder schärfen lässt) und ein Messer willst, das rauen Umgang verzeiht.' },
  { id: 'scharf', name: 'Länger scharf', claim: 'Harter Stahl: die Schneide hält länger, braucht aber Pflege', who: 'du nach dem Schneiden abtrocknest und auf dem Stein schärfen kannst, damit die Schneide lange scharf bleibt.' },
];
const DEFAULT_LIMIT_CHF = 300;

/** Typen, die für die Auswahl in Frage kommen (Gemüse-Eignung wird danach geprüft). */
const TYPES = new Set(['santoku', 'nakiri', 'gyuto']);
/** Standardlänge ± Toleranz in mm: keine Mini- oder Riesen-Varianten. */
const SIZE_BELOW = 15;
const SIZE_ABOVE = 30;
/** Hammerschlag: laut Händlern bleibt weniger Schnittgut haften (Kireaji, Chef Knives To Go) – für Gemüse ein halber Stern. */
const TSUCHIME_BONUS = 0.5;
const SAFE_SCALES = ['edge', 'sharpen', 'tough', 'rust', 'adapt'];
const CARE_SCALES = ['edge', 'sharpen', 'tough', 'adapt']; // Typ „Länger scharf“: Pflege (Rost) wird in Kauf genommen
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

const isGripFeature = (f) => f.startsWith('Wa-Griff');
/** Griff als Text für die Gegenüberstellung: „Yō-Griff aus Mahagoni“, „Wa-Griff aus Palisander (Shitan)“ … */
function gripText(item, data) {
  const style = item.grip?.style;
  if (!style || style === 'unknown') return null;
  const base = data.entry('handleStyles', style)?.short ?? style;
  const material = item.grip.material && style !== 'steel' ? data.t('handleMaterials', item.grip.material) : null;
  if (material) return `${base} aus ${material}`;
  return style === 'wa' ? `${base} (Holzart nicht angegeben)` : base;
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
      hardMid: knifeHardness(item, data)?.mid ?? 0,
      safe: stat(SAFE_SCALES.map((id) => st[id])),
      care: stat(CARE_SCALES.map((id) => st[id])),
      flagged: (item.flags ?? []).some((f) => /^(steel-family-conflict|left-signal-mismatch)/.test(String(f))),
    });
  }
  cache.set(data, out);
  return out;
}

const safeGate = (r) => !r.flagged && r.item.rust === 'full' && r.st.rust === 5 && r.st.adapt === 5 && r.safe.min >= 3 && r.all >= 4 && r.gem >= 4;
const robustGate = (r) => !r.flagged && r.item.rust === 'full' && r.st.rust === 5 && r.st.adapt === 5 && r.st.edge <= 2 && r.st.sharpen >= 4 && r.st.tough >= 4 && r.all >= 4 && r.gem >= 4;
const scharfGate = (r) => !r.flagged && r.st.adapt === 5 && r.st.edge >= 4 && r.all >= 4 && r.gem >= 4;

/** Bietet x gegenüber dem günstigeren Messer p etwas Zusätzliches? Mehr Ausstattung, bessere Sterne oder ein härterer Stahl (längere Schnitthaltigkeit). */
function addsValue(p, x) {
  return x.features.length > p.features.length || SAFE_SCALES.some((id) => x.st[id] > p.st[id]) || x.hardMid > p.hardMid;
}

/** Preis-Leistung (1–5): Anteil der gleichwertigen Messer (gleiche oder bessere Wertung und Gemüse-Eignung), die weniger kosten. */
function valueStars(x, pool, scoreOf) {
  const peers = pool.filter((y) => scoreOf(y) >= scoreOf(x) && y.gem >= x.gem);
  const cheaper = peers.filter((y) => y.chf < x.chf).length;
  return clamp(5 - Math.floor((cheaper / peers.length) * 5));
}

const byHandle = (a, b) => a.item.handle.localeCompare(b.item.handle);
const cmpSafe = (a, b) => b.safe.min - a.safe.min || b.gem - a.gem || b.features.length - a.features.length || b.hardMid - a.hardMid || b.pl - a.pl || b.safe.mean - a.safe.mean || a.chf - b.chf || byHandle(a, b);
const cmpCare = (a, b) => b.care.mean - a.care.mean || b.gem - a.gem || b.st.edge - a.st.edge || b.pl - a.pl || b.features.length - a.features.length || a.chf - b.chf || byHandle(a, b);

/** Je Typ: Tor, Rangfolge innerhalb einer Preisstufe und Wertung für „Preis-Leistung“. */
const RULES = {
  ausgewogen: { gate: safeGate, cmp: cmpSafe, score: (r) => r.safe.min },
  robust: { gate: robustGate, cmp: cmpSafe, score: (r) => r.safe.min },
  scharf: { gate: scharfGate, cmp: cmpCare, score: (r) => r.care.mean },
};

const LEADS = [/^Komplett rostfrei/, /^Teilweise rostfrei/, /^Nicht rostfrei/, /^Härte ca\./, /^Zum Stahl/, /^Hammerschlag/, /^Kurouchi/, /^Wa-Griff/];
function reasonsOf(item, data, est) {
  const all = highlights(item, data);
  const rust = est.kpis.find((k) => k.id === 'rust');
  if (item.rust && item.rust !== 'full' && rust?.text) all.push({ lead: item.rust === 'clad' ? 'Teilweise rostfrei.' : 'Nicht rostfrei.', text: rust.text, sources: rust.sources ?? [] });
  return LEADS.map((rx) => all.find((h) => rx.test(h.lead))).filter(Boolean);
}

function toPick(x, data, lane, tier) {
  return { lane, tier, item: x.item, size: x.size, sizeIndex: x.sizeIndex, jpy: x.jpy, chf: x.chf, est: x.est, st: x.st, sorglos: x.safe.min, mean: x.safe.mean, careMean: x.care.mean, gem: x.gem, pl: x.pl, features: x.features, reasons: reasonsOf(x.item, data, x.est), diff: null };
}

const SCALE_IDS = ['edge', 'sharpen', 'tough', 'rust', 'adapt'];
const scaleLabel = (id) => KPI_DEFS.find((d) => d.id === id)?.label ?? id;
const starsOf = (pick, id) => pick.est.kpis.find((k) => k.id === id)?.stars ?? null;

/**
 * Unterschiede zweier Auswahlen (prev → cur) als Daten:
 * { deltaChf, scales: [{ id, label, from, to }], same, better, worse, type, mm, steel, grip: { from, to, styleChanged }, added, removed } (added/removed ohne Griff).
 * `same` heißt: Alle fünf Alltags-Skalen haben dieselben Sterne – dann kauft der Mehrpreis keine andere Leistung.
 */
export function diffPicks(prev, cur, data) {
  const scales = SCALE_IDS.map((id) => ({ id, label: scaleLabel(id), from: starsOf(prev, id), to: starsOf(cur, id) })).filter((s) => s.from !== s.to);
  const typeOf = (p) => (p.item.type ? data.t('types', p.item.type) : '');
  const steelOf = (p) => {
    const hard = knifeHardness(p.item, data);
    const label = p.item.steel ? data.entry('steels', p.item.steel.id)?.short ?? p.item.steel.id : '';
    return { id: p.item.steel?.id ?? null, label, hrc: hard ? hrcText(hard.range) : null, cls: hard?.cls.label ?? null };
  };
  const a = steelOf(prev);
  const b = steelOf(cur);
  return {
    deltaChf: cur.chf - prev.chf,
    scales,
    same: scales.length === 0,
    better: scales.filter((s) => s.to > s.from),
    worse: scales.filter((s) => s.to < s.from),
    type: typeOf(prev) !== typeOf(cur) ? { from: typeOf(prev), to: typeOf(cur) } : null,
    mm: prev.size.mm !== cur.size.mm ? { from: prev.size.mm, to: cur.size.mm } : null,
    steel: a.id !== b.id ? { from: a, to: b } : null,
    grip: gripText(prev.item, data) !== gripText(cur.item, data) ? { from: gripText(prev.item, data), to: gripText(cur.item, data), styleChanged: (prev.item.grip?.style ?? null) !== (cur.item.grip?.style ?? null) } : null,
    added: cur.features.filter((f) => !isGripFeature(f) && !prev.features.includes(f)),
    removed: prev.features.filter((f) => !isGripFeature(f) && !cur.features.includes(f)),
  };
}

const money = (v) => `CHF ${Math.abs(Math.round(v))}`;
/** „+CHF 48“ / „−CHF 16“ */
export const signedChf = (v) => `${v < 0 ? '−' : '+'}${money(v)}`;
const names = (list) => list.map((s) => s.label).join(', ');
const hrcPart = (s) => (s.hrc ? ` (${s.hrc} HRC)` : '');

/**
 * Text zu einem Unterschied (aus diffPicks): { lead, lines: [{ kind, tone, text }] }.
 * lead = ein Satz, der sagt, was der Mehrpreis (kind 'step') oder der Typwechsel (kind 'lane') tatsächlich ändert.
 * tone: 'up' = besser/mehr, 'down' = schlechter/weniger, 'same' = unverändert, 'plain' = Hinweis ohne Wertung.
 */
export function describeDiff(d) {
  const lines = [];
  if (d.same) lines.push({ kind: 'perf', tone: 'same', text: 'Leistung unverändert: alle fünf Skalen haben dieselben Sterne.' });
  for (const s of d.scales) lines.push({ kind: 'perf', tone: s.to > s.from ? 'up' : 'down', text: `${s.label}: ${s.from} → ${s.to} von 5 Sternen` });
  if (d.steel) lines.push({ kind: 'steel', tone: 'plain', text: `Stahl: ${d.steel.from.label}${hrcPart(d.steel.from)} → ${d.steel.to.label}${hrcPart(d.steel.to)}` });
  if (d.type) lines.push({ kind: 'type', tone: 'plain', text: `Typ: ${d.type.from} → ${d.type.to}` });
  if (d.mm) lines.push({ kind: 'size', tone: 'plain', text: `Länge: ${cmText(d.mm.from)} → ${cmText(d.mm.to)} cm` });
  if (d.grip) lines.push({ kind: 'grip', tone: 'plain', text: `Griff: ${d.grip.from ?? 'nicht angegeben'} → ${d.grip.to ?? 'nicht angegeben'}` });
  if (d.added.length) lines.push({ kind: 'feat', tone: 'up', text: `Zusätzlich: ${d.added.join(', ')}` });
  if (d.removed.length) lines.push({ kind: 'feat', tone: 'down', text: `Entfällt: ${d.removed.join(', ')}` });

  const gain = d.better.length ? `besser: ${names(d.better)}` : '';
  const loss = d.worse.length ? `schlechter: ${names(d.worse)}` : '';
  const change = [gain, loss].filter(Boolean).join('; ');
  let lead;
  if (d.kind === 'lane') lead = d.same ? 'Gleiche Sterne wie das Vergleichsmesser.' : `So unterscheidet sich dieser Typ – ${change}.`;
  else if (d.same) {
    const buys = [d.steel ? `einen anderen Stahl (${d.steel.to.label})` : null, d.grip?.styleChanged ? d.grip.to : null, ...d.added].filter(Boolean);
    lead = `Der Mehrpreis kauft keine andere Leistung, sondern ${buys.length ? buys.join(', ') : 'eine andere Größe, ein anderes Holz oder eine andere Optik'}.${d.removed.length ? ` Dafür entfällt: ${d.removed.join(', ')}.` : ''}`;
  } else lead = `Der Mehrpreis ändert die Leistung – ${change}.`;
  return { lead, lines };
}

/**
 * Auswahl: { lanes: [{ lane, picks: [pick], gaps: [tier], steels: { labels, hrc } }], compare, limitChf, maxSorglos, pool: { ausgewogen, robust, scharf } }.
 * Jede Auswahl trägt `diff` = Unterschiede zum nächstgünstigeren Messer desselben Typs ({ kind: 'step', against, ...diffPicks }); das erste Messer
 * von „Robust“ und „Länger scharf“ wird mit dem günstigsten „Ausgewogen“-Messer verglichen (kind: 'lane').
 * compare = je Skala die Spanne der Sterne pro Typ (für die Gegenüberstellung der Typen).
 */
export function sichereWahl(data) {
  const limit = data.site?.customs?.CH?.limit ?? DEFAULT_LIMIT_CHF;
  const all = rows(data);
  const tierOf = (tier) => ({ ...tier, maxChf: tier.maxChf ?? limit });

  const lanes = LANES.map((lane) => {
    const rule = RULES[lane.id];
    const pool = all.filter(rule.gate);
    for (const x of pool) x.pl = valueStars(x, pool, rule.score);
    const picks = [];
    const gaps = [];
    let prev = null;
    TIERS.forEach((tier, i) => {
      const max = tier.maxChf ?? limit;
      const last = i === TIERS.length - 1;
      const band = pool.filter((x) => x.chf >= tier.minChf && (last ? x.chf <= max : x.chf < max)).sort(rule.cmp);
      // Mehr Geld nur mit Mehrwert: Das Messer muss gegenüber der Stufe davor etwas Belegtes zusätzlich bieten.
      const best = prev ? band.find((x) => addsValue(prev, x)) : band[0];
      if (best) {
        picks.push(toPick(best, data, lane, tierOf(tier)));
        prev = best;
      } else if (band[0]) gaps.push({ ...tierOf(tier), pick: toPick(band[0], data, lane, tierOf(tier)) });
      else gaps.push({ ...tierOf(tier), pick: null });
    });
    const hards = picks.map((p) => knifeHardness(p.item, data)).filter(Boolean);
    const steels = {
      labels: [...new Set(picks.map((p) => (p.item.steel ? data.entry('steels', p.item.steel.id)?.short ?? p.item.steel.id : null)).filter(Boolean))],
      hrc: hards.length ? hrcText([Math.min(...hards.map((x) => x.range[0])), Math.max(...hards.map((x) => x.range[1]))]) : null,
    };
    return { lane, picks, gaps, pool: pool.length, steels };
  });

  const baseline = lanes[0].picks[0] ?? null;
  for (const { picks } of lanes) {
    picks.forEach((pick, i) => {
      const against = i ? picks[i - 1] : pick.lane.id !== LANES[0].id ? baseline : null;
      if (against) pick.diff = { kind: i ? 'step' : 'lane', against, ...diffPicks(against, pick, data) };
    });
  }

  const compare = SCALE_IDS.map((id) => ({
    id,
    label: scaleLabel(id),
    cells: lanes.map(({ lane, picks }) => {
      const v = picks.map((p) => starsOf(p, id)).filter((n) => n != null);
      return { lane, min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
    }),
  }));

  // Höchster „Sorglos“-Wert, den irgendein Messer des Katalogs erreicht (Härte und Robustheit sind gegenläufig, daher meist 3)
  const maxSorglos = Math.max(0, ...all.filter((r) => r.item.rust === 'full').map((r) => r.safe.min));
  return { lanes, compare, limitChf: limit, maxSorglos, pool: Object.fromEntries(lanes.map((l) => [l.lane.id, l.pool])) };
}

/** Alle Auswahlen in Anzeige-Reihenfolge (Typ für Typ, innerhalb des Typs nach Preisstufe). */
export const allPicks = (w) => w.lanes.flatMap((l) => l.picks);

/** Regeln als Text (für Startseite und Messerkunde), aus den Konstanten erzeugt. */
export function pickRules(limitChf = DEFAULT_LIMIT_CHF) {
  const bands = TIERS.map((t, i) => (i === 0 ? `${t.level}: bis ${t.maxChf} CHF` : `${t.level}: ${t.minChf}–${t.maxChf ?? limitChf} CHF`));
  return {
    assumptions: [
      'Kocht vegetarisch: viel Gemüse, kein Fisch oder Fleisch zu zerlegen. Verlangt wird mindestens 4 von 5 Sternen Eignung fürs Gemüse (Hammerschlag zählt einen halben Stern mehr, weil laut Händlern weniger Schnittgut haften bleibt).',
      'Kennt kein einseitig geschliffenes Messer: beidseitig geschliffen (5 Sterne Eingewöhnung) und ein Allrounder (mindestens 4 von 5 Sternen Eignung für den Alltag; ein Nakiri erfüllt das nicht).',
      `Kauft in der Schweiz ein: Preise in CHF zum Kurs der Seite, Obergrenze ${limitChf} CHF (Wertfreigrenze pro Person und Tag, nur Orientierung).`,
      `Standardlänge des Typs (Toleranz −${SIZE_BELOW} bis +${SIZE_ABOVE} mm), laut Katalog vorrätig, Stahlsorte bekannt (sonst gibt es keine Schätzung).`,
    ],
    kpis: [
      ['Sorglos', 'Niedrigster Wert der fünf Alltags-Skalen (Schnitthaltigkeit, Schärfbarkeit, Ausbruch-Festigkeit, Rostschutz, Eingewöhnung): „kein schwacher Punkt“. Aussagekräftig nur beim Typ „Ausgewogen“; bei „Robust“ und „Länger scharf“ ist ein niedriger Wert der Preis des jeweiligen Stahls.'],
      ['Preis-Leistung', 'Anteil der gleichwertigen Messer desselben Typs (gleiche oder bessere Wertung und Gemüse-Eignung), die weniger kosten. 5 Sterne: höchstens knapp jedes fünfte ist günstiger; jede weiteren 20 Prozentpunkte kosten einen Stern.'],
    ],
    selection: [
      `Drei Typen, drei Preisstufen (nach Preis der Standardgröße): ${bands.join('; ')}. Pro Typ und Stufe erscheint höchstens ein Messer.`,
      '„Ausgewogen“: komplett rostfrei (5 Sterne Rostschutz), auf keiner der fünf Alltags-Skalen unter 3 Sternen. Es gewinnt das Messer mit der besten Sorglos-Wertung, dann der besten Gemüse-Eignung, dann der meisten Ausstattung (Damast, Hammerschlag, Holzgriff), dann dem besten Preis-Leistungs-Wert und zuletzt dem niedrigsten Preis.',
      '„Robust“: komplett rostfrei, aber weicher Stahl: höchstens 2 Sterne Schnitthaltigkeit, mindestens 4 Sterne Schärfbarkeit und Ausbruch-Festigkeit. Laut Knives and Stones stumpft die Schneide weicher Stähle schneller ab, lässt sich leicht schärfen und verzeiht rauen Umgang. Rangfolge wie bei „Ausgewogen“.',
      '„Länger scharf“: Pflege ist in Ordnung (Kohlenstoffstahl oder Mantel möglich). Verlangt werden mindestens 4 Sterne Schnitthaltigkeit, 2 Sterne Schärfbarkeit und 2 Sterne Ausbruch-Festigkeit; es gewinnt der beste Mittelwert dieser Skalen (Schnitthaltigkeit, Schärfbarkeit, Ausbruch-Festigkeit, Eingewöhnung).',
      'Die drei Typen schließen einander aus (Schnitthaltigkeit höchstens 2, genau 3, mindestens 4 Sterne): Kein Messer steht in zwei Spalten.',
      'Jede Karte vergleicht ihr Messer mit dem nächstgünstigeren desselben Typs: Sterne je Skala, Stahl, Typ, Länge, Ausstattung und Preis. Das erste Messer von „Robust“ und „Länger scharf“ wird mit dem günstigsten „Ausgewogen“-Messer verglichen. Ändert sich bei keiner Skala etwas, steht dort, dass der Mehrpreis Ausstattung bezahlt und keine andere Leistung.',
    ],
  };
}
