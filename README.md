# Japanmesser-Finder

Auswahlhilfe für japanische Küchenmesser aus dem Katalog des Tokioter Ladens **Tsubaya** (Kappabashi):
geführter **Finder**, filterbarer **Katalog**, kurze sachliche **Messerkunde** mit Quellen und eine
**„Für wen?“-Liste**, mit der sich mehrere Personen in einem Rutsch einkaufen lassen.

Jedes Messer zeigt belegte Besonderheiten, seine Härteklasse und den Vergleich mit den übrigen Messern desselben Typs im Katalog.
Aussagen nennen ihren Grund und ihre Quelle; was keine Quelle hergibt (z. B. die Schärfe ab Werk), steht nicht da und wird nicht geschätzt.
Sechs Sterne-Skalen (Schnitthaltigkeit, Schärfbarkeit, Ausbruch-Festigkeit, Rostschutz, Eingewöhnung, Preis im Typ) sind als **Schätzung** gekennzeichnet und lassen sich für bis zu vier Messer nebeneinander vergleichen (`#/vergleich`). Die Startseite zeigt eine „Sichere Wahl“: neun Messer für vegetarische Küche in der Schweiz (Preise in CHF) in drei Typen (Ausgewogen, Robust, Länger scharf) und drei Preisstufen. Eine Typ-Tabelle und der Block „Unterschied zu …“ auf jeder Karte zeigen, was sich gegenüber dem günstigeren Messer tatsächlich ändert (Sterne, Stahl, Griff, Ausstattung, Preis); Annahmen und Regeln sind offengelegt.

Statische Seite ohne Build-Schritt (HTML, CSS, ES-Module) – direkt über GitHub Pages auslieferbar.
Inoffiziell und nicht mit dem Shop verbunden. Keine Cookies, keine Tracker, keine externen Schriften.

## Lokal ansehen

```bash
python3 -m http.server 8077      # oder: npm run serve
# → http://127.0.0.1:8077/
```

(`file://` funktioniert nicht, weil Browser dabei das Laden der Daten blockieren.)

## Auf GitHub Pages veröffentlichen

1. Auf github.com ein neues, **leeres** Repository anlegen (Pages braucht bei kostenlosen Konten ein öffentliches Repo).
2. Im Projektordner:

   ```bash
   git init -b main
   git add .
   git commit -m "Japanmesser-Finder"
   git remote add origin https://github.com/<benutzer>/<repo>.git
   git push -u origin main
   ```
   (Fragt Git nach Name und E-Mail: `git config --global user.name "…"` und `git config --global user.email "…"`.)
3. Im Repository: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** → Save.
4. Nach ca. einer Minute ist die Seite unter `https://<benutzer>.github.io/<repo>/` erreichbar.

Alle Pfade sind relativ; die Seite läuft daher auch in einem Unterordner (`/<repo>/`).

## Aufbau

Siehe [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): Routen, Datenmodell, Module, CSS-Konventionen.

```
index.html · assets/{css,js} · data/ (knives.json, taxonomy.json, site.json) · content/wissen.json
scripts/ (Daten-Pipeline) · tests/ (node --test)
```

## Katalogdaten aktualisieren

Die Daten stammen aus dem öffentlichen Shopify-Katalog des Shops (`/collections/all/products.json`) und
den Produktseiten. Die Skripte arbeiten höflich (feste Pausen, `Retry-After` wird beachtet, generischer User-Agent).

```bash
node scripts/fetch-catalog.mjs data/raw                                   # Produktliste (ca. 4 Anfragen)
node scripts/fetch-product-specs.mjs data/raw/products.json data/raw/specs.jsonl   # Zusatzangaben je Produktseite (langsam, fortsetzbar)
node scripts/build-data.mjs data/raw/products.json --specs=data/raw/specs.jsonl    # erzeugt data/knives.json
npm test                                                                   # Datenintegrität + Logik
```

Korrekturen einzelner Artikel gehören in `data/overrides.json` (Schlüssel = Produkt-Handle), nicht in `knives.json`.

## Hinweise

* Preise (Yen; in Japan üblicherweise inkl. Verbrauchsteuer) und Verfügbarkeit stammen aus dem Online-Katalog und können vom Laden abweichen.
  Der Onlineverkauf des Shops ist laut Shop derzeit pausiert (Wiederaufnahme für Januar 2027 geplant).
* Produktbilder werden **nicht** kopiert, sondern vom Bild-Server des Shops geladen (abschaltbar unter „Hinweise“).
* Euro-/CHF-Beträge sind Orientierungswerte (EZB-Referenzkurs, Stand siehe `data/site.json`).
* Die Angaben zum Mitbringen (Steuer, Zoll, Waffenrecht) sind keine Rechtsberatung; Quellen und Stand stehen in der Messerkunde.
