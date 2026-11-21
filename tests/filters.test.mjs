// Tests für lib/filters.js: URL-Zustand, Filter-Semantik, Facetten, Volltext, Sortierung – plus Plausibilität gegen data/knives.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildData } from '../assets/js/data.js';
import { parseHash, buildHash } from '../assets/js/router.js';
import { collator } from '../assets/js/util.js';
import {
  defaultState,
  parseFilters,
  serializeFilters,
  parseRange,
  applyFilters,
  facetCounts,
  matchQuery,
  searchText,
  relevance,
  normalizeText,
  queryTokens,
  effectiveSort,
  resetFilters,
  activeFilters,
  activeFilterCount,
  removeFilter,
  suggestRelaxations,
  similarItems,
  TYPE_GROUP_ORDER,
} from '../assets/js/lib/filters.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const data = buildData(read('data/knives.json'), read('data/taxonomy.json'), read('data/site.json'));
const items = data.items;
const run = (query) => applyFilters(items, parseFilters(query), data);
const handles = (list) => new Set(list.map((i) => i.handle));

/** Künstlicher Artikel für Größen-Tests */
const mk = (over = {}) => ({ handle: 'x', title: 'X', category: 'knife', segment: 'home', type: 'gyuto', sizes: [], priceFrom: 0, available: true, ...over });
const sz = (mm, priceJpy, available = true, extra = {}) => ({ mm, priceJpy, available, ...extra });
const plain = { taxonomy: {} }; // reicht für Filter ohne Taxonomie-Bezug

// ───────────────────────────── URL-Zustand ─────────────────────────────

test('parse/serialize: vollständiger Round-Trip, nur Nicht-Standardwerte', () => {
  const query = {
    q: 'vg-10 gyuto',
    type: 'gyuto,santoku',
    steel: 'vg10,aus10',
    rust: 'full,clad',
    grip: 'wa,yo',
    bevel: 'double',
    hand: 'left',
    len: '180-240',
    price: '0-30000',
    finish: 'damascus,tsuchime',
    maker: 'Takeda Hamono,栗忠製作所',
    avail: '1',
    gastro: '1',
    cat: 'sharpening',
    sort: 'price-asc',
  };
  const state = parseFilters(query);
  assert.deepEqual(state.type, ['gyuto', 'santoku']);
  assert.deepEqual(state.len, { min: 180, max: 240 });
  assert.deepEqual(state.price, { min: 0, max: 30000 });
  assert.equal(state.avail, true);
  assert.deepEqual(serializeFilters(state), query);
  assert.deepEqual(parseFilters(serializeFilters(state)), state);

  // Durch den Router-Hash (URL-Kodierung von Leerzeichen, Komma, CJK, Sonderzeichen) und zurück
  const hash = buildHash('/katalog', serializeFilters(state));
  assert.deepEqual(parseFilters(parseHash(hash).query), state);
  const odd = parseFilters({ q: 'Santoku & "Gyuto" 17,5 cm?', maker: 'Yoshida Hamono' });
  assert.deepEqual(parseFilters(parseHash(buildHash('/katalog', serializeFilters(odd))).query), odd);
});

test('parse: Standardzustand, Ignorieren von Ungültigem, andere Eingabeformen', () => {
  assert.deepEqual(parseFilters({}), defaultState());
  assert.deepEqual(parseFilters(), defaultState());
  assert.deepEqual(serializeFilters(defaultState()), {});
  assert.deepEqual(serializeFilters({}), {}, 'Teilzustände werden ergänzt');

  const bad = parseFilters({ rust: 'foo,full', grip: 'plastic', bevel: 'x', hand: 'both', cat: 'x', sort: 'bogus', len: 'abc', price: '-', avail: '0', gastro: 'no', unbekannt: '1' });
  assert.deepEqual(bad.rust, ['full']);
  assert.deepEqual(bad.grip, []);
  assert.equal(bad.bevel, '');
  assert.equal(bad.hand, '');
  assert.equal(bad.cat, 'knife');
  assert.equal(bad.sort, 'default');
  assert.equal(bad.len, null);
  assert.equal(bad.price, null);
  assert.equal(bad.avail, false);
  assert.equal(bad.gastro, false);
  assert.equal(parseFilters({ bevel: 'single,double' }).bevel, '', 'beide Schliffarten = kein Filter');
  assert.deepEqual(parseFilters({ type: 'gyuto,gyuto, santoku,' }).type, ['gyuto', 'santoku'], 'Duplikate und Leerwerte fallen weg');
  assert.equal(parseFilters({ q: '  vg-10   gyuto  ' }).q, 'vg-10 gyuto');

  assert.deepEqual(parseFilters('?type=gyuto&avail=1').type, ['gyuto']);
  assert.equal(parseFilters('#/katalog?type=gyuto&avail=1').avail, true);
  assert.deepEqual(parseFilters(new URLSearchParams('rust=none&hand=right')).rust, ['none']);
  assert.equal(parseFilters(new URLSearchParams('rust=none&hand=right')).hand, 'right');
});

