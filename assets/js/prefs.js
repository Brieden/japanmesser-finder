// Nutzer-Einstellungen (persistiert): Währung für die Orientierungsanzeige, Bilder an/aus.
import { store } from './store.js';

const DEFAULTS = { currency: 'EUR', images: true };

export const prefs = {
  get: () => ({ ...DEFAULTS, ...(store.get('prefs', {}) ?? {}) }),
  set(patch) {
    store.set('prefs', { ...this.get(), ...patch });
    return this.get();
  },
  subscribe: (fn) => store.subscribe('prefs', () => fn(prefs.get())),
};
