// Produktkarte – einheitliche Darstellung eines Artikels in Katalog, Finder-Ergebnis, „Ähnliche Messer“, Liste.
//
//   productCard(item, { data, reasons?, warnings?, sizeIndex?, onPickDone? }) → <article class="card pcard">
//
// reasons  = Kurztexte „passt weil …“ (Finder), warnings = „bitte beachten“ (Finder)
// sizeIndex = bevorzugte Größe (wird im „Merken“-Dialog vorausgewählt)
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { prefs } from '../prefs.js';
import { shortlist } from '../shortlist.js';
import { priceParts, imageUrl, sizeText } from '../format.js';
import { itemHeadline, rustBadge, attrChips } from './attrs.js';
import { openPickDialog } from './pick.js';

export function productPhoto(item, { width = 480, eager = false } = {}) {
  const p = prefs.get();
  const first = item.images?.[0];
  if (!p.images || !first) {
    return h('div', { class: 'photo photo--empty', lang: 'ja', role: 'img', 'aria-label': p.images ? 'Kein Bild vorhanden' : 'Bilder sind ausgeblendet' }, '刃');
  }
  return h(
    'div',
    { class: 'photo' },
    h('img', {
      src: imageUrl(first.src, width),
      alt: item.title,
      width: 240,
      height: Math.round((240 * (first.h || 1)) / (first.w || 1)),
      loading: eager ? 'eager' : 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    })
  );
}

export function availabilityText(item) {
  const avail = item.sizes.filter((s) => s.available);
  if (!avail.length) return 'Laut Katalog nicht vorrätig';
  if (avail.length === item.sizes.length && item.sizes.length === 1) return 'Laut Katalog vorrätig';
  return `Laut Katalog vorrätig: ${avail.map((s) => sizeText(s).replace(' cm', '')).join(', ')} cm`;
}

export function priceBlock(item, data) {
  const p = prefs.get();
  const multi = item.priceTo != null && item.priceTo !== item.priceFrom;
  const { main, alt } = priceParts(item.priceFrom, { currency: p.currency, rates: data.rates });
  return h('div', { class: 'price' }, multi && h('span', { class: 'price__alt' }, 'ab'), h('span', { class: 'price__main' }, main), alt && h('span', { class: 'price__alt' }, alt));
}

export function productCard(item, { data, reasons = [], warnings = [], sizeIndex = 0, onPickDone } = {}) {
  const head = itemHeadline(data, item);
  const picked = shortlist.isPicked(item.handle);
  const pickBtn = h(
    'button',
    {
      class: ['btn', 'btn--sm', picked ? 'btn--primary' : ''],
      type: 'button',
      'aria-pressed': picked ? 'true' : 'false',
      onClick: () =>
        openPickDialog({
          data,
          item,
          sizeIndex,
          onDone: (result) => {
            pickBtn.replaceChildren(icon('bookmark-fill', { size: 16 }), 'Vorgemerkt');
            pickBtn.classList.add('btn--primary');
            pickBtn.setAttribute('aria-pressed', 'true');
            onPickDone?.(result);
          },
        }),
    },
    icon(picked ? 'bookmark-fill' : 'bookmark', { size: 16 }),
    picked ? 'Vorgemerkt' : 'Merken'
  );

  return h(
    'article',
    { class: ['card', 'card--link', 'pcard'], dataset: { handle: item.handle } },
    h('a', { class: 'pcard__photo', href: `#/messer/${encodeURIComponent(item.handle)}`, tabindex: '-1', 'aria-hidden': 'true' }, productPhoto(item)),
    h(
      'div',
      { class: 'card__body pcard__body' },
      h('div', { class: 'pcard__head' },
        h('h3', { class: 'pcard__title' }, h('a', { href: `#/messer/${encodeURIComponent(item.handle)}` }, head.title), head.sizes && h('span', { class: 'pcard__sizes' }, ` · ${head.sizes}`)),
        rustBadge(data, item)
      ),
      h('p', { class: 'pcard__orig', lang: 'en' }, item.title),
      h('div', { class: 'cluster pcard__chips' }, attrChips(data, item)),
      reasons.length > 0 && h('ul', { class: 'pcard__reasons' }, reasons.map((r) => h('li', { class: 'pcard__reason' }, icon('check', { size: 16 }), h('span', r)))),
      warnings.length > 0 && h('ul', { class: 'pcard__warnings' }, warnings.map((w) => h('li', { class: 'pcard__warning' }, icon('alert', { size: 16 }), h('span', w)))),
      h('div', { class: 'pcard__foot' },
        priceBlock(item, data),
        h('p', { class: ['pcard__avail', item.available ? '' : 'is-out'] }, availabilityText(item))
      ),
      h('div', { class: 'pcard__actions' }, pickBtn, h('a', { class: 'btn btn--ghost btn--sm', href: `#/messer/${encodeURIComponent(item.handle)}` }, 'Details', icon('arrow-right', { size: 16 })))
    )
  );
}
