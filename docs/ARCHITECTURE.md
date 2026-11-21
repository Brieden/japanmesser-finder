# Architektur – Japanmesser-Finder

Statische Webseite für GitHub Pages: **kein Build-Schritt, keine Frameworks, keine externen Skripte/Schriften**.
HTML + CSS + ES-Module (Vanilla JS), Hash-Routing (`#/katalog?…`). Deutsch, Anrede „du“, sachlicher Ton ohne Hype.

Vorschau lokal: `python3 -m http.server 8077` im Projektordner → http://127.0.0.1:8077/
(Direktes Öffnen per `file://` funktioniert nicht, weil Browser dabei `fetch`/Module blockieren.)

## Verzeichnisse

```
index.html                  Shell (Header, Navigation, <main id="app">, Footer)
assets/css/tokens.css       Design-Tokens (Farben, Typo, Abstände) inkl. Dark Mode
assets/css/base.css         Reset, Typografie, Layout-Primitive, Shell, Buttons, Formulare
assets/css/components.css   Chips, Karten, Notice, Dialog, Toast, Tabellen, Disclosure, …
assets/css/views/<name>.css Stile je Ansicht (per loadCss beim Rendern nachgeladen)
assets/js/main.js           Start: Daten laden, Router, Theme, Listen-Badge
assets/js/router.js         Hash-Router + View-Vertrag
assets/js/data.js           Laden von Katalog/Taxonomie/Site-Infos → ctx.data
assets/js/store.js          Key-Value-Store mit localStorage-Persistenz
assets/js/shortlist.js      „Für wen?“-Liste (Personen, Vormerkungen, Summen, Klartext-Export)
assets/js/format.js         Preise (JPY/EUR/CHF), Größen, Datum, Plural, Bild-URL
assets/js/dom.js            h() zum Elementebauen, rich() Mini-Markup, loadCss, assetUrl, withJa
assets/js/icons.js          Inline-SVG-Icons: icon('search')
assets/js/ui/               geteilte Bausteine: dialog.js, toast.js, shop-notice.js (+ weitere)
assets/js/lib/              reine Logik ohne DOM (Filter, Finder-Engine) – in Node testbar
assets/js/views/<name>.js   eine Datei je Route
data/knives.json            Katalog (erzeugt von scripts/build-data.mjs; NICHT von Hand editieren)
data/overrides.json         geprüfte Korrekturen je Produkt-Handle (fließen in knives.json ein)
data/taxonomy.json          Labels + Erklärtexte je Kategorie-Wert
data/site.json              Shop-Infos (Öffnungszeiten, Onlineverkauf pausiert), Wechselkurse
content/wissen.json         Inhalt der Messerkunde (Abschnitte, Glossar, Quellen)
scripts/                    Daten-Pipeline (Node, nur beim Aktualisieren nötig)
tests/                      node:test-Tests (npm test → node --test tests/)
```

## Routen und Verantwortung

| Route | Datei | Zweck |
|---|---|---|
| `#/` | views/home.js | Einstieg, drei Wege, Einkaufshinweis |
| `#/finder` | views/finder.js | geführter Assistent → Ergebnis (+ lib/finder-engine.js) |
| `#/katalog?…` | views/catalog.js | Filter + Suche (+ lib/filters.js), Zustand komplett in der URL |
| `#/messer/:handle` | views/detail.js | Detailseite eines Artikels |
| `#/wissen`, `#/wissen/:section` | views/wissen.js | Messerkunde (content/wissen.json) |
| `#/liste` | views/liste.js | Personen + Vormerkungen, Summen, Klartext/Drucken |
| `#/hinweise` | views/about.js | Datenstand, Methode, Datenschutz, Quellen, Haftungsausschluss |

## View-Vertrag

```js
export const title = 'Katalog';            // optional → <title> „Katalog · Japanmesser-Finder“
export async function render(ctx) {…}      // gibt einen DOM-Node zurück
export function destroy() {…}              // optional: Listener/Timer aufräumen
```
`ctx = { params, query, path, data, router, store }`

