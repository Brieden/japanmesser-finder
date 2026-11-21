// Hinweiskasten zum Shop (Onlineverkauf pausiert, Öffnungszeiten, Adresse). Auf Startseite, Detail und Liste nutzbar.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { dateDe } from '../format.js';

/** shopNotice(data, { compact: true }) → Node */
export function shopNotice(data, { compact = false } = {}) {
  const shop = data.site.shop;
  const online = shop.onlineSales;
  const suspended = online?.status === 'suspended';
  const head = suspended ? 'Gekauft wird derzeit im Laden' : 'Einkauf bei Tsubaya';

  if (compact) {
    // Kurzform: eine Zeile Kernaussage (Katalog, Detail) – die Langform steht auf Startseite und Finder
    return h(
      'aside',
      { class: ['notice', suspended ? 'notice--warn' : 'notice--info'], 'aria-label': 'Hinweis zum Einkauf' },
      h('span', { class: 'notice__icon' }, icon(suspended ? 'alert' : 'store', { size: 20 })),
      h('p', h('strong', `${head}. `), suspended ? 'Der Onlineverkauf ist pausiert (Wiederaufnahme für Januar 2027 geplant). ' : '', `Laden ${shop.hoursShort ?? ''} · `, h('a', { href: shop.mapUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Karte'), ' · ', h('a', { href: '#/hinweise' }, 'Hinweise'))
    );
  }

  const details = [
    suspended &&
      h('p', `Der Onlineverkauf ist laut Shop vorübergehend pausiert (Systemumstellung, Wiederaufnahme für ${online.resumeExpected === '2027-01' ? 'Januar 2027' : online.resumeExpected} geplant; Stand ${dateDe(online.asOf)}). `, h('a', { href: online.source, target: '_blank', rel: 'noopener noreferrer' }, 'Mitteilung des Shops')),
    h('p', h('strong', 'Laden: '), `${shop.hours}. `, h('span', { class: 'nowrap' }, shop.address), ' · ', h('a', { href: shop.mapUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Karte öffnen')),
    !compact && h('p', 'Preise und Bestand stammen aus dem öffentlichen Online-Katalog (Stand ', dateDe(data.meta.fetchedAt), '). Bitte vor Ort bestätigen – der Bestand im Laden kann abweichen.'),
  ];

  return h(
    'aside',
    { class: ['notice', suspended ? 'notice--warn' : 'notice--info'], 'aria-label': 'Hinweis zum Einkauf' },
    h('span', { class: 'notice__icon' }, icon(suspended ? 'alert' : 'store', { size: 20 })),
    h('div', h('p', h('strong', head)), details)
  );
}
