// Katalog-Filter: reine Logik ohne DOM (in Node testbar).
//
// Der komplette Zustand steht in der URL (#/katalog?type=gyuto,santoku&rust=full&len=180-240 …).
// Schlüssel (andere Module verlinken darauf, bitte nicht umbenennen):
//   q       Volltext                              type    Typ-IDs (Liste)            steel   Stahl-IDs (Liste)
//   rust    full,clad,none (Liste)                grip    wa,yo,steel (Liste)        bevel   single | double
//   hand    left | right (Händigkeit der Person)  len     mm-Bereich "180-240"       price   JPY-Bereich "0-30000"
//   finish  Oberflächen (Liste)                   maker   Hersteller (Liste)         avail   "1" = nur laut Katalog vorrätig
//   gastro  "1" = Profi-/Gastro-Linie einblenden  cat     knife | sharpening | tool (Standard knife)
//   sort    default | price-asc | price-desc | len-asc | len-desc | name | relevance
// Listenwerte sind kommagetrennt. Bereiche dürfen offen sein: "180-" (ab 180), "-240" (bis 240).
//
// Semantik
//   * Innerhalb einer Liste gilt ODER, zwischen den Filtern UND.
//   * Standard: category = knife und Segment „home“; Gastro-Messer erscheinen nur mit gastro=1.
//   * hand=left blendet Artikel mit handed === 'right' aus, hand=right solche mit handed === 'left'.
//   * Größenfilter (len, price, avail) wirken gemeinsam auf DIESELBE Größe: ein Artikel passt, wenn mindestens
//     eine Größe/Variante alle aktiven Größenfilter erfüllt (jede Größe einzeln für sich geprüft).
//   * Volltext: Wörter UND-verknüpft; ohne Groß-/Kleinschreibung, Diakritika und Satzzeichen ("vg-10" findet "VG10").

import { splitList, collator } from '../util.js';
import { cmText, jpy, priceRangeText } from '../format.js';

export const CATEGORIES = ['knife', 'sharpening', 'tool'];
export const RUST_VALUES = ['full', 'clad', 'none'];
export const GRIP_VALUES = ['wa', 'yo', 'steel'];
export const BEVEL_VALUES = ['single', 'double'];
export const HAND_VALUES = ['left', 'right'];
export const SORTS = ['default', 'price-asc', 'price-desc', 'len-asc', 'len-desc', 'name', 'relevance'];

/** Reihenfolge der Typgruppen in Standard-Sortierung und Filterliste (nicht die der Taxonomie-Datei). */
export const TYPE_GROUP_ORDER = ['allround', 'gemuese', 'fleisch', 'fisch', 'brot', 'klein', 'spezial'];

const LIST_KEYS = ['type', 'steel', 'rust', 'grip', 'finish', 'maker'];
const MAX_Q = 200;

// ───────────────────────────── Zustand ⇄ URL ─────────────────────────────

export const defaultState = () => ({
  q: '',
  type: [],
  steel: [],
  rust: [],
  grip: [],
  bevel: '',
  hand: '',
  len: null, // { min, max } in mm, offene Enden = null
  price: null, // { min, max } in JPY
  finish: [],
  maker: [],
  avail: false,
  gastro: false,
  cat: 'knife',
  sort: 'default',
});

const uniq = (arr) => [...new Set(arr)];

