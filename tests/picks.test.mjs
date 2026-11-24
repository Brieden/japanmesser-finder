import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildData } from '../assets/js/data.js';
import { sichereWahl, pickRules, describeDiff, diffPicks, allPicks, signedChf, TIERS, LANES, CURRENCY } from '../assets/js/lib/picks.js';
import { knifeHardness } from '../assets/js/lib/insights.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const wissen = read('content/wissen.json');
const data = buildData(read('data/knives.json'), read('data/taxonomy.json'), read('data/site.json'));
const w = sichereWahl(data);
const picks = allPicks(w);
const SCALE_IDS = ['edge', 'sharpen', 'tough', 'rust', 'adapt'];
const stars = (pick) => Object.fromEntries(pick.est.kpis.map((k) => [k.id, k.stars]));
const task = (pick, id) => pick.est.tasks.find((t) => t.id === id)?.stars ?? 0;
const lane = (id) => w.lanes.find((l) => l.lane.id === id);

test('Aufbau: drei Typen in fester Reihenfolge, je Typ höchstens eine Karte je Preisstufe, neun Karten', () => {
  assert.deepEqual(w.lanes.map((l) => l.lane.id), ['ausgewogen', 'robust', 'scharf']);
  assert.deepEqual(LANES.map((l) => l.id), w.lanes.map((l) => l.lane.id));
  for (const l of w.lanes) {
    assert.ok(l.picks.length >= 1 && l.picks.length <= TIERS.length, `${l.lane.name}: ${l.picks.length} Karten`);
    assert.equal(l.picks.length + l.gaps.length, TIERS.length, 'jede Preisstufe ist besetzt oder als Lücke benannt');
  }
  assert.equal(picks.length, 9, 'drei Typen × drei Preisstufen');
  assert.equal(w.lanes[0].picks[0].tier.id, 'einstieg');
});

test('Preisstufen: jedes Messer liegt im Preisband seiner Stufe, die Preise steigen je Typ; kein Messer doppelt', () => {
  const limit = data.site.customs.CH.limit;
  assert.equal(w.limitChf, limit);
  const handles = new Set();
  for (const l of w.lanes) {
    let last = -1;
    for (const pick of l.picks) {
      const t = TIERS.find((x) => x.id === pick.tier.id);
      assert.ok(pick.chf >= t.minChf && pick.chf <= (t.maxChf ?? limit), `${pick.tier.level}: CHF ${pick.chf}`);
      assert.ok(pick.chf >= last, 'Preise steigen von Stufe zu Stufe');
      last = pick.chf;
      handles.add(pick.item.handle);
    }
  }
  assert.equal(handles.size, picks.length, 'kein Messer doppelt');
  assert.equal(CURRENCY, 'CHF');
});

test('Preise in CHF folgen dem Kurs; die Obergrenze ist die Schweizer Wertfreigrenze', () => {
  for (const pick of picks) {
    assert.ok(Math.abs(pick.chf - pick.jpy / data.rates.CHF) < 1e-9);
    assert.ok(pick.chf <= w.limitChf);
    assert.equal(pick.jpy, pick.size.priceJpy);
    assert.equal(pick.size, pick.item.sizes[pick.sizeIndex]);
  }
});

test('Gemeinsame Annahmen: beidseitig, vorrätig, Allrounder, Gemüse, keine widersprüchlichen Katalogangaben', () => {
  for (const pick of picks) {
    const it = pick.item;
    const st = stars(pick);
    assert.equal(it.bevel, 'double');
    assert.ok(it.available && pick.size.available, 'laut Katalog vorrätig');
    assert.equal(st.adapt, 5);
    assert.ok(task(pick, 'allround') >= 4 && pick.gem >= 4, `${it.handle}: Allround/Gemüse`);
    assert.ok(!(it.flags ?? []).some((f) => /^(steel-family-conflict|left-signal-mismatch)/.test(f)), 'keine widersprüchlichen Katalogangaben');
  }
});

test('Typ „Ausgewogen“: komplett rostfrei, keine Skala unter 3 Sternen, Sorglos = niedrigster Wert', () => {
  for (const pick of lane('ausgewogen').picks) {
    const st = stars(pick);
    assert.equal(pick.item.rust, 'full');
    assert.equal(st.rust, 5);
    for (const id of SCALE_IDS) assert.ok(st[id] >= 3, `${pick.item.handle}: ${id} ${st[id]}`);
    assert.equal(pick.sorglos, Math.min(...SCALE_IDS.map((id) => st[id])));
  }
});

