#!/usr/bin/env node
/**
 * Liest die strukturierten "Supplemental Information"-Angaben (Stil, Stahlart,
 * Klingenaufbau, Schliff) von den Produktseiten des Shops. Diese Felder stehen
 * NICHT in products.json.
 *
 * Höflich: feste Pause zwischen Anfragen (Standard 5 s), Retry-After wird
 * beachtet, fortsetzbar (bereits vorhandene Handles werden übersprungen),
 * generischer User-Agent. Reihenfolge: zuerst eine gleichmäßige Stichprobe
 * (jedes N-te Produkt), danach alle übrigen.
 *
 * Aufruf:
 *   node scripts/fetch-product-specs.mjs <products.json> <ausgabe.jsonl> [--base=https://tsubaya.jp/en] [--delay=5000] [--stride=12]
 */
import { readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const [productsFile, outFile] = positional;
if (!productsFile || !outFile) {
  console.error('Aufruf: node scripts/fetch-product-specs.mjs <products.json> <ausgabe.jsonl> [--base=URL] [--delay=ms] [--stride=N]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const BASE = opt('base', 'https://tsubaya.jp/en').replace(/\/$/, '');
const DELAY_MS = Number(opt('delay', '5000'));
const STRIDE = Number(opt('stride', '12'));
const USER_AGENT = 'knife-catalog-snapshot/1.0 (private, non-commercial; honors robots.txt and Retry-After)';

// Produkttypen, die sicher keine Messer sind (Schleifsteine, Wetzstähle, Kleinteile) – niedrige Priorität
const NON_KNIFE_TYPES = new Set(['砥石', 'Whetstone', '業務用砥石', '業務用スチール', '骨抜き', '爪切り', 'ピーラー', '鱗取り', 'その他', '業務用その他', '在庫処分品']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

const textLines = (html) =>
  decodeEntities(
    html
      .replace(/<(br|\/p|\/li|\/div)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/** Zieht alle Akkordeon-Blöcke (Titel → Textzeilen) aus der Produktseite. */
function parseAccordions(html) {
  const out = {};
  const re = /<h2[^>]*class="[^"]*accordion__title[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h2>[\s\S]*?<div class="accordion__content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/details>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = textLines(m[1]).join(' ');
    if (title) out[title] = textLines(m[2]);
  }
  return out;
}

/**
 * Der Block heißt je nach Übersetzungsstand "Supplemental Information" (EN) oder
 * "補足情報" (JA); Schlüssel/Werte stehen entsprechend englisch oder japanisch
 * (Trenner ":" oder "："). Die Rohzeilen bleiben zusätzlich in `accordions` erhalten.
 */
function parseSpecs(accordions) {
  const specs = {};
  const lines = accordions['Supplemental Information'] ?? accordions['補足情報'] ?? [];
  for (const line of lines) {
    const match = line.match(/^(.+?)\s*[:：]\s*(.+)$/);
    if (match) specs[match[1].trim()] = match[2].trim();
  }
  return specs;
}

async function fetchPage(url) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(45000) });
    } catch (err) {
      // Netzwerkfehler (Verbindungsabbruch, Timeout, Ruhezustand des Rechners) → Backoff und erneut versuchen
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
    return { status: res.status, html: res.ok ? await res.text() : '' };
  }
  return { status: 0, html: '' }; // endgültig nicht erreichbar → wird NICHT gespeichert, beim nächsten Lauf erneut versucht
}

const { products } = JSON.parse(await readFile(productsFile, 'utf8'));
const done = new Set();
if (existsSync(outFile)) {
  for (const line of (await readFile(outFile, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).handle);
    } catch {
      /* unvollständige letzte Zeile ignorieren */
    }
  }
}

const indexed = products.map((p, i) => ({ p, i }));
const sample = indexed.filter(({ p, i }) => i % STRIDE === 0 && !NON_KNIFE_TYPES.has(p.product_type));
const sampleHandles = new Set(sample.map(({ p }) => p.handle));
const rest = indexed.filter(({ p }) => !sampleHandles.has(p.handle) && !NON_KNIFE_TYPES.has(p.product_type));
const queue = [...sample, ...rest].map(({ p }) => p.handle).filter((h) => !done.has(h));
console.log(`${queue.length} Seiten in der Warteschlange (${done.size} bereits vorhanden), Pause ${DELAY_MS} ms`);

let n = 0;
for (const handle of queue) {
  n += 1;
  const url = `${BASE}/products/${handle}`;
  const { status, html } = await fetchPage(url);
  if (status === 0) {
    console.log(`  übersprungen (nicht erreichbar): ${handle}`);
    continue;
  }
  const accordions = status === 200 ? parseAccordions(html) : {};
  const record = { handle, status, specs: parseSpecs(accordions), accordions };
  await appendFile(outFile, `${JSON.stringify(record)}\n`);
  if (n % 10 === 0 || n <= 3) console.log(`[${n}/${queue.length}] ${status} ${handle} ${JSON.stringify(record.specs)}`);
  await sleep(DELAY_MS);
}
console.log('Fertig.');