/** Objekt, URLSearchParams oder String ("type=gyuto", "?type=gyuto", "#/katalog?type=gyuto") → einfaches Objekt */
function toObject(query) {
  if (query == null) return {};
  if (typeof query === 'string') {
    let text = query.trim().replace(/^#/, '');
    text = text.startsWith('/') ? (text.includes('?') ? text.slice(text.indexOf('?') + 1) : '') : text.replace(/^\?/, '');
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (typeof URLSearchParams !== 'undefined' && query instanceof URLSearchParams) return Object.fromEntries(query);
  return query;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

function parseList(value, allowed) {
  const list = uniq((Array.isArray(value) ? value : [value]).flatMap((v) => splitList(v)));
  return allowed ? list.filter((v) => allowed.includes(v)) : list;
}

/** Ein einzelner Wert aus einer Aufzählung; bei Mehrfachangabe oder Unbekanntem ''. */
function parseOne(value, allowed) {
  const list = parseList(value, allowed);
  return list.length === 1 ? list[0] : '';
}

const parseFlag = (v) => ['1', 'true', 'yes', 'ja'].includes(String(first(v) ?? '').toLowerCase());

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const RANGE_RE = new RegExp(`^${NUM}?\\s*[-–]\\s*${NUM}?$`);

/** "180-240" → { min: 180, max: 240 } · "180-" → { min: 180, max: null } · "210" → { min: 210, max: 210 } · sonst null */
export function parseRange(value) {
  const text = String(first(value) ?? '').trim();
  if (!text) return null;
  const num = (s) => (s == null || s === '' ? null : Number(s.replace(',', '.')));
  let min;
  let max;
  const m = text.match(RANGE_RE);
  if (m) {
    min = num(m[1]);
    max = num(m[2]);
  } else if (new RegExp(`^${NUM}$`).test(text)) {
    min = max = num(text);
  } else return null;
  if ((min == null || min === 0) && max == null) return null; // "0-" schränkt nichts ein
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return { min, max };
}

export const rangeToText = (r) => (r ? `${r.min ?? ''}-${r.max ?? ''}` : '');

const cleanQuery = (v) => String(first(v) ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_Q);

/** Query-Objekt (oder URLSearchParams/Query-String) → vollständiger, validierter Zustand. Unbekanntes wird ignoriert. */
export function parseFilters(query = {}) {
  const src = toObject(query);
  const state = defaultState();
  state.q = cleanQuery(src.q);
  state.type = parseList(src.type);
  state.steel = parseList(src.steel);
  state.rust = parseList(src.rust, RUST_VALUES);
  state.grip = parseList(src.grip, GRIP_VALUES);
  state.bevel = parseOne(src.bevel, BEVEL_VALUES);
  state.hand = parseOne(src.hand, HAND_VALUES);
  state.len = parseRange(src.len);
  state.price = parseRange(src.price);
  state.finish = parseList(src.finish);
  state.maker = parseList(src.maker);
  state.avail = parseFlag(src.avail);
  state.gastro = parseFlag(src.gastro);
  const cat = first(src.cat);
  state.cat = CATEGORIES.includes(cat) ? cat : 'knife';
  const sort = first(src.sort);
  state.sort = SORTS.includes(sort) ? sort : 'default';
  return state;
}

/** Fehlende Felder ergänzen (Tests/Aufrufer dürfen Teilzustände übergeben). */
export const normalizeState = (state) => ({ ...defaultState(), ...(state ?? {}) });

/** Zustand → Query-Objekt mit Strings; nur Nicht-Standardwerte, feste Schlüsselreihenfolge (kanonische URLs). */
export function serializeFilters(state) {
  const s = normalizeState(state);
  const out = {};
  const q = cleanQuery(s.q);
  if (q) out.q = q;
  if (s.type.length) out.type = s.type.join(',');
  if (s.steel.length) out.steel = s.steel.join(',');
  if (s.rust.length) out.rust = s.rust.join(',');
  if (s.grip.length) out.grip = s.grip.join(',');
  if (s.bevel) out.bevel = s.bevel;
  if (s.hand) out.hand = s.hand;
  if (s.len) out.len = rangeToText(s.len);
  if (s.price) out.price = rangeToText(s.price);
  if (s.finish.length) out.finish = s.finish.join(',');
  if (s.maker.length) out.maker = s.maker.join(',');
  if (s.avail) out.avail = '1';
  if (s.gastro) out.gastro = '1';
  if (s.cat !== 'knife') out.cat = s.cat;
  if (s.sort !== 'default') out.sort = s.sort;
  return out;
}

/** Sortierung, die tatsächlich gilt: mit Suchtext ohne eigene Wahl → Relevanz; Relevanz ohne Suchtext → Standard. */
export function effectiveSort(state) {
  const s = normalizeState(state);
  if (s.sort === 'relevance') return s.q ? 'relevance' : 'default';
  if (s.sort === 'default' && s.q) return 'relevance';
  return s.sort;
}

/** Alle Filter zurück auf Standard (die Sortierung bleibt). */
export const resetFilters = (state) => ({ ...defaultState(), sort: normalizeState(state).sort });

// ───────────────────────────── Volltext ─────────────────────────────

/** Klein, ohne Diakritika (Latein), NFKD (Halb-/Vollbreite). Satzzeichen bleiben erhalten. */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o');
}

/** Wie fold, zusätzlich ohne Satzzeichen ("VG-10" → "vg10"); Leerzeichen bleiben als Wortgrenzen. */
export function normalizeText(text) {
  return fold(text)
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Suchtext → normalisierte Wörter ("vg-10  Gyuto" → ["vg10", "gyuto"]). Leerraum, Komma, Semikolon und Schrägstrich trennen Wörter, der Bindestrich nicht. */
export const queryTokens = (q) =>
  String(q ?? '')
    .split(/[\s,;/]+/)
    .map(normalizeText)
    .filter(Boolean);

const NO_TAXONOMY = {};
const indexCache = new WeakMap(); // Taxonomie → WeakMap(Artikel → Index)

const taxOf = (data) => data?.taxonomy ?? NO_TAXONOMY;
const label = (tax, group, id) => (id == null ? '' : tax[group]?.[id]?.label ?? '');

/** Durchsuchbare Felder eines Artikels: [Gewicht, normalisierter Text, Mindestlänge des Suchworts]. */
function buildIndex(item, tax) {
  const fields = [];
  const add = (weight, parts, minLen = 0) => {
    const text = normalizeText(parts.filter(Boolean).join(' '));
    if (text) fields.push([weight, text, minLen]);
  };
  const type = item.type ? tax.types?.[item.type] : null;
  const steel = item.steel?.id ? tax.steels?.[item.steel.id] : null;

  add(6, [item.title]);
  add(7, [
    type?.label ?? item.type,
    type?.kanji,
    type?.gloss,
    item.tip === 'kiritsuke' ? 'Kiritsuke' : '',
    item.productTypeJp,
    item.type,
    type ? '' : label(tax, 'categories', item.category),
  ]);
  add(4, [item.maker, label(tax, 'makers', item.maker), item.series, label(tax, 'origins', item.origin)]);
  add(4, [steel?.label, steel?.short, item.steel?.id, label(tax, 'steelFamilies', item.steel?.family)]);
  add(3, [(item.tags ?? []).join(' ')]);
  add(2, [
    label(tax, 'handleMaterials', item.grip?.material),
    label(tax, 'handleShapes', item.grip?.shape),
    label(tax, 'handleStyles', item.grip?.style),
    tax.handleStyles?.[item.grip?.style]?.short,
  ]);
  add(2, [
    ...(item.finish ?? []).flatMap((f) => [label(tax, 'finishes', f), tax.finishes?.[f]?.short]),
    label(tax, 'bevels', item.bevel),
    item.handed && item.handed !== 'both' ? label(tax, 'handed', item.handed) : '',
    label(tax, 'construction', item.construction),
  ]);
  add(1, [(item.sizes ?? []).map((s) => s.sku).join(' ')], 4); // Art.-Nr. nur für Suchwörter ab 4 Zeichen
  return fields;
}

function indexOf(item, data) {
  const tax = taxOf(data);
  let perTax = indexCache.get(tax);
  if (!perTax) indexCache.set(tax, (perTax = new WeakMap()));
  let idx = perTax.get(item);
  if (!idx) perTax.set(item, (idx = buildIndex(item, tax)));
  return idx;
}

/** Gesamter durchsuchbarer Text eines Artikels (normalisiert) – vor allem für Tests und Debugging. */
export const searchText = (item, data) => indexOf(item, data).map((f) => f[1]).join(' ');

const tokenMatches = (fields, tok) => fields.some(([, text, minLen]) => tok.length >= minLen && text.includes(tok));

/** Alle Wörter der Suche kommen im Artikel vor (UND). Leere Suche passt immer. */
export function matchQuery(item, q, data) {
  const tokens = Array.isArray(q) ? q : queryTokens(q);
  if (!tokens.length) return true;
  const fields = indexOf(item, data);
  return tokens.every((t) => tokenMatches(fields, t));
}

/** Trefferqualität für die Sortierung „Relevanz“: Titel/Typ vor Hersteller/Stahl vor Griff/Tags; Wortanfang und ganzes Wort zählen mehr. */
export function relevance(item, q, data) {
  const tokens = Array.isArray(q) ? q : queryTokens(q);
  if (!tokens.length) return 0;
  const fields = indexOf(item, data);
  let score = 0;
  for (const tok of tokens) {
    let best = 0;
    for (const [weight, text, minLen] of fields) {
      if (tok.length < minLen) continue;
      const at = text.indexOf(tok);
      if (at < 0) continue;
      let s = weight;
      if (at === 0 || text[at - 1] === ' ') s += 3;
      if (at + tok.length === text.length || text[at + tok.length] === ' ') s += 2;
      best = Math.max(best, s);
    }
    score += best;
  }
  if (tokens.length > 1) {
    const phrase = tokens.join(' ');
    if (fields.some(([weight, text]) => weight >= 6 && text.includes(phrase))) score += 5;
  }
  return score;
}

// ───────────────────────────── Filtern ─────────────────────────────

const ITEM_KEYS = ['cat', 'gastro', 'q', 'type', 'steel', 'rust', 'grip', 'bevel', 'hand', 'finish', 'maker'];
const SIZE_KEYS = ['len', 'price', 'avail'];

function handOk(hand, item) {
  if (hand === 'left') return item.handed !== 'right';
  if (hand === 'right') return item.handed !== 'left';
  return true;
}

/** Größe [mm … mmMax] schneidet den Bereich? Größen ohne Millimeterangabe (z. B. Körnung) passen nie. */
function sizeInLen(size, range) {
  if (size.mm == null) return false;
  const lo = size.mm;
  const hi = size.mmMax ?? size.mm;
  return (range.min == null || hi >= range.min) && (range.max == null || lo <= range.max);
}

const sizeInPrice = (size, range) => size.priceJpy != null && (range.min == null || size.priceJpy >= range.min) && (range.max == null || size.priceJpy <= range.max);

/** Zustand vorbereiten: liefert Prüffunktionen, die mehrfach über viele Artikel laufen. */
function compile(state, data) {
  const s = normalizeState(state);
  const tokens = queryTokens(s.q);
  const sets = Object.fromEntries(LIST_KEYS.map((k) => [k, new Set(s[k])]));
  const sizeTests = {
    len: s.len ? (z) => sizeInLen(z, s.len) : null,
    price: s.price ? (z) => sizeInPrice(z, s.price) : null,
    avail: s.avail ? (z) => !!z.available : null,
  };
  const activeSize = SIZE_KEYS.filter((k) => sizeTests[k]);

  /** Artikelweite Filter einzeln ausgewertet (true = erfüllt). */
  const evaluate = (item) => ({
    cat: item.category === s.cat,
    gastro: s.gastro || item.segment !== 'gastro',
    q: !tokens.length || matchQuery(item, tokens, data),
    type: !sets.type.size || sets.type.has(item.type),
    steel: !sets.steel.size || sets.steel.has(item.steel?.id),
    rust: !sets.rust.size || sets.rust.has(item.rust),
    grip: !sets.grip.size || sets.grip.has(item.grip?.style),
    bevel: !s.bevel || item.bevel === s.bevel,
    hand: handOk(s.hand, item),
    finish: !sets.finish.size || (item.finish ?? []).some((f) => sets.finish.has(f)),
    maker: !sets.maker.size || sets.maker.has(item.maker),
  });

  /** Mindestens eine Größe erfüllt ALLE angegebenen Größenfilter (Schlüsselmenge). */
  const sizesOk = (item, keys = activeSize) => {
    if (!keys.length) return true;
    return (item.sizes ?? []).some((z) => keys.every((k) => sizeTests[k](z)));
  };

  return { s, tokens, sizeTests, activeSize, evaluate, sizesOk };
}

const typeGroupIndex = (data) => {
  const types = taxOf(data).types ?? {};
  const cache = new Map();
  return (item) => {
    if (!cache.has(item.type)) {
      const i = TYPE_GROUP_ORDER.indexOf(types[item.type]?.group);
      cache.set(item.type, i < 0 ? TYPE_GROUP_ORDER.length : i);
    }
    return cache.get(item.type);
  };
};

const mmRange = (item) => {
  const mms = (item.sizes ?? []).flatMap((z) => [z.mm, z.mmMax]).filter((v) => v != null);
  return mms.length ? [Math.min(...mms), Math.max(...mms)] : null;
};

function comparator(sort, data, tokens) {
  const groupOf = typeGroupIndex(data);
  const byTitle = (a, b) => collator.compare(a.title, b.title);
  const byDefault = (a, b) => Number(!!b.available) - Number(!!a.available) || groupOf(a) - groupOf(b) || (a.priceFrom ?? Infinity) - (b.priceFrom ?? Infinity) || byTitle(a, b);
  const byAvailThenTitle = (a, b) => Number(!!b.available) - Number(!!a.available) || byTitle(a, b);
  // Artikel ohne Längenangabe stehen in beiden Richtungen am Ende
  const lenCompare = (dir) => (a, b) => {
    const ra = mmRange(a);
    const rb = mmRange(b);
    if (!ra || !rb) return ra ? -1 : rb ? 1 : byDefault(a, b);
    const va = dir > 0 ? ra[0] : ra[1];
    const vb = dir > 0 ? rb[0] : rb[1];
    return dir * (va - vb) || byAvailThenTitle(a, b);
  };
  switch (sort) {
    case 'price-asc':
      return (a, b) => (a.priceFrom ?? Infinity) - (b.priceFrom ?? Infinity) || byAvailThenTitle(a, b);
    case 'price-desc':
      return (a, b) => (b.priceFrom ?? -Infinity) - (a.priceFrom ?? -Infinity) || byAvailThenTitle(a, b);
    case 'len-asc':
      return lenCompare(1);
    case 'len-desc':
      return lenCompare(-1);
    case 'name':
      return byTitle;
    case 'relevance': {
      const scores = new Map();
      const score = (item) => {
        if (!scores.has(item)) scores.set(item, relevance(item, tokens, data));
        return scores.get(item);
      };
      return (a, b) => score(b) - score(a) || byDefault(a, b);
    }
    default:
      return byDefault;
  }
}

/** Treffer (sortiert) für den Zustand. items = Artikelliste (data.items), data = ctx.data (Taxonomie für Suche/Gruppen). */
export function applyFilters(items, state, data) {
  const c = compile(state, data);
  const hits = [];
  for (const item of items) {
    const ok = c.evaluate(item);
    if (ITEM_KEYS.every((k) => ok[k]) && c.sizesOk(item)) hits.push(item);
  }
  return hits.sort(comparator(effectiveSort(c.s), data, c.tokens));
}

// ───────────────────────────── Facetten ─────────────────────────────

const FACET_VALUES = {
  type: (i) => [i.type],
  steel: (i) => [i.steel?.id],
  rust: (i) => [i.rust],
  grip: (i) => [i.grip?.style],
  bevel: (i) => [i.bevel],
  finish: (i) => i.finish ?? [],
  maker: (i) => [i.maker],
};

/**
 * Anzahl je Optionswert unter allen ANDEREN aktiven Filtern (disjunktive Facetten): die Zahl bei einem Wert
 * entspricht den Treffern, wenn nur dieser Wert dieser Gruppe gewählt wäre.
 *
 * → { type:{gyuto:12,…}, steel, rust, grip, bevel, finish, maker, cat,
 *     hand:{left,right}, avail:{'1':n} (Treffer mit „nur vorrätig“), gastro:{'1':n} (zusätzliche Gastro-Artikel) }
 * `cat` zählt nur mit Suche, Hersteller und Größenfiltern (Typ, Stahl … gelten für Zubehör nicht).
 */
export function facetCounts(items, state, data) {
  const c = compile(state, data);
  const out = { cat: {}, hand: { left: 0, right: 0 }, avail: { 1: 0 }, gastro: { 1: 0 } };
  for (const key of Object.keys(FACET_VALUES)) out[key] = {};
  const bump = (bucket, v) => {
    if (v != null) bucket[v] = (bucket[v] ?? 0) + 1;
  };
  const withAvail = c.activeSize.includes('avail') ? c.activeSize : [...c.activeSize, 'avail'];
  if (!c.sizeTests.avail) c.sizeTests.avail = (z) => !!z.available;

  for (const item of items) {
    const ok = c.evaluate(item);
    const failing = ITEM_KEYS.filter((k) => !ok[k]);
    const sizesAll = c.sizesOk(item);
    // „besteht alle Filter außer key“ (nur für artikelweite Filter)
    const passesExcept = (key) => sizesAll && (failing.length === 0 || (failing.length === 1 && failing[0] === key));

    for (const key of Object.keys(FACET_VALUES)) {
      if (passesExcept(key)) for (const v of FACET_VALUES[key](item)) bump(out[key], v);
    }
    if (passesExcept('hand')) {
      if (handOk('left', item)) out.hand.left++;
      if (handOk('right', item)) out.hand.right++;
    }
    if (passesExcept('gastro') && item.segment === 'gastro') out.gastro[1]++;
    // „nur vorrätig“: Artikel muss die übrigen Filter erfüllen UND eine Größe haben, die zusätzlich vorrätig ist
    if (failing.length === 0 && c.sizesOk(item, withAvail)) out.avail[1]++;
    // Art: nur geteilte Filter (Suche, Hersteller, Größen, Gastro-Regel)
    if (ok.q && ok.maker && ok.gastro && sizesAll) bump(out.cat, item.category);
  }
  return out;
}

// ───────────────────────────── Aktive Filter, Lockerungen, Ähnliches ─────────────────────────────

// Untergrenze 0 zählt als „offen“ (price=0-30000 → „bis ¥30.000“)
const cmRange = (r) => (r.min && r.max != null ? `${cmText(r.min)}–${cmText(r.max)} cm` : r.min ? `ab ${cmText(r.min)} cm` : `bis ${cmText(r.max)} cm`);
const jpyRange = (r) => (r.min && r.max != null ? priceRangeText(r.min, r.max) : r.min ? `ab ${jpy(r.min)}` : `bis ${jpy(r.max)}`);

const entryLabel = (data, group, id, field = 'label') => {
  const e = taxOf(data)[group]?.[id];
  return e?.[field] ?? e?.label ?? id;
};

/** Aktive Filter als Liste für Chips: { key, value, group, text } (value = einzelner Wert bei Listen, sonst null). */
export function activeFilters(state, data) {
  const s = normalizeState(state);
  const list = [];
  const add = (key, value, group, text) => list.push({ key, value, group, text });
  if (s.q) add('q', null, 'Suche', `Suche: „${s.q}“`);
  if (s.cat !== 'knife') add('cat', null, 'Art', `Art: ${entryLabel(data, 'categories', s.cat)}`);
  for (const v of s.type) add('type', v, 'Typ', `Typ: ${entryLabel(data, 'types', v)}`);
  for (const v of s.rust) add('rust', v, 'Rostfrei', entryLabel(data, 'rust', v, 'short'));
  for (const v of s.steel) add('steel', v, 'Stahl', `Stahl: ${entryLabel(data, 'steels', v, 'short')}`);
  if (s.len) add('len', null, 'Länge', `Länge ${cmRange(s.len)}`);
  if (s.price) add('price', null, 'Preis', `Preis ${jpyRange(s.price)}`);
  for (const v of s.grip) add('grip', v, 'Griff', entryLabel(data, 'handleStyles', v, 'short'));
  if (s.bevel) add('bevel', null, 'Schliff', entryLabel(data, 'bevels', s.bevel, 'short'));
  if (s.hand) add('hand', null, 'Händigkeit', s.hand === 'left' ? 'Ich bin Linkshänder' : 'Ich bin Rechtshänder');
  for (const v of s.finish) add('finish', v, 'Oberfläche', `Oberfläche: ${entryLabel(data, 'finishes', v, 'short')}`);
  for (const v of s.maker) add('maker', v, 'Hersteller', `Hersteller: ${entryLabel(data, 'makers', v)}`);
  if (s.avail) add('avail', null, 'Bestand', 'Nur laut Katalog vorrätig');
  if (s.gastro) add('gastro', null, 'Linie', 'Mit Profi-/Gastro-Linie');
  return list;
}

/** Zustand ohne einen Filter (Listen: nur dieser Wert). */
export function removeFilter(state, key, value = null) {
  const s = normalizeState(state);
  const next = { ...s };
  if (LIST_KEYS.includes(key)) next[key] = value == null ? [] : s[key].filter((v) => v !== value);
  else if (key === 'q') next.q = '';
  else if (key === 'cat') next.cat = 'knife';
  else if (key === 'len' || key === 'price') next[key] = null;
  else if (key === 'bevel' || key === 'hand') next[key] = '';
  else if (key === 'avail' || key === 'gastro') next[key] = false;
  return next;
}

/**
 * Für den Leerzustand: Welche einzelne Änderung bringt wieder Treffer?
 * → [{ key, value, text, count, state }], absteigend nach Trefferzahl.
 */
export function suggestRelaxations(items, state, data, { limit = 4 } = {}) {
  const s = normalizeState(state);
  const out = [];
  for (const f of activeFilters(s, data)) {
    if (f.key === 'cat') continue; // Art wechseln ist keine Lockerung
    const next = removeFilter(s, f.key, f.value);
    const count = applyFilters(items, next, data).length;
    if (count === 0) continue;
    const text = f.key === 'q' ? `Suchbegriff „${s.q}“ weglassen` : f.key === 'avail' ? '„Nur vorrätig“ abschalten' : `Filter „${f.text}“ entfernen`;
    out.push({ key: f.key, value: f.value, text, count, state: next });
  }
  if (s.cat === 'knife' && !s.gastro) {
    const next = { ...s, gastro: true };
    const count = applyFilters(items, next, data).length;
    if (count > 0) out.push({ key: 'gastro', value: null, text: 'Profi-/Gastro-Linie einblenden', count, state: next, add: true });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}

/** Anzahl aktiver Filterwerte (ohne Suchtext) – für „Filter (n aktiv)“. */
export const activeFilterCount = (state, data) => activeFilters(state, data).filter((f) => f.key !== 'q').length;

/**
 * Ähnliche Artikel: gleicher Typ (sonst gleiche Typgruppe), gleiche Linie, ähnlicher Preis, vorrätig bevorzugt.
 * Sortiert nach Ähnlichkeit, höchstens n Stück, ohne den Artikel selbst.
 */
export function similarItems(item, data, n = 4) {
  const types = taxOf(data).types ?? {};
  const group = item.type ? types[item.type]?.group : null;
  const price = item.priceFrom || 1;
  const scored = [];
  for (const other of data.items ?? []) {
    if (other === item || other.handle === item.handle || other.category !== item.category) continue;
    if (other.segment !== item.segment) continue;
    const sameType = item.type != null && other.type === item.type;
    const sameGroup = !sameType && group != null && types[other.type]?.group === group;
    if (item.type != null && !sameType && !sameGroup) continue;
    if (item.handed === 'left' && other.handed === 'right') continue;
    if (item.handed === 'right' && other.handed === 'left') continue;
    const distance = Math.abs(Math.log((other.priceFrom || 1) / price)); // 0 = gleicher Preis, 0,69 = doppelt/halb
    let score = (sameType ? 0 : 1.5) + distance;
    if (!other.available) score += 0.8;
    if (other.bevel !== item.bevel) score += 0.6;
    if (item.rust && other.rust !== item.rust) score += 0.25;
    if (item.steel?.family && other.steel?.family !== item.steel.family) score += 0.2;
    if (item.grip?.style && other.grip?.style !== item.grip.style) score += 0.1;
    scored.push({ other, score });
  }
  return scored.sort((a, b) => a.score - b.score || collator.compare(a.other.title, b.other.title)).slice(0, n).map((x) => x.other);
}
