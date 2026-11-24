import { test } from 'node:test';
import assert from 'node:assert/strict';

import { jpy, priceParts, priceRangeText, sizeText, sizeRangeText, cmText, dateDe, imageUrl, convert } from '../assets/js/format.js';
import { parseHash, buildHash, matchRoute } from '../assets/js/router.js';
import { store } from '../assets/js/store.js';
import { shortlist, sizeKeyOf, resolvePick, totalJpy, listAsText } from '../assets/js/shortlist.js';
import { buildData } from '../assets/js/data.js';
import { splitList, joinList } from '../assets/js/util.js';

test('format: Yen, Umrechnung, Größen', () => {
  assert.equal(jpy(22000), '¥22.000');
  assert.equal(jpy(null), '–');
  const rates = { EUR: 174.35, CHF: 189.04 };
  assert.equal(Math.round(convert(17435, 'EUR', rates)), 100);
  assert.equal(convert(1000, 'JPY', rates), null);
  assert.deepEqual(priceParts(17435, { currency: 'EUR', rates }), { main: '¥17.435', alt: '≈ 100 €' });
  assert.equal(priceParts(1000, { currency: 'JPY', rates }).alt, null);
  assert.equal(priceRangeText(22000, 44000), '¥22.000 – ¥44.000');
  assert.equal(priceRangeText(22000, 22000), '¥22.000');
  assert.equal(cmText(135), '13,5');
  assert.equal(sizeText({ mm: 210 }), '21 cm');
  assert.equal(sizeText({ mm: 220, mmMax: 240 }), '22–24 cm');
  assert.equal(sizeText({ mm: 150, approx: true }), '15 cm (ca.)');
  assert.equal(sizeText({ label: 'Black', mm: null }), 'Black');
  assert.equal(sizeRangeText({ sizes: [{ mm: 150 }, { mm: 270 }] }), '15–27 cm');
  assert.equal(dateDe('2026-11-21T09:32:19+09:00'), '21.11.2026');
  assert.equal(imageUrl('https://x/y.jpg?v=1', 400), 'https://x/y.jpg?v=1&width=400');
  assert.equal(imageUrl('https://x/y.jpg', 400), 'https://x/y.jpg?width=400');
});

test('router: Hash parsen/bauen und Routen matchen', () => {
  assert.deepEqual(parseHash('#/katalog?type=gyuto,santoku&rust=full'), { path: '/katalog', query: { type: 'gyuto,santoku', rust: 'full' } });
  assert.deepEqual(parseHash(''), { path: '/', query: {} });
  assert.deepEqual(parseHash('#/wissen/stahl/'), { path: '/wissen/stahl', query: {} });
  assert.equal(buildHash('/katalog', { type: ['gyuto', 'santoku'], q: '', rust: null, avail: 1 }), '#/katalog?type=gyuto%2Csantoku&avail=1');
  const routes = [{ pattern: '/' }, { pattern: '/katalog' }, { pattern: '/messer/:handle' }, { pattern: '/wissen/:section' }];
  assert.equal(matchRoute(routes, '/').route.pattern, '/');
  assert.equal(matchRoute(routes, '/katalog').route.pattern, '/katalog');
  assert.deepEqual(matchRoute(routes, '/messer/vg10-gyuto%2021').params, { handle: 'vg10-gyuto 21' });
  assert.equal(matchRoute(routes, '/gibt-es-nicht'), null);
  assert.deepEqual(splitList('a, b,,c'), ['a', 'b', 'c']);
  assert.equal(joinList(['a', 'b']), 'a,b');
});

