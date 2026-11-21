// Tests der Finder-Engine (assets/js/lib/finder-engine.js): Szenarien gegen den echten Katalog und kleine Fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildData } from '../assets/js/data.js';
import {
  QUESTIONS,
  RESULT_STEP,
  BUDGETS,
  emptyAnswers,
  normalizeAnswers,
  visibleSteps,
  isAnswered,
  isComplete,
  firstOpenStep,
  nextStep,
  prevStep,
  hasProgress,
  rustAllowed,
  summarize,
  budgetText,
  recommendTypes,
  specialistHint,
  excludedTypes,
  steelAdvice,
  matchKnives,
  catalogQuery,
  stepNotes,
  targetLengthMm,
  explainEntries,
  whyText,
} from '../assets/js/lib/finder-engine.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const data = buildData(read('data/knives.json'), read('data/taxonomy.json'), read('data/site.json'));

/** Vollständige Beispielantworten; einzelne Felder werden je Szenario überschrieben. */
const A = (o = {}) => ({ who: '', tasks: ['allround'], level: 'beginner', rust: null, care: 'careful', hand: 'right', grip: 'any', size: 'standard', budget: 'open', looks: ['any'], ...o });

const eur = (yen) => Math.round(yen / data.rates.EUR).toLocaleString('de-DE');
const maxRun = (items) => {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const { item } of items) {
    const key = `${item.steel?.id}|${item.grip?.style}`;
    run = key === prev ? run + 1 : 1;
    prev = key;
    best = Math.max(best, run);
  }
  return best;
};

// ───────────────────────── Fragenablauf ─────────────────────────

test('Fragen: Ids eindeutig, Texte vollständig, kein Hype-Ton', () => {
  const ids = QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ['person', 'einsatz', 'erfahrung', 'rost', 'pflege', 'hand', 'griff', 'groesse', 'budget', 'optik']);
  for (const q of QUESTIONS) {
    assert.ok(q.title && q.key && ['text', 'single', 'multi'].includes(q.kind), q.id);
    assert.ok(whyText(q, data).length > 20, `Erklärung fehlt bei ${q.id}`);
    if (q.kind !== 'text') {
      const opts = q.options(data);
      assert.ok(opts.length >= 2, q.id);
      assert.equal(new Set(opts.map((o) => o.value)).size, opts.length, `Optionswerte doppelt bei ${q.id}`);
    }
    const text = [q.title, q.lead, whyText(q, data), ...q.options(data).flatMap((o) => [o.label, o.sub])].filter(Boolean).join(' ');
    assert.ok(!/!|Hammer-Angebot|unschlagbar|bestes?\b/i.test(text), `Ton bei ${q.id}`);
  }
  assert.ok(QUESTIONS.find((q) => q.id === 'person').hint.includes('Bleibt nur auf diesem Gerät'));
  // Aufgaben-Optionen stammen aus der Taxonomie
  assert.deepEqual(QUESTIONS.find((q) => q.id === 'einsatz').options(data).map((o) => o.value), Object.keys(data.taxonomy.tasks));
  // Budget mit Euro-Orientierung
  const budget = QUESTIONS.find((q) => q.id === 'budget').options(data);
  assert.deepEqual(budget.map((o) => o.value), ['lt15', '15-30', '30-60', 'gt60', 'open']);
  assert.equal(budget[0].sub, `≈ ${eur(15000)} €`);
  assert.equal(budget[1].sub, `≈ ${eur(15000)} bis ${eur(30000)} €`);
  assert.equal(budget[3].sub, `ab etwa ${eur(60000)} €`);
});

test('Ablauf: „Rost“ nur für Erfahrene, Weiter/Zurück, Resume', () => {
  assert.ok(!visibleSteps(A({ level: 'beginner' })).includes('rost'));
  assert.ok(!visibleSteps(A({ level: 'hobby' })).includes('rost'));
  assert.ok(visibleSteps(A({ level: 'expert' })).includes('rost'));
  assert.equal(nextStep('erfahrung', A({ level: 'beginner' })), 'pflege');
  assert.equal(nextStep('erfahrung', A({ level: 'expert' })), 'rost');
  assert.equal(nextStep('optik', A()), RESULT_STEP);
  assert.equal(prevStep('pflege', A({ level: 'beginner' })), 'erfahrung');
  assert.equal(prevStep('person', A()), null);
  assert.equal(prevStep(RESULT_STEP, A()), 'optik');

  assert.equal(hasProgress(emptyAnswers()), false);
  assert.equal(firstOpenStep(emptyAnswers()), 'einsatz'); // „Für wen?“ ist freiwillig und zählt immer als beantwortet
  const partial = { ...emptyAnswers(), tasks: ['gemuese'], level: 'expert' };
  assert.equal(hasProgress(partial), true);
  assert.equal(firstOpenStep(partial), 'rost');
  assert.equal(isComplete(partial), false);
  assert.equal(isComplete(A({ level: 'expert', rust: 'clad' })), true);
  assert.equal(isComplete(A({ level: 'expert', rust: null })), false);
  // optionale Fragen: erst mit gespeichertem (Standard-)Wert „beantwortet“, das Ergebnis geht trotzdem
  assert.equal(isAnswered('griff', { ...A(), grip: null }), false);
  assert.equal(isComplete({ ...A(), grip: null, size: null, budget: null, looks: null }), true);
  assert.equal(firstOpenStep({ ...A(), grip: null }), 'griff');
  assert.equal(firstOpenStep(A()), RESULT_STEP);
});

test('Antworten: Bereinigung gespeicherter/ungültiger Eingaben', () => {
  assert.deepEqual(normalizeAnswers(null), emptyAnswers());
  assert.deepEqual(normalizeAnswers('quatsch'), emptyAnswers());
  const n = normalizeAnswers({ who: `  ${'x'.repeat(100)}  `, tasks: ['fisch', 'fisch', 'brot', 'obst', 5], level: 'god', rust: 'any', care: 'rough', hand: 'left', grip: 'plastic', size: 'huge', budget: '15-30', looks: ['damascus', 'bogus', 'plain'] });
  assert.equal(n.who.length, 60);
  assert.deepEqual(n.tasks, ['fisch', 'brot']); // höchstens zwei, ohne Doppelte
  assert.equal(n.level, null);
  assert.equal(n.rust, 'any');
  assert.equal(n.grip, null);
  assert.equal(n.size, null);
  assert.deepEqual(n.looks, ['damascus', 'plain']);
  assert.deepEqual(normalizeAnswers({ looks: ['plain', 'any'] }).looks, ['any']);
  assert.equal(normalizeAnswers({ looks: [] }).looks, null);
  assert.deepEqual(normalizeAnswers({ tasks: ['unbekannt', 'fisch'] }, data).tasks, ['fisch']);
  // Eingaben werden nie verändert
  const frozen = Object.freeze({ ...A(), tasks: Object.freeze(['gemuese']), looks: Object.freeze(['any']) });
  assert.doesNotThrow(() => matchKnives(frozen, data));
  assert.doesNotThrow(() => steelAdvice(frozen, data));
});

