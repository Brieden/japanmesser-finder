// Link auf die Produktseite eines Messers im Shop (tsubaya.jp). Gedacht zum Vorzeigen im Laden:
// Es ist die japanische Seite des Shops, also die Sprache, in der das Personal seine eigene Website kennt.
import { h } from '../dom.js';
import { icon } from '../icons.js';

/** shopPageLink(data, item, { cls }) → <a> auf die japanische Produktseite (öffnet in neuem Tab). */
export function shopPageLink(data, item, { cls = 'btn btn--primary' } = {}) {
  return h(
    'a',
    { class: cls, href: data.shopUrlJa(item), target: '_blank', rel: 'noopener noreferrer' },
    h('span', { lang: 'ja' }, '商品ページを開く'),
    icon('external', { size: 18 }),
    h('span', { class: 'visually-hidden' }, ' (Produktseite im Shop, öffnet in neuem Tab)')
  );
}
