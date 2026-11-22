// Detailseite eines Artikels (#/messer/:handle): Galerie, Größen und Preise, Merkmale mit Erklärungen,
// „Was dieses Messer besonders macht“ und „Im Vergleich“ (belegte Aussagen, lib/insights.js), „Bitte beachten“, Typ-Karte, ähnliche Messer.
// Fehlende Taxonomie-Felder lassen die jeweilige Zeile einfach weg.
import { h, loadCss, assetUrl, withJa } from '../dom.js';
import { icon } from '../icons.js';
import { prefs } from '../prefs.js';
import { shortlist } from '../shortlist.js';
import { sizeText, sizeRangeText, cmText, imageUrl, dateDe, convert, money } from '../format.js';
import { itemHeadline, rustBadge, attrChips } from '../ui/attrs.js';
import { productCard, productPhoto, priceBlock, availabilityText } from '../ui/card.js';
import { openPickDialog } from '../ui/pick.js';
import { openDialog } from '../ui/dialog.js';
import { shopNotice } from '../ui/shop-notice.js';
import { silhouette } from '../ui/silhouette.js';
import { similarItems } from '../lib/filters.js';
import { highlights, compareInClass, hardnessSentence, priceSentence, knifeHardness, hardnessNote, sharpeningStatement, hrcText } from '../lib/insights.js';
import { hardnessMeter } from '../ui/meter.js';
import { fillSources } from '../ui/sources.js';
import { kpiSection } from '../ui/kpis.js';

// Der Router liest `title` nach dem Rendern (lebendige Bindung) → Tab-Titel mit dem konkreten Messer.
export let title = 'Messer';

const ORIGIN_KEY = 'jmf:catalog-origin'; // Spur vom Katalog (gleicher Schlüssel in catalog.js)
const UNSPECIFIED_STEELS = new Set(['unknown', 'stainless-unspecified', 'carbon-unspecified']);

// ───────────────────────────── Zurück zum Katalog ─────────────────────────────

/**
 * Woher kam der Besuch? Der Katalog legt beim Klick auf eine Karte { hash, steps } in sessionStorage ab; die Detailseite
 * übernimmt es und merkt es sich im Verlaufseintrag (überlebt Zurück/Vor). steps = so viele Einträge liegt der Katalog zurück.
 */
function readOrigin() {
  try {
    let origin = history.state?.jmfOrigin ?? null;
    if (!origin) {
      const raw = sessionStorage.getItem(ORIGIN_KEY);
      if (raw) {
        origin = JSON.parse(raw);
        sessionStorage.removeItem(ORIGIN_KEY);
      }
    }
    const valid = origin && typeof origin.hash === 'string' && origin.hash.startsWith('#/katalog') && Number.isInteger(origin.steps) && origin.steps >= 1 && history.length > 1;
    if (!valid) return null;
    history.replaceState({ ...(history.state ?? {}), jmfOrigin: origin }, '');
    return origin;
  } catch {
    return null;
  }
}