test('parseRange: offene Enden, einzelne Zahl, Dezimalkomma, vertauschte Grenzen', () => {
  assert.deepEqual(parseRange('180-240'), { min: 180, max: 240 });
  assert.deepEqual(parseRange('180-'), { min: 180, max: null });
  assert.deepEqual(parseRange('-240'), { min: null, max: 240 });
  assert.deepEqual(parseRange('210'), { min: 210, max: 210 });
  assert.deepEqual(parseRange('13,5-21'), { min: 13.5, max: 21 });
  assert.deepEqual(parseRange('240-180'), { min: 180, max: 240 });
  assert.equal(parseRange('0-'), null, '„ab 0“ schränkt nichts ein');
  assert.equal(parseRange('-'), null);
  assert.equal(parseRange(''), null);
  assert.equal(parseRange('abc'), null);
  assert.equal(parseRange(null), null);
  assert.equal(serializeFilters({ len: { min: 180, max: null } }).len, '180-');
  assert.equal(serializeFilters({ price: { min: null, max: 30000 } }).price, '-30000');
});

test('effectiveSort, resetFilters, activeFilters, removeFilter', () => {
  assert.equal(effectiveSort({ q: 'gyuto', sort: 'default' }), 'relevance', 'mit Suchtext ohne eigene Wahl: Relevanz');
  assert.equal(effectiveSort({ q: '', sort: 'relevance' }), 'default', 'Relevanz ohne Suchtext: Standard');
  assert.equal(effectiveSort({ q: 'gyuto', sort: 'price-asc' }), 'price-asc');
  assert.equal(effectiveSort({}), 'default');

  const state = parseFilters({ q: 'vg10', type: 'gyuto,santoku', rust: 'full', len: '180-240', price: '-30000', hand: 'left', avail: '1', gastro: '1', maker: 'Masahiro', sort: 'name' });
  assert.deepEqual(resetFilters(state), { ...defaultState(), sort: 'name' }, 'Zurücksetzen behält nur die Sortierung');

  const chips = activeFilters(state, data);
  const keys = chips.map((c) => c.key);
  assert.deepEqual(keys.filter((k) => k === 'type').length, 2, 'ein Chip je Listenwert');
  for (const k of ['q', 'rust', 'len', 'price', 'hand', 'avail', 'gastro', 'maker']) assert.ok(keys.includes(k), `Chip für ${k}`);
  assert.ok(chips.every((c) => c.text && !/undefined|null/.test(c.text)), 'lesbare Texte: ' + chips.map((c) => c.text).join(' | '));
  assert.equal(activeFilterCount(state, data), chips.length - 1, 'Suchtext zählt nicht für „Filter (n aktiv)“');
  assert.equal(chips.find((c) => c.key === 'len').text, 'Länge 18–24 cm');
  assert.equal(chips.find((c) => c.key === 'price').text, 'Preis bis ¥30.000');

  assert.deepEqual(removeFilter(state, 'type', 'gyuto').type, ['santoku']);
  assert.deepEqual(removeFilter(state, 'type').type, []);
  assert.equal(removeFilter(state, 'q').q, '');
  assert.equal(removeFilter(state, 'len').len, null);
  assert.equal(removeFilter(state, 'hand').hand, '');
  assert.equal(removeFilter(state, 'avail').avail, false);
  assert.equal(removeFilter(removeFilter(state, 'gastro'), 'gastro').gastro, false);
  assert.deepEqual(state.type, ['gyuto', 'santoku'], 'Eingabe bleibt unverändert');
  // Jeder Chip entfernt genau seinen Filter
  for (const c of chips) assert.equal(activeFilters(removeFilter(state, c.key, c.value), data).length, chips.length - 1, `entfernt ${c.text}`);
});

// ───────────────────────────── Filter-Semantik ─────────────────────────────

test('Standard: nur Messer der Haushaltslinie; gastro=1 blendet die Profi-Linie zusätzlich ein', () => {
  const home = run({});
  assert.ok(home.length > 0);
  assert.ok(home.every((i) => i.category === 'knife' && i.segment === 'home'));
  assert.equal(home.length, items.filter((i) => i.category === 'knife' && i.segment === 'home').length);

  const all = run({ gastro: '1' });
  const gastro = items.filter((i) => i.category === 'knife' && i.segment === 'gastro');
  assert.ok(gastro.length > 0, 'Datensatz enthält Gastro-Messer');
  assert.equal(all.length, home.length + gastro.length);
  assert.ok(all.every((i) => i.category === 'knife'));
  assert.ok(gastro.every((i) => handles(all).has(i.handle)) && gastro.every((i) => !handles(home).has(i.handle)));
});

test('cat: Zubehör und Sonstiges, unabhängig von der Messer-Linie', () => {
  const sharp = run({ cat: 'sharpening' });
  assert.ok(sharp.length > 0 && sharp.every((i) => i.category === 'sharpening'));
  assert.equal(sharp.length, items.filter((i) => i.category === 'sharpening').length);
  const tools = run({ cat: 'tool' });
  assert.ok(tools.length > 0 && tools.every((i) => i.category === 'tool'));
  assert.equal(run({ cat: 'sharpening', gastro: '1' }).length, sharp.length);
});