test('Rost: Erlaubnis nach Erfahrung, Wahl und Pflege', () => {
  assert.deepEqual(rustAllowed(A({ level: 'beginner' })), ['full']);
  assert.deepEqual(rustAllowed(A({ level: 'hobby', rust: 'any' })), ['full']); // Hobby: nie mehr als komplett rostfrei
  assert.deepEqual(rustAllowed(A({ level: 'beginner', rust: 'any' })), ['full']);
  assert.deepEqual(rustAllowed(A({ level: 'expert', rust: 'full' })), ['full']);
  assert.deepEqual(rustAllowed(A({ level: 'expert', rust: 'clad' })), ['full', 'clad']);
  assert.deepEqual(rustAllowed(A({ level: 'expert', rust: 'any' })), ['full', 'clad', 'none']);
  assert.deepEqual(rustAllowed(A({ level: 'expert', rust: 'any', care: 'rough' })), ['full']);
  assert.deepEqual(rustAllowed(A({ level: 'expert', rust: null })), ['full']);
});

// ───────────────────────── Szenarien mit echten Daten ─────────────────────────

test('Anfänger, allround, rechts, 15–30k: nur komplett rostfrei, Gyuto/Santoku, Preis innerhalb Obergrenze +10 %', () => {
  const a = A({ budget: '15-30', grip: 'wa' });
  const r = matchKnives(a, data);
  assert.deepEqual(r.relaxed, []);
  assert.ok(r.items.length >= 6, `nur ${r.items.length} Treffer`);
  assert.deepEqual(r.typeRecs.map((t) => t.typeId).slice(0, 2), ['gyuto', 'santoku']);
  for (const x of r.items) {
    assert.equal(x.item.rust, 'full');
    assert.equal(x.item.segment, 'home');
    assert.ok(['gyuto', 'santoku'].includes(x.item.type), x.item.type);
    assert.ok(x.item.sizes[x.sizeIndex].priceJpy <= 30000 * 1.1, `${x.item.handle} ${x.item.sizes[x.sizeIndex].priceJpy}`);
    assert.equal(x.item.grip.style, 'wa');
    assert.ok(x.item.sizes[x.sizeIndex].available, 'nur vorrätige Größen');
    assert.ok(x.reasons.includes('komplett rostfrei'));
    assert.ok(x.reasons.some((t) => /Wa-Griff wie gewünscht/.test(t)));
    assert.ok(x.reasons.some((t) => /¥[\d.]+ – im Budget/.test(t)) || x.warnings.some((t) => /bis zu 10 % über dem Budget/.test(t)));
    assert.ok(x.reasons.some((t) => /Wunschlänge/.test(t)));
    assert.ok(x.reasons[0].startsWith(`${data.t('types', x.item.type)} – passt zu`));
  }
  assert.ok(r.items.every((x, i, arr) => i === 0 || x.score <= arr[0].score));
});

test('Gemüse: Nakiri/Santoku vorn', () => {
  const r = matchKnives(A({ tasks: ['gemuese'] }), data);
  assert.ok(['nakiri', 'santoku'].includes(r.typeRecs[0].typeId));
  assert.ok(['nakiri', 'santoku'].includes(r.typeRecs[1].typeId));
  assert.ok(['nakiri', 'santoku'].includes(r.items[0].item.type));
  assert.ok(r.items.slice(0, 4).every((x) => ['nakiri', 'santoku'].includes(x.item.type)));
  assert.ok(r.typeRecs.length <= 3);
  // Usuba (einseitig, Stufe 3) taucht für Nicht-Experten nicht auf, der Hinweis aber schon
  assert.ok(!r.typeRecs.some((t) => t.typeId === 'usuba'));
  assert.equal(specialistHint(A({ tasks: ['gemuese'] }), data).show, true);
});

test('Brot: Brotmesser; Geflügel: Honesuki', () => {
  const bread = matchKnives(A({ tasks: ['brot'] }), data);
  assert.equal(bread.typeRecs[0].typeId, 'bread');
  assert.ok(bread.items.length > 0);
  assert.ok(bread.items.every((x) => x.item.type === 'bread' && x.item.rust === 'full'));

  for (const level of ['beginner', 'hobby', 'expert']) {
    const poultry = matchKnives(A({ tasks: ['gefluegel'], level, rust: 'full' }), data);
    assert.equal(poultry.typeRecs[0].typeId, 'honesuki', level);
    assert.ok(poultry.items.some((x) => x.item.type === 'honesuki'), level);
  }
});

test('Zwei Aufgaben: Haupt zuerst, zweite bekommt einen Platz (Brotmesser neben Gyuto)', () => {
  const r = recommendTypes(A({ tasks: ['allround', 'brot'] }), data);
  assert.equal(r[0].typeId, 'gyuto');
  assert.ok(r.some((t) => t.typeId === 'bread'));
  assert.ok(r.length <= 3);
  const items = matchKnives(A({ tasks: ['allround', 'brot'] }), data).items;
  assert.ok(items.some((x) => x.item.type === 'bread'));
  // umgekehrt: Brot als Haupt
  assert.equal(recommendTypes(A({ tasks: ['brot', 'allround'] }), data)[0].typeId, 'bread');
});

test('Linkshänder + Fisch + Experte: keine Rechtshänder-Messer, einseitige nur als Linkshänder-Ausführung', () => {
  for (const rust of ['full', 'any']) {
    const r = matchKnives(A({ level: 'expert', rust, hand: 'left', tasks: ['fisch'] }), data, { onlyAvailable: false, limit: 24 });
    if (rust === 'any') assert.ok(r.items.length > 0, 'mit Kohlenstoffstahl gibt es Linkshänder-Sashimimesser');
    for (const { item } of r.items) {
      assert.ok(item.handed !== 'right', item.handle);
      assert.ok(!(item.bevel === 'single' && item.handed !== 'left'), item.handle);
    }
    for (const t of r.typeRecs) {
      const type = data.entry('types', t.typeId);
      if (type.bevel === 'single') assert.ok(t.warnings.includes('Einseitig geschliffen: nur in Linkshänder-Ausführung sinnvoll'), t.typeId);
    }
  }
  // Rechtshänder bekommen keine Linkshänder-Ausführungen
  const right = matchKnives(A({ level: 'expert', rust: 'any', hand: 'right', tasks: ['fisch'] }), data, { limit: 24 });
  assert.ok(right.items.length > 0 && right.items.every((x) => x.item.handed !== 'left'));
});