function backLink(origin) {
  return h(
    'a',
    {
      class: 'detail__back',
      href: origin?.hash ?? '#/katalog',
      onClick: (event) => {
        if (!origin || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        // Zurück zum Katalog mit seinen Filtern (der Router liest sie aus der URL); war der Katalog der direkte Vorgänger: history.back()
        if (origin.steps === 1) history.back();
        else history.go(-origin.steps);
      },
    },
    icon('arrow-left', { size: 18 }),
    'Zurück zum Katalog'
  );
}

// ───────────────────────────── Hilfen ─────────────────────────────

const entry = (data, group, id) => (id == null ? null : data.entry(group, id));
const hasMm = (item) => item.sizes.some((s) => s.mm != null);
const preferredSize = (item) => Math.max(0, item.sizes.findIndex((s) => s.available));
const jaYen = (n) => `¥${new Intl.NumberFormat('ja-JP').format(Math.round(n))}`;

function ratesCurrency(data) {
  const c = prefs.get().currency;
  return c && c !== 'JPY' && data.rates?.[c] ? c : null;
}

/** Preis eines Eintrags: ¥ fett, Orientierung in der gewählten Währung daneben */
function priceCell(data, yen) {
  const cur = ratesCurrency(data);
  const alt = cur ? convert(yen, cur, data.rates) : null;
  return h('span', { class: 'price' }, h('span', { class: 'price__main' }, `¥${new Intl.NumberFormat('de-DE').format(Math.round(yen))}`), alt != null && h('span', { class: 'price__alt' }, `≈ ${money(alt, cur)}`));
}


// ───────────────────────────── Galerie ─────────────────────────────

/**
 * Hauptbild + bis zu 3 Vorschaubilder (der Katalog liefert höchstens 4 Bilder). Ein Klick auf ein Vorschaubild tauscht es
 * mit dem Hauptbild; so bleiben alle Bilder erreichbar und es gibt nie mehr als 3 Vorschaubilder.
 * Tastatur: Tab/Pfeiltasten (Home/End) bewegen den Fokus, Enter/Leertaste tauschen. Bilder aus → Platzhalter.
 */
function gallery(item) {
  const images = (item.images ?? []).slice(0, 4);
  if (!prefs.get().images || !images.length) return h('div', { class: 'detail__gallery' }, h('div', { class: 'detail__stage' }, productPhoto(item)));

  const total = images.length;
  const order = images.map((_, i) => i); // order[0] = Hauptbild, order[1…] = Vorschaubilder
  const altFor = (i) => (i === 0 ? item.title : `${item.title} (Bild ${i + 1} von ${total})`);
  const srcset = (src) => [480, 900, 1400].map((w) => `${imageUrl(src, w)} ${w}w`).join(', ');
  const first = images[0];
  const main = h('img', {
    src: imageUrl(first.src, 900),
    srcset: srcset(first.src),
    sizes: '(min-width: 52rem) 46vw, 100vw',
    alt: altFor(0),
    width: 900,
    height: Math.round((900 * (first.h || 1)) / (first.w || 1)),
    decoding: 'async',
    fetchpriority: 'high',
    referrerpolicy: 'no-referrer',
  });
  const stage = h('div', { class: 'detail__stage' }, h('div', { class: 'photo' }, main));
  const status = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

  const thumbs = order.slice(1).map((_, k) => {
    const img = h('img', { alt: '', width: 96, height: 96, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    const button = h('button', { class: 'detail__thumb', type: 'button', onClick: () => swap(k + 1) }, h('span', { class: 'photo' }, img));
    return { button, img };
  });

  function paint() {
    const image = images[order[0]];
    main.src = imageUrl(image.src, 900);
    main.srcset = srcset(image.src);
    main.alt = altFor(order[0]);
    thumbs.forEach(({ button, img }, k) => {
      const i = order[k + 1];
      const t = images[i];
      img.src = imageUrl(t.src, 200);
      img.height = Math.round((96 * (t.h || 1)) / (t.w || 1));
      button.setAttribute('aria-label', `Bild ${i + 1} von ${total} groß anzeigen`);
    });
  }

  function swap(k) {
    [order[0], order[k]] = [order[k], order[0]];
    paint();
    status.textContent = `Bild ${order[0] + 1} von ${total} wird groß angezeigt.`;
  }

  paint();
  const strip = thumbs.length
    ? h(
        'div',
        {
          class: 'detail__thumbs',
          role: 'group',
          'aria-label': 'Weitere Bilder des Artikels',
          onKeydown: (event) => {
            const current = thumbs.findIndex(({ button }) => button === document.activeElement);
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
            let next = null;
            if (step) next = (current + step + thumbs.length) % thumbs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = thumbs.length - 1;
            if (next == null) return;
            event.preventDefault();
            thumbs[next].button.focus();
          },
        },
        thumbs.map((t) => t.button)
      )
    : null;

  return h('div', { class: 'detail__gallery' }, stage, strip, status);
}

// ───────────────────────────── Merken / Im Laden zeigen ─────────────────────────────

function createPickButtons(data, item) {
  const buttons = [];
  const refresh = () => {
    const picked = shortlist.isPicked(item.handle);
    for (const b of buttons) {
      if (!b.dataset.main) continue;
      b.replaceChildren(icon(picked ? 'bookmark-fill' : 'bookmark', { size: 18 }), picked ? 'Vorgemerkt' : 'Merken');
      b.setAttribute('aria-pressed', picked ? 'true' : 'false');
    }
  };
  return {
    main(sizeIndex) {
      const b = h('button', { class: 'btn btn--primary', type: 'button', dataset: { main: '1' }, onClick: () => openPickDialog({ data, item, sizeIndex, onDone: refresh }) });
      buttons.push(b);
      refresh();
      return b;
    },
    row(sizeIndex) {
      return h('button', { class: 'btn btn--sm', type: 'button', 'aria-label': `Größe ${sizeText(item.sizes[sizeIndex])} merken`, onClick: () => openPickDialog({ data, item, sizeIndex, onDone: refresh }) }, icon('bookmark', { size: 16 }), 'Merken');
    },
  };
}

/** Großer Dialog zum Vorzeigen im Laden: Originaltitel, Größe, Art.-Nr., Preis – mit japanischen Feldbezeichnungen fürs Personal. */
function openShowDialog({ data, item, sizeIndex = 0 }) {
  let index = sizeIndex;
  const facts = h('dl', { class: 'detail-show__facts', 'aria-live': 'polite' });
  const row = (ja, de, value, cls) => [h('dt', h('span', { lang: 'ja' }, ja), ` · ${de}`), h('dd', { class: cls }, value)];

  function update() {
    const size = item.sizes[index];
    facts.replaceChildren(
      ...row('商品名', 'Produkt', h('span', { lang: 'en' }, item.title), 'detail-show__title'),
      ...row('サイズ', 'Größe', sizeText(size), 'detail-show__size'),
      ...row('商品番号', 'Art.-Nr.', size?.sku ?? '–', 'detail-show__sku'),
      ...row('価格', 'Preis (laut Online-Katalog)', [jaYen(size?.priceJpy), h('span', { class: 'detail-show__tax', lang: 'ja' }, ' 税込')], 'detail-show__price')
    );
    switcher?.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', i === index ? 'true' : 'false'));
  }

  const switcher =
    item.sizes.length > 1
      ? h(
          'div',
          { class: 'segmented detail-show__sizes', role: 'group', 'aria-label': 'Größe wählen' },
          item.sizes.map((s, i) =>
            h('button', { type: 'button', 'aria-pressed': 'false', onClick: () => { index = i; update(); } }, sizeText(s))
          )
        )
      : null;

  update();
  const body = h(
    'div',
    { class: 'detail-show' },
    h('p', { class: 'detail-show__ask', lang: 'ja' }, 'こちらの商品を見せてください。'),
    h('p', { class: 'muted small detail-show__ask-de' }, 'Bedeutung: „Bitte zeigen Sie mir dieses Produkt.“'),
    switcher,
    facts,
    h('p', { class: 'muted small' }, `Preis und Bestand stammen aus dem Online-Katalog (Stand ${dateDe(data.meta.fetchedAt)}) und können im Laden abweichen.`)
  );
  return openDialog({ title: 'Im Laden zeigen', body, sheet: false });
}

// ───────────────────────────── Größen-Tabelle ─────────────────────────────

function sizesSection(data, item, picks, origin) {
  const multi = item.sizes.length > 1;
  const sizeLabel = hasMm(item) ? 'Größe' : 'Variante';
  // Mobil steht der volle Satz in der Karte; ab Tabellenbreite genügt die Kurzform (die Spaltenüberschrift sagt „laut Katalog“)
  const stock = (size) =>
    h(
      'span',
      { class: ['chip', size.available ? 'chip--ok' : 'chip--warn'] },
      icon(size.available ? 'check' : 'alert', { size: 14 }),
      h('span', { class: 'detail__stock-long' }, size.available ? 'Laut Katalog vorrätig' : 'Laut Katalog nicht vorrätig'),
      h('span', { class: 'detail__stock-short', 'aria-hidden': 'true' }, size.available ? 'Vorrätig' : 'Nicht vorrätig')
    );

  const rows = item.sizes.map((size, i) =>
    h(
      'tr',
      { role: 'row', class: size.available ? '' : 'is-out' },
      h('th', { scope: 'row', role: 'rowheader', class: 'detail__size' }, size.label && size.mm == null ? size.label : sizeText(size)),
      h('td', { role: 'cell', class: 'detail__cell-price', dataset: { label: 'Preis' } }, priceCell(data, size.priceJpy)),
      h('td', { role: 'cell', class: 'detail__cell-stock', dataset: { label: 'Bestand' } }, stock(size)),
      h('td', { role: 'cell', class: 'detail__cell-sku', dataset: { label: 'Art.-Nr.' } }, size.sku ? h('code', size.sku) : h('span', { class: 'muted' }, '–', h('span', { class: 'visually-hidden' }, ' nicht angegeben'))),
      multi &&
        h(
          'td',
          { role: 'cell', class: 'detail__cell-act' },
          h(
            'div',
            { class: 'cluster' },
            picks.row(i),
            h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'aria-label': `Größe ${sizeText(size)} im Laden zeigen`, onClick: () => openShowDialog({ data, item, sizeIndex: i }) }, icon('store', { size: 16 }), 'Im Laden zeigen')
          )
        )
    )
  );

  const cur = ratesCurrency(data);
  const rateNote = cur
    ? ` Die Umrechnung ist nur eine Orientierung (${data.site?.rates?.source ?? 'Kurs'} vom ${dateDe(data.site?.rates?.asOf)}: 1 ${cur === 'EUR' ? '€' : cur} = ¥${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(data.rates[cur])}).`
    : '';
  const gritNote =
    item.category === 'sharpening' && item.sizes.every((s) => s.mm == null && /^\d+$/.test(String(s.label ?? '')))
      ? h('p', { class: 'muted small' }, 'Die Zahlen bei den Varianten sind vermutlich die Körnung (Grit); der Shop nennt das nicht ausdrücklich.')
      : null;

  return h(
    'section',
    { class: 'detail__section', 'aria-labelledby': 'detail-sizes' },
    h('h2', { id: 'detail-sizes' }, hasMm(item) ? 'Größen und Preise' : 'Varianten und Preise'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'table detail__sizes', role: 'table' },
        h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, ['Größe', 'Preis', 'Bestand laut Katalog', 'Art.-Nr.', multi ? 'Aktion' : null].filter(Boolean).map((text, i) => h('th', { scope: 'col', role: 'columnheader', class: i === 4 ? 'visually-hidden' : '' }, text === 'Größe' ? sizeLabel : text)))),
        h('tbody', { role: 'rowgroup' }, rows)
      )
    ),
    h('p', { class: 'muted small detail__price-note' }, `Preise in Yen laut Online-Katalog (in Japan üblicherweise inkl. Verbrauchsteuer).${rateNote} Die Art.-Nr. hilft im Laden beim Nachfragen.`),
    gritNote
  );
}

