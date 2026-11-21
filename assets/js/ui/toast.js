// Kurze Rückmeldung unten im Bild: toast('Zur Liste hinzugefügt')
import { h } from '../dom.js';

let host = null;

export function toast(message, { ms = 3200 } = {}) {
  if (!host) {
    host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const el = h('div', { class: 'toast' }, message);
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}