test('hand: left blendet Rechtshänder-Messer aus, right die Linkshänder-Messer; beidhändige bleiben', () => {
  const base = run({ gastro: '1' });
  const left = run({ hand: 'left', gastro: '1' });
  const right = run({ hand: 'right', gastro: '1' });
  assert.ok(left.every((i) => i.handed !== 'right'));
  assert.ok(right.every((i) => i.handed !== 'left'));
  assert.ok(left.some((i) => i.handed === 'left') && left.some((i) => i.handed === 'both'));
  assert.equal(left.length, base.filter((i) => i.handed !== 'right').length);
  assert.equal(right.length, base.filter((i) => i.handed !== 'left').length);
  assert.ok(left.length < base.length && right.length < base.length, 'Datensatz enthält einseitige Messer beider Händigkeiten');
  // Synthetisch
  const list = [mk({ handle: 'l', handed: 'left' }), mk({ handle: 'r', handed: 'right' }), mk({ handle: 'b', handed: 'both' }), mk({ handle: 'n', handed: null })];
  const hs = (state) => applyFilters(list, parseFilters(state), plain).map((i) => i.handle).sort();
  assert.deepEqual(hs({ hand: 'left' }), ['b', 'l', 'n']);
  assert.deepEqual(hs({ hand: 'right' }), ['b', 'n', 'r']);
  assert.deepEqual(hs({}), ['b', 'l', 'n', 'r']);
});

test('len/price: ein Artikel passt, wenn irgendeine Größe im Bereich liegt', () => {
  const a = mk({ handle: 'a', sizes: [sz(150, 10000, false), sz(210, 40000)], priceFrom: 10000, priceTo: 40000 });
  const ranged = mk({ handle: 'r', sizes: [sz(220, 20000, true, { mmMax: 240 })] });
  const noMm = mk({ handle: 'g', category: 'knife', sizes: [{ label: '320', mm: null, priceJpy: 5000, available: true }] });
  const list = [a, ranged, noMm];
  const hits = (query) => applyFilters(list, parseFilters(query), plain).map((i) => i.handle).sort();

  // Länge
  assert.deepEqual(hits({ len: '200-240' }), ['a', 'r'], '210 mm bzw. 220–240 mm liegen im Bereich');
  assert.deepEqual(hits({ len: '100-160' }), ['a'], 'die kleine Größe genügt');
  assert.deepEqual(hits({ len: '300-400' }), []);
  assert.deepEqual(hits({ len: '235-250' }), ['r'], 'Spanne mmMax überlappt');
  assert.deepEqual(hits({ len: '241-250' }), []);
  assert.deepEqual(hits({ len: '210-210' }), ['a'], 'Grenzen sind inklusiv');
  assert.deepEqual(hits({ len: '230-' }), ['r'], 'offenes Ende');
  assert.deepEqual(hits({ len: '-150' }), ['a']);
  assert.ok(hits({}).includes('g') && !hits({ len: '0-9999' }).includes('g'), 'Größen ohne mm passen nie auf einen Längenfilter');
  // Preis: jede Größe einzeln, nicht die Spanne zwischen niedrigster und höchster
  assert.deepEqual(hits({ price: '0-12000' }), ['g', 'a'].sort(), '10.000 passt, 5.000 (ohne mm) ebenfalls');
  assert.deepEqual(hits({ price: '45000-' }), []);
  assert.deepEqual(hits({ price: '20000-30000' }), ['r'], 'a hat 10.000 und 40.000, aber nichts dazwischen');
  assert.deepEqual(hits({ price: '40000' }), ['a'], 'einzelne Zahl = genau dieser Preis');
});

test('Größenfilter (len, price, avail) gelten gemeinsam für dieselbe Größe', () => {
  const a = mk({ handle: 'a', sizes: [sz(150, 10000, false), sz(210, 40000, true)], available: true });
  const hits = (query) => applyFilters([a], parseFilters(query), plain).length;
  assert.equal(hits({ avail: '1' }), 1, 'mindestens eine Größe vorrätig');
  assert.equal(hits({ len: '140-160' }), 1);
  assert.equal(hits({ avail: '1', len: '140-160' }), 0, 'die 15-cm-Größe ist nicht vorrätig');
  assert.equal(hits({ avail: '1', len: '200-220' }), 1);
  assert.equal(hits({ len: '200-220', price: '0-12000' }), 0, '21 cm kostet 40.000, 15 cm liegt nicht in 20–22 cm');
  assert.equal(hits({ len: '140-220', price: '0-12000' }), 1);
  assert.equal(hits({ len: '140-160', price: '0-12000', avail: '1' }), 0);
  // avail=1: Artikel ohne vorrätige Größe fallen heraus
  assert.equal(applyFilters([mk({ sizes: [sz(150, 1000, false)], available: false })], parseFilters({ avail: '1' }), plain).length, 0);
});

