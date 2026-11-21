#!/usr/bin/env node
/**
 * Baut aus dem rohen Shopify-Katalog (products.json) den normalisierten
 * Datensatz für die Webseite (data/knives.json).
 *
 * Quellen je Produkt (in dieser Priorität):
 *   1. data/overrides.json   – manuelle/geprüfte Korrekturen je Handle
 *   2. specs.jsonl           – "Supplemental Information" der Produktseite (optional)
 *   3. Tags (japanisch), Produkttyp (japanisch), Titel (englisch), Varianten
 *
 * Aufruf:
 *   node scripts/build-data.mjs <products.json> [--specs=<specs.jsonl>] [--overrides=data/overrides.json]
 *                               [--out=data/knives.json] [--report]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ───────────────────────────── Wörterbücher ─────────────────────────────

/** Produkttyp-Stamm (japanisch, ohne Klammer-Suffix) → Messertyp-ID */
const TYPE_BY_STEM = {
  三徳: 'santoku',
  小三徳: 'santoku',
  牛刀: 'gyuto',
  業務用牛刀: 'gyuto',
  ペティ: 'petty',
  パーリング: 'paring',
  ピーリング: 'paring',
  菜切: 'nakiri',
  薄刃: 'usuba',
  筋引: 'sujihiki',
  業務用筋引: 'sujihiki',
  柳刃: 'yanagiba',
  蛸引: 'takohiki',
  フグ引: 'fuguhiki',
  出刃: 'deba',
  洋出刃: 'yo-deba',
  相出刃: 'ai-deba',
  身卸: 'mioroshi',
  骨スキ: 'honesuki',
  ボーニング: 'boning',
  業務用ボーニング: 'boning',
  パン切: 'bread',
  そば切: 'soba',
  鰻裂き: 'unagi',
  貝裂き: 'kaisaki',
  中華: 'cleaver',
  クリーバー: 'cleaver',
  面取り: 'mentori',
  むきもの: 'mukimono',
  カステラ: 'castella',
  冷凍包丁: 'frozen',
  ステーキナイフ: 'steak',
  業務用ブッチャーナイフ: 'butcher',
  業務用サーモン: 'salmon',
  鮭切: 'salmon',
  ハムスライサー: 'ham-slicer',
  カービングナイフ: 'carving',
  ソール: 'sole',
  鹿さばき: 'deer',
  Honekiri: 'honekiri',
  切付: 'kiritsuke',
  Paring: 'paring',
  'Small Santoku': 'santoku',
  Nakiri: 'nakiri',
};

/** Produkttypen, die keine Messer sind → Kategorie */
const CATEGORY_BY_STEM = {
  砥石: 'sharpening',
  Whetstone: 'sharpening',
  業務用砥石: 'sharpening',
  業務用スチール: 'sharpening',
  骨抜き: 'tool',
  爪切り: 'tool',
  ピーラー: 'tool',
  鱗取り: 'tool',
};

/** Fallback: Messertyp aus dem Titel (für 武田シリーズ, その他, 在庫処分品 …). Reihenfolge = Priorität. */
const TYPE_BY_TITLE = [
  [/chinese cleaver|cleaver/i, 'cleaver'],
  [/gyuto/i, 'gyuto'],
  [/santoku/i, 'santoku'],
  [/nakiri/i, 'nakiri'],
  [/usuba/i, 'usuba'],
  [/petty/i, 'petty'],
  [/sujihiki/i, 'sujihiki'],
  [/yanagiba/i, 'yanagiba'],
  [/takohiki/i, 'takohiki'],
  [/fuguhiki/i, 'fuguhiki'],
  [/mioroshi/i, 'mioroshi'],
  [/deba/i, 'deba'],
  [/honesuki|boning/i, 'honesuki'],
  [/bunka/i, 'bunka'],
  [/kiritsuke/i, 'kiritsuke'],
  [/sasanoha|kosasa/i, 'sasanoha'],
  [/funayuki/i, 'funayuki'],
  [/kogatana/i, 'kogatana'],
  [/bread/i, 'bread'],
  [/paring/i, 'paring'],
  [/ceramic knife/i, 'other-knife'],
];