* `router.href(path, query)` → `'#/katalog?type=gyuto'` · `router.navigate(path, query, { replace })`
* `router.replaceQuery(query)` aktualisiert die URL **ohne Neu-Rendern** (für Filter); `router.query()` liefert die aktuelle Query.
* Listenwerte in der Query sind kommagetrennt (`type=gyuto,santoku`); Hilfen: `splitList`/`joinList` in util.js.
* CSS der Ansicht: `await loadCss(assetUrl('assets/css/views/<name>.css'))` am Anfang von `render`.

## Datenmodell `data/knives.json`

```jsonc
{ "meta": { "source", "fetchedAt", "count", "currency": "JPY", "shopSpecsCount" },
  "items": [ {
    "id": 8848969269546,                 // Shopify-ID
    "handle": "vg10-damascus-gyuto-walnut-kw",   // eindeutiger Schlüssel, Teil der Shop-URL
    "title": "VG10 Damascus Gyuto Walnut Octagonal Handle",   // Originaltitel (englisch) – so fragt man im Laden
    "category": "knife" | "sharpening" | "tool",
    "type": "gyuto" | …,                 // Schlüssel in taxonomy.types (null bei Nicht-Messern)
    "segment": "home" | "gastro" | "accessory",  // gastro = Profi-/Gastro-Linie (業務用)
    "maker": "Tsubaya", "origin": "JP" | "DE" | "CH", "series": "Tanegashima"?,
    "steel": { "id": "vg10", "family": "stainless" | "carbon" } | null,   // id → taxonomy.steels
    "rust": "full" | "clad" | "none" | null,
        // full = komplett rostfrei · clad = teilweise rostfrei (rostfreier Mantel, Kern/Schneide Kohlenstoffstahl)
        // none = nicht rostfrei (Kohlenstoffstahl)
    "construction": "solid" | "warikomi" | "kasumi" | "laminated",
    "bevel": "double" | "single",        // beidseitig / einseitig geschliffen
    "handed": "both" | "right" | "left", // single bevel: right = Standard, left = Linkshänder-Ausführung
    "grip": { "style": "wa"|"yo"|"steel"|"unknown", "material": "walnut"|…|null, "shape": "octagonal"|…|null },
    "finish": ["damascus","tsuchime","kurouchi","nashiji","fine-finish","mirror","kasumi","dimple"],
    "tip": "kiritsuke" | null,
    "sizes": [ { "label": "21cm", "mm": 210, "mmMax"?: 240, "approx"?: true, "priceJpy": 44000, "available": true, "sku": "TBY…" } ],
    "priceFrom": 44000, "priceTo": 44000,
    "available": true,                   // mindestens eine Größe laut Online-Katalog vorrätig
    "images": [ { "src": "https://cdn.shopify.com/…jpg?v=…", "w": 3424, "h": 3424 } ],   // bis zu 4
    "tags": ["…japanische Shop-Tags…"], "notes"?: ["one-off","no-box",…], "shopSpecs"?: {…roh…},
    "flags"?: ["…Datenqualitäts-Hinweise…"], "overridden"?: ["field",…], "productTypeJp": "牛刀(ステン)"
  } ] }
```
* Preise sind **Yen laut Online-Katalog** (in Japan üblicherweise inkl. Verbrauchsteuer; vom Shop nicht ausdrücklich angegeben). Umrechnung nur zur Orientierung (`format.priceParts`).
* Verfügbarkeit stammt aus dem Online-Katalog; der Shop verkauft derzeit online nicht (siehe `site.json`) – immer als „laut Katalog“ kennzeichnen.
* Bilder: nie selbst hosten; `format.imageUrl(src, breite)` fordert Zielbreiten vom Shopify-CDN an. Immer `loading="lazy"`, `decoding="async"`, `width`/`height` setzen, `alt` = Titel.

## Taxonomie `data/taxonomy.json`

Gruppen: `types`, `typeGroups`, `steels`, `steelFamilies`, `rust`, `construction`, `bevels`, `handed`, `handleStyles`, `handleMaterials`, `handleShapes`, `finishes`, `segments`, `categories`, `origins`, `makers`.
Jeder Eintrag hat mindestens `label`; viele zusätzlich `short`. Zugriff: `data.t('types','gyuto')` → „Gyuto“, `data.entry('types','gyuto')` → ganzes Objekt.
Die Inhaltsfelder (werden schrittweise ergänzt – Ansichten müssen **graceful degradieren**, wenn ein Feld fehlt):