test('Listenfilter: ODER innerhalb, UND zwischen den Gruppen', () => {
  const list = [
    mk({ handle: '1', type: 'gyuto', steel: { id: 'vg10' }, rust: 'full', finish: ['damascus'], maker: 'A', bevel: 'double', grip: { style: 'wa' } }),
    mk({ handle: '2', type: 'santoku', steel: { id: 'aus10' }, rust: 'full', finish: ['tsuchime', 'damascus'], maker: 'B', bevel: 'double', grip: { style: 'yo' } }),
    mk({ handle: '3', type: 'yanagiba', steel: { id: 'shirogami1' }, rust: 'none', finish: [], maker: 'A', bevel: 'single', grip: { style: 'wa' } }),
  ];
  const hits = (query) => applyFilters(list, parseFilters(query), plain).map((i) => i.handle).sort();
  assert.deepEqual(hits({ type: 'gyuto,santoku' }), ['1', '2']);
  assert.deepEqual(hits({ type: 'gyuto,santoku', rust: 'none' }), []);
  assert.deepEqual(hits({ steel: 'vg10,shirogami1' }), ['1', '3']);
  assert.deepEqual(hits({ finish: 'tsuchime' }), ['2']);
  assert.deepEqual(hits({ finish: 'damascus,tsuchime' }), ['1', '2'], 'mehrwertige Oberfläche: eine genügt');
  assert.deepEqual(hits({ maker: 'A', grip: 'wa' }), ['1', '3']);
  assert.deepEqual(hits({ bevel: 'single' }), ['3']);
  assert.deepEqual(hits({ rust: 'full,clad' }), ['1', '2']);
});

// ───────────────────────────── Facetten ─────────────────────────────

test('facetCounts: Anzahl je Wert = Treffer, wenn nur dieser Wert der Gruppe gewählt wäre (disjunktiv)', () => {
  const state = parseFilters({ type: 'gyuto,santoku', rust: 'full', len: '180-270', avail: '1', bevel: 'double' });
  const counts = facetCounts(items, state, data);
  const hitsWith = (patch) => applyFilters(items, { ...state, ...patch }, data).length;

  // Eigene Auswahl zählt nicht mit: nakiri ist nicht gewählt, hat aber seine Zahl unter den übrigen Filtern
  assert.ok(counts.type.nakiri > 0 && counts.type.nakiri === hitsWith({ type: ['nakiri'] }));
  assert.equal(counts.type.gyuto, hitsWith({ type: ['gyuto'] }));
  assert.equal(counts.type.gyuto + counts.type.santoku, hitsWith({}), 'gewählte Typen ergeben die Treffer');

  for (const key of ['type', 'steel', 'rust', 'grip', 'finish', 'maker']) {
    const entries = Object.entries(counts[key]);
    assert.ok(entries.length > 0, `Facette ${key} hat Werte`);
    for (const [value, n] of entries) assert.equal(n, hitsWith({ [key]: [value] }), `${key}=${value}`);
  }
  for (const [value, n] of Object.entries(counts.bevel)) assert.equal(n, hitsWith({ bevel: value }), `bevel=${value}`);
  assert.equal(counts.hand.left, hitsWith({ hand: 'left' }));
  assert.equal(counts.hand.right, hitsWith({ hand: 'right' }));
  assert.equal(counts.avail[1], hitsWith({ avail: true }));
  assert.equal(counts.gastro[1], hitsWith({ gastro: true }) - hitsWith({ gastro: false }));
  assert.ok(counts.rust.none > 0 && counts.rust.none === hitsWith({ rust: ['none'] }), 'abgewählte Rost-Stufe zeigt die Zahl, die sie brächte');
});

test('facetCounts: ohne Filter stimmen die Summen mit den Treffern überein', () => {
  const state = defaultState();
  const total = applyFilters(items, state, data).length;
  const counts = facetCounts(items, state, data);
  const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
  assert.equal(sum(counts.type), total, 'jeder Messerartikel hat genau einen Typ');
  assert.equal(sum(counts.rust) + items.filter((i) => i.category === 'knife' && i.segment === 'home' && !i.rust).length, total);
  assert.equal(sum(counts.bevel), total);
  assert.equal(counts.cat.knife, total);
  assert.equal(counts.cat.sharpening, items.filter((i) => i.category === 'sharpening').length);
  assert.equal(counts.cat.tool, items.filter((i) => i.category === 'tool').length);
  assert.equal(counts.avail[1], applyFilters(items, { ...state, avail: true }, data).length);
  assert.equal(counts.gastro[1], items.filter((i) => i.category === 'knife' && i.segment === 'gastro').length);
  assert.equal(counts.hand.left + counts.hand.right >= total, true);
});

test('facetCounts: Suche und Größenfilter wirken auf alle Facetten, die Art zählt nur geteilte Filter', () => {
  const state = parseFilters({ q: 'gyuto', price: '-30000', type: 'santoku' });
  const counts = facetCounts(items, state, data);
  // type=santoku ist gewählt, die Zahl bei gyuto zeigt trotzdem die Gyuto-Treffer mit Suche + Preis
  assert.equal(counts.type.gyuto, applyFilters(items, { ...state, type: ['gyuto'] }, data).length);
  // Art: Zubehör zählt nur unter Suche/Preis/Hersteller, nicht unter type=santoku
  assert.equal(counts.cat.sharpening ?? 0, applyFilters(items, { ...defaultState(), q: 'gyuto', price: { min: null, max: 30000 }, cat: 'sharpening' }, data).length);
  const stones = facetCounts(items, parseFilters({ q: 'shapton', type: 'santoku' }), data);
  assert.equal(stones.cat.sharpening, applyFilters(items, parseFilters({ q: 'shapton', cat: 'sharpening' }), data).length, 'Zubehör ignoriert den Messer-Typ');
  assert.ok(stones.cat.sharpening > 0);
  assert.equal(counts.cat.knife, applyFilters(items, { ...state, type: [] }, data).length);
});