// ───────────────────────────── Merkmale ─────────────────────────────

function specSection(data, item) {
  const rows = [];
  const add = (label, value, note, link) => value != null && value !== '' && rows.push({ label, value, note, link });
  const taxEntry = (group, id) => entry(data, group, id);
  const type = item.type ? taxEntry('types', item.type) : null;

  if (item.category !== 'knife') {
    add('Art', data.t('categories', item.category));
  } else {
    // Typ
    const kiritsuke = item.tip === 'kiritsuke' && item.type !== 'kiritsuke' ? 'Mit Kiritsuke-Spitze (K-Tip): schräg abgeschnittene Spitze.' : null;
    add('Typ', h('span', withJa(`${type?.label ?? item.type ?? '–'}${type?.kanji ? ` ${type.kanji}` : ''}`)), [type?.gloss, kiritsuke].filter(Boolean).join(' · ') || null, { href: '#/wissen/typen', text: 'Messertypen in der Messerkunde' });
    // Rost-Stufe
    if (item.rust) {
      const r = taxEntry('rust', item.rust);
      add('Rost-Stufe', rustBadge(data, item, { long: true }), [r?.explain, r?.care && `Pflege: ${r.care}`].filter(Boolean).join(' '), { href: '#/wissen/stahl', text: 'Stahl und „rostfrei“' });
    } else add('Rost-Stufe', h('span', { class: 'muted' }, 'Nicht angegeben'));
    // Stahl
    if (item.steel) {
      const s = taxEntry('steels', item.steel.id);
      const bits = [];
      if (s?.summary) bits.push(s.summary);
      if (s?.hardnessHrc) bits.push(`Härte typisch ${hrcText(s.hardnessHrc)} HRC (Richtwert der Stahlsorte, nicht am einzelnen Messer gemessen).`);
      if (s?.beginnerReason) bits.push(s.beginnerReason);
      add('Stahl', s?.label ?? item.steel.id, bits.join(' ') || null, { href: '#/wissen/stahl', text: 'Stahl in der Messerkunde' });
    }
    // Aufbau
    if (item.construction) {
      const c = taxEntry('construction', item.construction);
      add('Aufbau', c?.label ?? item.construction, c?.explain, { href: '#/wissen/bauweise', text: 'Bauweisen erklärt' });
    }
    // Schliff + Händigkeit
    if (item.bevel) {
      const b = taxEntry('bevels', item.bevel);
      add('Schliff', b?.label ?? item.bevel, b?.explain, { href: '#/wissen/schliff', text: 'Einseitig oder beidseitig' });
    }
    if (item.handed) {
      const hd = taxEntry('handed', item.handed);
      let note = null;
      if (item.bevel === 'single' && item.handed === 'right') note = 'Einseitig geschliffene Messer sind händigkeitsgebunden: Dies ist die Standard-Ausführung für Rechtshänder.';
      else if (item.handed === 'left') note = 'Laut Shop die Linkshänder-Ausführung (Titel oder Schlagwort „左刃“).';
      add('Händigkeit', hd?.label ?? item.handed, note);
    }
    // Griff
    if (item.grip && item.grip.style !== 'unknown') {
      const gs = taxEntry('handleStyles', item.grip.style);
      const material = item.grip.material && item.grip.style !== 'steel' ? data.t('handleMaterials', item.grip.material) : null;
      const shape = item.grip.shape ? data.t('handleShapes', item.grip.shape) : null;
      add('Griff', [gs?.label ?? item.grip.style, material, shape].filter(Boolean).join(' · '), gs?.explain);
    } else add('Griff', h('span', { class: 'muted' }, 'Nicht angegeben'));
    // Oberfläche
    if (item.finish?.length) {
      const list = item.finish.map((f) => ({ label: data.t('finishes', f), explain: taxEntry('finishes', f)?.explain }));
      add('Oberfläche', h('span', list.map((f, i) => [i ? ', ' : '', f.label])), list.map((f) => f.explain).filter(Boolean).join(' '));
    } else add('Oberfläche', h('span', { class: 'muted' }, 'Keine besondere Oberflächenbearbeitung angegeben'));
    // Länge
    const range = sizeRangeText(item);
    if (range) add('Klingenlänge', range, item.sizes.length > 1 ? 'Spanne über alle angebotenen Größen.' : 'Klingenlänge laut Shop; die Angabe ist ein Richtwert.');
    add('Linie', data.t('segments', item.segment), item.segment === 'gastro' ? 'Profi-/Gastro-Linie (業務用): für den gewerblichen Einsatz gedacht.' : null);
  }

  // Hersteller / Herkunft (alle Artikel)
  const maker = item.maker ? data.t('makers', item.maker) : null;
  const origin = item.origin ? data.t('origins', item.origin) : null;
  add('Hersteller', h('span', withJa([maker, item.series && `Serie ${item.series}`].filter(Boolean).join(' · ') || 'Nicht angegeben')));
  add('Herkunft', origin ?? 'Nicht angegeben');

  return h(
    'section',
    { class: 'detail__section', 'aria-labelledby': 'detail-spec' },
    h('h2', { id: 'detail-spec' }, 'Eigenschaften'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'table detail__spec' },
        h('tbody', rows.map((r) =>
          h(
            'tr',
            h('th', { scope: 'row' }, r.label),
            h('td', h('div', { class: 'detail__value' }, typeof r.value === 'string' ? withJa(r.value) : r.value), r.note && h('p', { class: 'detail__note' }, withJa(r.note), r.link && [' ', h('a', { href: r.link.href }, r.link.text)]), !r.note && r.link && h('p', { class: 'detail__note' }, h('a', { href: r.link.href }, r.link.text)))
          )
        ))
      )
    ),
    h('p', { class: 'muted small' }, 'Die Merkmale sind aus Titel, Schlagwörtern und Spezifikationen des Online-Katalogs abgeleitet und können Fehler enthalten (', h('a', { href: '#/hinweise' }, 'Methode und Datenstand'), '). Die Erklärungen stammen aus der ', h('a', { href: '#/wissen' }, 'Messerkunde'), '.')
  );
}

