#!/usr/bin/env node
/**
 * Lädt den öffentlichen Produktkatalog einer Shopify-Collection (products.json)
 * seitenweise und höflich: feste Pausen zwischen den Anfragen, Retry-After
 * (HTTP 429/503) wird respektiert, generischer User-Agent.
 *
 * Aufruf:
 *   node scripts/fetch-catalog.mjs <ausgabeordner> [--base=https://tsubaya.jp/en] [--collection=all] [--delay=4000]
 *
 * Ergebnis im Ausgabeordner:
 *   page-001.json, page-002.json, …   (Rohdaten je Seite)
 *   products.json                      ({ source, fetchedAt, count, products: [...] })
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--'));
if (!outDir) {
  console.error('Aufruf: node scripts/fetch-catalog.mjs <ausgabeordner> [--base=URL] [--collection=all] [--delay=ms]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const BASE = opt('base', 'https://tsubaya.jp/en').replace(/\/$/, '');
const COLLECTION = opt('collection', 'all');
const DELAY_MS = Number(opt('delay', '4000'));
const PAGE_SIZE = 250; // Shopify-Maximum
const MAX_PAGES = 60; // Sicherheitsnetz
const USER_AGENT = 'knife-catalog-snapshot/1.0 (private, non-commercial; honors robots.txt and Retry-After)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
    } catch (err) {
      const waitMs = Math.min(120000, 5000 * 2 ** (attempt - 1));
      console.log(`  Netzwerkfehler (${err.cause?.code ?? err.message}), Versuch ${attempt} – warte ${Math.round(waitMs / 1000)} s`);
      await sleep(waitMs);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers.get('retry-after')) || 60;
      const waitMs = (Math.max(retryAfter, 60) + 5) * 1000;
      console.log(`  HTTP ${res.status} (Versuch ${attempt}) – warte ${Math.round(waitMs / 1000)} s`);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
    return res.json();
  }
  throw new Error(`Zu viele Wiederholungen für ${url}`);
}

await mkdir(outDir, { recursive: true });
const all = [];
for (let page = 1; page <= MAX_PAGES; page += 1) {
  const url = `${BASE}/collections/${COLLECTION}/products.json?limit=${PAGE_SIZE}&page=${page}`;
  console.log(`Seite ${page}: ${url}`);
  const data = await getJson(url);
  const products = Array.isArray(data.products) ? data.products : [];
  console.log(`  ${products.length} Produkte`);
  if (products.length === 0) break;
  await writeFile(path.join(outDir, `page-${String(page).padStart(3, '0')}.json`), JSON.stringify(data));
  all.push(...products);
  if (products.length < PAGE_SIZE) break;
  await sleep(DELAY_MS);
}

const merged = {
  source: `${BASE}/collections/${COLLECTION}/products.json`,
  fetchedAt: new Date().toISOString(),
  count: all.length,
  products: all,
};
await writeFile(path.join(outDir, 'products.json'), JSON.stringify(merged));
console.log(`Fertig: ${all.length} Produkte → ${path.join(outDir, 'products.json')}`);
