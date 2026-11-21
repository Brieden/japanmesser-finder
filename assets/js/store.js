// Winziger Key-Value-Store mit Pub/Sub und localStorage-Persistenz (Fallback: Speicher im RAM).
// localStorage kann fehlen oder werfen (Privatmodus, blockierte Cookies) → alles in try/catch.

const PREFIX = 'jmf:v1:';
const memory = new Map();
const listeners = new Map();

function readStorage(key) {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeStorage(key, value) {
  try {
    if (value === undefined) globalThis.localStorage?.removeItem(PREFIX + key);
    else globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignorieren: Daten bleiben für diese Sitzung im RAM */
  }
}

export const store = {
  get(key, fallback = undefined) {
    if (memory.has(key)) return memory.get(key);
    const stored = readStorage(key);
    if (stored !== undefined) {
      memory.set(key, stored);
      return stored;
    }
    return fallback;
  },

  set(key, value) {
    memory.set(key, value);
    writeStorage(key, value);
    for (const fn of listeners.get(key) ?? []) fn(value);
    return value;
  },

  /** store.update('people', (list) => [...list, x], []) */
  update(key, fn, fallback = undefined) {
    return this.set(key, fn(this.get(key, fallback)));
  },

  remove(key) {
    memory.delete(key);
    writeStorage(key, undefined);
    for (const fn of listeners.get(key) ?? []) fn(undefined);
  },

  /** Gibt eine Funktion zum Abmelden zurück. */
  subscribe(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key)?.delete(fn);
  },

  /** Nur für Tests: RAM-Cache leeren (localStorage bleibt unberührt). */
  _resetMemory() {
    memory.clear();
    listeners.clear();
  },
};