// ───────────────────────────── Besonderheiten und Vergleich ─────────────────────────────

/** „Was dieses Messer besonders macht“: belegte Aussagen mit Folge für den Alltag; Quellen werden nachgeladen. */
function highlightsSection(data, item) {
  const list = highlights(item, data);
  if (!list.length) return null;
  const slots = [];
  const entries = list.map((hl) => {
    const slot = h('span', { class: 'detail__src muted' });
    slots.push([slot, hl.sources]);
    return h('li', h('strong', withJa(hl.lead)), ' ', withJa(hl.text), slot);
  });
  fillSources(slots); // ohne Quellenliste bleibt jede Aussage lesbar; ihre Herkunft steht dann im Satz
  return h(
    'section',
    { class: 'detail__section', 'aria-labelledby': 'detail-special' },
    h('h2', { id: 'detail-special' }, 'Was dieses Messer besonders macht'),
    h('p', { class: 'muted small' }, 'Jede Aussage nennt ihre Quelle. Sie gilt für Messer mit diesem Merkmal, nicht als Messung am einzelnen Exemplar.'),
    h('ul', { class: 'detail__highlights' }, entries)
  );
}

/** „Im Vergleich“: Härteklasse (Knives and Stones), Einordnung unter den Messern desselben Typs, Schärfaufwand, Preis. */
function compareSection(data, item) {
  const cmp = compareInClass(item, data);
  if (!cmp) return null;
  const hard = knifeHardness(item, data);
  const sharp = sharpeningStatement(item, data);
  const rows = [];

  if (hard) {
    rows.push(
      h(
        'div',
        { class: 'detail__compare-row' },
        h('h3', { class: 'detail__h3' }, 'Härte'),
        hardnessMeter({ range: hard.range, taxonomy: data.taxonomy }),
        h('p', `${hrcText(hard.range)} HRC, Klasse „${hard.cls.label}“. Das ist der typische Wert der Stahlsorte ${hard.steel.short ?? hard.steel.label}, nicht am einzelnen Messer gemessen.`),
        hardnessSentence(cmp) && h('p', hardnessSentence(cmp))
      ),
      h(
        'div',
        { class: 'detail__compare-row' },
        h('h3', { class: 'detail__h3' }, 'Schnitthaltigkeit und Schärfen'),
        h('p', h('strong', 'Schnitthaltigkeit: '), `${hard.cls.retention} (Skala von Knives and Stones)`),
        h('p', h('strong', 'Schärfen: '), sharp ? sharp.text : 'Für diese Stahlsorte liegt uns keine belegte Aussage vor.')
      )
    );
  } else {
    const note = hardnessNote(item, data);
    rows.push(
      h('div', { class: 'detail__compare-row' }, h('h3', { class: 'detail__h3' }, 'Härte'), h('p', note ? note.text : 'Die Stahlsorte ist nicht genannt; die Härte lässt sich nicht einordnen. Deshalb gibt es hier keinen Härte-Vergleich.'))
    );
  }

  if (priceSentence(cmp)) rows.push(h('div', { class: 'detail__compare-row' }, h('h3', { class: 'detail__h3' }, 'Preis'), h('p', priceSentence(cmp))));

  return h(
    'section',
    { class: 'detail__section', 'aria-labelledby': 'detail-compare' },
    h('h2', { id: 'detail-compare' }, `Im Vergleich: ${cmp.typeLabel}`),
    h('div', { class: 'detail__compare' }, rows),
    h(
      'p',
      { class: 'muted small' },
      `Verglichen wird mit den übrigen ${cmp.n - 1} ${cmp.typeLabel} im Katalog (Stand ${dateDe(data.meta?.fetchedAt)}). Wie scharf das Messer ab Werk ist, lässt sich nicht sagen: Geometrie und Schliff nennt der Katalog nicht. `,
      h('a', { href: '#/wissen/schaerfe' }, 'So entsteht die Einordnung')
    )
  );
}