test('Linkshänder, beidseitig: Gyuto/Santoku bleiben möglich', () => {
  const r = matchKnives(A({ hand: 'left' }), data);
  assert.ok(r.items.length >= 6);
  assert.ok(r.items.every((x) => x.item.bevel === 'double' || x.item.handed === 'left'));
  assert.ok(r.items.some((x) => x.reasons.some((t) => /für Links- und Rechtshänder/.test(t))));
});

test('Pflege „rough“: nur komplett rostfrei, Warnung zur Spülmaschine, Empfehlung eines robusten Messers', () => {
  const a = A({ level: 'expert', rust: 'any', care: 'rough' });
  const advice = steelAdvice(a, data);
  assert.deepEqual(advice.rustAllowed, ['full']);
  assert.ok(advice.warnings.some((w) => /Spülmaschine/.test(w)));
  assert.ok(advice.bullets.some((b) => /Spülmaschine/.test(b)));
  assert.ok(advice.bullets.some((b) => /europäisch/.test(b)));
  const r = matchKnives(a, data, { limit: 24 });
  assert.ok(r.items.length > 0);
  assert.ok(r.items.every((x) => x.item.rust === 'full'));
  assert.ok(stepNotes('pflege', a, data).some((n) => n.tone === 'warn' && /Spülmaschine/.test(n.text)));
  // Griffe, die nicht quellen, werden bevorzugt und benannt
  assert.ok(r.items.some((x) => x.reasons.includes('Griff quillt nicht durch Wasser')));
  // Rost-Wahl des Experten wird bei „rough“ übergangen und in den Chips so ausgewiesen
  assert.ok(summarize(a, data).some((c) => c.id === 'rust' && /wegen Pflege/.test(c.value) && c.step === null));
});

test('Budget zu klein: schrittweise gelockert und benannt', () => {
  const r = matchKnives(A({ budget: 'lt15' }), data);
  const cheap = data.knives.filter((k) => k.segment === 'home' && ['gyuto', 'santoku'].includes(k.type) && k.rust === 'full' && k.sizes.some((s) => s.available && s.priceJpy <= 16500)).length;
  if (cheap < 4) {
    // Voraussetzung (aus den Daten): weniger als vier Gyuto/Santoku bis ¥16.500 → es muss gelockert werden
    assert.ok(r.relaxed.length >= 1, 'relaxed gefüllt');
    assert.ok(r.relaxed.some((t) => /^Budget: bis ¥18\.750 statt ¥15\.000/.test(t)));
  }
  assert.ok(r.items.length >= 4);
  assert.ok(r.items.every((x) => x.item.rust === 'full' && x.item.sizes[x.sizeIndex].priceJpy <= 15000 * 1.25));
  if (r.relaxed.length) assert.ok(r.items.every((x) => x.item.sizes[x.sizeIndex].priceJpy <= 15000 * (r.relaxedIds.includes('budget') ? 1.25 : 1.1)));

  // Mehrere Wünsche zugleich: Optik fällt zuerst, dann Griff – Rost und Händigkeit bleiben
  const tight = matchKnives(A({ budget: 'lt15', grip: 'wa', looks: ['damascus'], size: 'large' }), data);
  assert.ok(tight.relaxedIds.length >= 1, 'Damast + Wa + groß + bis ¥15.000 ergibt nicht genug Treffer');
  assert.equal(tight.relaxedIds[0], 'looks', 'zuerst fällt die Optik');
  assert.ok(tight.relaxed[0].startsWith('Optik'));
  assert.deepEqual(tight.relaxedIds, ['looks', 'grip', 'budget', 'length'].filter((id) => tight.relaxedIds.includes(id)), 'Reihenfolge Optik → Griff → Budget → Länge');
  assert.ok(tight.items.every((x) => x.item.rust === 'full'));
  // Ohne Wünsche gibt es keine Lockerung
  assert.deepEqual(matchKnives(A({ budget: 'open' }), data).relaxed, []);
});

test('Harte Regeln bleiben auch bei Totallockerung bestehen; leere Ergebnisse sind erklärbar', () => {
  const a = A({ level: 'expert', rust: 'full', hand: 'left', tasks: ['fisch'], grip: 'wa', looks: ['damascus'], budget: 'lt15' });
  const r = matchKnives(a, data, { onlyAvailable: false });
  for (const { item } of r.items) {
    assert.equal(item.rust, 'full');
    assert.ok(item.handed !== 'right' && !(item.bevel === 'single' && item.handed !== 'left'));
  }
  assert.ok(r.items.length === 0 || r.tried.length > 0);
  if (r.total === 0) assert.ok(r.tried.length >= 1, 'versuchte Lockerungen werden genannt');

  // Brotmesser sind laut Katalog alle einseitig für Rechtshänder → Linkshändern wird das ehrlich erklärt
  const bread = data.knives.filter((k) => k.segment === 'home' && k.type === 'bread');
  if (bread.every((k) => k.bevel === 'single' && k.handed === 'right')) {
    const left = matchKnives(A({ tasks: ['brot'], hand: 'left' }), data);
    assert.equal(left.items.length, 0);
    assert.equal(left.typeRecs.length, 0);
    const ex = excludedTypes(A({ tasks: ['brot'], hand: 'left' }), data);
    assert.equal(ex[0].typeId, 'bread');
    assert.equal(ex[0].reason, 'hand');
    assert.match(ex[0].text, /Linkshändern zeigen wir sie nicht/);
  }
  assert.deepEqual(excludedTypes(A({ tasks: ['allround'] }), data), []);
});

