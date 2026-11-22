import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildData } from '../assets/js/data.js';
import { estimateKpis, taskStars, compareRows, kpiRules, KPI_DEFS, EDGE_BREAKS, RUST_STARS, ADAPT_STARS } from '../assets/js/lib/predict.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const wissen = read('content/wissen.json');
const data = buildData(read('data/knives.json'), read('data/taxonomy.json'), read('data/site.json'));
const home = data.knives.filter((k) => k.segment === 'home');
const find = (pred) => home.find(pred);
const stars = (item) => Object.fromEntries(estimateKpis(item, data).kpis.map((k) => [k.id, k.stars]));
const kpi = (item, id) => estimateKpis(item, data).kpis.find((k) => k.id === id);
// Gyuto mit beidseitigem Schliff ohne K-Tip-Spitze: nur die Härte bestimmt die Sterne
const gyuto = (steel) => find((k) => k.type === 'gyuto' && k.bevel === 'double' && k.tip !== 'kiritsuke' && k.steel?.id === steel);

test('Skalen: jede hat Leitfrage, Bedeutung der 5 Sterne und eine Regel in der Messerkunde', () => {
  const ids = KPI_DEFS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  const rules = kpiRules();
  for (const d of KPI_DEFS) {
    assert.ok(d.ask.endsWith('?') && d.five && d.basis && ['estimate', 'catalog'].includes(d.kind), d.id);
    assert.ok(rules[d.id]?.length > 30, `${d.id}: Regel fehlt`);
  }
  assert.equal(EDGE_BREAKS.length, 4);
});

test('Härte → Schnitthaltigkeit, Schärfbarkeit und Ausbruch-Festigkeit (Gegenpole) für typische Stähle', () => {
  assert.deepEqual(['edge', 'sharpen', 'tough'].map((id) => stars(gyuto('aus8'))[id]), [1, 5, 5]);
  assert.deepEqual(['edge', 'sharpen', 'tough'].map((id) => stars(gyuto('aus10'))[id]), [2, 4, 4]);
  assert.deepEqual(['edge', 'sharpen', 'tough'].map((id) => stars(gyuto('vg10'))[id]), [3, 3, 3]);
  // Weißstahl: trotz Härte relativ leicht schärfbar (Ichimonji) → mindestens 4 Sterne Schärfbarkeit
  const white = gyuto('shirogami2');
  if (white) assert.deepEqual(['edge', 'sharpen', 'tough'].map((id) => stars(white)[id]), [4, 4, 2]);
  // Blue Super: Feinschliff schwierig (Ichimonji); sehr verschleißfest
  assert.deepEqual(['edge', 'sharpen', 'tough'].map((id) => stars(gyuto('aogami-super'))[id]), [5, 1, 1]);
  assert.deepEqual(['edge', 'sharpen', 'tough'].map((id) => stars(gyuto('zdp189'))[id]), [5, 1, 1]);
});

test('Abzüge nur mit Beleg: einseitiger Schliff, Honesuki/Mioroshi, K-Tip, „rusts easily“', () => {
  const yana = find((k) => k.type === 'yanagiba' && k.steel?.id === 'shirogami2');
  assert.equal(stars(yana).sharpen, 3, 'Weißstahl 4 Sterne minus 1 für einseitigen Schliff');
  assert.match(kpi(yana, 'sharpen').text, /Einseitiger Schliff: Händler sehen beim Nachschliff mehr Übungsbedarf/);
  const hon = find((k) => k.type === 'honesuki' && k.steel?.id === 'aogami2');
  assert.equal(stars(hon).tough, 1, '6 − 4 Sterne Schnitthaltigkeit − 1 für die dünne Spitze');
  assert.match(kpi(hon, 'tough').text, /Ein Stern Abzug: Die dünne Spitze bricht aus/);
  assert.ok(kpi(hon, 'tough').sources.includes('knifewear-honesuki'));
  const ktip = find((k) => k.tip === 'kiritsuke' && k.steel?.id && estimateKpis(k, data).kpis[0].stars != null);
  if (ktip) {
    const plain = 6 - stars(ktip).edge;
    assert.equal(stars(ktip).tough, Math.max(1, plain - 1));
    assert.match(kpi(ktip, 'tough').text, /K-Tip-Spitze ist laut Knifewear empfindlicher/);
  }
  const easy = find((k) => (k.notes ?? []).includes('rusts-easily-per-shop') && k.rust === 'full');
  if (easy) {
    assert.equal(stars(easy).rust, 4);
    assert.match(kpi(easy, 'rust').text, /„rusts easily“ \(1 Stern Abzug\)/);
  }
});

test('Brotmesser: Wellenschliff 1 Stern Schärfbarkeit; ohne Stahlsorte keine Härte-Schätzung', () => {
  const bread = find((k) => k.type === 'bread');
  assert.equal(stars(bread).sharpen, 1);
  assert.match(kpi(bread, 'sharpen').text, /Wellenschliff/);
  const mo = find((k) => k.steel?.id === 'mo');
  for (const id of ['edge', 'sharpen', 'tough']) {
    assert.equal(kpi(mo, id).stars, null);
    assert.match(kpi(mo, id).text, /^Keine Schätzung: /);
  }
  const mov = find((k) => k.steel?.id === 'mov');
  assert.match(kpi(mov, 'edge').text, /zu breit/);
});