// ───────────────────────────── „Bitte beachten“ ─────────────────────────────

/** [{ lead, text }] – aus den Daten abgeleitet, jeweils mit konkreter Folge für den Alltag. */
function cautions(data, item) {
  const out = [];
  const add = (lead, text) => out.push({ lead, text });
  const flags = item.flags ?? [];
  const notes = item.notes ?? [];
  const steel = item.steel ? entry(data, 'steels', item.steel.id) : null;

  if (item.rust === 'none' || item.rust === 'clad') {
    const r = entry(data, 'rust', item.rust);
    add(item.rust === 'none' ? 'Nicht rostfrei.' : 'Teilweise rostfrei.', [r?.care, item.rust === 'none' ? 'Kohlenstoffstahl bildet Patina und kann bei Nässe rosten.' : 'Die Schneide besteht aus Kohlenstoffstahl und kann Patina ansetzen oder rosten.'].filter(Boolean).join(' '));
  }
  if (notes.includes('rusts-easily-per-shop') && item.rust === 'full') add('Rostet laut Shop leicht.', 'Der Shop weist ausdrücklich darauf hin; trotzdem nach dem Gebrauch abtrocknen.');
  else if (notes.includes('rusts-easily-per-shop')) add('Rostet laut Shop leicht.', 'Der Shop weist ausdrücklich darauf hin: Nach jedem Gebrauch abwischen und trocknen.');

  if (item.bevel === 'single') {
    const text =
      item.handed === 'left'
        ? 'Dies ist die Linkshänder-Ausführung; für Rechtshänder ist sie nicht gedacht. Händler sehen bei einseitig geschliffenen Messern mehr Übungsbedarf bei Benutzung und Nachschliff als bei beidseitigem Schliff (Erfahrungsurteil, nicht gemessen).'
        : 'Die Klinge ist händigkeitsgebunden; Händler sehen bei Benutzung und Nachschliff mehr Übungsbedarf als bei beidseitigem Schliff (Erfahrungsurteil, nicht gemessen). Dies ist die Rechtshänder-Ausführung; Linkshänder brauchen eine Linkshänder-Ausführung (nicht jeder Typ wird so angeboten).';
    add('Einseitig geschliffen.', text);
  } else if (item.handed === 'left') {
    add('Für Linkshänder gekennzeichnet.', 'Der Shop führt dieses Messer als Linkshänder-Ausführung; für Rechtshänder ist der Artikel ohne Linkshänder-Kennzeichnung gedacht.');
  }
  if (flags.includes('left-signal-mismatch')) add('Händigkeit nicht eindeutig.', 'Titel und Schlagwörter des Shops widersprechen sich bei der Linkshänder-Ausführung. Im Laden nachfragen.');

  const hrcMax = steel?.hardnessHrc ? Math.max(...steel.hardnessHrc) : 0;
  const veryHard = data.taxonomy.hardnessScale?.classes?.find((c) => c.id === 'veryhard');
  if (veryHard && hrcMax >= veryHard.min) add(`Härte bis ca. ${hrcMax} HRC.`, `Ab ${veryHard.min} HRC gilt ein Stahl nach Knives and Stones als spröder: Bei rauem Gebrauch sind Ausbrüche eher möglich. Deshalb nicht hebeln oder verdrehen. (HRC ist ein Richtwert der Stahlsorte.)`);

  if (item.steel && UNSPECIFIED_STEELS.has(item.steel.id)) add('Stahlsorte nicht angegeben.', 'Der Shop nennt keine genaue Sorte; Härte und Schärfbarkeit lassen sich nicht einschätzen.');
  if (flags.some((f) => f.startsWith('steel-family-conflict'))) add('Stahlangaben widersprüchlich.', 'Titel, Schlagwörter und Spezifikation des Shops passen nicht zusammen; hier gilt die Mehrheit der Angaben. Im Laden bestätigen lassen.');

  if (item.segment === 'gastro') add('Profi-/Gastro-Linie (業務用).', 'Der Shop führt dieses Messer unter den Artikeln für den gewerblichen Einsatz. Preise und Ausstattung können sich von den Haushaltsmessern unterscheiden.');
  if (notes.includes('one-off')) add('Einzelstück laut Shop.', 'Der Shop bezeichnet das Messer als „one-off item“: Es gibt nur dieses eine Exemplar.');
  if (notes.includes('no-box')) add('Ohne Box.', 'Laut Shop wird das Messer nicht in einer Geschenkbox geliefert.');
  if (!item.available) add('Laut Online-Katalog nicht vorrätig.', 'Im Laden nachfragen; der Bestand dort kann vom Online-Katalog abweichen.');
  return out;
}

