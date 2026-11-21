// #/hinweise – Hinweise, Datenstand & Quellen
import { h, loadCss, assetUrl } from '../dom.js';
import { icon } from '../icons.js';
import { prefs } from '../prefs.js';
import { store } from '../store.js';
import { dateDe, count } from '../format.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';

export const title = 'Hinweise, Datenstand & Quellen';

const SECTIONS = [
  ['ueber', 'Über diese Seite'],
  ['datenstand', 'Datenstand'],
  ['preise', 'Preise und Verfügbarkeit'],
  ['einstellungen', 'Einstellungen'],
  ['datenschutz', 'Datenschutz'],
  ['haftung', 'Haftungsausschluss'],
  ['quellen', 'Quellen'],
];

export async function render(ctx) {
  await loadCss(assetUrl('assets/css/views/about.css'));
  const { data, router } = ctx;
  const { meta, site } = data;
  const shop = site?.shop ?? {};
  const sales = shop.onlineSales;
  const rates = site?.rates;
  const wissen = (path = '') => router.href(`/wissen${path}`);

  const sec = (id, heading, ...body) => {
    const hid = `hinweise-${id}`;
    return h('section', { class: 'about__sec stack', id, 'aria-labelledby': hid }, h('h2', { id: hid }, h('a', { class: 'about__anchor', href: `#${id}`, 'aria-hidden': 'true', tabindex: -1, onClick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); } }, '#'), heading), ...body);
  };

  // Einstellungen (wirken sofort)
  const cur = h('select', { id: 'set-currency', onChange: (e) => { prefs.set({ currency: e.target.value }); toast('Währung gespeichert'); } },
    [['EUR', 'Euro (EUR)'], ['CHF', 'Schweizer Franken (CHF)'], ['JPY', 'Nur Yen (JPY)']].map(([v, l]) => h('option', { value: v, selected: prefs.get().currency === v }, l)));
  const img = h('input', { type: 'checkbox', id: 'set-images', checked: prefs.get().images, onChange: (e) => { prefs.set({ images: e.target.checked }); toast(e.target.checked ? 'Bilder werden angezeigt' : 'Bilder sind ausgeblendet'); } });

  return h(
    'div',
    { class: 'container container--narrow section about' },
    h('p', { class: 'eyebrow' }, 'Transparenz'),
    h('h1', 'Hinweise, Datenstand & Quellen'),
    h('nav', { class: 'about__toc', 'aria-label': 'Auf dieser Seite' }, h('ul', { role: 'list' }, SECTIONS.map(([id, label]) => h('li', null, h('a', { href: `#${id}`, onClick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); } }, label))))),

    sec('ueber', 'Über diese Seite',
      h('p', 'Der Japanmesser-Finder ist ein inoffizielles, privates und nicht-kommerzielles Projekt. Er hilft dabei, aus dem Katalog des Tokioter Messerladens Tsubaya das passende japanische Küchenmesser für die passende Person zu finden.'),
      h('p', 'Die Seite enthält keine Werbung, kein Tracking und keine Affiliate-Links. Sie ist nicht mit dem Shop verbunden und wird weder von ihm noch von Herstellern unterstützt oder geprüft.')),

    sec('datenstand', 'Datenstand',
      h('p', `Der Katalog wurde am ${dateDe(meta?.fetchedAt)} abgerufen und enthält ${count(data.knives.length, 'Messer', 'Messer')} sowie ${count(data.accessories.length, 'Zubehör- oder Pflegeartikel', 'Zubehör- und Pflegeartikel')}. Neuere Änderungen im Shop sind hier erst nach einer Aktualisierung sichtbar.`),
      h('p', 'Die Merkmale (Messertyp, Stahl, Rostverhalten, Schliff, Griff, Optik) sind nicht frei erfunden, sondern werden aus mehreren Quellen abgeleitet:'),
      h('ul', null,
        h('li', 'aus den Produkttiteln,'),
        h('li', 'aus den japanischen Tags und Produkttypen des Shops,'),
        h('li', `und, wo vorhanden, aus den Zusatzangaben der Produktseiten (bei ${meta?.shopSpecsCount ?? 'einem Teil der'} Artikeln).`)),
      h('p', 'Automatische Plausibilitätsprüfungen markieren widersprüchliche Angaben. Trotzdem sind Fehler möglich. Wo der Shop etwas nicht nennt, steht das ausdrücklich da, etwa „Sorte nicht angegeben“, statt dass geraten wird. Wichtige Angaben vor dem Kauf bitte im Laden nachfragen.')),

    sec('preise', 'Preise und Verfügbarkeit',
      h('p', 'Alle Preise sind Yen-Preise laut Online-Katalog des Shops. In Japan sind Endkundenpreise üblicherweise Bruttopreise (inklusive Verbrauchsteuer); der Shop nennt das auf den Produktseiten nicht ausdrücklich, bitte im Laden bestätigen. Der Bestand im Laden kann davon abweichen; „vorrätig“ heißt hier immer „laut Katalog“.'),
      sales ? h('div', { class: 'notice notice--warn' }, h('p', null, sales.text, sales.source ? [' ', h('a', { href: sales.source, target: '_blank', rel: 'noopener noreferrer' }, 'Mitteilung des Shops'), ` (Stand ${dateDe(sales.asOf)})`] : null)) : null,
      rates ? h('p', `Euro- und Franken-Beträge sind nur eine Orientierung. Grundlage ist der ${rates.source} vom ${dateDe(rates.asOf)}: 1 € = ¥${String(rates.perUnit.EUR).replace('.', ',')}, 1 CHF = ¥${String(rates.perUnit.CHF).replace('.', ',')}. Der tatsächliche Betrag (Kartenkurs, Gebühren) weicht ab.`) : null),

    sec('einstellungen', 'Einstellungen',
      h('p', { class: 'muted' }, 'Änderungen wirken sofort und werden in deinem Browser gespeichert.'),
      h('div', { class: 'about__form stack' },
        h('div', { class: 'about__field' }, h('label', { for: 'set-currency' }, 'Währung für die Orientierungsanzeige'), cur),
        h('div', { class: 'about__check' }, img, h('label', { for: 'set-images' }, 'Produktbilder anzeigen')),
        h('p', { class: 'muted' }, 'Ohne Bilder baut dein Browser keine Verbindung zum Bild-Server des Shops auf.'))),

    sec('datenschutz', 'Datenschutz',
      h('ul', null,
        h('li', 'Die Seite setzt keine Cookies und nutzt keine Tracker oder Statistik-Dienste. Es werden keine Eingaben an einen Server gesendet.'),
        h('li', 'Deine Liste, die Finder-Antworten und die Einstellungen liegen ausschließlich im Browser (localStorage) und lassen sich dort oder mit dem Knopf unten löschen.'),
        h('li', 'Die Produktbilder lädt dein Browser direkt vom Bild-Server des Shops (cdn.shopify.com). Dabei wird deine IP-Adresse an diesen Server übertragen. Das lässt sich oben unter „Einstellungen“ abschalten.'),
        h('li', 'Die Seite selbst wird über GitHub Pages ausgeliefert. GitHub kann Zugriffe protokollieren; darauf hat dieses Projekt keinen Einfluss.')),
      h('div', null, h('button', { class: 'btn', type: 'button', onClick: () => confirmWipe(ctx) }, icon('trash'), 'Alle lokalen Daten löschen'))),

    sec('haftung', 'Haftungsausschluss',
      h('p', 'Die Seite bietet Orientierung, keine Rechts-, Steuer- oder Zollberatung. Alle Angaben erfolgen ohne Gewähr. Für verbindliche Auskünfte zu Freigrenzen, Einfuhr und Steuererstattung sind die jeweiligen Behörden maßgeblich.'),
      h('p', 'Marken- und Produktnamen gehören ihren jeweiligen Inhabern und werden nur zur Beschreibung der Artikel genannt. Produktbilder und Titel stammen aus dem Online-Katalog des Shops.')),

    sec('quellen', 'Quellen',
      h('ul', null,
        h('li', 'Katalog, Preise und Produktangaben: ', shop.url ? h('a', { href: shop.url, target: '_blank', rel: 'noopener noreferrer' }, `${shop.name ?? 'Shop'} (${shop.url.replace(/^https?:\/\//, '')})`) : 'Online-Katalog des Shops', '.'),
        h('li', 'Wechselkurse: ', rates?.source ?? 'EZB-Referenzkurs', '.'),
        h('li', 'Messerkunde mit Quellenangaben je Abschnitt: ', h('a', { href: wissen() }, 'Wissen'), '.'),
        h('li', 'Zoll, Freigrenzen und Steuererstattung mit Quellen: ', h('a', { href: wissen('/mitbringen') }, 'Messer mitbringen'), '.')))
  );
}

function confirmWipe(ctx) {
  const dlg = openDialog({
    title: 'Alle lokalen Daten löschen?',
    body: h('div', { class: 'stack' },
      h('p', 'Liste, Personen, Finder-Antworten und Einstellungen werden aus diesem Browser gelöscht. Das lässt sich nicht rückgängig machen.'),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => { wipe(); dlg.close(); toast('Lokale Daten gelöscht'); setTimeout(() => location.reload(), 600); } }, icon('trash'), 'Alles löschen'),
        h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Abbrechen'))),
  });
}

function wipe() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    keys.filter((k) => k?.startsWith('jmf:')).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignorieren */ }
  try { store._resetMemory?.(); } catch { /* ignorieren */ }
}
