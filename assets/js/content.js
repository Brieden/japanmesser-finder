// Messerkunde-Inhalte (content/wissen.json) einmal laden und teilen: Messerkunde und Detailseite (Quellen) nutzen dieselbe Anfrage.
import { assetUrl } from './dom.js';

let promise = null;

export function loadWissen() {
  promise ??= fetch(assetUrl('content/wissen.json'))
    .then((r) => {
      if (!r.ok) throw new Error(`wissen.json: ${r.status}`);
      return r.json();
    })
    .catch((e) => {
      promise = null;
      throw e;
    });
  return promise;
}