test('Spezialmesser: Hinweiskarte statt Sashimi-Messer für Nicht-Experten, Schalter schaltet sie dazu', () => {
  for (const level of ['beginner', 'hobby']) {
    const a = A({ tasks: ['fisch'], level });
    const hint = specialistHint(a, data);
    assert.equal(hint.show, true);
    assert.match(hint.title, /Fisch und Sashimi/);
    assert.match(hint.text, /Gyuto|Santoku/);
    assert.equal(hint.toggleLabel, 'Trotzdem Sashimi-Messer zeigen');
    const plain = matchKnives(a, data);
    assert.ok(plain.typeRecs.every((t) => !hint.types.includes(t.typeId)));
    assert.ok(plain.typeRecs.some((t) => ['gyuto', 'santoku'].includes(t.typeId)));
    assert.ok(plain.items.every((x) => x.item.bevel !== 'single' || !hint.types.includes(x.item.type)));
    const more = matchKnives(a, data, { includeSpecialists: true });
    assert.ok(more.typeRecs.some((t) => hint.types.includes(t.typeId)));
    assert.ok(more.typeRecs.some((t) => !hint.types.includes(t.typeId)), 'ehrliche Alternative bleibt dabei');
    assert.ok(more.items.some((x) => hint.types.includes(x.item.type)));
    assert.ok(more.items.filter((x) => x.item.bevel === 'single').every((x) => x.warnings.some((w) => /Einseitig geschliffen/.test(w))));
    assert.ok(more.typeRecs.find((t) => hint.types.includes(t.typeId)).warnings.some((w) => /^Einseitig geschliffen: händigkeitsgebunden; Händler sehen bei Benutzung und Nachschliff mehr Übungsbedarf$/.test(w)));
  }
  const expert = A({ tasks: ['fisch'], level: 'expert', rust: 'full' });
  assert.equal(specialistHint(expert, data).show, false);
  assert.ok(['yanagiba', 'deba', 'takohiki', 'mioroshi', 'fuguhiki'].includes(recommendTypes(expert, data)[0].typeId));
  assert.equal(specialistHint(A({ tasks: ['allround'] }), data).show, false);
  // Linkshänder-Anfänger, die Sashimi-Messer sehen wollen: nur Linkshänder-Ausführungen
  const left = matchKnives(A({ tasks: ['fisch'], hand: 'left' }), data, { includeSpecialists: true, onlyAvailable: false, limit: 24 });
  for (const { item } of left.items) assert.ok(item.handed !== 'right' && !(item.bevel === 'single' && item.handed !== 'left'));
});

test('Typen: höchstens drei, nur im Katalog vorhandene, Begründungen belegbar', () => {
  for (const task of Object.keys(data.taxonomy.tasks)) {
    for (const level of ['beginner', 'expert']) {
      const recs = recommendTypes(A({ tasks: [task], level, rust: 'any' }), data);
      assert.ok(recs.length <= 3, task);
      for (const t of recs) {
        assert.ok(data.knives.some((k) => k.segment === 'home' && k.type === t.typeId), t.typeId);
        assert.ok(data.entry('types', t.typeId).tasks, `${t.typeId} ohne tasks-Gewichte`);
        assert.ok(t.reasons.length > 0 && t.count > 0 && t.availableCount <= t.count);
      }
      assert.ok(recs.every((t, i) => i === 0 || t.score <= recs[0].score));
    }
  }
  assert.equal(recommendTypes(A({ tasks: ['obst'] }), data)[0].typeId, 'petty');
});

test('Treffer: beste Größe je Artikel, vorrätig, Budget je Größe', () => {
  const a = A({ budget: '15-30', size: 'standard' });
  const r = matchKnives(a, data, { limit: 24 });
  for (const x of r.items) {
    const target = targetLengthMm(x.item.type, 'standard', data);
    const dist = (s) => (s.mm == null ? 1e9 : target < s.mm ? s.mm - target : target > (s.mmMax ?? s.mm) ? target - (s.mmMax ?? s.mm) : 0);
    const chosen = x.item.sizes[x.sizeIndex];
    for (const s of x.item.sizes) {
      if (!s.available || s.priceJpy > 30000 * 1.1) continue;
      assert.ok(dist(chosen) <= dist(s), `${x.item.handle}: ${chosen.label} statt ${s.label}`);
    }
  }
  // ohne „nur vorrätig“ sind nicht vorrätige Größen möglich, die Gesamtzahl wächst
  const all = matchKnives(a, data, { onlyAvailable: false, limit: 24 });
  assert.ok(all.total >= r.total);
  assert.ok(r.totalWithUnavailable >= r.total);
  assert.equal(all.totalWithUnavailable, all.total);
});

test('Treffer: Griff, Optik und Länge wirken als Filter, solange nichts gelockert werden muss', () => {
  const yo = matchKnives(A({ grip: 'yo' }), data);
  assert.deepEqual(yo.relaxed, []);
  assert.ok(yo.items.every((x) => x.item.grip.style === 'yo'));
  const plain = matchKnives(A({ looks: ['plain'] }), data);
  assert.deepEqual(plain.relaxed, []);
  assert.ok(plain.items.every((x) => !(x.item.finish ?? []).some((f) => ['damascus', 'tsuchime', 'kurouchi', 'nashiji', 'dimple'].includes(f))));
  const hammered = matchKnives(A({ looks: ['hammered', 'rustic'] }), data);
  assert.ok(hammered.items.every((x) => (x.item.finish ?? []).some((f) => ['tsuchime', 'dimple', 'kurouchi'].includes(f))));
  const small = matchKnives(A({ size: 'small' }), data);
  const large = matchKnives(A({ size: 'large' }), data);
  const gyutoLen = (r) => r.items.filter((x) => x.item.type === 'gyuto').map((x) => x.item.sizes[x.sizeIndex].mm);
  assert.ok(Math.max(...gyutoLen(small)) <= Math.min(...gyutoLen(large)), 'kleine Größe ergibt kürzere Gyuto als große');
});

test('Vielfalt: nie mehr als drei gleiche Stahl-/Griff-Kombinationen hintereinander', () => {
  for (const a of [A(), A({ tasks: ['gemuese'] }), A({ level: 'expert', rust: 'any', tasks: ['fleisch'] }), A({ tasks: ['obst'], budget: '15-30' }), A({ care: 'rough' })]) {
    for (const limit of [8, 24]) {
      const r = matchKnives(a, data, { limit });
      assert.ok(r.items.length > 0);
      assert.ok(maxRun(r.items) <= 3, `${JSON.stringify(a.tasks)} limit ${limit}: Lauflänge ${maxRun(r.items)}`);
    }
  }
});

test('Typ-Anteile: jeder empfohlene Typ erscheint, Haupt-Typ führt', () => {
  const r = matchKnives(A({ tasks: ['gemuese'] }), data);
  const types = new Set(r.items.map((x) => x.item.type));
  for (const t of r.typeRecs) assert.ok(types.has(t.typeId), `${t.typeId} fehlt in den Treffern`);
  assert.equal(r.items.length, 8);
  const l3 = matchKnives(A({ tasks: ['gemuese'] }), data, { limit: 3 });
  assert.equal(l3.items.length, 3);
  assert.equal(matchKnives(A(), data, { limit: 0 }).items.length, 0);
});

