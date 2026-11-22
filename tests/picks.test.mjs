import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildData } from '../assets/js/data.js';
import { sichereWahl, pickRules, TIERS, CURRENCY } from '../assets/js/lib/picks.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const wissen = read('content/wissen.json');
const data = buildData(read('data/knives.json'), read('data/taxonomy.json'), read('data/site.json'));
const w = sichereWahl(data);
const stars = (pick) => Object.fromEntries(pick.est.kpis.map((k) => [k.id, k.stars]));
const task = (pick, id) => pick.est.tasks.find((t) => t.id === id)?.stars ?? 0;

test('Auswahl: je Stufe ein Messer im Preisband, aufsteigend, ohne Doppelte', () => {
  assert.ok(w.tiers.length >= 1);
  assert.equal(w.tiers[0].pick.tier.id, 'einstieg');
  const limit = data.site.customs.CH.limit;
  assert.equal(w.limitChf, limit);
  let last = -1;
  const handles = new Set();
  for (const { pick } of w.tiers) {
    const t = TIERS.find((x) => x.id === pick.tier.id);
    assert.ok(pick.chf >= t.minChf && pick.chf <= (t.maxChf ?? limit), `${pick.tier.level}: CHF ${pick.chf}`);
    assert.ok(pick.chf >= last, 'Preise steigen von Stufe zu Stufe');
    last = pick.chf;
    handles.add(pick.item.handle);
  }
  if (w.expert) handles.add(w.expert.item.handle);
  assert.equal(handles.size, w.tiers.length + (w.expert ? 1 : 0), 'kein Messer doppelt');
  assert.equal(CURRENCY, 'CHF');
});

test('Preise in CHF folgen dem Kurs; die Obergrenze ist die Schweizer Wertfreigrenze', () => {
  for (const pick of [...w.tiers.map((t) => t.pick), w.expert].filter(Boolean)) {
    assert.ok(Math.abs(pick.chf - pick.jpy / data.rates.CHF) < 1e-9);
    assert.ok(pick.chf <= w.limitChf);
    assert.equal(pick.jpy, pick.size.priceJpy);
    assert.equal(pick.size, pick.item.sizes[pick.sizeIndex]);
  }
});

test('Sorglos-Tor: komplett rostfrei, beidseitig, vorrätig, Allrounder, Gemüse, keine Skala unter 3 Sternen', () => {
  for (const { pick } of w.tiers) {
    const it = pick.item;
    const st = stars(pick);
    assert.equal(it.rust, 'full');
    assert.equal(it.bevel, 'double');
    assert.ok(it.available && pick.size.available, 'laut Katalog vorrätig');
    assert.equal(st.rust, 5);
    assert.equal(st.adapt, 5);
    for (const id of ['edge', 'sharpen', 'tough']) assert.ok(st[id] >= 3, `${it.handle}: ${id} ${st[id]}`);
    assert.equal(pick.sorglos, Math.min(st.edge, st.sharpen, st.tough, st.rust, st.adapt), 'Sorglos = niedrigster Wert der fünf Skalen');
    assert.ok(task(pick, 'allround') >= 4 && pick.gem >= 4);
    assert.ok(!(it.flags ?? []).some((f) => /^(steel-family-conflict|left-signal-mismatch)/.test(f)), 'keine widersprüchlichen Katalogangaben');
  }
});

test('Standardlänge: keine Mini- oder Riesen-Varianten', () => {
  for (const pick of [...w.tiers.map((t) => t.pick), w.expert].filter(Boolean)) {
    const typical = data.entry('types', pick.item.type).typicalMm;
    assert.ok(pick.size.mm >= typical[0] - 15 && pick.size.mm <= typical[1] + 30, `${pick.item.handle}: ${pick.size.mm} mm`);
  }
});

test('Preis-Leistung: 1–5 Sterne, das günstigste gleichwertige Messer hat 5, teurere Stufen nie mehr', () => {
  const first = w.tiers[0].pick;
  assert.equal(first.pl, 5);
  for (const pick of [...w.tiers.map((t) => t.pick), w.expert].filter(Boolean)) {
    assert.ok(Number.isInteger(pick.pl) && pick.pl >= 1 && pick.pl <= 5);
  }
  for (const { pick } of w.tiers) assert.ok(pick.pl <= first.pl);
});

test('Mehr Geld nur mit Mehrwert: teurere Stufen bieten mehr Ausstattung oder eine bessere Wertung', () => {
  for (let i = 1; i < w.tiers.length; i++) {
    const a = w.tiers[i - 1].pick;
    const b = w.tiers[i].pick;
    assert.ok(b.features.length > a.features.length || b.sorglos > a.sorglos || b.gem > a.gem, `${b.tier.level} bietet nichts Neues`);
    assert.ok(b.upgrade && Array.isArray(b.upgrade.added));
    assert.equal(b.upgrade.sameStars, ['edge', 'sharpen', 'tough', 'rust', 'adapt'].every((id) => stars(a)[id] === stars(b)[id]));
  }
  // verworfene Stufen hätten nichts Neues geboten
  const lastShown = w.tiers.at(-1)?.pick;
  for (const d of w.dropped) assert.ok(!(d.pick.features.length > lastShown.features.length || d.pick.sorglos > lastShown.sorglos || d.pick.gem > lastShown.gem));
});

test('„Kennt sich aus“: Pflege ist in Ordnung, Schnitthaltigkeit und Schärfbarkeit müssen stimmen', () => {
  assert.ok(w.expert, 'für Pflege-Fans gibt es eine Auswahl');
  const st = stars(w.expert);
  assert.ok(st.edge >= 4 && st.sharpen >= 3 && st.tough >= 2 && st.adapt === 5);
  assert.ok(w.expert.item.available && w.expert.item.bevel === 'double');
  assert.ok(w.expert.careMean >= 3);
});

test('Gründe nennen existierende Quellen; jede Auswahl hat mindestens zwei Gründe', () => {
  const known = new Set(Object.keys(wissen.sources));
  for (const pick of [...w.tiers.map((t) => t.pick), w.expert].filter(Boolean)) {
    assert.ok(pick.reasons.length >= 2, `${pick.item.handle}: zu wenige Gründe`);
    for (const r of pick.reasons) {
      assert.ok(r.lead && r.text && r.sources.length > 0);
      for (const s of r.sources) assert.ok(known.has(s), s);
    }
  }
});

test('Regeln als Text: Stufen, Obergrenze und beide Kennzahlen stehen drin', () => {
  const rules = pickRules(w.limitChf);
  assert.match(rules.selection[0], /Einstieg: bis 120 CHF/);
  assert.match(rules.selection[0], new RegExp(`Zum Schenken: 200–${w.limitChf} CHF`));
  assert.deepEqual(rules.kpis.map(([k]) => k), ['Sorglos', 'Preis-Leistung']);
  assert.ok(rules.assumptions.some((t) => new RegExp(`Obergrenze ${w.limitChf} CHF`).test(t)));
  assert.ok(rules.assumptions.length >= 5 && rules.selection.length >= 4);
});
