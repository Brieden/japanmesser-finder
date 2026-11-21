// Katalog: Filter + Suche. Der Zustand steckt komplett in der URL (lib/filters.js).
// Änderungen zeichnen Ergebnisse, Chips und Zähler an Ort und Stelle neu (router.replaceQuery, kein Neurendern der Seite),
// damit Fokus und Scrollposition erhalten bleiben. Zurück/Vor rendert die Ansicht neu und liest ctx.query.
//
// Ab 60 rem steht das Filterpanel als klebende Seitenleiste neben den Ergebnissen; darunter wandert dasselbe Panel
// in ein Bottom-Sheet (ui/dialog.js), das über den Button „Filter (n aktiv)“ geöffnet wird.
import { h, loadCss, assetUrl, withJa } from '../dom.js';
import { icon } from '../icons.js';
import { productCard } from '../ui/card.js';
import { shopNotice } from '../ui/shop-notice.js';
import { openDialog } from '../ui/dialog.js';
import { prefs } from '../prefs.js';
import { count as countText, money, dateDe, cmText } from '../format.js';
import { debounce, collator } from '../util.js';
import {
  parseFilters,
  serializeFilters,
  applyFilters,
  facetCounts,
  activeFilters,
  activeFilterCount,
  removeFilter,
  resetFilters,
  suggestRelaxations,
  effectiveSort,
  defaultState,
  RUST_VALUES,
  GRIP_VALUES,
  TYPE_GROUP_ORDER,
} from '../lib/filters.js';

export const title = 'Katalog';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE = 200;
const FIELD_DEBOUNCE = 400;
const DESKTOP = '(min-width: 60rem)';
const ORIGIN_KEY = 'jmf:catalog-origin'; // Spur für den Zurück-Link der Detailseite (gleicher Schlüssel in detail.js)

// ───────────────────────────── Hilfen ─────────────────────────────

const ABBREVIATIONS = new Set(['z', 'b', 'ca', 'bzw', 'usw', 'ggf', 'vgl', 'bspw', 'etc', 'inkl', 'max', 'min', 'nr']);