/** Boning-Unterformen aus dem Titel */
const BONING_SUBTYPES = [
  [/honesuki/i, 'honesuki'],
  [/garasuki/i, 'garasuki'],
  [/kawahagi/i, 'kawahagi'],
  [/atamatori/i, 'atamatori'],
];

/** Titel-Stichworte für Tool-Produkte unter "その他" */
const TOOL_TITLE = /shears|scissors|puller|peeler|scaler|tweezers|sharpener|whetstone|strop|stone/i;
/** Schutz-/Transportzubehör (kein Messer) */
const ACCESSORY_TITLE = /\bcover\b|blade guard|knife roll|sheath|\bsaya\b|knife case/i;

/** Stahl: [Regex auf Titel+Tags, ID, Familie]. Reihenfolge = Priorität. */
const STEEL_PATTERNS = [
  [/white ?#?1\b|白一/i, 'shirogami1', 'carbon'],
  [/white ?#?2\b|白二/i, 'shirogami2', 'carbon'],
  [/white ?#?3\b|白三/i, 'shirogami3', 'carbon'],
  [/blue ?#?1\b|青一/i, 'aogami1', 'carbon'],
  [/blue ?#?2\b|青二/i, 'aogami2', 'carbon'],
  [/blue ?super|青スーパー|\bNAS\b/i, 'aogami-super', 'carbon'],
  [/v-?toku ?#?1/i, 'vtoku1', 'carbon'],
  [/v-?toku ?#?2/i, 'vtoku2', 'carbon'],
  [/\bSK\b ?carbon|\bSK\b/i, 'sk', 'carbon'],
  [/silver ?#?3|銀三/i, 'ginsan3', 'stainless'],
  [/zdp-?189/i, 'zdp189', 'stainless'],
  [/\bZA-?18\b/i, 'za18', 'stainless'],
  [/\bVG-?10\b/i, 'vg10', 'stainless'],
  [/\bVG-?1\b/i, 'vg1', 'stainless'],
  [/\bVG-?2\b/i, 'vg2', 'stainless'],
  [/\bVG-?7\b/i, 'vg7', 'stainless'],
  [/\bAUS-?10\b/i, 'aus10', 'stainless'],
  [/\bAUS-?8\b/i, 'aus8', 'stainless'],
  [/\bHSS\b|粉末ハイス/i, 'hss', 'stainless'],
  [/cobalt (stainless )?steel/i, 'cobalt', 'stainless'],
  [/swedish steel/i, 'swedish', 'stainless'],
  [/molybdenum vanadium/i, 'mov', 'stainless'],
  [/molybdenum/i, 'mo', 'stainless'],
  [/\bINOX\b/i, 'inox', 'stainless'],
];

const HANDLE_MATERIALS = [
  [/magnolia/i, 'magnolia'],
  [/walnut|ウォールナット/i, 'walnut'],
  [/rosewood|紫檀/i, 'rosewood'],
  [/ebony|ebnoy|黒檀/i, 'ebony'],
  [/\boak\b/i, 'oak'],
  [/teak/i, 'teak'],
  [/micarta|マイカルタ/i, 'micarta'],
  [/ironwood|アイアンウッド/i, 'ironwood'],
  [/\byew\b/i, 'yew'],
  [/\belm\b/i, 'elm'],
  [/mahogany/i, 'mahogany'],
  [/satine/i, 'satine'],
  [/zelkova|ケヤキ/i, 'zelkova'],
  [/cherry/i, 'cherry'],
  [/tagayasan/i, 'tagayasan'],
  [/wenge/i, 'wenge'],
  [/hinoki/i, 'hinoki'],
  [/burl|花梨瘤/i, 'burl'],
  [/tortoiseshell/i, 'resin'],
  [/\bP[ACP]\b handle|\bP[ACP] handle|\bPP\b|\bPA\b|\bPC\b/, 'plastic'],
  [/stainless steel handle|ステンレス柄/i, 'steel'],
  [/\bwood(en)? handle|\bwood\b/i, 'wood'],
];

const MAKER_PATTERNS = [
  [/takeda hamono/i, 'Takeda Hamono'],
  [/yoshida ?hamono/i, 'Yoshida Hamono'],
  [/saji takeshi/i, 'Saji Takeshi'],
  [/tanaka shigeki/i, 'Tanaka Shigeki'],
  [/masahiro/i, 'Masahiro'],
  [/kanehide/i, 'Kanehide'],
  [/naniwa/i, 'Naniwa'],
  [/shapton/i, 'Shapton'],
  [/\bdick\b/i, 'DICK'],
  [/victorinox/i, 'Victorinox'],
  [/vallorbe/i, 'Vallorbe'],
  [/caribou/i, 'Caribou'],
  [/morihei/i, 'Morihei'],
];
const VENDOR_MAKER = { 鍔屋: 'Tsubaya', 正広: 'Masahiro', DICK: 'DICK', ビクトリノックス: 'Victorinox', ナニワ: 'Naniwa', カリブー: 'Caribou', バローベ: 'Vallorbe', シャプトン: 'Shapton', 森平: 'Morihei', SANKEN: 'Kanehide', 'N/A': null };
const MAKER_ORIGIN = { DICK: 'DE', Victorinox: 'CH', Vallorbe: 'CH' };

const SERIES_PATTERNS = [
  [/tanegashima|種子島/i, 'Tanegashima'],
  [/sakura/i, 'Sakura'],
  [/nishiki-?goi/i, 'Nishiki-Goi'],
  [/sasanoha/i, 'Sasanoha'],
  [/nawame/i, 'Nawame'],
  [/bessaku/i, 'Bessaku'],
  [/honyaki inox/i, 'Honyaki INOX'],
  [/limited ?model/i, 'Limited'],
];

// ───────────────────────────── Hilfsfunktionen ─────────────────────────────

const stripHtml = (html) =>
  (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const firstMatch = (list, text) => {
  for (const entry of list) if (entry[0].test(text)) return entry;
  return null;
};

/** "15cm" → 150, "13.5cm" → 135, "Approx. 22-24cm" → {min:220,max:240}, "S (16cm)" → 160 … */
function parseSizeLabel(label) {
  if (!label) return null;
  const range = label.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*cm/i);
  if (range) return { mm: Math.round(Number(range[1]) * 10), mmMax: Math.round(Number(range[2]) * 10), approx: true };
  const single = label.match(/(\d+(?:\.\d+)?)\s*cm/i);
  if (single) return { mm: Math.round(Number(single[1]) * 10), approx: /approx/i.test(label) };
  const mm = label.match(/(\d+(?:\.\d+)?)\s*mm/i);
  if (mm) return { mm: Math.round(Number(mm[1])), approx: /approx/i.test(label) };
  return null;
}

const ensureNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "Supplemental Information" der Produktseite: JA/EN-Schlüssel → kanonische Felder */
const SPEC_KEY = {
  スタイル: 'style',
  Style: 'style',
  鋼材タイプ: 'steelType',
  'Steel Type': 'steelType',
  刃構造: 'structure',
  'Blade Structure': 'structure',
  刃形状: 'grind',
  'Blade Grind': 'grind',
};
const SPEC_VALUE = {
  style: [[/和|japan/i, 'wa'], [/洋|western/i, 'yo']],
  steelType: [[/ステンレス|stainless/i, 'stainless'], [/鋼|carbon|steel/i, 'carbon']],
  structure: [[/全鋼|solid|mono/i, 'solid'], [/割込|warikomi/i, 'warikomi'], [/霞|合わせ|kasumi|awase/i, 'kasumi'], [/laminat|clad|multi/i, 'laminated']],
  grind: [[/片|single/i, 'single'], [/両|double/i, 'double']],
};

export function normalizeSpecs(rec) {
  let raw = rec.specs && Object.keys(rec.specs).length ? rec.specs : null;
  if (!raw) {
    raw = {};
    for (const line of rec.accordions?.['補足情報'] ?? rec.accordions?.['Supplemental Information'] ?? []) {
      const m = line.match(/^(.+?)\s*[:：]\s*(.+)$/);
      if (m) raw[m[1].trim()] = m[2].trim();
    }
  }
  const out = { raw };
  for (const [k, v] of Object.entries(raw)) {
    const key = SPEC_KEY[k];
    if (!key) continue;
    const hit = SPEC_VALUE[key].find(([re]) => re.test(v));
    if (hit) out[key] = hit[1];
    else (out.unknown ??= []).push(`${k}=${v}`);
  }
  return out;
}

// ───────────────────────────── Extraktion je Produkt ─────────────────────────────

export function extract(product, specsByHandle = {}) {
  const title = product.title;
  const tags = product.tags || [];
  const tagSet = new Set(tags);
  const haystack = `${title} ${tags.join(' ')}`;
  const stem = (product.product_type || '').replace(/\((ステン|鋼|Carbon|Stainless)\)$/i, '').trim();
  const shopSpecs = specsByHandle[product.handle]?.specs ?? null;
  const flags = [];

  // Kategorie + Typ
  let category = 'knife';
  let typeId = TYPE_BY_STEM[stem] ?? null;
  if (CATEGORY_BY_STEM[stem]) category = CATEGORY_BY_STEM[stem];
  if (typeId === 'boning') typeId = BONING_SUBTYPES.find(([re]) => re.test(title))?.[1] ?? 'boning';
  if (!typeId && category === 'knife') {
    if (ACCESSORY_TITLE.test(title) || (TOOL_TITLE.test(title) && !/knife|knives/i.test(title))) category = 'tool';
    else {
      const hit = firstMatch(TYPE_BY_TITLE, title);
      if (hit) typeId = hit[1];
      else {
        typeId = 'other-knife';
        flags.push('type-unknown');
      }
    }
  }
  if (category !== 'knife') typeId = null;

  // Segment (Haushalt vs. Gastro/Profi)
  const gastro = product.product_type?.startsWith('業務用') || tagSet.has('業者用');
  const segment = category === 'knife' ? (gastro ? 'gastro' : 'home') : 'accessory';

  // Hersteller / Herkunft / Serie
  const makerHit = firstMatch(MAKER_PATTERNS, title);
  const maker = makerHit ? makerHit[1] : product.vendor in VENDOR_MAKER ? VENDOR_MAKER[product.vendor] : product.vendor;
  const origin = MAKER_ORIGIN[maker] ?? 'JP';
  const seriesHit = firstMatch(SERIES_PATTERNS, haystack);
  const series = seriesHit ? seriesHit[1] : null;

  // Stahl
  let steelId = null;
  let steelFamily = null;
  if (category === 'knife') {
    const steelHit = firstMatch(STEEL_PATTERNS, haystack);
    if (steelHit) [, steelId, steelFamily] = steelHit;
    else if (tagSet.has('鋼') || /carbon steel/i.test(title)) {
      steelId = 'carbon-unspecified';
      steelFamily = 'carbon';
    } else if (tagSet.has('ステンレス') || /stainless/i.test(title) || /\(ステン\)/.test(product.product_type || '')) {
      steelId = 'stainless-unspecified';
      steelFamily = 'stainless';
    } else {
      steelId = 'unknown';
      flags.push('steel-unknown');
    }
  }

  // Stahlfamilie: drei unabhängige Signale (Titel-Muster, japanische Tags, Shop-Feld der Produktseite) → Mehrheit.
  // Das Shop-Feld ist nicht unfehlbar (z. B. "SK Carbon Steel Cleaver" steht dort als rostfrei) → Konflikte werden markiert.
  if (category === 'knife') {
    const tagFamily = tagSet.has('鋼') ? 'carbon' : tagSet.has('ステンレス') ? 'stainless' : null;
    const votes = [steelFamily, tagFamily, shopSpecs?.steelType ?? null].filter(Boolean);
    const carbon = votes.filter((v) => v === 'carbon').length;
    const stainless = votes.filter((v) => v === 'stainless').length;
    const winner = carbon === stainless ? steelFamily : carbon > stainless ? 'carbon' : 'stainless';
    if (new Set(votes).size > 1) flags.push(`steel-family-conflict(title=${steelFamily},tags=${tagFamily},shop=${shopSpecs?.steelType ?? null}→${winner})`);
    steelFamily = winner;
  }

  // Rostverhalten (3 Stufen): full = komplett rostfrei, clad = teilweise (Mantel rostfrei, Kern Kohlenstoffstahl), none = nicht rostfrei
  let rust = null;
  if (category === 'knife') {
    const stainlessClad = /stainl?e?a?ss?\s?-?clad|stainless clad/i.test(title);
    if (steelFamily === 'carbon') rust = stainlessClad || (tagSet.has('ステンレス') && tagSet.has('鋼')) ? 'clad' : 'none';
    else if (steelFamily === 'stainless') rust = 'full';
    if (steelFamily === 'carbon' && tagSet.has('ステンレス') && !stainlessClad) flags.push('rust-clad-by-tag-only');
  }

  // Aufbau: solid (Vollstahl) | warikomi (Kern zwischen zwei Mantel-Lagen) | kasumi (Hartstahl auf Weicheisen, "awase") | laminated (mehrlagig, nicht näher bestimmt)
  // damascus = sichtbares Lagenmuster (rein optisch/zusätzlich)
  const damascus = /damascus|damasucus|multilayer|\d+\s?layers?|suminagashi/i.test(title) || tagSet.has('ダマスカス') || tagSet.has('墨流');
  let construction = null;
  if (category === 'knife') {
    if (shopSpecs?.structure) construction = shopSpecs.structure;
    else construction = tagSet.has('全鋼') || /honyaki/i.test(title) ? 'solid' : 'laminated';
  }

  // Schliff + Händigkeit
  const SINGLE_BEVEL_TYPES = new Set(['yanagiba', 'takohiki', 'fuguhiki', 'deba', 'ai-deba', 'mioroshi', 'usuba', 'unagi', 'kaisaki', 'sole']);
  let bevel = null;
  if (category === 'knife') {
    if (shopSpecs?.grind) bevel = shopSpecs.grind;
    else if (/double bevel/i.test(title)) bevel = 'double';
    else bevel = SINGLE_BEVEL_TYPES.has(typeId) ? 'single' : 'double';
  }
  const leftTitle = /left-?handed/i.test(title);
  const leftTag = tagSet.has('左刃');
  if (leftTitle !== leftTag && category === 'knife') flags.push('left-signal-mismatch');
  const handed = category !== 'knife' ? null : leftTitle || leftTag ? 'left' : bevel === 'single' ? 'right' : 'both';

  // Griff
  let handleStyle = null;
  if (category === 'knife') {
    if (tagSet.has('ステンレス柄')) handleStyle = 'steel';
    else if (shopSpecs?.style) handleStyle = shopSpecs.style;
    else if (tagSet.has('和式柄')) handleStyle = 'wa';
    else if (tagSet.has('洋式柄')) handleStyle = 'yo';
    else if (/japanese handle/i.test(title)) handleStyle = 'wa';
    else if (/western handle/i.test(title)) handleStyle = 'yo';
    else handleStyle = 'unknown';
  }
  const matHit = firstMatch(HANDLE_MATERIALS, haystack);
  const handleMaterial = category === 'knife' ? matHit?.[1] ?? null : null;
  let handleShape = null;
  if (/octagonal/i.test(title)) handleShape = 'octagonal';
  else if (/\boval\b/i.test(title)) handleShape = 'oval';
  else if (/\bround\b/i.test(title) && category === 'knife') handleShape = 'round';
  else if (/straight handle/i.test(title)) handleShape = 'straight';
  else if (/curved handle/i.test(title)) handleShape = 'curved';

  // Oberfläche / Optik
  const finish = [];
  if (/kurouchi|黒打/i.test(haystack)) finish.push('kurouchi');
  if (/tsuchime|鎚目/i.test(haystack)) finish.push('tsuchime');
  if (/nashiji|梨地/i.test(haystack)) finish.push('nashiji');
  if (damascus) finish.push('damascus');
  if (/fine-?finish|superfine|上仕上/i.test(haystack)) finish.push('fine-finish');
  if (/mirror|鏡面/i.test(haystack)) finish.push('mirror');
  if (/kasumi/i.test(title)) finish.push('kasumi');
  if (/dimple/i.test(title)) finish.push('dimple');
  const tip = /kiritsuke|kirituke|切付/i.test(haystack) ? 'kiritsuke' : null;

  // Größen & Preise (alle JPY)
  const sizes = product.variants.map((v) => {
    const parsed = parseSizeLabel(v.option1);
    return {
      label: v.option1 && v.option1 !== 'Default Title' ? v.option1 : null,
      mm: parsed?.mm ?? null,
      ...(parsed?.mmMax ? { mmMax: parsed.mmMax } : {}),
      ...(parsed?.approx ? { approx: true } : {}),
      priceJpy: ensureNumber(v.price),
      available: Boolean(v.available),
      sku: v.sku || null,
    };
  });
  const prices = sizes.map((s) => s.priceJpy).filter((x) => x !== null);
  const availableSizes = sizes.filter((s) => s.available);
  const bodyText = stripHtml(product.body_html);
  const notes = [];
  if (/one-off item/i.test(bodyText)) notes.push('one-off');
  if (/doesn't come within a box/i.test(bodyText)) notes.push('no-box');
  if (/rusts easily/i.test(bodyText)) notes.push('rusts-easily-per-shop');

  const images = (product.images || []).slice(0, 4).map((i) => ({ src: i.src, w: i.width, h: i.height }));

  return {
    id: product.id,
    handle: product.handle,
    title,
    category,
    type: typeId,
    segment,
    maker,
    origin,
    ...(series ? { series } : {}),
    steel: category === 'knife' ? { id: steelId, family: steelFamily } : null,
    rust,
    construction,
    bevel,
    handed,
    grip: category === 'knife' ? { style: handleStyle, material: handleMaterial, shape: handleShape } : null,
    finish,
    tip,
    sizes,
    priceFrom: prices.length ? Math.min(...prices) : null,
    priceTo: prices.length ? Math.max(...prices) : null,
    available: availableSizes.length > 0,
    images,
    tags,
    ...(notes.length ? { notes } : {}),
    ...(shopSpecs ? { shopSpecs: shopSpecs.raw } : {}),
    ...(flags.length ? { flags } : {}),
    productTypeJp: product.product_type,
  };
}

// ───────────────────────────── Hauptprogramm ─────────────────────────────

function applyOverrides(record, overrides) {
  const patch = overrides?.[record.handle];
  if (!patch) return record;
  const merged = { ...record };
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith('_')) continue; // Kommentarfelder
    if (value && typeof value === 'object' && !Array.isArray(value) && merged[key] && typeof merged[key] === 'object') merged[key] = { ...merged[key], ...value };
    else merged[key] = value;
  }
  merged.overridden = Object.keys(patch).filter((k) => !k.startsWith('_'));
  return merged;
}

const countBy = (items, fn) => {
  const m = new Map();
  for (const x of items) m.set(fn(x), (m.get(fn(x)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

async function main() {
  const args = process.argv.slice(2);
  const productsFile = args.find((a) => !a.startsWith('--'));
  if (!productsFile) {
    console.error('Aufruf: node scripts/build-data.mjs <products.json> [--specs=…] [--overrides=…] [--out=…] [--report]');
    process.exit(2);
  }
  const opt = (name, fallback) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : fallback;
  };
  const specsFile = opt('specs', null);
  const overridesFile = opt('overrides', 'data/overrides.json');
  const outFile = opt('out', 'data/knives.json');

  const raw = JSON.parse(await readFile(productsFile, 'utf8'));
  const specsByHandle = {};
  if (specsFile && existsSync(specsFile)) {
    for (const line of (await readFile(specsFile, 'utf8')).split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.status !== 200) continue;
        const specs = normalizeSpecs(rec);
        if (Object.keys(specs.raw).length) specsByHandle[rec.handle] = { specs };
      } catch {
        /* unvollständige Zeile */
      }
    }
  }
  const overrides = existsSync(overridesFile) ? JSON.parse(await readFile(overridesFile, 'utf8')) : {};

  const items = raw.products.map((p) => applyOverrides(extract(p, specsByHandle), overrides));
  const dataset = {
    meta: {
      source: raw.source,
      fetchedAt: raw.fetchedAt,
      count: items.length,
      currency: 'JPY',
      shopSpecsCount: Object.keys(specsByHandle).length,
    },
    items,
  };
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(dataset));
  console.log(`${items.length} Produkte → ${outFile} (${Object.keys(specsByHandle).length} mit Shop-Spezifikationen, ${Object.keys(overrides).filter((k) => !k.startsWith('_')).length} Overrides)`);

  if (args.includes('--report')) {
    const knives = items.filter((i) => i.category === 'knife');
    console.log('\n── Kategorien ──', countBy(items, (i) => i.category));
    console.log('── Segment (Messer) ──', countBy(knives, (i) => i.segment));
    console.log('── Typen ──', countBy(knives, (i) => i.type));
    console.log('── Stahl ──', countBy(knives, (i) => i.steel.id));
    console.log('── Rost ──', countBy(knives, (i) => i.rust));
    console.log('── Aufbau ──', countBy(knives, (i) => i.construction));
    console.log('── Schliff ──', countBy(knives, (i) => i.bevel));
    console.log('── Händigkeit ──', countBy(knives, (i) => i.handed));
    console.log('── Griffstil ──', countBy(knives, (i) => i.grip.style));
    console.log('── Griffmaterial ──', countBy(knives, (i) => i.grip.material));
    console.log('── Hersteller ──', countBy(knives, (i) => i.maker));
    console.log('── Serien ──', countBy(knives, (i) => i.series ?? '-'));
    console.log('── Flags ──', countBy(knives.flatMap((i) => (i.flags || []).map((f) => ({ f }))), (x) => x.f));
    const withoutSize = knives.filter((i) => i.sizes.some((s) => s.mm === null));
    console.log(`── Messer mit unparsbarer Größe: ${withoutSize.length}`, withoutSize.slice(0, 12).map((i) => `${i.title} [${i.sizes.map((s) => s.label).join('|')}]`));
    for (const flag of ['type-unknown', 'steel-unknown', 'left-signal-mismatch', 'rust-clad-by-tag-only']) {
      const hit = knives.filter((i) => i.flags?.includes(flag));
      if (hit.length) console.log(`── ${flag} (${hit.length}) ──\n` + hit.map((i) => `  ${i.title} | ${i.productTypeJp} | ${i.tags.join(',')}`).join('\n'));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