test('Katalog-Abfrage: genau die vereinbarten Schlüssel', () => {
  const q = catalogQuery(A({ budget: '15-30', grip: 'wa', hand: 'left', tasks: ['gemuese'] }), data);
  assert.deepEqual(Object.keys(q).sort(), ['avail', 'grip', 'hand', 'len', 'price', 'rust', 'type']);
  assert.deepEqual(q.rust, ['full']);
  assert.equal(q.grip, 'wa');
  assert.equal(q.hand, 'left');
  assert.equal(q.avail, 1);
  assert.equal(q.price, '15000-33000');
  assert.match(q.len, /^\d+-\d+$/);
  assert.ok(Array.isArray(q.type) && q.type.length >= 1 && q.type.length <= 3);
  assert.deepEqual(q.type, recommendTypes(A({ tasks: ['gemuese'] }), data).map((t) => t.typeId));
  // ohne Wünsche entfallen Griff/Preis; Experte mit „egal“ braucht keinen Rost-Filter
  const open = catalogQuery(A({ level: 'expert', rust: 'any', grip: 'any', budget: 'open' }), data);
  assert.deepEqual(Object.keys(open).sort(), ['avail', 'hand', 'len', 'type']);
  assert.deepEqual(catalogQuery(A({ level: 'expert', rust: 'clad' }), data).rust, ['full', 'clad']);
  assert.equal(catalogQuery(A({ budget: 'gt60' }), data).price, '60000-');
  assert.match(catalogQuery(A({ budget: 'lt15' }), data).price, /^0-16500$/);
});

test('Katalog-Abfrage: Formate werden von lib/filters.js verstanden, Finder-Treffer stehen auch im Katalog', async (t) => {
  const filters = await import('../assets/js/lib/filters.js').catch(() => null);
  const { buildHash, parseHash } = await import('../assets/js/router.js');
  if (typeof filters?.parseFilters !== 'function' || typeof filters?.applyFilters !== 'function') return t.skip('lib/filters.js bietet parseFilters/applyFilters nicht');
  for (const a of [A({ budget: '15-30', grip: 'wa' }), A({ tasks: ['gemuese'], hand: 'left' }), A({ tasks: ['obst'], budget: 'lt15', size: 'large' }), A({ level: 'expert', rust: 'clad', tasks: ['gefluegel'] })]) {
    const query = parseHash(buildHash('/katalog', catalogQuery(a, data))).query;
    const state = filters.parseFilters(query);
    assert.deepEqual(state.type, recommendTypes(a, data).map((r) => r.typeId));
    assert.deepEqual(state.rust, rustAllowed(a));
    assert.equal(state.hand, a.hand);
    assert.equal(state.avail, true);
    assert.ok(state.len && state.len.min < state.len.max);
    const shown = new Set(filters.applyFilters(data.items, state, data).map((i) => i.handle));
    const strict = matchKnives(a, data, { limit: 40 });
    assert.deepEqual(strict.relaxed, [], 'Voraussetzung: strenge Treffer');
    for (const { item } of strict.items) assert.ok(shown.has(item.handle), `${item.handle} fehlt im Katalog-Filter`);
  }
  // Budget-Bereiche: offen nach oben bei „über ¥60.000“
  assert.deepEqual(filters.parseFilters(parseHash(buildHash('/katalog', catalogQuery(A({ budget: 'gt60' }), data))).query).price, { min: 60000, max: null });
  assert.deepEqual(filters.parseFilters(parseHash(buildHash('/katalog', catalogQuery(A({ budget: 'lt15' }), data))).query).price, { min: 0, max: 16500 });
});

test('Profil-Chips: Reihenfolge, Schritt-Verweise, Budget mit Euro', () => {
  const a = A({ who: 'Anna', tasks: ['allround', 'brot'], budget: '15-30', looks: ['damascus', 'hammered'], grip: 'wa' });
  const chips = summarize(a, data);
  assert.deepEqual(chips.map((c) => c.id), ['who', 'tasks', 'level', 'rust', 'care', 'hand', 'grip', 'size', 'budget', 'looks']);
  const ids = new Set(QUESTIONS.map((q) => q.id));
  for (const c of chips) {
    assert.ok(c.step === null || ids.has(c.step), c.id);
    assert.equal(c.text, `${c.label}: ${c.value}`);
  }
  assert.equal(chips.find((c) => c.id === 'who').value, 'Anna');
  assert.equal(chips.find((c) => c.id === 'tasks').value, 'Alles Mögliche im Alltag + Brot');
  assert.equal(chips.find((c) => c.id === 'rust').step, null); // automatisch, nicht änderbar
  assert.equal(chips.find((c) => c.id === 'budget').value, `¥15.000 bis ¥30.000 (≈ ${eur(15000)} bis ${eur(30000)} €)`);
  assert.equal(chips.find((c) => c.id === 'looks').value, 'Damast, Hammerschlag');
  assert.deepEqual(summarize(emptyAnswers(), data), []);
  assert.equal(summarize(A({ level: 'expert', rust: 'clad' }), data).find((c) => c.id === 'rust').step, 'rost');
  assert.equal(budgetText('open', data), 'offen');
  assert.equal(budgetText('gt60', data), `über ¥60.000 (≈ ab ${eur(60000)} €)`);
  assert.equal(budgetText('lt15', { rates: {} }), 'bis ¥15.000'); // ohne Kurs keine Euro-Angabe
});

test('Stahl und Pflege: Erklärung je Erfahrung, drei Rost-Stufen', () => {
  const beginner = steelAdvice(A(), data);
  assert.deepEqual(beginner.tiers.map((t) => [t.id, t.allowed]), [['full', true], ['clad', false], ['none', false]]);
  assert.ok(beginner.tiers.every((t) => t.explain.length > 20 && t.care.length > 5));
  assert.match(beginner.headline, /komplett rostfrei/i);
  assert.ok(beginner.bullets.some((b) => /Wasserstein/.test(b)));
  assert.ok(beginner.bullets.some((b) => /VG-10|Ginsan|AUS/.test(b) && /HRC/.test(b)));
  assert.deepEqual(beginner.warnings, []);
  assert.ok(steelAdvice(A({ care: 'service' }), data).bullets.some((b) => /Schleifdienst|lässt schleifen/.test(b)));
  // Kohlenstoffstahl + Schleifdienst: erlaubt (Wahl des Experten), aber mit ehrlichem Hinweis
  const serviceCarbon = steelAdvice(A({ level: 'expert', rust: 'any', care: 'service' }), data);
  assert.deepEqual(serviceCarbon.rustAllowed, ['full', 'clad', 'none']);
  assert.ok(serviceCarbon.bullets.some((b) => /Bei Schleifdienst bleibt vor allem der Aufwand, nach jedem Gebrauch zu trocknen/.test(b)));
  assert.ok(!steelAdvice(A({ level: 'expert', rust: 'full', care: 'service' }), data).bullets.some((b) => /Bei Schleifdienst bleibt vor allem der Aufwand, nach jedem Gebrauch zu trocknen/.test(b)));
  const clad = steelAdvice(A({ level: 'expert', rust: 'clad' }), data);
  assert.deepEqual(clad.rustAllowed, ['full', 'clad']);
  assert.match(clad.headline, /teilweise/i);
  const any = steelAdvice(A({ level: 'expert', rust: 'any' }), data);
  assert.deepEqual(any.tiers.map((t) => t.allowed), [true, true, true]);
  assert.ok(any.bullets.some((b) => /Kohlenstoffstähle/.test(b)));
  // Experten mit Kohlenstoffstahl bekommen ihn auch in den Treffern – mit Warnung
  const r = matchKnives(A({ level: 'expert', rust: 'any', tasks: ['fleisch'] }), data, { limit: 24 });
  assert.ok(r.items.some((x) => x.item.rust === 'none' && x.warnings.includes('Kohlenstoffstahl: nach jedem Gebrauch abtrocknen')));
});