test('Typ „Robust“: komplett rostfrei, weicher Stahl – Schnitthaltigkeit höchstens 2, Schärfbarkeit und Ausbruch-Festigkeit mindestens 4', () => {
  assert.ok(lane('robust').picks.length >= 2);
  for (const pick of lane('robust').picks) {
    const st = stars(pick);
    assert.equal(pick.item.rust, 'full');
    assert.ok(st.edge <= 2 && st.sharpen >= 4 && st.tough >= 4, `${pick.item.handle}: ${SCALE_IDS.map((id) => st[id]).join('')}`);
  }
});

test('Typ „Länger scharf“: mindestens 4 Sterne Schnitthaltigkeit; Pflege ist in Ordnung', () => {
  assert.ok(lane('scharf').picks.length >= 2);
  for (const pick of lane('scharf').picks) assert.ok(stars(pick).edge >= 4, pick.item.handle);
  assert.ok(lane('scharf').picks.some((p) => p.item.rust !== 'full'), 'Kohlenstoffstahl oder Mantel kommt vor');
});

test('Die drei Typen schließen einander aus: Schnitthaltigkeit ≤2 / genau 3 / ≥4', () => {
  for (const pick of lane('robust').picks) assert.ok(stars(pick).edge <= 2);
  for (const pick of lane('ausgewogen').picks) assert.equal(stars(pick).edge, 3);
  for (const pick of lane('scharf').picks) assert.ok(stars(pick).edge >= 4);
});

test('Standardlänge: keine Mini- oder Riesen-Varianten', () => {
  for (const pick of picks) {
    const typical = data.entry('types', pick.item.type).typicalMm;
    assert.ok(pick.size.mm >= typical[0] - 15 && pick.size.mm <= typical[1] + 30, `${pick.item.handle}: ${pick.size.mm} mm`);
  }
});

test('Preis-Leistung: 1–5 Sterne, ganze Zahlen; mindestens ein Messer je Typ mit 5', () => {
  for (const pick of picks) assert.ok(Number.isInteger(pick.pl) && pick.pl >= 1 && pick.pl <= 5);
  for (const l of w.lanes) assert.ok(l.picks.some((p) => p.pl === 5), `${l.lane.name}: kein Messer mit 5 Sternen`);
});

test('Mehr Geld nur mit Mehrwert: höhere Stufe hat mehr Ausstattung, bessere Sterne oder einen härteren Stahl', () => {
  for (const l of w.lanes) {
    for (let i = 1; i < l.picks.length; i++) {
      const a = l.picks[i - 1];
      const b = l.picks[i];
      const mid = (p) => knifeHardness(p.item, data)?.mid ?? 0;
      const better = SCALE_IDS.some((id) => stars(b)[id] > stars(a)[id]);
      assert.ok(b.features.length > a.features.length || better || mid(b) > mid(a), `${l.lane.name}: ${b.tier.level} bietet nichts Neues`);
    }
    // verworfene Stufen hätten nichts Neues geboten
    for (const g of l.gaps) assert.ok(g.pick === null || l.picks.length > 0);
  }
});

test('Unterschiede: jede Karte außer dem günstigsten „Ausgewogen“-Messer vergleicht sich mit dem richtigen Messer', () => {
  const baseline = w.lanes[0].picks[0];
  assert.equal(baseline.diff, null);
  for (const l of w.lanes) {
    l.picks.forEach((pick, i) => {
      if (pick === baseline) return;
      const d = pick.diff;
      assert.ok(d, `${pick.item.handle}: kein Unterschied`);
      if (i) {
        assert.equal(d.kind, 'step');
        assert.equal(d.against, l.picks[i - 1]);
      } else {
        assert.equal(d.kind, 'lane');
        assert.equal(d.against, baseline);
      }
      assert.ok(Math.abs(d.deltaChf - (pick.chf - d.against.chf)) < 1e-9);
      const changed = SCALE_IDS.filter((id) => stars(pick)[id] !== stars(d.against)[id]);
      assert.deepEqual(d.scales.map((s) => s.id), changed, 'genau die Skalen mit anderen Sternen');
      assert.equal(d.same, changed.length === 0);
      for (const s of d.scales) assert.ok(s.label && s.from !== s.to);
      assert.deepEqual(diffPicks(d.against, pick, data).scales, d.scales, 'diffPicks liefert dasselbe');
    });
  }
});