/** Sätze trennen, ohne bei Abkürzungen („z. B.“, „ca.“) zu zerschneiden. */
function sentences(text) {
  const out = [];
  let start = 0;
  const re = /([.!?])\s+(?=[A-ZÄÖÜ„"(])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const word = text.slice(start, m.index).split(/\s+/).pop().replace(/[^\p{L}]/gu, '').toLowerCase();
    if (m[1] === '.' && (word.length <= 1 || ABBREVIATIONS.has(word))) continue;
    out.push(text.slice(start, m.index + 1));
    start = m.index + m[0].length;
  }
  out.push(text.slice(start));
  return out.filter(Boolean);
}

/** Erster Satz einer Erklärung, ohne „Begriff (…): “-Vorspann; für die kurzen Zeilen im Filterpanel. */
function shortExplain(text, maxChars = 150) {
  if (!text) return '';
  let t = String(text).trim();
  const colon = t.indexOf(': ');
  const dot = t.indexOf('. ');
  if (colon > 0 && colon < 70 && (dot < 0 || colon < dot)) t = t.slice(colon + 2);
  t = t.charAt(0).toUpperCase() + t.slice(1);
  let s = sentences(t)[0] ?? t;
  if (s.length > maxChars) s = `${s.slice(0, s.lastIndexOf(' ', maxChars))} …`;
  return s;
}

const nfInt = new Intl.NumberFormat('de-DE');
const fmtInt = (n) => nfInt.format(n);

const SORT_LABELS = {
  default: 'Standard',
  relevance: 'Beste Treffer',
  'price-asc': 'Preis aufsteigend',
  'price-desc': 'Preis absteigend',
  'len-asc': 'Länge aufsteigend',
  'len-desc': 'Länge absteigend',
  name: 'Name A–Z',
};

const sameRange = (a, b) => (a?.min ?? null) === (b?.min ?? null) && (a?.max ?? null) === (b?.max ?? null);

function savedShown() {
  const n = history.state?.catShown;
  return Number.isInteger(n) && n > PAGE_SIZE ? n : null;
}

function rememberOrigin(steps = 1) {
  try {
    sessionStorage.setItem(ORIGIN_KEY, JSON.stringify({ hash: location.hash, steps }));
  } catch {
    /* ohne sessionStorage fällt der Zurück-Link auf #/katalog zurück */
  }
}

// ───────────────────────────── View-Vertrag ─────────────────────────────

let active = null; // laufende Instanz

export async function render(ctx) {
  active?.dispose();
  active = null;
  const startHash = location.hash;
  await loadCss(assetUrl('assets/css/views/catalog.css'));
  if (location.hash !== startHash) return h('div'); // inzwischen woanders hin navigiert: der Router verwirft dieses Ergebnis
  const view = createCatalog(ctx);
  active = view;
  return view.root;
}

export function destroy() {
  // Bei Zurück/Vor rendert der Router dieselbe Ansicht neu und ruft danach destroy() der alten auf – die neue Instanz darf nicht fallen.
  if (active && !active.root.isConnected) {
    active.dispose();
    active = null;
  }
}

// ───────────────────────────── Ansicht ─────────────────────────────

function createCatalog({ data, router, query }) {
  // Fehlende Taxonomie-Gruppen dürfen nichts brechen: leere Objekte statt undefined
  const tax = Object.fromEntries(['types', 'typeGroups', 'steels', 'steelFamilies', 'rust', 'bevels', 'handleStyles', 'finishes', 'makers', 'categories'].map((g) => [g, data.taxonomy?.[g] ?? {}]));
  const items = data.items;
  const cleanups = [];
  const updaters = []; // Funktionen, die das Panel (Häkchen, Zähler, Werte) mit dem Zustand abgleichen
  const cardCache = new Map();

  let state = parseFilters(query);
  let shown = savedShown() ?? PAGE_SIZE;
  let savedAs = shown; // zuletzt in history.state abgelegter Wert (Safari begrenzt replaceState-Aufrufe)
  let results = [];
  let counts = {};
  let sheet = null;
  let sortHasQuery = null;

  // Feste Reihenfolge der Optionen: Häufigkeit über alle Messer (inkl. Gastro), unabhängig vom aktuellen Filter
  const base = facetCounts(items, { ...defaultState(), gastro: true }, data);
  const byBase = (key) => (a, b) => (base[key][b] ?? 0) - (base[key][a] ?? 0) || collator.compare(String(a), String(b));

  const noun = (n) => (state.cat === 'knife' ? countText(n, 'Messer', 'Messer') : countText(n, 'Artikel', 'Artikel'));

  // ── Zustand ändern ──

  function commit(next, { resetShown = true } = {}) {
    state = next;
    if (resetShown) shown = PAGE_SIZE;
    try {
      router.replaceQuery(serializeFilters(state));
    } catch {
      /* URL nicht schreibbar (z. B. Aufruflimit des Browsers): Ansicht aktualisiert sich trotzdem */
    }
    refresh();
    saveShown();
  }

  /** Wie viele Karten sichtbar sind, bleibt im Verlaufseintrag: nach Detailseite → Zurück ist die Liste so lang wie vorher. */
  function saveShown() {
    if (shown === savedAs) return;
    savedAs = shown;
    try {
      history.replaceState({ ...(history.state ?? {}), catShown: shown }, '');
    } catch {
      /* ignorieren */
    }
  }

  function toggle(key, value, on) {
    const rest = state[key].filter((v) => v !== value);
    commit({ ...state, [key]: on ? [...rest, value] : rest });
  }

  /** Art wechseln: Filter, die nur für Messer gelten, fallen weg (sonst blieben 0 Treffer ohne erkennbaren Grund). */
  function setCategory(cat) {
    const keepKnifeFilters = cat === 'knife';
    commit({
      ...state,
      cat,
      ...(keepKnifeFilters ? {} : { type: [], steel: [], rust: [], grip: [], bevel: '', hand: '', finish: [], len: null, gastro: false }),
    });
  }

  const resetAll = () => commit(resetFilters(state));

  // ── Filterpanel: Bausteine ──

  /** Eine Auswahlzeile (Checkbox oder Radio) mit Anzahl; Zeilen ohne Treffer sind gedämpft, bleiben aber wählbar. */
  function option({ kind = 'checkbox', name, value, text, ja, sub, tip, onChange, isOn, getCount, formatCount, countHint = ' Treffer' }) {
    const input = h('input', { type: kind, name, value: String(value), onChange: (event) => onChange(event.target.checked) });
    const num = document.createTextNode('');
    const hint = document.createTextNode(countHint);
    const countEl = h('span', { class: 'fopt__count' }, num, h('span', { class: 'visually-hidden' }, hint));
    const row = h(
      'label',
      { class: 'fopt', title: tip || null },
      input,
      h('span', { class: 'fopt__main' }, h('span', { class: 'fopt__label' }, withJa(text), ja && [' ', h('span', { class: 'fopt__ja', lang: 'ja' }, ja)]), sub && h('span', { class: 'fopt__sub' }, withJa(sub))),
      getCount && countEl
    );
    updaters.push(() => {
      const on = isOn();
      input.checked = on;
      if (!getCount) return;
      const n = getCount();
      num.nodeValue = formatCount ? formatCount(n, on) : fmtInt(n);
      row.classList.toggle('is-zero', n === 0 && !on);
    });
    return row;
  }

  const fieldsetOf = (legend, rows) => h('fieldset', { class: 'cat-opts' }, h('legend', { class: 'visually-hidden' }, legend), rows);

  /** Aufklappbare Gruppe mit Zähler der aktiven Auswahl im Kopf. */
  function group({ id, title: groupTitle, open = false, knifeOnly = false, activeCount, children }) {
    const badge = h('span', { class: 'badge cat-group__badge' });
    const details = h(
      'details',
      { class: 'disclosure cat-group', open: open || activeCount() > 0, dataset: { group: id } },
      h('summary', {}, h('span', { class: 'cat-group__title' }, groupTitle), badge),
      h('div', { class: 'disclosure__body cat-group__body' }, children)
    );
    updaters.push(() => {
      const n = activeCount();
      badge.hidden = n === 0;
      badge.replaceChildren(String(n), h('span', { class: 'visually-hidden' }, ' aktiv'));
      details.hidden = knifeOnly && state.cat !== 'knife';
    });
    return details;
  }

  /** Untergruppe (Typgruppe, Stahlfamilie) mit Summe der Treffer im Kopf. */
  function subGroup({ label: subLabel, ids, key, optionOf, open }) {
    const total = document.createTextNode('');
    const sub = h(
      'details',
      { class: 'cat-sub', open: open || ids.some((id) => state[key].includes(id)) },
      h('summary', {}, h('span', {}, subLabel), h('span', { class: 'cat-sub__count' }, total, h('span', { class: 'visually-hidden' }, ' Treffer'))),
      h('div', { class: 'cat-sub__body' }, ids.map(optionOf))
    );
    updaters.push(() => {
      total.nodeValue = fmtInt(ids.reduce((sum, id) => sum + (counts[key][id] ?? 0), 0));
    });
    return sub;
  }

  // ── Filterpanel: Gruppen ──

  function typeGroup() {
    const byGroup = new Map();
    for (const id of Object.keys(base.type)) {
      const g = tax.types[id]?.group ?? 'spezial';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(id);
    }
    const order = [...TYPE_GROUP_ORDER, ...[...byGroup.keys()].filter((g) => !TYPE_GROUP_ORDER.includes(g))].filter((g) => byGroup.has(g));
    const subs = order.map((g, index) =>
      subGroup({
        label: tax.typeGroups[g]?.label ?? g,
        ids: byGroup.get(g).sort(byBase('type')),
        key: 'type',
        open: index === 0,
        optionOf: (id) =>
          option({
            name: 'type',
            value: id,
            text: tax.types[id]?.label ?? id,
            ja: tax.types[id]?.kanji,
            tip: tax.types[id]?.gloss,
            onChange: (on) => toggle('type', id, on),
            isOn: () => state.type.includes(id),
            getCount: () => counts.type[id] ?? 0,
          }),
      })
    );
    return group({ id: 'type', title: 'Typ', open: true, knifeOnly: true, activeCount: () => state.type.length, children: subs });
  }

  function rustGroup() {
    const rows = RUST_VALUES.map((id) =>
      option({
        name: 'rust',
        value: id,
        text: tax.rust[id]?.label ?? id,
        sub: shortExplain(tax.rust[id]?.explain),
        onChange: (on) => toggle('rust', id, on),
        isOn: () => state.rust.includes(id),
        getCount: () => counts.rust[id] ?? 0,
      })
    );
    const note = h('p', { class: 'cat-note' }, h('strong', '„Teilweise rostfrei“'), ' heißt: Nur der Mantel der Klinge ist rostfrei, Kern und Schneide bestehen aus Kohlenstoffstahl und können Patina ansetzen. ', h('a', { href: '#/wissen/stahl' }, 'Mehr in der Messerkunde'));
    return group({ id: 'rust', title: 'Rostfrei', open: true, knifeOnly: true, activeCount: () => state.rust.length, children: [fieldsetOf('Rostfrei', rows), note] });
  }

  function steelGroup() {
    const familyOf = (id) => tax.steels[id]?.family || 'none';
    const ids = Object.keys(base.steel);
    const subs = ['stainless', 'carbon', 'none']
      .map((family, index) => {
        const list = ids.filter((id) => familyOf(id) === family).sort(byBase('steel'));
        if (!list.length) return null;
        return subGroup({
          label: family === 'none' ? 'Stahl nicht angegeben' : tax.steelFamilies[family]?.label ?? family,
          ids: list,
          key: 'steel',
          open: index === 0,
          optionOf: (id) =>
            option({
              name: 'steel',
              value: id,
              text: tax.steels[id]?.label ?? id,
              onChange: (on) => toggle('steel', id, on),
              isOn: () => state.steel.includes(id),
              getCount: () => counts.steel[id] ?? 0,
            }),
        });
      })
      .filter(Boolean);
    return group({ id: 'steel', title: 'Stahl', knifeOnly: true, activeCount: () => state.steel.length, children: subs });
  }

  /** Zwei Zahlfelder (von/bis) mit Schnellauswahl; Werte im Zustand sind mm bzw. JPY. */
  function rangeGroup({ id, title: groupTitle, what, unit, unitWord, inputmode, toField, fromField, presets, extra }) {
    const mk = (suffix, text) => {
      const input = h('input', { type: 'number', id: `cat-${id}-${suffix}`, inputmode, min: '0', step: 'any', autocomplete: 'off' });
      const node = h('div', { class: 'cat-range__field' }, h('label', { for: input.id }, text, h('span', { class: 'visually-hidden' }, ` (${what} in ${unitWord})`)), h('div', { class: 'cat-range__input' }, input, h('span', { class: 'cat-range__unit', 'aria-hidden': 'true' }, unit)));
      return { input, node };
    };
    const min = mk('min', 'von');
    const max = mk('max', 'bis');
    const readField = (input) => {
      if (input.value.trim() === '') return null;
      const v = fromField(Number(input.value));
      return Number.isFinite(v) && v >= 0 ? v : null;
    };
    const apply = () => {
      let a = readField(min.input);
      let b = readField(max.input);
      if (a != null && b != null && a > b) [a, b] = [b, a];
      const range = a == null && b == null ? null : { min: a, max: b };
      if (!sameRange(range, state[id])) commit({ ...state, [id]: range });
    };
    const later = debounce(apply, FIELD_DEBOUNCE);
    for (const { input } of [min, max]) {
      input.addEventListener('input', later);
      input.addEventListener('change', () => {
        later.cancel();
        apply();
        updateRangeFields(); // vertauschte Werte sichtbar korrigieren
      });
    }
    cleanups.push(() => later.cancel());

    const presetButtons = presets.map((preset) => {
      const btn = h(
        'button',
        {
          class: 'chip-select',
          type: 'button',
          'aria-pressed': 'false',
          onClick: () => commit({ ...state, [id]: sameRange(state[id], preset.range) ? null : { ...preset.range } }),
        },
        preset.text,
        preset.sub && h('span', { class: 'chip-select__count' }, preset.sub)
      );
      return { btn, range: preset.range };
    });

    function updateRangeFields() {
      const r = state[id];
      if (document.activeElement !== min.input) min.input.value = r?.min != null ? toField(r.min) : '';
      if (document.activeElement !== max.input) max.input.value = r?.max != null ? toField(r.max) : '';
    }
    const hintEl = extra?.hint ? h('p', { class: 'cat-note cat-range__hint' }) : null;
    updaters.push(() => {
      updateRangeFields();
      for (const { btn, range } of presetButtons) btn.setAttribute('aria-pressed', sameRange(state[id], range) ? 'true' : 'false');
      if (hintEl) hintEl.textContent = extra.hint();
    });

    return group({
      id,
      title: groupTitle,
      knifeOnly: extra?.knifeOnly ?? false,
      activeCount: () => (state[id] ? 1 : 0),
      children: [
        h('div', { class: 'cat-range' }, min.node, h('span', { class: 'cat-range__dash', 'aria-hidden': 'true' }, '–'), max.node),
        h('div', { class: 'cat-presets', role: 'group', 'aria-label': `${groupTitle}: Schnellauswahl` }, presetButtons.map((p) => p.btn)),
        hintEl,
        extra?.note,
      ],
    });
  }

  function lengthGroup() {
    const typical = ['gyuto', 'santoku', 'petty', 'sujihiki']
      .map((id) => {
        const t = tax.types[id];
        return t?.typicalMm ? `${t.label} ${cmText(t.typicalMm[0])}–${cmText(t.typicalMm[1])} cm` : null;
      })
      .filter(Boolean);
    return rangeGroup({
      id: 'len',
      title: 'Länge',
      what: 'Klingenlänge',
      unit: 'cm',
      unitWord: 'Zentimetern',
      inputmode: 'decimal',
      toField: (mm) => String(Math.round(mm) / 10),
      fromField: (cm) => Math.round(cm * 10),
      presets: [
        { text: 'bis 15 cm', range: { min: null, max: 150 } },
        { text: '15–21 cm', range: { min: 150, max: 210 } },
        { text: '21–27 cm', range: { min: 210, max: 270 } },
        { text: 'ab 27 cm', range: { min: 270, max: null } },
      ],
      extra: {
        knifeOnly: true,
        note: [
          typical.length ? h('p', { class: 'cat-note' }, `Üblich laut Messerkunde: ${typical.join(', ')}. `) : null,
          h('p', { class: 'cat-note' }, 'Ein Messer passt, wenn irgendeine seiner Größen in den Bereich fällt; die Klingenlänge laut Shop ist ein Richtwert.'),
        ],
      },
    });
  }

  function currencyForHint() {
    const c = prefs.get().currency;
    return c && c !== 'JPY' && data.rates?.[c] ? c : 'EUR';
  }

  function priceGroup() {
    const cur = currencyForHint();
    const rate = data.rates?.[cur];
    const approx = (yen) => (rate ? money(yen / rate, cur) : null);
    const source = data.site?.rates;
    return rangeGroup({
      id: 'price',
      title: 'Preis',
      what: 'Preis',
      unit: '¥',
      unitWord: 'Yen',
      inputmode: 'numeric',
      toField: (yen) => String(Math.round(yen)),
      fromField: (yen) => Math.round(yen),
      presets: [
        { text: 'bis ¥20.000', range: { min: null, max: 20000 } },
        { text: '¥20.000–40.000', range: { min: 20000, max: 40000 } },
        { text: '¥40.000–80.000', range: { min: 40000, max: 80000 } },
        { text: 'ab ¥80.000', range: { min: 80000, max: null } },
      ],
      extra: {
        hint: () => {
          const r = state.price;
          const stamp = source?.asOf ? ` (${source.source ?? 'Kurs'} vom ${dateDe(source.asOf)})` : '';
          if (!rate) return '';
          if (r && (r.min || r.max != null)) {
            const lo = r.min ? approx(r.min) : null;
            const hi = r.max != null ? approx(r.max) : null;
            return `Zur Orientierung: ${lo && hi ? `${lo} bis ${hi}` : hi ? `bis ${hi}` : `ab ${lo}`}${stamp}`;
          }
          return `Zur Orientierung: ¥10.000 ≈ ${approx(10000)}${stamp}`;
        },
        note: h('p', { class: 'cat-note' }, 'Yen laut Online-Katalog (in Japan üblicherweise inkl. Verbrauchsteuer). Ein Artikel passt, wenn irgendeine seiner Größen in den Bereich fällt.'),
      },
    });
  }

  function gripGroup() {
    const rows = GRIP_VALUES.map((id) =>
      option({
        name: 'grip',
        value: id,
        text: tax.handleStyles[id]?.label ?? id,
        sub: shortExplain(tax.handleStyles[id]?.explain),
        onChange: (on) => toggle('grip', id, on),
        isOn: () => state.grip.includes(id),
        getCount: () => counts.grip[id] ?? 0,
      })
    );
    return group({ id: 'grip', title: 'Griff', knifeOnly: true, activeCount: () => state.grip.length, children: fieldsetOf('Griff', rows) });
  }

  /** Einzelauswahl (Radio) mit „Egal“ als erster Zeile. */
  function radioGroup({ id, title: groupTitle, knifeOnly = true, values, current, getCount, setValue, note }) {
    const rows = values.map(({ value, text, sub }) =>
      option({
        kind: 'radio',
        name: `cat-${id}`,
        value,
        text,
        sub,
        onChange: (on) => on && setValue(value),
        isOn: () => current() === value,
        getCount: value === '' ? null : () => getCount(value),
      })
    );
    return group({ id, title: groupTitle, knifeOnly, activeCount: () => (current() && current() !== (id === 'cat' ? 'knife' : '') ? 1 : 0), children: [fieldsetOf(groupTitle, rows), note] });
  }

  function bevelGroup() {
    return radioGroup({
      id: 'bevel',
      title: 'Schliff',
      values: [
        { value: '', text: 'Egal' },
        { value: 'double', text: tax.bevels.double?.label ?? 'Beidseitig geschliffen', sub: shortExplain(tax.bevels.double?.explain) },
        { value: 'single', text: tax.bevels.single?.label ?? 'Einseitig geschliffen', sub: shortExplain(tax.bevels.single?.explain) },
      ],
      current: () => state.bevel,
      getCount: (v) => counts.bevel[v] ?? 0,
      setValue: (v) => commit({ ...state, bevel: v }),
      note: h('p', { class: 'cat-note' }, h('a', { href: '#/wissen/schliff' }, 'Einseitig oder beidseitig – was das bedeutet')),
    });
  }

  function handGroup() {
    const single = items.filter((i) => i.category === 'knife' && i.bevel === 'single');
    const left = single.filter((i) => i.handed === 'left').length;
    const right = single.filter((i) => i.handed === 'right').length;
    const rest = single.length - left - right;
    return radioGroup({
      id: 'hand',
      title: 'Händigkeit',
      values: [
        { value: '', text: 'Egal' },
        { value: 'left', text: 'Ich bin Linkshänder' },
        { value: 'right', text: 'Ich bin Rechtshänder' },
      ],
      current: () => state.hand,
      getCount: (v) => counts.hand[v] ?? 0,
      setValue: (v) => commit({ ...state, hand: v }),
      note: h('p', { class: 'cat-note' }, `Beidseitig geschliffene Messer passen in beide Hände. Von ${single.length} einseitig geschliffenen Messern im Katalog (z. B. Yanagiba, Deba, Usuba) sind ${right} Rechtshänder- und ${left} Linkshänder-Ausführungen${rest ? `, ${rest} ohne Angabe` : ''}. Die Auswahl blendet das jeweils unpassende aus, Messer ohne Angabe bleiben sichtbar.`),
    });
  }

  function finishGroup() {
    const ids = Object.keys(base.finish).sort(byBase('finish'));
    const rows = ids.map((id) =>
      option({
        name: 'finish',
        value: id,
        text: tax.finishes[id]?.label ?? id,
        onChange: (on) => toggle('finish', id, on),
        isOn: () => state.finish.includes(id),
        getCount: () => counts.finish[id] ?? 0,
      })
    );
    return group({ id: 'finish', title: 'Oberfläche', knifeOnly: true, activeCount: () => state.finish.length, children: fieldsetOf('Oberfläche', rows) });
  }

  function makerGroup() {
    const ids = Object.keys(base.maker).sort(byBase('maker'));
    // Hersteller von Zubehör stehen nicht in der Messer-Basis: alphabetisch anhängen
    const more = [...new Set(items.map((i) => i.maker).filter((m) => m && !ids.includes(m)))].sort(collator.compare);
    ids.push(...more);
    const rows = ids.map((id) =>
      option({
        name: 'maker',
        value: id,
        text: tax.makers[id]?.label ?? id,
        onChange: (on) => toggle('maker', id, on),
        isOn: () => state.maker.includes(id),
        getCount: () => counts.maker[id] ?? 0,
      })
    );
    return group({ id: 'maker', title: 'Hersteller', activeCount: () => state.maker.length, children: fieldsetOf('Hersteller', rows) });
  }

  function categoryGroup() {
    return radioGroup({
      id: 'cat',
      title: 'Art',
      knifeOnly: false,
      values: [
        { value: 'knife', text: tax.categories.knife?.label ?? 'Messer' },
        { value: 'sharpening', text: tax.categories.sharpening?.label ?? 'Schleifzubehör' },
        { value: 'tool', text: tax.categories.tool?.label ?? 'Sonstiges' },
      ],
      current: () => state.cat,
      getCount: (v) => counts.cat[v] ?? 0,
      setValue: setCategory,
    });
  }

  // ── Filterpanel: Aufbau ──

  const resetBtn = h('button', { class: 'btn btn--ghost btn--sm cat-panel__reset', type: 'button', onClick: resetAll }, 'Alle zurücksetzen');
  const applyLabel = document.createTextNode('');
  const applyBtn = h('button', { class: 'btn btn--primary btn--block', type: 'button', onClick: () => sheet?.close() }, applyLabel);

  const availRow = option({
    name: 'avail',
    value: '1',
    text: 'Nur laut Katalog vorrätig',
    sub: 'Bestand laut Online-Katalog, im Laden bitte bestätigen.',
    onChange: (on) => commit({ ...state, avail: on }),
    isOn: () => state.avail,
    getCount: () => counts.avail[1] ?? 0,
  });
  const gastroRow = option({
    name: 'gastro',
    value: '1',
    text: 'Profi-/Gastro-Messer einblenden',
    sub: 'Linie für den gewerblichen Einsatz (業務用)',
    onChange: (on) => commit({ ...state, gastro: on }),
    isOn: () => state.gastro,
    getCount: () => counts.gastro[1] ?? 0,
    formatCount: (n, on) => (on ? fmtInt(n) : `+${fmtInt(n)}`),
    countHint: ' zusätzliche Treffer',
  });
  const gastroWrap = h('div', { class: 'cat-toggles__row' }, gastroRow);
  updaters.push(() => {
    gastroWrap.hidden = state.cat !== 'knife';
  });

  const panel = h(
    'div',
    { class: 'cat-panel' },
    h('div', { class: 'cat-panel__head' }, h('h2', { class: 'cat-panel__title' }, 'Filter'), resetBtn),
    h('div', { class: 'cat-toggles' }, availRow, gastroWrap),
    typeGroup(),
    rustGroup(),
    steelGroup(),
    lengthGroup(),
    priceGroup(),
    gripGroup(),
    bevelGroup(),
    handGroup(),
    finishGroup(),
    makerGroup(),
    categoryGroup(),
    h('div', { class: 'cat-panel__apply' }, applyBtn)
  );
  updaters.push(() => {
    resetBtn.hidden = activeFilters(state, data).length === 0;
  });

  // ── Kopf: Titel, Zähler, Suche, Sortierung, Filter-Button ──

  const countEl = h('p', { class: 'cat-count', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });

  const searchInput = h('input', { type: 'search', id: 'cat-q', name: 'q', value: state.q, placeholder: 'Suchen: Typ, Stahl, Hersteller, 牛刀 …', autocomplete: 'off', enterkeyhint: 'search', spellcheck: 'false', maxlength: '200' });
  const applySearch = () => {
    const q = searchInput.value.replace(/\s+/g, ' ').trim();
    if (q !== state.q) commit({ ...state, q });
  };
  const searchLater = debounce(applySearch, SEARCH_DEBOUNCE);
  // Während einer IME-Eingabe (z. B. 牛刀 per Kana) nicht mit Halbfertigem filtern; erst nach compositionend suchen
  searchInput.addEventListener('input', (event) => {
    if (!event.isComposing) searchLater();
  });
  searchInput.addEventListener('compositionend', searchLater);
  cleanups.push(() => searchLater.cancel());
  const searchForm = h(
    'form',
    {
      class: 'cat-search',
      role: 'search',
      onSubmit: (event) => {
        event.preventDefault();
        searchLater.cancel();
        applySearch();
      },
    },
    h('label', { class: 'visually-hidden', for: 'cat-q' }, 'Katalog durchsuchen'),
    h('span', { class: 'cat-search__icon', 'aria-hidden': 'true' }, icon('search', { size: 20 })),
    searchInput
  );

  const sortSelect = h('select', {
    id: 'cat-sort',
    onChange: (event) => {
      const v = event.target.value;
      commit({ ...state, sort: v === 'relevance' ? 'default' : v });
    },
  });
  const sortBox = h('div', { class: 'cat-sort' }, h('label', { for: 'cat-sort' }, 'Sortierung'), sortSelect);

  const filterLabel = document.createTextNode('Filter');
  const filterBtn = h('button', { class: 'btn cat-filterbtn', type: 'button', 'aria-haspopup': 'dialog', onClick: openSheet }, icon('sliders', { size: 18 }), h('span', filterLabel));

  const head = h(
    'header',
    { class: 'cat-head' },
    h('div', { class: 'cat-head__title' }, h('h1', 'Katalog'), countEl, h('p', { class: 'muted small cat-head__stand' }, `Preise und Bestand laut Online-Katalog, Stand ${dateDe(data.meta?.fetchedAt)}.`)),
    h('div', { class: 'cat-toolbar' }, searchForm, sortBox, filterBtn)
  );

  // ── Ergebnisse ──

  const resultsHeading = h('h2', { class: 'visually-hidden', id: 'cat-results', tabindex: '-1' }, 'Ergebnisse');
  const chipsRow = h('div', { class: 'cat-chips', hidden: true });
  const emptyHost = h('div', { class: 'cat-empty-host' });
  const grid = h('div', { class: 'grid cat-grid' });
  const moreInfo = h('p', { class: 'muted cat-more__info' });
  const moreBtn = h('button', { class: 'btn', type: 'button', onClick: showMore }, 'Mehr anzeigen');
  const moreWrap = h('div', { class: 'cat-more', hidden: true }, moreInfo, moreBtn);
  const liveStatus = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

  grid.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest?.('a[href^="#/messer/"]')) rememberOrigin(1);
  });

  const asideSlot = h('aside', { class: 'cat-filters', 'aria-label': 'Filter' }, panel);
  const main = h('div', { class: 'cat-main' }, resultsHeading, chipsRow, emptyHost, grid, moreWrap, liveStatus);
  const root = h('section', { class: 'container section cat' }, head, h('div', { class: 'cat-notice' }, shopNotice(data, { compact: true })), h('div', { class: 'cat-layout' }, asideSlot, main));

  const cardFor = (item) => {
    let card = cardCache.get(item.handle);
    if (!card) cardCache.set(item.handle, (card = productCard(item, { data })));
    return card;
  };

  function showMore() {
    const from = shown;
    shown = Math.min(shown + PAGE_SIZE, results.length);
    saveShown();
    const added = results.slice(from, shown).map(cardFor);
    grid.append(...added);
    renderMore();
    liveStatus.textContent = `${added.length} weitere angezeigt, ${shown} von ${results.length}.`;
    added[0]?.querySelector('.pcard__title a')?.focus();
  }

  function renderMore() {
    const rest = results.length - shown;
    moreWrap.hidden = results.length <= PAGE_SIZE;
    moreInfo.textContent = rest > 0 ? `${fmtInt(shown)} von ${fmtInt(results.length)} angezeigt` : `Alle ${fmtInt(results.length)} angezeigt`;
    moreBtn.hidden = rest <= 0;
    moreBtn.textContent = `Mehr anzeigen (${Math.min(PAGE_SIZE, rest)} weitere)`;
  }

  function emptyState() {
    const suggestions = suggestRelaxations(items, state, data);
    const chips = activeFilters(state, data);
    const lead = state.q
      ? `Zu „${state.q}“ passt in dieser Auswahl nichts. Die Suche kennt englische Titel, deutsche Typ- und Stahlnamen, Hersteller, Griffholz und japanische Begriffe (z. B. 牛刀).`
      : chips.length
        ? 'Die gewählten Filter schließen zusammen alle Artikel aus.'
        : 'In dieser Art gibt es keine Artikel.';
    return h(
      'div',
      { class: 'empty cat-empty' },
      h('div', { class: 'empty__mark', lang: 'ja', 'aria-hidden': 'true' }, '刃'),
      h('h3', 'Keine Treffer'),
      h('p', lead),
      suggestions.length
        ? h(
            'div',
            { class: 'cat-empty__help' },
            h('p', { class: 'cat-empty__lede' }, 'Das bringt wieder Treffer:'),
            h('ul', { class: 'cat-empty__list' }, suggestions.map((s) => h('li', h('button', { class: 'btn', type: 'button', onClick: () => { commit(s.state); resultsHeading.focus({ preventScroll: true }); } }, s.text, h('span', { class: 'cat-empty__n' }, countText(s.count, 'Treffer', 'Treffer'))))))
          )
        : chips.length > 1
          ? h('p', 'Nimm mehrere Filter heraus oder setze alle zurück.')
          : null,
      chips.length ? h('button', { class: 'btn btn--primary', type: 'button', onClick: () => { resetAll(); resultsHeading.focus({ preventScroll: true }); } }, 'Alle Filter zurücksetzen') : null
    );
  }

  // ── Neu zeichnen ──

  function renderHead() {
    countEl.textContent = `${noun(results.length)} gefunden`;
    const n = activeFilterCount(state, data);
    filterLabel.nodeValue = n ? `Filter (${n} aktiv)` : 'Filter';
    applyLabel.nodeValue = results.length ? `${noun(results.length)} anzeigen` : 'Keine Treffer – Filter ändern';
    if (document.activeElement !== searchInput) searchInput.value = state.q;

    const hasQuery = !!state.q;
    if (hasQuery !== sortHasQuery) {
      sortHasQuery = hasQuery;
      const keys = hasQuery ? ['relevance', 'price-asc', 'price-desc', 'len-asc', 'len-desc', 'name'] : ['default', 'price-asc', 'price-desc', 'len-asc', 'len-desc', 'name'];
      sortSelect.replaceChildren(...keys.map((k) => h('option', { value: k }, SORT_LABELS[k])));
    }
    sortSelect.value = effectiveSort(state);
  }

  function renderChips() {
    const list = activeFilters(state, data);
    chipsRow.hidden = list.length === 0;
    if (!list.length) {
      chipsRow.replaceChildren();
      return;
    }
    chipsRow.replaceChildren(
      h(
        'ul',
        { class: 'cat-chips__list', 'aria-label': 'Aktive Filter' },
        list.map((f, i) =>
          h('li', h('button', { class: 'cat-chip', type: 'button', 'aria-label': `Filter entfernen: ${f.text}`, onClick: () => removeChip(i) }, h('span', withJa(f.text)), icon('close', { size: 16 })))
        )
      ),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => { resetAll(); resultsHeading.focus({ preventScroll: true }); } }, 'Alle zurücksetzen')
    );
  }

  function removeChip(index) {
    const f = activeFilters(state, data)[index];
    if (!f) return;
    commit(removeFilter(state, f.key, f.value));
    const buttons = chipsRow.querySelectorAll('.cat-chip');
    (buttons[Math.min(index, buttons.length - 1)] ?? resultsHeading).focus({ preventScroll: true });
  }

  function renderResults() {
    shown = Math.min(Math.max(shown, PAGE_SIZE), Math.max(results.length, PAGE_SIZE));
    grid.hidden = results.length === 0;
    grid.replaceChildren(...results.slice(0, shown).map(cardFor));
    emptyHost.replaceChildren(...(results.length ? [] : [emptyState()]));
    renderMore();
  }

  function refresh() {
    results = applyFilters(items, state, data);
    counts = facetCounts(items, state, data);
    renderHead();
    renderChips();
    renderResults();
    for (const update of updaters) update();
  }

  // ── Bottom-Sheet (unter 60 rem) ──

  function openSheet() {
    if (sheet) return;
    panel.classList.add('is-sheet');
    sheet = openDialog({
      title: 'Filter',
      body: panel,
      sheet: true,
      onClose: () => {
        sheet = null;
        panel.classList.remove('is-sheet');
        asideSlot.append(panel);
      },
    });
  }

  const media = window.matchMedia(DESKTOP);
  const onMedia = () => {
    if (media.matches) sheet?.close();
  };
  media.addEventListener?.('change', onMedia);
  cleanups.push(() => media.removeEventListener?.('change', onMedia));

  refresh();

  return {
    root,
    dispose() {
      for (const fn of cleanups) fn();
      cleanups.length = 0;
      try {
        sheet?.close();
      } catch {
        /* ignorieren */
      }
    },
  };
}