// ───────────────────────────── Volltext ─────────────────────────────

test('Normalisierung: Groß/Klein, Diakritika, Satzzeichen, Halbbreite', () => {
  assert.equal(normalizeText('VG-10'), 'vg10');
  assert.equal(normalizeText('Jamón Straße Chūka'), 'jamon strasse chuka');
  assert.equal(normalizeText('Shirogami #1 (Weißstahl)'), 'shirogami 1 weissstahl');
  assert.equal(normalizeText('ＶＧ１０'), 'vg10', 'Vollbreite Zeichen');
  assert.equal(normalizeText('牛刀(ステン)'), '牛刀ステン');
  assert.deepEqual(queryTokens('  vg-10   Gyuto - '), ['vg10', 'gyuto']);
  assert.deepEqual(queryTokens('Prosciutto/Jamón, Serrano'), ['prosciutto', 'jamon', 'serrano'], 'Schrägstrich und Komma trennen Wörter');
  assert.deepEqual(queryTokens(''), []);
});

test('Volltext: "vg-10" findet "VG10" (Stahl, Titel, Label)', () => {
  const vg10 = items.filter((i) => i.steel?.id === 'vg10');
  assert.ok(vg10.length > 20);
  for (const q of ['vg-10', 'VG10', 'vg 10', 'Vg-10']) {
    const found = handles(run({ q, gastro: '1' }));
    assert.ok(vg10.every((i) => found.has(i.handle)), `"${q}" findet alle VG-10-Messer`);
    assert.ok([...found].every((h) => /vg-?\s?10/i.test(searchText(data.byHandle.get(h), data)) || searchText(data.byHandle.get(h), data).includes('vg10')), `"${q}": nur Treffer, die VG10 enthalten`);
  }
  assert.equal(handles(run({ q: 'vg-10' })).size, handles(run({ q: 'vg10' })).size);
});

test('Volltext: kiritsuke (Typ und K-Tip), 牛刀 (Kanji), Diakritika, Hersteller, Griffholz, Tags', () => {
  // Kiritsuke: eigener Typ und Kiritsuke-Spitze an anderen Typen
  const kiri = items.filter((i) => i.type === 'kiritsuke' || i.tip === 'kiritsuke');
  assert.ok(kiri.length > 10);
  const kiriHits = handles(run({ q: 'kiritsuke', gastro: '1' }));
  assert.ok(kiri.every((i) => kiriHits.has(i.handle)));
  assert.ok(items.filter((i) => i.type === 'kiritsuke').every((i) => i.handle && kiriHits.has(i.handle)));
  assert.equal(run({ q: 'KIRITSUKE' }).length, run({ q: 'kiritsuke' }).length, 'Groß/Klein egal');

  // 牛刀 = Gyuto: über Kanji der Taxonomie und japanischen Shop-Typ
  const gyuto = items.filter((i) => i.type === 'gyuto');
  const kanji = run({ q: '牛刀', gastro: '1' });
  assert.ok(gyuto.every((i) => handles(kanji).has(i.handle)), 'alle Gyuto gefunden');
  assert.ok(kanji.every((i) => i.type === 'gyuto' || /牛刀/.test(searchText(i, data))));
  assert.equal(handles(run({ q: '牛刀' })).size, run({ type: 'gyuto' }).length, 'ohne Gastro: genau die Gyuto der Haushaltslinie');

  // Diakritika: ein Titel mit Akzent wird auch ohne Akzent gefunden (und umgekehrt, in Großbuchstaben)
  const accented = items.find((i) => /[À-ž]/.test(i.title));
  assert.ok(accented, 'Datensatz enthält einen Titel mit Akzent');
  const word = accented.title.split(/[\s/]+/).find((w) => /[À-ž]/.test(w));
  const plainWord = word.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  assert.notEqual(plainWord, word);
  assert.ok(handles(run({ q: plainWord, gastro: '1', cat: accented.category })).has(accented.handle), `"${plainWord}" findet "${word}"`);
  assert.ok(handles(run({ q: word.toUpperCase(), gastro: '1', cat: accented.category })).has(accented.handle));

  // Hersteller, Griffholz (deutsches Label), japanische Tags
  const takeda = items.filter((i) => i.maker === 'Takeda Hamono' && i.category === 'knife' && i.segment === 'home');
  assert.ok(takeda.every((i) => handles(run({ q: 'takeda' })).has(i.handle)));
  const walnut = items.filter((i) => i.grip?.material === 'walnut' && i.category === 'knife' && i.segment === 'home');
  assert.ok(walnut.length > 10 && walnut.every((i) => handles(run({ q: 'walnuss' })).has(i.handle)), 'deutsches Holz-Label');
  const tag = items.find((i) => i.category === 'knife' && i.segment === 'home' && i.tags?.some((t) => /[ぁ-ヿ]/.test(t))).tags.find((t) => /[ぁ-ヿ]/.test(t));
  const tagged = items.filter((i) => i.tags?.includes(tag) && i.category === 'knife' && i.segment === 'home');
  assert.ok(tagged.length > 0 && tagged.every((i) => handles(run({ q: tag })).has(i.handle)), 'japanische Schlagwörter');
  // Deutsche Stahl-Labels
  assert.ok(run({ q: 'weißstahl' }).length > 0 && run({ q: 'weissstahl' }).length === run({ q: 'weißstahl' }).length);
});

