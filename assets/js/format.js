// Zahlen-, Preis-, Größen- und Datumsformatierung (de-DE). DOM-frei, daher in Node testbar.

const nfInt = new Intl.NumberFormat('de-DE');
const nfOne = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export const num = (n) => nfInt.format(n);

/** 22000 → "¥22.000" */
export const jpy = (n) => (n == null || Number.isNaN(n) ? '–' : `¥${nfInt.format(Math.round(n))}`);

/**
 * JPY → Zielwährung. rates = { EUR: 174.35, CHF: 189.04 } (Yen je 1 Einheit der Fremdwährung).
 * Gibt null zurück, wenn nicht umrechenbar oder currency === 'JPY'.
 */
export function convert(amountJpy, currency, rates) {
  if (amountJpy == null || !currency || currency === 'JPY' || !rates?.[currency]) return null;
  return amountJpy / rates[currency];
}

export function money(amount, currency) {
  const v = nfInt.format(Math.round(amount));
  return currency === 'EUR' ? `${v} €` : `${v} ${currency}`;
}

/** { main: '¥22.000', alt: '≈ 126 €' | null } – Hauptpreis immer in Yen (so steht er im Laden am Schild). */
export function priceParts(amountJpy, { currency = 'EUR', rates } = {}) {
  const foreign = convert(amountJpy, currency, rates);
  return { main: jpy(amountJpy), alt: foreign == null ? null : `≈ ${money(foreign, currency)}` };
}

/** "¥22.000 – ¥44.000" bzw. "¥22.000" */
export function priceRangeText(from, to) {
  if (from == null) return '–';
  return to == null || to === from ? jpy(from) : `${jpy(from)} – ${jpy(to)}`;
}

export const cmText = (mm) => nfOne.format(mm / 10);

/** Größen-Objekt aus knives.json → "21 cm", "22–24 cm", "13,5 cm (ca.)" */
export function sizeText(size) {
  if (size?.mm != null) {
    if (size.mmMax) return `${cmText(size.mm)}–${cmText(size.mmMax)} cm`;
    return `${cmText(size.mm)} cm${size.approx ? ' (ca.)' : ''}`;
  }
  return size?.label ?? '–';
}

/** Spanne aller Größen eines Artikels: "15–27 cm" */
export function sizeRangeText(item) {
  const mms = (item.sizes ?? []).flatMap((s) => [s.mm, s.mmMax]).filter((v) => v != null);
  if (!mms.length) return '';
  const lo = Math.min(...mms);
  const hi = Math.max(...mms);
  return lo === hi ? `${cmText(lo)} cm` : `${cmText(lo)}–${cmText(hi)} cm`;
}

/** ISO-Datum → "21.11.2026" */
export function dateDe(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tokyo' }).format(d);
}

export const plural = (n, one, many) => (n === 1 ? one : many);

/** "3 Messer" / "1 Messer" */
export const count = (n, one, many) => `${nfInt.format(n)} ${plural(n, one, many)}`;

/** Shopify-CDN-Bild in Zielbreite anfordern (spart Daten) */
export function imageUrl(src, width) {
  if (!src) return '';
  if (!width) return src;
  return src.includes('?') ? `${src}&width=${width}` : `${src}?width=${width}`;
}