const fixture = () => {
  const items = [
    { handle: 'a', title: 'A Gyuto', type: 'gyuto', category: 'knife', priceFrom: 20000, priceTo: 26000, sizes: [{ label: '21cm', mm: 210, priceJpy: 20000, available: true, sku: 'SKU-A21' }, { label: '24cm', mm: 240, priceJpy: 26000, available: false, sku: 'SKU-A24' }] },
    { handle: 'b', title: 'B Petty', type: 'petty', category: 'knife', priceFrom: 10000, priceTo: 10000, sizes: [{ label: '15cm', mm: 150, priceJpy: 10000, available: true, sku: null }] },
  ];
  const taxonomy = { types: { gyuto: { label: 'Gyuto' }, petty: { label: 'Petty' } } };
  return buildData({ meta: { fetchedAt: '2026-11-21T00:00:00Z' }, items }, taxonomy, { shop: { url: 'https://tsubaya.jp/en' }, rates: { perUnit: { EUR: 174.35 } } });
};

test('data: buildData liefert Index und Label-Helfer', () => {
  const data = fixture();
  assert.equal(data.byHandle.get('a').title, 'A Gyuto');
  assert.equal(data.t('types', 'gyuto'), 'Gyuto');
  assert.equal(data.t('types', 'unbekannt', 'Fallback'), 'Fallback');
  assert.equal(data.shopUrl(data.items[0]), 'https://tsubaya.jp/en/products/a');
  // japanische Seite: aus site.shop.urlJa, ohne Angabe aus der englischen URL abgeleitet
  assert.equal(data.shopUrlJa(data.items[0]), 'https://tsubaya.jp/products/a');
  const withJa = buildData({ meta: {}, items: data.items }, {}, { shop: { url: 'https://tsubaya.jp/en', urlJa: 'https://example.test/' } });
  assert.equal(withJa.shopUrlJa(data.items[0]), 'https://example.test/products/a');
  assert.equal(data.knives.length, 2);
});

test('shortlist: Personen, Vormerkungen ohne Doppelte, Summen, Klartext', () => {
  store._resetMemory();
  const data = fixture();
  const p = shortlist.add({ name: 'Anna' });
  assert.equal(shortlist.active().id, p.id);
  const sizeKey = sizeKeyOf(data.byHandle.get('a').sizes[0], 0);
  assert.equal(sizeKey, 'SKU-A21');
  const k1 = shortlist.addPick(p.id, { handle: 'a', sizeKey, sizeMm: 210 });
  const k2 = shortlist.addPick(p.id, { handle: 'a', sizeKey, sizeMm: 210 });
  assert.equal(k1.id, k2.id, 'gleiche Kombination wird nicht doppelt gespeichert');
  shortlist.addPick(p.id, { handle: 'b', sizeKey: sizeKeyOf(data.byHandle.get('b').sizes[0], 0) });
  assert.equal(shortlist.count(), 2);
  assert.equal(shortlist.isPicked('a'), true);
  assert.equal(shortlist.picksFor('b').length, 1);

  const person = shortlist.get(p.id);
  assert.equal(resolvePick(person.picks[0], data.byHandle).priceJpy, 20000);
  assert.deepEqual(totalJpy(person, data.byHandle), { sum: 30000, missing: 0 });
  // Vormerkung zu verschwundenem Artikel: kein Absturz, wird als "missing" gezählt
  shortlist.addPick(p.id, { handle: 'weg', sizeKey: 'x' });
  assert.deepEqual(totalJpy(shortlist.get(p.id), data.byHandle), { sum: 30000, missing: 1 });

  const text = listAsText(shortlist.all(), { byHandle: data.byHandle, t: data.t, rates: data.rates, currency: 'EUR' });
  assert.match(text, /Für Anna:/);
  assert.match(text, /Gyuto 21 cm – A Gyuto – ¥20\.000 – Art\.-Nr\. SKU-A21/);
  assert.match(text, /Gesamt: ¥30\.000 \(≈ 172 €\)/);

  shortlist.removePick(p.id, k1.id);
  assert.equal(shortlist.get(p.id).picks.some((x) => x.handle === 'a'), false);
  shortlist.remove(p.id);
  assert.equal(shortlist.all().length, 0);
  assert.equal(shortlist.active(), null);
});