test('Die Startseite nennt die Zahl der Finder-Fragen (zehn)', () => {
  assert.equal(QUESTIONS.length, 10, 'Wenn sich die Zahl ändert: Text in assets/js/views/home.js anpassen');
});

test('Hinweise und Erklärungen je Schritt', () => {
  assert.ok(stepNotes('pflege', A({ level: 'beginner' }), data).some((n) => /automatisch/.test(n.title) && n.explain?.[0].ids.length === 3));
  assert.ok(!stepNotes('pflege', A({ level: 'expert', rust: 'full' }), data).some((n) => /automatisch/.test(n.title)));
  assert.ok(stepNotes('hand', A({ hand: 'left' }), data).some((n) => /D-förmig/.test(n.text)));
  assert.deepEqual(stepNotes('hand', A({ hand: 'right' }), data), []);
  assert.ok(stepNotes('erfahrung', A({ tasks: ['fisch'] }), data).length === 1);
  assert.deepEqual(stepNotes('erfahrung', A({ tasks: ['fisch'], level: 'expert' }), data), []);
  const rost = explainEntries(QUESTIONS.find((q) => q.id === 'rost'), data);
  assert.deepEqual(rost.map((e) => e.id), ['full', 'clad', 'none']);
  assert.ok(rost.every((e) => e.text.length > 40));
  assert.ok(explainEntries(QUESTIONS.find((q) => q.id === 'hand'), data)[0].text.includes('Linkshänder'));
  assert.deepEqual(explainEntries(QUESTIONS.find((q) => q.id === 'person'), data), []);
});

test('Längen: Wunschlänge je Größe, Rückfall auf Katalog-Mittelwert', () => {
  // small = unteres Ende, standard = Mitte, large = oberes Ende (bei enger Spanne eine Stufe darüber)
  for (const id of ['gyuto', 'santoku', 'petty']) {
    const [lo, hi] = data.entry('types', id).typicalMm;
    assert.equal(targetLengthMm(id, 'small', data), lo, id);
    assert.equal(targetLengthMm(id, 'standard', data), Math.round((lo + hi) / 2), id);
    assert.equal(targetLengthMm(id, 'large', data), hi - lo < 20 ? hi + 15 : hi, id);
  }
  assert.equal(targetLengthMm('gyuto', 'standard', data), 225);
  // ohne typicalMm: Mittelwert der Katalog-Größen dieses Typs
  const noTypical = Object.keys(data.taxonomy.types).find((id) => !data.entry('types', id).typicalMm && data.knives.some((k) => k.segment === 'home' && k.type === id && k.sizes.some((s) => s.mm)));
  if (noTypical) {
    const mms = data.knives.filter((k) => k.segment === 'home' && k.type === noTypical).flatMap((k) => k.sizes.map((s) => (s.mmMax ? (s.mm + s.mmMax) / 2 : s.mm))).filter(Boolean);
    const mean = Math.round(mms.reduce((s, v) => s + v, 0) / mms.length);
    assert.equal(targetLengthMm(noTypical, 'standard', data), mean, noTypical);
    assert.equal(targetLengthMm(noTypical, 'small', data), mean - 15, noTypical);
    assert.equal(targetLengthMm(noTypical, 'large', data), mean + 15, noTypical);
  }
  assert.equal(targetLengthMm('gibt-es-nicht', 'standard', data), null);
});

// ───────────────────────── Fixtures: Logik ohne Abhängigkeit vom Katalogstand ─────────────────────────

const taxonomy = () => ({
  tasks: { allround: { label: 'Alles Mögliche', hint: 'x' }, gemuese: { label: 'Gemüse', hint: 'y' }, fisch: { label: 'Fisch', hint: 'z' } },
  types: {
    gyuto: { label: 'Gyuto', level: 1, bevel: 'double', typicalMm: [210, 240], tasks: { allround: 1, gemuese: 0.6, fisch: 0.3 }, group: 'allround' },
    santoku: { label: 'Santoku', level: 1, bevel: 'double', tasks: { allround: 0.9, gemuese: 0.85, fisch: 0.3 }, group: 'allround' }, // ohne typicalMm
    yanagiba: { label: 'Yanagiba', level: 3, bevel: 'single', typicalMm: [210, 240], tasks: { fisch: 1 }, group: 'fisch' },
    nacktes: { label: 'Nacktes Messer' }, // ohne Gewichte, ohne alles
  },
  steels: {
    vg10: { label: 'VG-10', short: 'VG-10', hardnessHrc: [59, 61], beginnerFriendly: true, beginnerReason: 'Rostfreier Stahl ist weit weniger reaktiv.' },
    zdp189: { label: 'ZDP-189', short: 'ZDP-189', hardnessHrc: [65, 67], beginnerFriendly: false },
    aogami2: { label: 'Aogami #2', short: 'Aogami #2', hardnessHrc: [61, 63], beginnerFriendly: false },
    mo: { label: 'Molybdän-Stahl', short: 'Mo-Stahl', summary: 'Molybdän-Stahl laut Shop: die genaue Sorte ist nicht angegeben.', beginnerFriendly: true, beginnerReason: 'Rostfreier Stahl ist weit weniger reaktiv.' },
    unknown: { label: 'Stahl nicht angegeben', short: 'o. A.' },
  },
  rust: { full: { label: 'Komplett rostfrei', care: 'Von Hand spülen.', explain: 'Durchgehend rostfrei.' }, clad: { label: 'Teilweise rostfrei', care: 'Abtrocknen.', explain: 'Mantel rostfrei.' }, none: { label: 'Nicht rostfrei', care: 'Sofort abtrocknen.', explain: 'Kohlenstoffstahl.' } },
  handleStyles: { wa: { label: 'Japanischer Griff (Wa)', short: 'Wa-Griff' }, yo: { label: 'Westlicher Griff (Yō)', short: 'Yō-Griff' } },
  handleShapes: { octagonal: { label: 'Achteckig' }, curved: { label: 'Gebogen' } },
});

const fixture = (items) => buildData({ meta: { fetchedAt: '2026-11-21T00:00:00Z' }, items }, taxonomy(), { shop: { url: 'https://tsubaya.jp/en' }, rates: { perUnit: { EUR: 174.35 } } });

