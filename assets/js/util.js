// Kleine, DOM-freie Hilfsfunktionen (auch in Node-Tests nutzbar).

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const debounce = (fn, ms = 200) => {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
};

export const uid = (prefix = 'id') => `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

export const unique = (arr) => [...new Set(arr)];

/** Zählt Werte: countBy(items, fn) → Map(wert → anzahl) */
export const countBy = (items, fn) => {
  const map = new Map();
  for (const item of items) {
    const key = fn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
};

export const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Mehrfachwerte in URL-Query: "a,b,c" ⇄ ['a','b','c'] */
export const splitList = (value) => (value ? String(value).split(',').map((s) => s.trim()).filter(Boolean) : []);
export const joinList = (arr) => (arr && arr.length ? arr.join(',') : '');

export const isBrowser = typeof document !== 'undefined';

/** Sicheres Lesen verschachtelter Pfade: get(obj, 'a.b.c', fallback) */
export const get = (obj, path, fallback = undefined) => {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null) return fallback;
    cur = cur[key];
  }
  return cur ?? fallback;
};