function cautionsBox(data, item) {
  const list = cautions(data, item);
  if (!list.length) return null;
  return h(
    'aside',
    { class: 'notice notice--warn detail__cautions', 'aria-labelledby': 'detail-cautions' },
    h('span', { class: 'notice__icon' }, icon('alert', { size: 20 })),
    h(
      'div',
      h('h2', { id: 'detail-cautions', class: 'detail__notice-title' }, 'Bitte beachten'),
      h('ul', { class: 'detail__cautions-list' }, list.map((c) => h('li', h('strong', withJa(c.lead)), ' ', withJa(c.text))))
    )
  );
}

// ───────────────────────────── Typ-Karte ─────────────────────────────

function typeCard(data, item) {
  const type = item.type ? entry(data, 'types', item.type) : null;
  if (!type || !(type.summary || type.uses?.length || type.avoid || type.fun)) return null;
  const meta = [];
  if (type.level) meta.push(`Einstufung ${type.level} von 3`);
  if (type.typicalMm) meta.push(`typisch ${cmText(type.typicalMm[0])}–${cmText(type.typicalMm[1])} cm`);
  else if (type.lengthMm) meta.push(`üblich ${cmText(type.lengthMm[0])}–${cmText(type.lengthMm[1])} cm`);

  return h(
    'section',
    { class: 'card detail__typecard', 'aria-labelledby': 'detail-type' },
    h(
      'div',
      { class: 'card__body' },
      h('div', { class: 'detail__typecard-head' }, h('div', h('p', { class: 'eyebrow' }, 'Über den Typ'), h('h2', { id: 'detail-type', class: 'detail__typecard-title' }, withJa(`${type.label}${type.kanji ? ` ${type.kanji}` : ''}`)), type.gloss && h('p', { class: 'muted detail__gloss' }, type.gloss)), h('div', { class: 'detail__sil' }, silhouette(item.type, { width: 150 }))),
      type.summary && h('p', withJa(type.summary)),
      meta.length > 0 && h('p', { class: 'cluster detail__meta' }, meta.map((m) => h('span', { class: 'chip chip--outline' }, m))),
      type.levelReason && h('p', { class: 'detail__note' }, withJa(type.levelReason), ' ', h('a', { href: '#/wissen/typen' }, 'Einstufung erklärt')),
      type.uses?.length > 0 && h('div', h('h3', { class: 'detail__h3' }, 'Wofür'), h('ul', type.uses.map((u) => h('li', withJa(u))))),
      type.avoid && h('div', h('h3', { class: 'detail__h3' }, 'Weniger geeignet'), h('p', withJa(type.avoid))),
      type.fun && h('div', h('h3', { class: 'detail__h3' }, 'Spaßfaktor'), h('p', withJa(type.fun)))
    )
  );
}