let counter = 0;
const knife = (o = {}) => {
  counter += 1;
  const sizes = o.sizes ?? [{ label: '21cm', mm: 210, priceJpy: o.price ?? 20000, available: true, sku: `S${counter}` }];
  const { price, ...rest } = o;
  void price;
  return { id: counter, handle: `k${counter}`, title: `Knife ${counter}`, category: 'knife', segment: 'home', type: 'gyuto', steel: { id: 'vg10', family: 'stainless' }, rust: 'full', bevel: 'double', handed: 'both', grip: { style: 'wa', material: 'walnut', shape: 'octagonal' }, finish: [], sizes, priceFrom: sizes[0].priceJpy, priceTo: sizes.at(-1).priceJpy, available: sizes.some((s) => s.available), ...rest };
};

test('Fixture: Lockerungsreihenfolge Optik → Griff → Budget → Länge, nur wirksame Schritte werden genannt', () => {
  const items = [
    knife({ price: 12000, grip: { style: 'wa' }, finish: ['damascus'] }),
    knife({ price: 12000, grip: { style: 'wa' }, finish: [] }),
    knife({ price: 14000, grip: { style: 'yo' }, finish: ['damascus'] }),
    knife({ price: 14000, grip: { style: 'yo' }, finish: [] }),
    knife({ price: 40000, grip: { style: 'wa' }, finish: ['damascus'] }),
  ];
  const d = fixture(items);
  const strict = matchKnives(A({ budget: 'lt15', grip: 'wa', looks: ['damascus'] }), d);
  assert.deepEqual(strict.relaxedIds, ['looks', 'grip']);
  assert.equal(strict.total, 4);
  assert.deepEqual(strict.relaxed, ['Optik: auch andere Oberflächen', 'Griff: auch westliche (Yō-)Griffe']);
  assert.ok(strict.items.every((x) => x.item.sizes[0].priceJpy <= 16500), '40.000 bleibt draußen');
  // genügend Treffer → nichts zu lockern
  const enough = matchKnives(A({ budget: 'lt15' }), d);
  assert.deepEqual(enough.relaxed, []);
  assert.equal(enough.total, 4);
  // nur Optik-Wunsch, nur zwei Treffer: Optik wird gelockert, Budget bleibt, weil es nichts bringt
  const only = matchKnives(A({ budget: 'lt15', looks: ['damascus'], grip: 'yo' }), d);
  assert.ok(only.relaxedIds.includes('looks'));
});

test('Fixture: Budget +25 %, Länge zuletzt; Rost und Händigkeit werden nie gelockert', () => {
  const items = [
    knife({ price: 16000 }),
    knife({ price: 17000 }),
    knife({ price: 17500 }),
    knife({ price: 17000, sizes: [{ label: '30cm', mm: 300, priceJpy: 17000, available: true, sku: 'long' }] }),
    knife({ price: 25000 }),
    // diese drei dürfen unter keinen Umständen auftauchen
    knife({ price: 12000, rust: 'none', steel: { id: 'aogami2', family: 'carbon' } }),
    knife({ price: 12000, rust: 'clad' }),
    knife({ price: 12000, handed: 'left' }),
  ];
  const d = fixture(items);
  const r = matchKnives(A({ budget: 'lt15', hand: 'right' }), d);
  assert.deepEqual(r.relaxedIds, ['budget', 'length']);
  assert.equal(r.relaxed[0], 'Budget: bis ¥18.750 statt ¥15.000 (+25 %)');
  assert.equal(r.relaxed[1], 'Länge: auch kürzere und längere Größen');
  assert.equal(r.items.length, 4);
  for (const { item } of r.items) {
    assert.equal(item.rust, 'full', 'Rost nie gelockert');
    assert.notEqual(item.handed, 'left', 'Händigkeit nie gelockert');
  }
  assert.ok(r.items.some((x) => x.item.sizes[x.sizeIndex].mm === 300), 'Länge gelockert: die lange Größe ist dabei');
  assert.ok(r.items.every((x) => x.item.sizes[x.sizeIndex].priceJpy <= 18750));
  const long = r.items.find((x) => x.item.sizes[x.sizeIndex].mm === 300);
  assert.ok(long.warnings.some((w) => /weicht von der Wunschlänge/.test(w)));
  assert.ok(r.items.some((x) => x.warnings.some((w) => /über dem Budget/.test(w))));
  // Linkshänder: weder Rechtshänder-Einseitige noch explizit rechtshändige Artikel
  const mixed = fixture([knife(), knife({ bevel: 'single', handed: 'right' }), knife({ bevel: 'single', handed: 'left' }), knife({ handed: 'right' }), knife({ handed: 'left' })]);
  const left = matchKnives(A({ budget: 'open', hand: 'left' }), mixed, { limit: 20 });
  assert.equal(left.items.length, 3);
  assert.ok(left.items.every((x) => (x.item.bevel === 'double' && x.item.handed !== 'right') || x.item.handed === 'left'));
  const right = matchKnives(A({ budget: 'open', hand: 'right' }), mixed, { limit: 20 });
  assert.ok(right.items.every((x) => x.item.handed !== 'left'));
});

test('Fixture: Größe je Artikel und Budget je Größe', () => {
  const multi = knife({
    sizes: [
      { label: '18cm', mm: 180, priceJpy: 15000, available: true, sku: 'a' },
      { label: '21cm', mm: 210, priceJpy: 24000, available: true, sku: 'b' },
      { label: '24cm', mm: 240, priceJpy: 52000, available: true, sku: 'c' },
      { label: '27cm', mm: 270, priceJpy: 70000, available: false, sku: 'd' },
    ],
  });
  const d = fixture([multi]);
  const std = matchKnives(A({ budget: '15-30' }), d);
  assert.equal(std.items.length, 1);
  assert.equal(std.items[0].sizeIndex, 1, '21 cm: nah an 22,5 cm und im Budget');
  assert.ok(std.items[0].reasons.some((t) => t === '21 cm: nahe der Wunschlänge (etwa 22,5 cm)'));
  assert.ok(std.items[0].reasons.some((t) => t === '¥24.000 – im Budget'));
  // offenes Budget und große Größe: 24 cm
  assert.equal(matchKnives(A({ size: 'large' }), d).items[0].sizeIndex, 2);
  // 27 cm ist nicht vorrätig: ohne „nur vorrätig“ wäre es bei sehr großem Wunsch möglich, mit Schalter nie
  assert.ok(matchKnives(A(), d).items.every((x) => x.item.sizes[x.sizeIndex].available));
});