test('Volltext: Wörter UND-verknüpft, leere Suche passt immer, Art.-Nr. erst ab 4 Zeichen', () => {
  const g = handles(run({ q: 'gyuto' }));
  const w = handles(run({ q: 'walnuss' }));
  const both = handles(run({ q: 'gyuto walnuss' }));
  assert.ok(both.size > 0 && both.size < g.size);
  assert.ok([...both].every((h) => g.has(h) && w.has(h)));
  assert.equal(run({ q: 'gyuto zzzxqy' }).length, 0);
  assert.equal(run({ q: '' }).length, run({}).length);
  assert.equal(run({ q: '- / ,' }).length, run({}).length, 'reine Satzzeichen filtern nichts');
  const item = items.find((i) => i.sizes[0]?.sku);
  assert.ok(matchQuery(item, item.sizes[0].sku, data), 'vollständige Art.-Nr. findet den Artikel');
  assert.ok(matchQuery(item, item.sizes[0].sku.slice(0, 6), data));
  assert.equal(matchQuery(item, 'zzz', data), false);
  assert.equal(matchQuery(item, '', data), true);
});

// ───────────────────────────── Sortierung ─────────────────────────────

const groupIndex = (item) => {
  const i = TYPE_GROUP_ORDER.indexOf(data.taxonomy.types[item.type]?.group);
  return i < 0 ? TYPE_GROUP_ORDER.length : i;
};

test('Sortierung default: vorrätig zuerst, dann Typgruppe, dann Preis aufsteigend', () => {
  const list = run({ gastro: '1' });
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    if (!!a.available !== !!b.available) {
      assert.ok(a.available && !b.available, 'vorrätig vor nicht vorrätig');
      continue;
    }
    if (groupIndex(a) !== groupIndex(b)) {
      assert.ok(groupIndex(a) < groupIndex(b), `Typgruppe ${a.type} vor ${b.type}`);
      continue;
    }
    assert.ok(a.priceFrom <= b.priceFrom, 'Preis aufsteigend innerhalb der Gruppe');
  }
  assert.ok(list[0].available);
  assert.equal(TYPE_GROUP_ORDER.join(), 'allround,gemuese,fleisch,fisch,brot,klein,spezial');
  // Kein Artikel fehlt oder doppelt
  assert.equal(new Set(list.map((i) => i.handle)).size, list.length);
});

test('Sortierung: Preis, Länge, Name', () => {
  const asc = run({ sort: 'price-asc' });
  const desc = run({ sort: 'price-desc' });
  assert.ok(asc.every((x, i) => i === 0 || asc[i - 1].priceFrom <= x.priceFrom));
  assert.ok(desc.every((x, i) => i === 0 || desc[i - 1].priceFrom >= x.priceFrom));
  assert.equal(asc.length, desc.length);

  const mmOf = (i) => i.sizes.flatMap((z) => [z.mm, z.mmMax]).filter((v) => v != null);
  const lenAsc = run({ sort: 'len-asc', gastro: '1' });
  const lenDesc = run({ sort: 'len-desc', gastro: '1' });
  const known = (list) => list.filter((i) => mmOf(i).length);
  const mins = known(lenAsc).map((i) => Math.min(...mmOf(i)));
  const maxs = known(lenDesc).map((i) => Math.max(...mmOf(i)));
  assert.ok(mins.every((v, i) => i === 0 || mins[i - 1] <= v), 'kürzeste Größe aufsteigend');
  assert.ok(maxs.every((v, i) => i === 0 || maxs[i - 1] >= v), 'längste Größe absteigend');
  const unknownAfter = (list) => list.findIndex((i) => !mmOf(i).length);
  for (const list of [lenAsc, lenDesc]) {
    const firstUnknown = unknownAfter(list);
    if (firstUnknown >= 0) assert.ok(list.slice(firstUnknown).every((i) => !mmOf(i).length), 'Artikel ohne Länge stehen am Ende');
  }

  const names = run({ sort: 'name' }).map((i) => i.title);
  assert.ok(names.every((t, i) => i === 0 || collator.compare(names[i - 1], t) <= 0));
});