function learnLinks(item) {
  if (item.category === 'tool') return null;
  const links =
    item.category === 'sharpening'
      ? [['#/wissen/pflege', 'Pflege und Schärfen']]
      : [
          ['#/wissen/typen', 'Alle Messertypen in der Messerkunde'],
          ['#/wissen/stahl', 'Stahl und „rostfrei“ erklärt'],
        ];
  if (item.bevel === 'single') links.push(['#/wissen/schliff', 'Einseitig geschliffen: was das heißt']);
  if (item.category === 'knife' && (item.rust === 'none' || item.rust === 'clad')) links.push(['#/wissen/pflege', 'Pflege und Schärfen']);
  return h('nav', { class: 'detail__learn', 'aria-label': 'Weiterlesen in der Messerkunde' }, h('p', { class: 'eyebrow' }, 'Weiterlesen'), h('ul', links.map(([href, text]) => h('li', h('a', { href }, icon('book', { size: 16 }), text)))));
}

// ───────────────────────────── Ähnliche Messer ─────────────────────────────

function similarSection(data, item, origin) {
  const list = similarItems(item, data, 4);
  if (!list.length) return null;
  const grid = h('div', { class: 'grid detail__similar-grid' }, list.map((s) => productCard(s, { data })));
  const peers = list.filter((s) => s.category === 'knife').slice(0, 3);
  const compareHref = item.category === 'knife' && peers.length ? `#/vergleich?m=${[item.handle, ...peers.map((s) => s.handle)].map(encodeURIComponent).join(',')}` : null;
  grid.addEventListener('click', (event) => {
    if (!origin || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!event.target.closest?.('a[href^="#/messer/"]')) return;
    try {
      sessionStorage.setItem(ORIGIN_KEY, JSON.stringify({ hash: origin.hash, steps: origin.steps + 1 }));
    } catch {
      /* ohne sessionStorage verweist der Zurück-Link auf #/katalog */
    }
  });
  return h(
    'section',
    { class: 'detail__similar', 'aria-labelledby': 'detail-similar' },
    h('h2', { id: 'detail-similar' }, item.category === 'knife' ? 'Ähnliche Messer' : 'Ähnliche Artikel'),
    h('p', { class: 'muted' }, item.type ? 'Gleicher Typ, ähnlicher Preis; vorrätige Artikel laut Katalog zuerst.' : 'Gleiche Art, ähnlicher Preis.'),
    compareHref ? h('p', h('a', { class: 'btn', href: compareHref }, icon('check', { size: 18 }), 'Dieses Messer mit den ähnlichen vergleichen'), h('span', { class: 'muted small' }, ' Sterne und Eckdaten nebeneinander')) : null,
    grid
  );
}

