// Integritätstests für den ausgelieferten Datensatz (data/knives.json) gegen die Taxonomie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const catalog = read('data/knives.json');
const tax = read('data/taxonomy.json');
const knives = catalog.items.filter((i) => i.category === 'knife');

const unknown = (values, group) => [...new Set(values.filter((v) => v != null && !(v in tax[group])))];

test('Datensatz: eindeutige Handles, Pflichtfelder', () => {
  const handles = catalog.items.map((i) => i.handle);
  assert.equal(new Set(handles).size, handles.length, 'Handles müssen eindeutig sein');
  for (const i of catalog.items) {
    assert.equal(typeof i.handle, 'string', `handle ist String bei ${i.title}`);
    assert.ok(i.title, 'Titel fehlt');
    assert.ok(['knife', 'sharpening', 'tool'].includes(i.category), `category ${i.category}`);
    assert.ok(Array.isArray(i.sizes) && i.sizes.length > 0, `sizes fehlt bei ${i.handle}`);
  }
});

test('Datensatz: jeder Handle ergibt eine gültige Shop-URL (ohne Sonderzeichen), site.json nennt die Basis-URLs', () => {
  const site = read('data/site.json');
  assert.equal(site.shop.url, 'https://tsubaya.jp/en');
  assert.equal(site.shop.urlJa, 'https://tsubaya.jp');
  for (const i of catalog.items) {
    assert.match(i.handle, /^[a-z0-9][a-z0-9-]*$/, `Handle mit Sonderzeichen: ${i.handle}`);
    assert.equal(new URL(`${site.shop.urlJa}/products/${i.handle}`).pathname, `/products/${i.handle}`);
  }
});

test('Datensatz: alle Aufzählungswerte existieren in der Taxonomie', () => {
  assert.deepEqual(unknown(knives.map((i) => i.type), 'types'), []);
  assert.deepEqual(unknown(knives.map((i) => i.steel?.id), 'steels'), []);
  assert.deepEqual(unknown(knives.map((i) => i.rust), 'rust'), []);
  assert.deepEqual(unknown(knives.map((i) => i.construction), 'construction'), []);
  assert.deepEqual(unknown(knives.map((i) => i.bevel), 'bevels'), []);
  assert.deepEqual(unknown(knives.map((i) => i.handed), 'handed'), []);
  assert.deepEqual(unknown(knives.map((i) => i.grip?.style), 'handleStyles'), []);
  assert.deepEqual(unknown(knives.map((i) => i.grip?.material), 'handleMaterials'), []);
  assert.deepEqual(unknown(knives.map((i) => i.grip?.shape), 'handleShapes'), []);
  assert.deepEqual(unknown(knives.flatMap((i) => i.finish), 'finishes'), []);
  assert.deepEqual(unknown(catalog.items.map((i) => i.segment), 'segments'), []);
  assert.deepEqual(unknown(catalog.items.map((i) => i.maker), 'makers'), []);
});

test('Datensatz: Stahlfamilie und Rost-Stufe sind konsistent', () => {
  for (const k of knives) {
    if (k.steel?.family === 'stainless') assert.equal(k.rust, 'full', `${k.handle}: rostfreier Stahl muss rust=full sein`);
    if (k.steel?.family === 'carbon') assert.ok(['clad', 'none'].includes(k.rust), `${k.handle}: Kohlenstoffstahl ist clad oder none`);
    if (k.rust === 'clad') assert.equal(k.steel.family, 'carbon', `${k.handle}: clad setzt Kohlenstoff-Kern voraus`);
    const taxFamily = tax.steels[k.steel.id]?.family;
    if (taxFamily) assert.equal(taxFamily, k.steel.family, `${k.handle}: Stahlfamilie passt nicht zur Taxonomie`);
  }
});

test('Datensatz: Händigkeit passt zum Schliff, Preise und Größen sind plausibel', () => {
  for (const k of knives) {
    if (k.bevel === 'double') assert.ok(['both', 'left'].includes(k.handed), `${k.handle}: beidseitig → both/left`);
    if (k.bevel === 'single') assert.ok(['right', 'left'].includes(k.handed), `${k.handle}: einseitig → right/left`);
    assert.ok(k.priceFrom == null || (k.priceFrom >= 500 && k.priceFrom <= 800000), `${k.handle}: Preis ${k.priceFrom}`);
    for (const s of k.sizes) if (s.mm != null) assert.ok(s.mm >= 40 && s.mm <= 600, `${k.handle}: Größe ${s.mm} mm`);
  }
});