test('Sortierung Relevanz: Suche ohne eigene Sortierung sortiert nach Trefferqualität', () => {
  const q = 'gyuto walnuss';
  const list = run({ q, gastro: '1' });
  const tokens = queryTokens(q);
  const scores = list.map((i) => relevance(i, tokens, data));
  assert.ok(list.length > 5);
  assert.ok(scores.every((s, i) => i === 0 || scores[i - 1] >= s), 'Relevanz absteigend');
  // Titel vor Hersteller vor Schlagwort (künstliche Artikel, damit die Gewichte eindeutig sind)
  const a = mk({ handle: 'a', type: null, title: 'Gyuto Foo' });
  const b = mk({ handle: 'b', type: null, title: 'Foo', maker: 'Gyuto' });
  const c = mk({ handle: 'c', type: null, title: 'Foo', tags: ['gyuto'] });
  const d = mk({ handle: 'd', type: null, title: 'Foo' });
  assert.ok(relevance(a, 'gyuto', plain) > relevance(b, 'gyuto', plain));
  assert.ok(relevance(b, 'gyuto', plain) > relevance(c, 'gyuto', plain));
  assert.ok(relevance(c, 'gyuto', plain) > relevance(d, 'gyuto', plain));
  assert.deepEqual(applyFilters([c, b, a], parseFilters({ q: 'gyuto' }), plain).map((i) => i.handle), ['a', 'b', 'c'], 'Suche ohne sort: Relevanz');
  assert.ok(relevance(a, 'foo gyuto', plain) > relevance(a, 'gyuto', plain), 'mehr passende Wörter zählen mehr');
  assert.ok(relevance(mk({ type: null, title: 'Aaa Gyuto Foo' }), 'gyuto foo', plain) > relevance(mk({ type: null, title: 'Foo Aaa Gyuto' }), 'gyuto foo', plain), 'zusammenhängende Wortfolge im Titel gewinnt');
  // Wortanfang vor Wortmitte
  assert.ok(relevance(mk({ type: null, title: 'Santoku' }), 'sant', plain) > relevance(mk({ type: null, title: 'Xsantoku' }), 'sant', plain));
  // Typ-Treffer ganz oben bei einer Typ-Suche
  const title = run({ q: 'santoku' });
  assert.ok(/santoku/i.test(title[0].title) || title[0].type === 'santoku');
  // Explizite Sortierung gewinnt gegen Relevanz
  const byPrice = run({ q: 'gyuto', sort: 'price-asc' });
  assert.ok(byPrice.every((x, i) => i === 0 || byPrice[i - 1].priceFrom <= x.priceFrom));
  // Ohne Suchtext fällt „relevance“ auf Standard zurück
  assert.deepEqual(run({ sort: 'relevance' }).map((i) => i.handle), run({}).map((i) => i.handle));
});

// ───────────────────────────── Plausibilität gegen knives.json ─────────────────────────────

test('Plausibilität: type=gyuto liefert nur Gyuto, und zwar alle der Haushaltslinie', () => {
  const list = run({ type: 'gyuto' });
  assert.ok(list.length > 50);
  assert.ok(list.every((i) => i.type === 'gyuto'));
  assert.equal(list.length, items.filter((i) => i.type === 'gyuto' && i.segment === 'home').length);
  assert.equal(run({ type: 'gyuto', gastro: '1' }).length, items.filter((i) => i.type === 'gyuto').length);
  const two = run({ type: 'gyuto,santoku' });
  assert.ok(two.every((i) => i.type === 'gyuto' || i.type === 'santoku'));
  assert.equal(two.length, run({ type: 'gyuto' }).length + run({ type: 'santoku' }).length);
  assert.equal(run({ type: 'gibt-es-nicht' }).length, 0);
});

test('Plausibilität: Rost, Stahl, Schliff, Griff, Oberfläche, Hersteller, Bestand', () => {
  const check = (query, predicate, label) => {
    const list = run(query);
    assert.ok(list.length > 0, `${label}: Treffer vorhanden`);
    assert.ok(list.every(predicate), `${label}: alle Treffer passen`);
    return list;
  };
  check({ rust: 'none' }, (i) => i.rust === 'none', 'rust=none');
  check({ rust: 'full,clad' }, (i) => i.rust === 'full' || i.rust === 'clad', 'rust=full,clad');
  check({ steel: 'vg10' }, (i) => i.steel.id === 'vg10', 'steel=vg10');
  check({ steel: 'aogami2,shirogami2' }, (i) => ['aogami2', 'shirogami2'].includes(i.steel.id), 'steel Liste');
  check({ bevel: 'single' }, (i) => i.bevel === 'single', 'bevel=single');
  check({ bevel: 'double' }, (i) => i.bevel === 'double', 'bevel=double');
  check({ grip: 'wa' }, (i) => i.grip.style === 'wa', 'grip=wa');
  check({ grip: 'steel' }, (i) => i.grip.style === 'steel', 'grip=steel');
  check({ finish: 'damascus' }, (i) => i.finish.includes('damascus'), 'finish=damascus');
  check({ maker: 'Takeda Hamono' }, (i) => i.maker === 'Takeda Hamono', 'maker');
  // Hersteller, deren Messer alle zur Profi-Linie gehören: ohne gastro=1 unsichtbar, mit gastro=1 vollständig
  const makerKnives = (m) => items.filter((i) => i.category === 'knife' && i.maker === m);
  const gastroOnly = [...new Set(items.map((i) => i.maker))].find((m) => m && makerKnives(m).length > 0 && makerKnives(m).every((i) => i.segment === 'gastro'));
  assert.ok(gastroOnly, 'Datensatz enthält einen reinen Profi-Linien-Hersteller');
  assert.equal(run({ maker: gastroOnly }).length, 0, `${gastroOnly}: ohne gastro=1 nicht sichtbar`);
  assert.equal(run({ maker: gastroOnly, gastro: '1' }).length, makerKnives(gastroOnly).length);
  const avail = check({ avail: '1' }, (i) => i.available && i.sizes.some((s) => s.available), 'avail=1');
  assert.ok(avail.length < run({}).length, 'es gibt auch nicht vorrätige Messer');
  check({ len: '210-240' }, (i) => i.sizes.some((s) => s.mm != null && (s.mmMax ?? s.mm) >= 210 && s.mm <= 240), 'len=210-240');
  check({ price: '-10000' }, (i) => i.sizes.some((s) => s.priceJpy <= 10000), 'price bis 10.000');
  check({ price: '50000-80000' }, (i) => i.sizes.some((s) => s.priceJpy >= 50000 && s.priceJpy <= 80000), 'price 50.000–80.000');
  check({ cat: 'sharpening', maker: 'Shapton' }, (i) => i.category === 'sharpening' && i.maker === 'Shapton', 'cat+maker');
  // Kombination
  check({ type: 'gyuto', rust: 'full', len: '210-240', avail: '1' }, (i) => i.type === 'gyuto' && i.rust === 'full' && i.available, 'Kombination');
});