test('Unterschiede als Text: Sterne-Änderungen, Stahl und Griff werden genannt; „keine andere Leistung“ nur bei gleichen Sternen', () => {
  const stepPicks = picks.filter((p) => p.diff?.kind === 'step');
  assert.ok(stepPicks.length >= 3);
  for (const pick of picks.filter((p) => p.diff)) {
    const d = pick.diff;
    const { lead, lines } = describeDiff(d);
    assert.ok(lead.length > 20);
    assert.equal(/keine andere Leistung/.test(lead), d.kind === 'step' && d.same, `${pick.item.handle}: ${lead}`);
    for (const s of d.scales) assert.ok(lines.some((l) => l.kind === 'perf' && l.text.includes(s.label) && l.text.includes(`${s.from} → ${s.to}`)), `${s.label} fehlt`);
    if (d.same) assert.ok(lines.some((l) => l.tone === 'same'));
    if (d.steel) assert.ok(lines.some((l) => l.kind === 'steel' && l.text.includes(d.steel.to.label)));
    if (d.grip) assert.ok(lines.some((l) => l.kind === 'grip'));
    for (const f of d.added) assert.ok(lines.some((l) => l.text.includes(f)));
  }
  assert.equal(signedChf(48.4), '+CHF 48');
  assert.equal(signedChf(-15.6), '−CHF 16');
});

test('Gegenüberstellung der Typen: Spannen stimmen mit den Karten überein; Stahl und Härte je Typ', () => {
  assert.deepEqual(w.compare.map((r) => r.id), SCALE_IDS);
  for (const row of w.compare) {
    row.cells.forEach((c, i) => {
      const values = w.lanes[i].picks.map((p) => stars(p)[row.id]);
      assert.equal(c.min, Math.min(...values));
      assert.equal(c.max, Math.max(...values));
    });
  }
  // der Kern der Typen: Schnitthaltigkeit steigt, Ausbruch-Festigkeit und Rostschutz fallen von „Robust“ über „Ausgewogen“ zu „Länger scharf“
  const row = (id) => w.compare.find((r) => r.id === id).cells;
  const [aus, rob, sch] = [0, 1, 2];
  assert.ok(row('edge')[rob].max < row('edge')[aus].min && row('edge')[aus].max < row('edge')[sch].min);
  assert.ok(row('tough')[rob].min > row('tough')[aus].max && row('tough')[aus].min > row('tough')[sch].max);
  for (const l of w.lanes) assert.ok(l.steels.labels.length >= 1 && /^\d+(–\d+)?$/.test(l.steels.hrc));
});

test('Gründe nennen existierende Quellen; jede Auswahl hat mindestens zwei Gründe', () => {
  const known = new Set(Object.keys(wissen.sources));
  for (const pick of picks) {
    assert.ok(pick.reasons.length >= 2, `${pick.item.handle}: zu wenige Gründe`);
    for (const r of pick.reasons) {
      assert.ok(r.lead && r.text && r.sources.length > 0, `${pick.item.handle}: ${r.lead}`);
      for (const s of r.sources) assert.ok(known.has(s), s);
    }
  }
});

test('Regeln als Text: Stufen, Obergrenze, drei Typen und beide Kennzahlen stehen drin', () => {
  const rules = pickRules(w.limitChf);
  assert.match(rules.selection[0], /Einstieg: bis 120 CHF/);
  assert.match(rules.selection[0], /Kocht gern: 120–180 CHF/);
  assert.match(rules.selection[0], new RegExp(`Zum Schenken: 180–${w.limitChf} CHF`));
  for (const name of ['Ausgewogen', 'Robust', 'Länger scharf']) assert.ok(rules.selection.some((t) => t.includes(`„${name}“`)), name);
  assert.deepEqual(rules.kpis.map(([k]) => k), ['Sorglos', 'Preis-Leistung']);
  assert.ok(rules.assumptions.some((t) => new RegExp(`Obergrenze ${w.limitChf} CHF`).test(t)));
  assert.ok(rules.assumptions.length >= 4 && rules.selection.length >= 6);
});