test('Fixture: Warnungen sind sachlich und belegbar', () => {
  const items = [
    knife({ steel: { id: 'aogami2', family: 'carbon' }, rust: 'none', finish: ['kurouchi'] }),
    knife({ steel: { id: 'zdp189', family: 'stainless' } }),
    knife({ steel: { id: 'unknown', family: 'stainless' } }),
    knife({ steel: { id: 'mo', family: 'stainless' } }),
    knife({ flags: ['steel-family-conflict(title=carbon,tags=carbon,shop=stainless→carbon)'], notes: ['one-off'] }),
  ];
  const d = fixture(items);
  const r = matchKnives(A({ level: 'expert', rust: 'any', budget: 'open' }), d, { limit: 10 });
  const by = (steel) => r.items.find((x) => x.item.steel.id === steel);
  assert.ok(by('aogami2').warnings.includes('Kohlenstoffstahl: nach jedem Gebrauch abtrocknen'));
  assert.ok(by('zdp189').warnings.some((w) => /^Härte 65\+ HRC: ab 65 HRC spröder, Ausbrüche bei Knochen oder Verdrehen möglich \(Knives and Stones\)$/.test(w)));
  assert.ok(by('unknown').warnings.includes('Sorte nicht angegeben'));
  assert.ok(by('mo').warnings.some((w) => /^Sorte nicht angegeben \(nur „Mo-Stahl“ laut Shop\)$/.test(w)));
  assert.ok(r.items.some((x) => x.warnings.includes('Stahlangabe im Katalog widersprüchlich – im Laden nachfragen')));
  assert.ok(r.items.some((x) => x.warnings.includes('Einzelstück laut Shop')));
  // Einsteiger: Mo-Stahl bekommt wegen unklarer Sorte keinen Stahl-Grund; VG-10 nennt den Grund der Taxonomie
  const beginner = matchKnives(A({ level: 'beginner' }), d, { limit: 10 });
  assert.ok(!beginner.items.find((x) => x.item.steel.id === 'mo').reasons.some((t) => /^Mo-Stahl:/.test(t)));
  assert.ok(beginner.items.find((x) => x.item.steel.id === 'vg10').reasons.some((t) => /^VG-10: Rostfreier Stahl ist weit weniger reaktiv\.$/.test(t)));
  // Linkshänder + Wa-Griff mit unbekannter/asymmetrischer Form
  const odd = fixture([knife({ grip: { style: 'wa', shape: 'curved' } }), knife({ grip: { style: 'wa', shape: 'octagonal' } })]);
  const left = matchKnives(A({ hand: 'left' }), odd);
  assert.ok(left.items.some((x) => x.warnings.some((w) => /D-förmige Griffe sind laut Kireaji meist für Rechtshänder ausgerichtet/.test(w))));
  assert.ok(left.items.some((x) => !x.warnings.some((w) => /D-förmige/.test(w))));
});

test('Fixture: Spezialtypen, fehlende Taxonomie-Felder und Typ ohne Gewichte', () => {
  const d = fixture([knife({ type: 'yanagiba', bevel: 'single', handed: 'right', price: 30000, sizes: [{ label: '24cm', mm: 240, priceJpy: 30000, available: true, sku: 'y' }] }), knife({ type: 'nacktes' }), knife({ type: 'gyuto' }), knife({ type: 'santoku', sizes: [{ label: '16cm', mm: 160, priceJpy: 20000, available: true, sku: 's1' }, { label: '18cm', mm: 180, priceJpy: 22000, available: true, sku: 's2' }] })]);
  const fish = A({ tasks: ['fisch'] });
  assert.ok(!matchKnives(fish, d).items.some((x) => x.item.type === 'yanagiba'));
  assert.ok(matchKnives(fish, d, { includeSpecialists: true }).items.some((x) => x.item.type === 'yanagiba'));
  assert.ok(matchKnives({ ...fish, level: 'expert', rust: 'full' }, d).items.some((x) => x.item.type === 'yanagiba'));
  // Typ ohne tasks wird nie empfohlen; Santoku ohne typicalMm → Mittelwert der Katalog-Größen (170 mm)
  const recs = recommendTypes(A(), d);
  assert.ok(!recs.some((t) => t.typeId === 'nacktes'));
  assert.equal(targetLengthMm('santoku', 'standard', d), 170);
  const santoku = matchKnives(A({ tasks: ['allround'] }), d).items.find((x) => x.item.type === 'santoku');
  assert.equal(santoku.sizeIndex, 0, '16 cm liegt näher an 17 cm als 18 cm');
  // Katalog ganz ohne passende Messer: leere Ergebnisse, keine Fehler
  const empty = fixture([]);
  const r = matchKnives(A(), empty);
  assert.deepEqual([r.items, r.total, r.typeRecs, r.relaxed], [[], 0, [], []]);
  assert.doesNotThrow(() => steelAdvice(A(), empty));
  assert.doesNotThrow(() => catalogQuery(A(), empty));
  assert.doesNotThrow(() => specialistHint(A(), empty));
  assert.doesNotThrow(() => excludedTypes(A(), empty));
  // Taxonomie fast leer
  const bare = buildData({ meta: {}, items: [knife()] }, { types: { gyuto: { label: 'Gyuto', tasks: { allround: 1 } } } }, {});
  assert.doesNotThrow(() => matchKnives(A(), bare));
  assert.doesNotThrow(() => summarize(A(), bare));
  assert.doesNotThrow(() => QUESTIONS.map((q) => q.options(bare)));
  assert.equal(matchKnives(A(), bare).items.length, 1);
});

test('Fixture: Vielfalt greift auch, wenn viele Treffer dieselbe Kombination haben', () => {
  const same = Array.from({ length: 9 }, (_, i) => knife({ price: 20000 + i * 100 }));
  const other = [knife({ steel: { id: 'aogami2', family: 'carbon' }, rust: 'full', price: 21000 }), knife({ grip: { style: 'yo' }, price: 22000 }), knife({ steel: { id: 'mo', family: 'stainless' }, price: 23000 })];
  const d = fixture([...same, ...other]);
  const r = matchKnives(A(), d, { limit: 12 });
  assert.equal(r.items.length, 12);
  assert.ok(maxRun(r.items) <= 3, `Lauflänge ${maxRun(r.items)}`);
  // sind alle gleich, ist die Wiederholung unvermeidbar – aber es gibt keinen Absturz
  const allSame = matchKnives(A(), fixture(same), { limit: 8 });
  assert.equal(allSame.items.length, 8);
});

test('Budget-Bänder: Obergrenzen wie vereinbart', () => {
  assert.equal(BUDGETS.lt15.max, 15000);
  assert.deepEqual([BUDGETS['15-30'].min, BUDGETS['15-30'].max], [15000, 30000]);
  assert.deepEqual([BUDGETS['30-60'].min, BUDGETS['30-60'].max], [30000, 60000]);
  assert.equal(BUDGETS.gt60.min, 60000);
  assert.equal(BUDGETS.gt60.max, Infinity);
  assert.equal(BUDGETS.open.max, Infinity);
});