test('Plausibilität: Beispiel-Zählungen sind konsistent mit den Rohdaten', () => {
  const knives = items.filter((i) => i.category === 'knife' && i.segment === 'home');
  const counts = facetCounts(items, defaultState(), data);
  for (const [type, n] of Object.entries(counts.type)) assert.equal(n, knives.filter((i) => i.type === type).length, `type ${type}`);
  for (const [steel, n] of Object.entries(counts.steel)) assert.equal(n, knives.filter((i) => i.steel?.id === steel).length, `steel ${steel}`);
  for (const [maker, n] of Object.entries(counts.maker)) assert.equal(n, knives.filter((i) => i.maker === maker).length, `maker ${maker}`);
  for (const [finish, n] of Object.entries(counts.finish)) assert.equal(n, knives.filter((i) => i.finish.includes(finish)).length, `finish ${finish}`);
});

// ───────────────────────────── Leerzustand-Hilfen & Ähnliches ─────────────────────────────

test('suggestRelaxations: nennt nur Änderungen, die tatsächlich Treffer bringen', () => {
  const state = parseFilters({ type: 'gyuto', rust: 'none', maker: 'Victorinox' });
  assert.equal(applyFilters(items, state, data).length, 0);
  const suggestions = suggestRelaxations(items, state, data);
  assert.ok(suggestions.length >= 1);
  for (const s of suggestions) {
    assert.ok(s.count > 0 && s.count === applyFilters(items, s.state, data).length, s.text);
    assert.ok(s.text.length > 5);
  }
  assert.ok(suggestions.every((s, i) => i === 0 || suggestions[i - 1].count >= s.count), 'absteigend nach Treffern');
  assert.ok(suggestions.length <= 4);

  // Gastro-Messer als Ausweg
  const g = parseFilters({ type: 'boning' });
  const gs = suggestRelaxations(items, g, data);
  assert.ok(gs.some((s) => s.key === 'gastro' && s.count > 0), 'Profi-Linie vorschlagen');
  // Suchtext
  const q = suggestRelaxations(items, parseFilters({ q: 'gyuto', maker: 'Shapton' }), data);
  assert.ok(q.every((s) => s.count > 0));
  assert.deepEqual(suggestRelaxations(items, defaultState(), data).filter((s) => s.key !== 'gastro'), [], 'ohne Filter keine Lockerung nötig');
});

test('similarItems: gleicher Typ, gleiche Linie, passende Händigkeit, ohne den Artikel selbst', () => {
  const gyuto = items.find((i) => i.type === 'gyuto' && i.segment === 'home' && i.available && i.priceFrom > 5000 && i.priceFrom < 40000);
  const list = similarItems(gyuto, data);
  assert.equal(list.length, 4);
  assert.ok(list.every((i) => i.handle !== gyuto.handle && i.type === 'gyuto' && i.segment === gyuto.segment && i.category === 'knife'));
  assert.ok(list.every((i) => i.available), 'vorrätige bevorzugt');
  // Linkshänder-Ausführung: keine Rechtshänder-Messer vorschlagen
  const left = items.find((i) => i.type === 'yanagiba' && i.handed === 'left');
  assert.ok(similarItems(left, data).every((i) => i.handed !== 'right'));
  // Rechtshänder-Messer: keine Linkshänder-Ausführungen
  const right = items.find((i) => i.type === 'yanagiba' && i.handed === 'right');
  assert.ok(similarItems(right, data).every((i) => i.handed !== 'left'));
  // Ähnlicher Preis: die Vorschläge liegen näher am Preis als der Durchschnitt aller Gyuto
  const meanGap = (xs) => xs.reduce((s, i) => s + Math.abs(Math.log(i.priceFrom / gyuto.priceFrom)), 0) / xs.length;
  assert.ok(meanGap(list) < meanGap(items.filter((i) => i.type === 'gyuto' && i.handle !== gyuto.handle)));
  // Zubehör: gleiche Art
  const stone = items.find((i) => i.category === 'sharpening');
  assert.ok(similarItems(stone, data).every((i) => i.category === 'sharpening'));
  assert.equal(similarItems(gyuto, data, 2).length, 2);
});