test('Rostschutz und Eingewöhnung folgen den Angaben des Katalogs', () => {
  for (const [rust, n] of Object.entries(RUST_STARS)) assert.equal(stars(find((k) => k.rust === rust)).rust, n, rust);
  assert.deepEqual(Object.keys(ADAPT_STARS).map(Number), [1, 2, 3]);
  assert.equal(stars(find((k) => k.type === 'gyuto')).adapt, 5);
  assert.equal(stars(find((k) => k.type === 'yanagiba')).adapt, 1);
  assert.equal(stars(find((k) => data.entry('types', k.type)?.level === 2)).adapt, 3);
  assert.match(kpi(find((k) => k.type === 'yanagiba'), 'adapt').text, /händigkeitsgebunden/);
  const takeda = find((k) => k.maker === 'Takeda Hamono' && k.rust === 'none');
  assert.match(kpi(takeda, 'rust').text, /Chef Knives To Go nennt für die Linie „NAS“ einen rostfreien Mantel/);
});

test('Preis im Typ: günstigste 5 Sterne, teuerste 1 Stern; Gastro und kleine Typen ohne Vergleich', () => {
  const gy = home.filter((k) => k.type === 'gyuto' && k.priceFrom != null).sort((a, b) => a.priceFrom - b.priceFrom);
  assert.equal(stars(gy[0]).price, 5);
  assert.equal(stars(gy.at(-1)).price, 1);
  assert.match(kpi(gy[0], 'price').text, /^Preis ab ¥[\d.]+: günstiger als/);
  const gastro = data.knives.find((k) => k.segment === 'gastro');
  assert.equal(kpi(gastro, 'price').stars, null);
  assert.equal(estimateKpis(data.accessories[0], data), null, 'Zubehör wird nicht eingeschätzt');
});

test('Skalen heben Unterschiede hervor: Schnitthaltigkeit, Schärfbarkeit, Ausbruch-Festigkeit, Preis nutzen alle fünf Stufen', () => {
  const dist = {};
  for (const id of ['edge', 'sharpen', 'tough', 'price']) dist[id] = [0, 0, 0, 0, 0];
  for (const k of home) for (const x of estimateKpis(k, data).kpis) if (dist[x.id] && x.stars) dist[x.id][x.stars - 1] += 1;
  for (const [id, counts] of Object.entries(dist)) for (const [i, n] of counts.entries()) assert.ok(n >= 10, `${id}: nur ${n} Messer mit ${i + 1} Sternen`);
  // Rost und Eingewöhnung haben dreistufige Angaben: mindestens drei verschiedene Werte
  for (const id of ['rust', 'adapt']) assert.ok(new Set(home.map((k) => stars(k)[id]).filter(Boolean)).size >= 3, id);
});

test('Jede Aussage nennt eine Begründung, jede zitierte Quelle existiert', () => {
  const known = new Set(Object.keys(wissen.sources));
  const missing = new Set();
  for (const item of data.knives) {
    const est = estimateKpis(item, data);
    assert.equal(est.kpis.length, KPI_DEFS.length);
    for (const k of est.kpis) {
      assert.ok(k.text && k.text.length > 15, `${item.handle}/${k.id}: Begründung fehlt`);
      assert.ok(k.stars == null || (Number.isInteger(k.stars) && k.stars >= 1 && k.stars <= 5), `${item.handle}/${k.id}`);
      if (k.stars != null && k.id !== 'price') assert.ok(k.sources.length > 0, `${item.handle}/${k.id}: Schätzung ohne Quelle`);
      for (const s of k.sources) if (!known.has(s)) missing.add(s);
    }
  }
  assert.deepEqual([...missing], []);
});

test('Eignung je Aufgabe aus den Typ-Gewichten; Zusammenfassung nennt Stärken und Abstriche', () => {
  const t = taskStars(gyuto('vg10'), data);
  assert.deepEqual(t.map((x) => x.stars), [5, 4, 3, 2]);
  assert.equal(t[0].label, data.taxonomy.tasks.allround.label);
  const e = estimateKpis(gyuto('aogami-super'), data);
  assert.ok(e.summary.strengths.includes('Schnitthaltigkeit') && e.summary.limits.includes('Schärfbarkeit'));
  assert.deepEqual(e.notEstimated, ['Schärfe ab Werk', 'Gewicht und Balance', 'Klingendicke und -höhe']);
});

test('Vergleich: Abstand und Spitzenreiter je Skala', () => {
  const a = gyuto('aus8');
  const b = gyuto('aogami-super');
  const rows = compareRows([a, b].map((item) => ({ item, est: estimateKpis(item, data) })));
  const edge = rows.find((r) => r.def.id === 'edge');
  assert.equal(edge.spread, 4);
  assert.deepEqual(edge.best, [b]);
  assert.deepEqual(rows.find((r) => r.def.id === 'sharpen').best, [a]);
  const same = compareRows([a, a].map((item) => ({ item, est: estimateKpis(item, data) })));
  assert.ok(same.every((r) => r.spread === 0 && r.best.length === 0));
});