// ───────────────────────────── Unbekannter Handle ─────────────────────────────

function notFound({ data, router, params }) {
  const handle = params.handle ?? '';
  const words = handle.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const need = Math.min(2, words.length);
  const guesses = words.length
    ? data.items
        .map((it) => ({ it, n: words.filter((w) => it.handle.includes(w)).length }))
        .filter((x) => x.n >= Math.max(1, need))
        .sort((a, b) => b.n - a.n || a.it.handle.length - b.it.handle.length)
        .slice(0, 4)
        .map((x) => x.it)
    : [];
  const q = words.slice(0, 3).join(' ');
  return h(
    'section',
    { class: 'container section detail' },
    backLink(null),
    h(
      'div',
      { class: 'empty detail__missing' },
      h('div', { class: 'empty__mark', lang: 'ja', 'aria-hidden': 'true' }, '刃'),
      h('h1', 'Dieses Messer gibt es im Katalog nicht'),
      h('p', 'Zu diesem Link finde ich keinen Artikel. Entweder ist er aus dem Online-Katalog verschwunden, oder der Link ist unvollständig kopiert.'),
      h('div', { class: 'cluster detail__missing-actions' }, h('a', { class: 'btn btn--primary', href: router.href('/katalog') }, icon('search', { size: 18 }), 'Zum Katalog'), q && h('a', { class: 'btn', href: router.href('/katalog', { q }) }, `Katalog nach „${q}“ durchsuchen`), h('a', { class: 'btn btn--ghost', href: router.href('/finder') }, icon('compass', { size: 18 }), 'Messer-Finder starten'))
    ),
    guesses.length > 0 && h('section', { class: 'detail__similar', 'aria-labelledby': 'detail-guess' }, h('h2', { id: 'detail-guess' }, 'Meintest du eines davon?'), h('div', { class: 'grid detail__similar-grid' }, guesses.map((g) => productCard(g, { data }))))
  );
}

// ───────────────────────────── Render ─────────────────────────────

export async function render(ctx) {
  const startHash = location.hash;
  await loadCss(assetUrl('assets/css/views/detail.css'));
  if (location.hash !== startHash) return h('div'); // inzwischen woanders hin navigiert: der Router verwirft dieses Ergebnis
  const { data, params } = ctx;
  const item = data.byHandle.get(params.handle);
  if (!item) {
    title = 'Artikel nicht gefunden';
    return notFound(ctx);
  }

  const head = itemHeadline(data, item);
  title = `${head.title} – ${item.title}`;
  const origin = readOrigin();
  const picks = createPickButtons(data, item);
  const type = item.type ? entry(data, 'types', item.type) : null;
  const group = type?.group ? data.t('typeGroups', type.group) : null;
  const eyebrow = [item.category === 'knife' ? group : data.t('categories', item.category), type?.kanji, type?.gloss].filter(Boolean).join(' · ');
  const best = preferredSize(item);
  const out = !item.available;

  const summary = h(
    'div',
    { class: 'detail__summary' },
    eyebrow && h('p', { class: 'eyebrow' }, withJa(eyebrow)),
    h('h1', { class: 'detail__title' }, head.title, head.steel && h('span', { class: 'detail__steel' }, ` · ${head.steel}`)),
    h('p', { class: 'detail__orig', lang: 'en' }, item.title),
    h('p', { class: 'muted small detail__orig-hint' }, 'Originaltitel aus dem Shop – danach kannst du im Laden fragen.'),
    h('div', { class: 'cluster detail__chips' }, item.rust && rustBadge(data, item, { long: true }), attrChips(data, item, { max: 8 })),
    h('div', { class: 'detail__buy' }, priceBlock(item, data), h('p', { class: ['detail__avail', out ? 'is-out' : ''] }, icon(out ? 'alert' : 'check', { size: 16 }), availabilityText(item))),
    h(
      'div',
      { class: 'detail__actions' },
      picks.main(best),
      h('button', { class: 'btn', type: 'button', onClick: () => openShowDialog({ data, item, sizeIndex: best }) }, icon('store', { size: 18 }), 'Im Laden zeigen'),
      h('a', { class: 'btn btn--ghost', href: data.shopUrl(item), target: '_blank', rel: 'noopener noreferrer' }, 'Beim Shop ansehen', icon('external', { size: 16 }), h('span', { class: 'visually-hidden' }, ' (öffnet in neuem Tab)'))
    ),
    shopNotice(data, { compact: true })
  );

  return h(
    'article',
    { class: 'container section detail' },
    backLink(origin),
    h('div', { class: 'detail__top' }, gallery(item), summary),
    cautionsBox(data, item),
    sizesSection(data, item, picks, origin),
    h('div', { class: 'detail__cols' }, h('div', { class: 'detail__main' }, kpiSection(data, item), highlightsSection(data, item), compareSection(data, item), specSection(data, item)), h('div', { class: 'detail__side' }, typeCard(data, item), learnLinks(item))),
    similarSection(data, item, origin)
  );
}
