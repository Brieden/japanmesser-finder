// Lädt Katalog (data/knives.json), Taxonomie (data/taxonomy.json) und Seiten-Infos (data/site.json)
// und baut daraus das `data`-Objekt, das jede Ansicht über ctx.data bekommt.

import { assetUrl } from './dom.js';

async function getJson(path) {
  const url = typeof document === 'undefined' ? path : assetUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export async function loadData() {
  const [catalog, taxonomy, site] = await Promise.all([getJson('data/knives.json'), getJson('data/taxonomy.json'), getJson('data/site.json')]);
  return buildData(catalog, taxonomy, site);
}

/**
 * Reine Funktion (auch in Tests nutzbar).
 * @returns {{
 *   meta, site, taxonomy, rates, items, knives, accessories, byHandle,
 *   t(group, id, fallback?): string,
 *   entry(group, id): object|null,
 *   shopUrl(item): string        // Produktseite im englischen Shop (tsubaya.jp/en/products/<handle>)
 *   shopUrlJa(item): string      // dieselbe Seite auf Japanisch (tsubaya.jp/products/<handle>) – die Seite, die das Personal kennt
 * }}
 */
export function buildData(catalog, taxonomy, site) {
  const items = catalog.items;
  const byHandle = new Map(items.map((item) => [item.handle, item]));
  const entry = (group, id) => taxonomy[group]?.[id] ?? null;
  const t = (group, id, fallback) => entry(group, id)?.label ?? fallback ?? String(id ?? '');
  const base = (site?.shop?.url ?? 'https://tsubaya.jp/en').replace(/\/$/, '');
  const baseJa = (site?.shop?.urlJa ?? base.replace(/\/en$/, '')).replace(/\/$/, '');

  return {
    meta: catalog.meta,
    site,
    taxonomy,
    rates: site?.rates?.perUnit ?? {},
    items,
    knives: items.filter((i) => i.category === 'knife'),
    accessories: items.filter((i) => i.category !== 'knife'),
    byHandle,
    t,
    entry,
    shopUrl: (item) => `${base}/products/${item.handle}`,
    shopUrlJa: (item) => `${baseJa}/products/${item.handle}`,
  };
}