* `types.<id>`: `kanji`, `gloss`, `group`, `summary`, `uses[]`, `avoid`, `fun`, `level` (1 leicht … 3 anspruchsvoll), `bevel`, `lengthMm:[min,max]`, `typicalMm:[a,b]`, `tasks[]` (siehe Finder), `leftHandNote`, `sources[]`
* `steels.<id>`: `summary`, `hardnessHrc`, `character`, `care` (`low|medium|high`), `beginnerFriendly`, `sources[]`
* `rust.<id>`: `explain` (ausführlich), `care`
* `construction.<id>`, `bevels.<id>`, `handleStyles.<id>`, `finishes.<id>`: `explain`

## Inhalt der Messerkunde `content/wissen.json`

```jsonc
{ "version": 1,
  "intro": { "title": "…", "lede": "…" },
  "sections": [ { "id": "grundlagen", "kicker": "…", "title": "…", "summary": "…",
      "blocks": [
        { "type": "p", "text": "Mini-Markup: **fett**, *kursiv*, [Link](https://…)" },
        { "type": "h3", "text": "…" },
        { "type": "list", "ordered": false, "items": ["…"] },
        { "type": "callout", "tone": "info|warn|ok", "title": "…", "text": "…" },
        { "type": "table", "caption": "…", "head": ["…"], "rows": [["…"]] },
        { "type": "figure", "id": "rust-tiers|construction|bevel|handles|…" },   // Diagramm, das die Ansicht selbst zeichnet
        { "type": "typeatlas" },      // interaktiver Messertyp-Atlas aus taxonomy.types
        { "type": "steeltable" }      // Stahl-Übersicht aus taxonomy.steels
      ],
      "sources": ["src-01"] } ],
  "glossary": [ { "term": "Hagane", "ja": "鋼", "text": "…" } ],
  "sources": { "src-01": { "title": "…", "url": "https://…", "publisher": "…" } } }
```

## Kern-APIs (Kurzreferenz)

* **dom.js**: `h(tag, props, ...children)` (props: `class`, `style` (Objekt, `--var` ok), `dataset`, `onClick`/`onInput`/…, `value`/`checked` als Properties, boolesche Attribute) · `rich(text)` Mini-Markup → Fragment (kein HTML!) · `withJa(text)` · `loadCss(href)` · `assetUrl(path)` · `mount(container, ...nodes)` · `$`/`$$`. **Niemals `innerHTML` mit Daten verwenden.**
* **icons.js**: `icon(name, { size, title })`. Vorhanden: compass, search, book, bookmark, bookmark-fill, filter, plus, minus, check, close, chevron-*, arrow-*, info, alert, external, drop, ruler, hand, trash, copy, print, sun, moon, contrast, blade, store, user, users, sliders, sparkle, share. Neue Icons in `PATHS` ergänzen (24×24, Strich).
* **format.js**: `jpy(n)`, `priceParts(jpy, {currency, rates})` → `{main, alt}`, `priceRangeText(from,to)`, `sizeText(size)`, `sizeRangeText(item)`, `cmText(mm)`, `dateDe(iso)`, `count(n,'Messer','Messer')`, `imageUrl(src,width)`.
* **store.js**: `store.get/set/update/subscribe`; Schlüssel-Präfix `jmf:v1:`. Genutzte Schlüssel: `theme`, `people`, `activePerson`, `prefs` (`{currency:'EUR'|'CHF'|'JPY', images:boolean}`), `finder` (letzte Antworten).
* **shortlist.js**: `shortlist.add/rename/remove/active/setActive/addPick/removePick/updatePick/picksFor/isPicked/count/subscribe`, `sizeKeyOf(size, index)`, `resolvePick(pick, byHandle)`, `totalJpy(person, byHandle)`, `listAsText(people, ctx)`.
* **ui/dialog.js**: `openDialog({ title, body, sheet })` · **ui/toast.js**: `toast(text)` · **ui/shop-notice.js**: `shopNotice(data, {compact})`.
* **data (ctx.data)**: `items`, `knives`, `accessories`, `byHandle` (Map), `taxonomy`, `meta`, `site`, `rates`, `t(group,id)`, `entry(group,id)`, `shopUrl(item)`.

