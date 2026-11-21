import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildData } from '../assets/js/data.js';
import { hardnessClass, knifeHardness, hardnessNote, sharpeningStatement, compareInClass, typeStats, rustClassStats, highlights, hardnessSentence, priceSentence, median, hrcText } from '../assets/js/lib/insights.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const wissen = read('content/wissen.json');
const data = buildData(read('data/knives.json'), read('data/taxonomy.json'), read('data/site.json'));
const home = data.knives.filter((k) => k.segment === 'home');
const find = (pred) => home.find(pred);

test('Härteklassen: Grenzen der Skala von Knives and Stones', () => {
  const id = (h) => hardnessClass(h, data.taxonomy).id;
  assert.equal(id(54), 'soft', 'unterhalb der Skala gilt weich');
  assert.equal(id(55), 'soft');
  assert.equal(id(58.5), 'soft');
  assert.equal(id(59), 'balanced');
  assert.equal(id(61.5), 'balanced');
  assert.equal(id(62), 'hard');
  assert.equal(id(64.5), 'hard');
  assert.equal(id(65), 'veryhard');
  assert.equal(id(67), 'veryhard');
  assert.equal(hardnessClass(null, data.taxonomy), null);
  assert.equal(hrcText([62, 65]), '62–65');
  assert.equal(median([1, 5, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('knifeHardness: nur mit bekannter Stahlsorte und Härte', () => {
  const vg10 = find((k) => k.steel?.id === 'vg10');
  const h = knifeHardness(vg10, data);
  assert.deepEqual(h.range, [59, 61]);
  assert.equal(h.cls.id, 'balanced');
  for (const unknown of ['mo', 'swedish', 'cobalt', 'hss', 'inox', 'vg1', 'mov', 'stainless-unspecified', 'unknown']) {
    const k = find((x) => x.steel?.id === unknown);
    if (k) assert.equal(knifeHardness(k, data), null, `${unknown}: keine Härte bekannt → keine Einordnung`);
  }
});

test('zu breite Härtespanne (Molybdän-Vanadium 54–60 HRC): kein Klassen-Urteil, aber ein ehrlicher Hinweis', () => {
  const mov = find((k) => k.steel?.id === 'mov');
  assert.equal(knifeHardness(mov, data), null);
  assert.match(hardnessNote(mov, data).text, /54–60 HRC; die Spanne ist zu breit/);
  assert.ok(highlights(mov, data).some((h) => h.lead === 'Härte nicht einzuordnen.'));
  assert.equal(hardnessNote(find((k) => k.steel?.id === 'vg10'), data), null);
});

test('Schärfaufwand: nur belegte Aussagen', () => {
  const white = find((k) => k.steel?.id === 'shirogami2');
  assert.equal(sharpeningStatement(white, data).level, 'easy');
  assert.match(sharpeningStatement(white, data).text, /Weißstahl/);
  const superBlue = find((k) => k.steel?.id === 'aogami-super');
  assert.equal(sharpeningStatement(superBlue, data).level, 'harder');
  const vg10 = find((k) => k.steel?.id === 'vg10');
  assert.match(sharpeningStatement(vg10, data).text, /Härteklasse/);
  // Aogami #2: Kohlenstoffstahl ohne belegte Aussage → nichts behaupten (die generische Härteklassen-Aussage passt nicht auf Blaustahl)
  const blue2 = find((k) => k.steel?.id === 'aogami2');
  assert.equal(sharpeningStatement(blue2, data), null);
  const mo = find((k) => k.steel?.id === 'mo');
  assert.equal(sharpeningStatement(mo, data), null);
});

test('compareInClass: Vergleich nur innerhalb desselben Typs und mit klaren Grenzen', () => {
  const gyuto = find((k) => k.type === 'gyuto' && k.steel?.id === 'aogami-super');
  const cmp = compareInClass(gyuto, data);
  assert.equal(cmp.type, 'gyuto');
  assert.ok(cmp.n >= 20);
  assert.ok(cmp.hardness.nKnown >= 5);
  assert.ok(cmp.hardness.percentile >= 0 && cmp.hardness.percentile <= 1);
  assert.ok(['oberes Drittel', 'mittleres Drittel', 'unteres Drittel'].includes(cmp.hardness.band));
  assert.equal(cmp.hardness.band, 'oberes Drittel', 'Aogami Super (62–65 HRC) liegt bei den Gyuto im oberen Drittel');
  assert.ok(cmp.price.n >= 5);
  const noSteel = find((k) => k.type === 'gyuto' && k.steel?.id === 'mo');
  assert.equal(compareInClass(noSteel, data).hardness, null, 'ohne Stahlsorte keine Härte-Einordnung');
  assert.ok(compareInClass(noSteel, data).price, 'der Preisvergleich bleibt möglich');
  const gastro = data.knives.find((k) => k.segment === 'gastro');
  assert.equal(compareInClass(gastro, data), null, 'Gastro-Linie wird nicht eingeordnet');
  assert.equal(compareInClass(data.accessories[0], data), null);
  const s1 = hardnessSentence(cmp);
  assert.match(s1, /^Härter als \d+ % der übrigen \d+ Gyuto mit bekannter Härte/);
  assert.match(s1, /oberes Drittel\)\.$/);
  assert.match(priceSentence(cmp), /^Preis ab ¥[\d.]+: (günstiger|teurer) als \d+ % der übrigen \d+ Gyuto \((oberes|mittleres|unteres) Drittel\); Median ¥[\d.]+\.$/);
});

test('typeStats und rustClassStats sind konsistent mit dem Katalog', () => {
  const s = typeStats('gyuto', data);
  assert.equal(s.n, home.filter((k) => k.type === 'gyuto').length);
  assert.equal(s.rust.full + s.rust.clad + s.rust.none + s.rust.unknown, s.n);
  assert.ok(s.hrcKnown > 0 && s.hrcKnown <= s.n);
  assert.ok(s.hrcMin <= s.hrcMedian && s.hrcMedian <= s.hrcMax);
  assert.ok(s.topSteels.length > 0 && s.topSteels[0].count >= s.topSteels.at(-1).count);
  const r = rustClassStats(data);
  assert.equal(r.full.n + r.clad.n + r.none.n, home.filter((k) => k.rust).length);
  assert.ok(r.full.hrcMedian != null && r.none.hrcMedian != null);
});

test('highlights: belegt, konkret und mit existierenden Quellen', () => {
  const k = find((x) => x.handle === 'vg10-damascus-gyuto-walnut-kw');
  const leads = highlights(k, data).map((h) => h.lead);
  assert.ok(leads.includes('Komplett rostfrei.'));
  assert.ok(leads.includes('Wa-Griff.'));
  assert.ok(leads.includes('Damast-Muster.'));
  assert.ok(leads.some((l) => l.startsWith('Härte ca. 59–61 HRC')));
  assert.deepEqual(highlights(data.accessories[0], data), []);

  // Integrität: jede zitierte Quelle existiert in der Messerkunde
  const known = new Set(Object.keys(wissen.sources));
  const missing = new Set();
  for (const item of data.knives) for (const h of highlights(item, data)) {
    assert.ok(h.lead && h.text && h.text.length > 20, `${item.handle}: leere Aussage`);
    assert.ok(h.sources.length > 0, `${item.handle}: "${h.lead}" ohne Quelle`);
    for (const s of h.sources) if (!known.has(s)) missing.add(s);
  }
  assert.deepEqual([...missing], [], 'zitierte Quellen fehlen in content/wissen.json');
});

test('Datenintegrität: alle Quellen-Verweise der Taxonomie existieren', () => {
  const known = new Set(Object.keys(wissen.sources));
  const tax = data.taxonomy;
  const refs = [];
  refs.push(tax.hardnessScale.source);
  for (const [id, t] of Object.entries(tax.types)) for (const s of t.sources ?? []) refs.push([`types.${id}`, s]);
  for (const [id, s] of Object.entries(tax.steels)) {
    for (const x of s.sources ?? []) refs.push([`steels.${id}`, x]);
    for (const f of s.facts ?? []) refs.push([`steels.${id}.facts`, f.s]);
    if (s.sharpen?.source) refs.push([`steels.${id}.sharpen`, s.sharpen.source]);
  }
  for (const [id, m] of Object.entries(tax.makers)) for (const x of m.sources ?? []) refs.push([`makers.${id}`, x]);
  const bad = refs.filter((r) => typeof r !== 'string' && !known.has(r[1])).map((r) => r.join(' → '));
  assert.deepEqual(bad, []);
  assert.ok(known.has(tax.hardnessScale.source));
  for (const sec of wissen.sections) for (const s of sec.sources) assert.ok(known.has(s), `Abschnitt ${sec.id}: Quelle ${s}`);
});

test('Typen: jede Einstufung hat eine Begründung; einseitige Typen nennen den Grund konkret', () => {
  for (const [id, t] of Object.entries(data.taxonomy.types)) {
    if (t.level == null) continue;
    assert.ok(t.levelReason && t.levelReason.length > 30, `${id}: levelReason fehlt`);
  }
  for (const id of ['usuba', 'yanagiba', 'deba']) {
    const t = data.taxonomy.types[id];
    assert.match(t.levelReason, /händigkeitsgebunden/);
    assert.match(t.levelReason, /Übungsbedarf/);
    assert.ok(t.sharpenNote);
  }
  // die Beispiel-Formulierung aus der Prüfung: kein pauschales „zu anspruchsvoll“ ohne Grund
  assert.doesNotMatch(data.taxonomy.types.usuba.avoid, /meist zu anspruchsvoll/);
  assert.match(data.taxonomy.types.usuba.avoid, /einseitig geschliffen/);
});

// ───────────────────────── Sprach-Prüfung ─────────────────────────
// Diese Floskeln sagen nichts Überprüfbares und wurden bewusst gestrichen. Wer sie wieder einbaut, muss sie begründen oder ersetzen.
const BANNED = [/einsteigerfreundlich/i, /unkompliziert/i, /pflegeleicht/i, /alltagstauglich/i, /hochwertig/i, /für einsteiger geeignet/i, /eher etwas für erfahrene/i, /meist zu anspruchsvoll/i, /geflügelfans/i, /wenig übung nötig/i, /verzeiht pflegefehler/i, /robustes messer/i];

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (/\.(js|json|html|md)$/.test(name)) out.push(p);
  }
  return out;
}

test('Sprach-Prüfung: keine gestrichenen Floskeln in Oberfläche und Inhalten', () => {
  const files = [...walkFiles(ROOT + 'assets/js'), ROOT + 'data/taxonomy.json', ROOT + 'content/wissen.json', ROOT + 'index.html', ROOT + 'README.md']
    // Tests und Prüfskripte selbst dürfen die Floskeln nennen
    .filter((f) => !f.includes('/tests/'));
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const rx of BANNED) if (rx.test(text)) hits.push(`${f.replace(ROOT, '')}: ${rx}`);
  }
  assert.deepEqual(hits, []);
});
