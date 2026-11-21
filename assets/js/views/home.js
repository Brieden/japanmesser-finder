// Startseite: die drei Wege zum passenden Messer + Liste + Einkaufshinweis.
import { h, loadCss, assetUrl } from '../dom.js';
import { icon } from '../icons.js';
import { shortlist } from '../shortlist.js';
import { shopNotice } from '../ui/shop-notice.js';
import { num, dateDe } from '../format.js';

export const title = '';

export async function render(ctx) {
  await loadCss(assetUrl('assets/css/views/home.css'));
  const { data } = ctx;
  const homeKnives = data.knives.filter((k) => k.segment === 'home');
  const people = shortlist.all();

  const path = (href, iconName, heading, text, cta, extra = '') =>
    h(
      'a',
      { class: ['card', 'card--link', 'path', extra], href },
      h('div', { class: 'card__body' },
        h('span', { class: 'path__icon' }, icon(iconName, { size: 26 })),
        h('h2', { class: 'card__title' }, heading),
        h('p', { class: 'path__text' }, text),
        h('span', { class: 'path__cta' }, cta, icon('arrow-right', { size: 18 }))
      )
    );

  return h(
    'div',
    { class: 'home' },
    h(
      'section',
      { class: 'container hero' },
      h('p', { class: 'eyebrow' }, 'Messer aus Kappabashi, Tokyo'),
      h('h1', 'Das richtige Messer für die richtige Person'),
      h('p', { class: 'lede' }, 'Eine Auswahlhilfe für den Messerkauf bei Tsubaya: geführt über wenige Fragen, per Filter durch den ganzen Katalog – oder erst einmal kurz und sachlich nachlesen, worin sich japanische Messer unterscheiden.'),
      h('div', { class: 'hamon', 'aria-hidden': 'true' })
    ),
    h(
      'section',
      { class: 'container paths', 'aria-label': 'Wege zum passenden Messer' },
      path('#/finder', 'compass', 'Geführter Finder', 'Wenige Fragen zur Person, zur Küche und zur Pflege. Du erhältst passende Messertypen, eine Stahl-Empfehlung mit Erklärung und konkrete Treffer aus dem Katalog – jeweils mit Begründung.', 'Finder starten', 'path--primary'),
      path('#/katalog', 'search', 'Katalog durchsuchen', `${num(homeKnives.length)} Haushalts- und Hobbymesser filtern nach Typ, Stahl, rostfrei, Länge, Griff, Händigkeit und Preis – ohne Umweg.`, 'Zum Katalog'),
      path('#/wissen', 'book', 'Messerkunde', 'Kurz, sachlich und ohne Hype: Stahl, Bauweise, Messertypen und Pflege – mit Quellen. Dazu: wann welcher Typ sinnvoll ist und Spaß macht.', 'Nachlesen')
    ),
    h(
      'section',
      { class: 'container section--tight' },
      h(
        'div',
        { class: 'card list-teaser' },
        h('div', { class: 'card__body list-teaser__body' },
          h('div',
            h('h2', { class: 'card__title' }, 'Für mehrere Personen einkaufen?'),
            h('p', { class: 'muted' }, 'Lege je Person ein Profil an, sammle Favoriten in der Liste und zeige sie im Laden vor – mit Summen in Yen und Euro.')
          ),
          h('a', { class: 'btn', href: '#/liste' }, icon('bookmark', { size: 18 }), people.length ? `Liste öffnen (${shortlist.count()})` : 'Liste öffnen')
        )
      )
    ),
    h('section', { class: 'container section--tight' }, shopNotice(data)),
    h('p', { class: 'container muted small home__stand' }, `Katalogstand: ${dateDe(data.meta.fetchedAt)} · ${num(data.knives.length)} Messer (davon ${num(data.knives.length - homeKnives.length)} Profi-/Gastro-Linie), ${num(data.accessories.length)} Zubehörartikel · `, h('a', { href: '#/hinweise' }, 'Hinweise & Quellen'))
  );
}