## CSS-Konventionen

* Nur Token-Variablen (`var(--ink)`, `var(--space-4)` …), keine festen Farbwerte. Dark Mode kommt automatisch über die Tokens.
* Bausteine: `.container`, `.container--narrow`, `.section`, `.stack`, `.cluster`, `.grid`, `.card`, `.card__body`, `.photo`, `.chip`, `.chip--ok|warn|bad|info|outline`, `.chip-select`, `.btn` (+ `--primary|--accent|--ghost|--sm|--block`), `.notice` (+ `--info|warn|bad|ok`), `details.disclosure`, `dialog.dialog`, `.segmented`, `.table-wrap > table.table`, `.price`, `.rust.rust--full|clad|none`, `.progress`, `.empty`, `.eyebrow`, `.lede`, `.muted`, `.hamon`.
* Mobile first; Breakpoint Desktop-Navigation ab `52rem`. Touch-Ziele ≥ 44 px. Kein horizontales Scrollen der Seite (nur in `.table-wrap`).
* Farbe nie als einziges Signal (Rost-Stufen: Punkt-Form + Text). Kontrast mindestens WCAG AA. `prefers-reduced-motion` ist global beachtet.

## Qualitätsregeln

* **Barrierefrei**: semantisches HTML, sichtbarer Fokus, Tastaturbedienung, `lang="ja"` für Kanji (automatisch via `rich`/`withJa`), Labels an allen Formularfeldern, Dialoge über `<dialog>`.
* **Datenschutz**: keine Cookies, keine Tracker, keine externen Schriften/Skripte. Einzige Fremdanfragen: Produktbilder vom Shopify-CDN (abschaltbar über `prefs.images`; dann Platzhalter statt `<img>`).
* **Ton**: sachlich, belegt, keine Superlative/Marketingwörter. Unsicheres ausdrücklich als solches kennzeichnen („laut Shop“, „Sorte nicht angegeben“).
* **Robustheit**: fehlende Felder (z. B. noch ohne Erklärtext) dürfen nichts brechen; leere Ergebnislisten bekommen einen hilfreichen Leerzustand.
* **Tests**: reine Logik (`assets/js/lib/*`, `format`, `shortlist`) mit `node:test` unter `tests/` abdecken.

## Stand der Umsetzung (21.11.2026)

Alle Routen sind umgesetzt und im Browser geprüft (Desktop/Mobil, hell/dunkel; axe-core ohne WCAG-2.1-A/AA-Verstöße).

| Baustein | Dateien |
|---|---|
| Katalog (Filter, Suche, URL-Zustand) | `lib/filters.js`, `views/catalog.js`, `css/views/catalog.css` |
| Detailseite, „Im Laden zeigen“ | `views/detail.js`, `css/views/detail.css` |
| Finder (Fragen, Bewertung, Begründung) | `lib/finder-engine.js`, `views/finder.js`, `css/views/finder.css` |
| Messerkunde (Atlas, Stahltabelle, Diagramme) | `views/wissen.js`, `ui/typeatlas.js`, `ui/steeltable.js`, `ui/figures.js` |
| Liste („Für wen?“, Text/Druck/Zeigen) | `views/liste.js`, `css/views/liste.css` |
| Hinweise, Datenschutz, Einstellungen | `views/about.js`, `css/views/about.css` |
| Silhouetten (maßstabsgetreue Seitenprofile) | `ui/silhouette.js` |

Tests: `npm test` (Kern, Datenintegrität, Filter, Finder). Der Finder-Test prüft u. a., dass Finder-Treffer im Katalog-Filter wiederzufinden sind.

Bewusste Grenzen: Preise/Bestand sind eine Momentaufnahme des Online-Katalogs; Merkmale werden aus Titeln, Tags und Produktseiten
abgeleitet (Stahlfamilie per Mehrheit aus Titel, Tags und Shop-Feld – einzelne Shop-Felder sind fehlerhaft, z. B. „SK Carbon Steel Cleaver“).
