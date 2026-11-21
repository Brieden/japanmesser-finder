// "Für wen?"-Liste: Personen mit Profil und ausgewählten Messern. Persistiert über store ('people').
// Wird von Katalog, Detailseite, Finder-Ergebnis und Listenansicht gemeinsam genutzt.

import { store } from './store.js';
import { uid } from './util.js';
import { jpy, sizeText, convert, money } from './format.js';

const KEY = 'people';
const ACTIVE = 'activePerson';

/** Stabiler Schlüssel einer Größe/Variante (SKU, sonst Label, sonst Index) */
export const sizeKeyOf = (size, index = 0) => size?.sku ?? size?.label ?? String(index);

const all = () => store.get(KEY, []);
const write = (updater) => store.update(KEY, updater, []);

export const shortlist = {
  all,
  get: (id) => all().find((p) => p.id === id) ?? null,

  active() {
    return this.get(store.get(ACTIVE, null)) ?? all()[0] ?? null;
  },
  setActive: (id) => store.set(ACTIVE, id),

  /** Neue Person anlegen; wird automatisch aktiv. profile = { answers, summary } oder null */
  add({ name = '', profile = null } = {}) {
    const n = all().length + 1;
    const person = { id: uid('p'), name: name.trim() || `Person ${n}`, profile, picks: [], createdAt: Date.now() };
    write((list) => [...list, person]);
    store.set(ACTIVE, person.id);
    return person;
  },

  rename: (id, name) => write((list) => list.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p))),
  setProfile: (id, profile) => write((list) => list.map((p) => (p.id === id ? { ...p, profile } : p))),
  remove(id) {
    write((list) => list.filter((p) => p.id !== id));
    if (store.get(ACTIVE, null) === id) store.set(ACTIVE, all()[0]?.id ?? null);
  },

  /**
   * Messer (und Größe) zu einer Person legen. pick = { handle, sizeKey, sizeMm?, note? }
   * Dieselbe Kombination aus handle+sizeKey wird nicht doppelt gespeichert. Gibt den Eintrag zurück.
   */
  addPick(personId, pick) {
    let result = null;
    write((list) =>
      list.map((p) => {
        if (p.id !== personId) return p;
        const existing = p.picks.find((x) => x.handle === pick.handle && x.sizeKey === pick.sizeKey);
        if (existing) {
          result = existing;
          return p;
        }
        result = { id: uid('k'), note: '', addedAt: Date.now(), ...pick };
        return { ...p, picks: [...p.picks, result] };
      })
    );
    return result;
  },
  removePick: (personId, pickId) => write((list) => list.map((p) => (p.id === personId ? { ...p, picks: p.picks.filter((k) => k.id !== pickId) } : p))),
  updatePick: (personId, pickId, patch) => write((list) => list.map((p) => (p.id === personId ? { ...p, picks: p.picks.map((k) => (k.id === pickId ? { ...k, ...patch } : k)) } : p))),

  /** Alle Vormerkungen zu einem Artikel: [{ person, pick }] */
  picksFor: (handle) => all().flatMap((person) => person.picks.filter((k) => k.handle === handle).map((pick) => ({ person, pick }))),
  isPicked: (handle) => all().some((p) => p.picks.some((k) => k.handle === handle)),
  count: () => all().reduce((n, p) => n + p.picks.length, 0),

  subscribe: (fn) => store.subscribe(KEY, fn),
};

/**
 * Löst eine Vormerkung gegen den aktuellen Katalog auf.
 * → { item|null, size|null, priceJpy|null, available: boolean|null }
 */
export function resolvePick(pick, byHandle) {
  const item = byHandle.get(pick.handle) ?? null;
  if (!item) return { item: null, size: null, priceJpy: null, available: null };
  const idx = item.sizes.findIndex((s, i) => sizeKeyOf(s, i) === pick.sizeKey);
  const size = idx >= 0 ? item.sizes[idx] : item.sizes[0] ?? null;
  return { item, size, priceJpy: size?.priceJpy ?? item.priceFrom ?? null, available: size ? Boolean(size.available) : null };
}

/** Summe einer Person in Yen (+ Anzahl nicht auflösbarer Einträge) */
export function totalJpy(person, byHandle) {
  let sum = 0;
  let missing = 0;
  for (const pick of person.picks) {
    const { priceJpy } = resolvePick(pick, byHandle);
    if (priceJpy == null) missing += 1;
    else sum += priceJpy;
  }
  return { sum, missing };
}

/** Kopierbarer Klartext (z. B. für WhatsApp/Notizen/Zeigen im Laden). ctx = { byHandle, t, rates, currency } */
export function listAsText(people, ctx) {
  const lines = [];
  let grand = 0;
  for (const person of people) {
    if (!person.picks.length) continue;
    lines.push(`Für ${person.name}:`);
    for (const pick of person.picks) {
      const r = resolvePick(pick, ctx.byHandle);
      const typeName = r.item?.type ? ctx.t('types', r.item.type) : '';
      const size = r.size ? sizeText(r.size) : '';
      const head = [typeName, size].filter(Boolean).join(' ');
      lines.push(`• ${head ? `${head} – ` : ''}${r.item?.title ?? pick.handle} – ${jpy(r.priceJpy)}${r.size?.sku ? ` – Art.-Nr. ${r.size.sku}` : ''}`);
      if (pick.note) lines.push(`  Notiz: ${pick.note}`);
    }
    const { sum } = totalJpy(person, ctx.byHandle);
    grand += sum;
    lines.push(`  Summe ${person.name}: ${jpy(sum)}`, '');
  }
  if (lines.length) {
    const foreign = convert(grand, ctx.currency, ctx.rates);
    lines.push(`Gesamt: ${jpy(grand)}${foreign != null ? ` (≈ ${money(foreign, ctx.currency)})` : ''}`);
  }
  return lines.join('\n');
}
