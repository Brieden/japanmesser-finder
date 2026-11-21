// Einstiegspunkt: Daten laden, Router starten, Navigation/Theme/Listen-Badge verdrahten.

import { loadData } from './data.js';
import { startRouter } from './router.js';
import { h, $, $$, mount } from './dom.js';
import { icon, hydrateIcons } from './icons.js';
import { store } from './store.js';
import { shortlist } from './shortlist.js';

const ROUTES = [
  { pattern: '/', nav: null, load: () => import('./views/home.js') },
  { pattern: '/finder', nav: 'finder', load: () => import('./views/finder.js') },
  { pattern: '/katalog', nav: 'katalog', load: () => import('./views/catalog.js') },
  { pattern: '/messer/:handle', nav: 'katalog', load: () => import('./views/detail.js') },
  { pattern: '/wissen', nav: 'wissen', load: () => import('./views/wissen.js') },
  { pattern: '/wissen/:section', nav: 'wissen', load: () => import('./views/wissen.js') },
  { pattern: '/liste', nav: 'liste', load: () => import('./views/liste.js') },
  { pattern: '/hinweise', nav: null, load: () => import('./views/about.js') },
];

// ── Farbschema: automatisch → hell → dunkel → automatisch ──
const THEMES = [null, 'light', 'dark'];
const THEME_TEXT = { null: 'automatisch', light: 'hell', dark: 'dunkel' };
const THEME_ICON = { null: 'contrast', light: 'sun', dark: 'moon' };

function applyTheme(pref) {
  if (pref === 'light' || pref === 'dark') document.documentElement.dataset.theme = pref;
  else delete document.documentElement.dataset.theme;
  const btn = $('#theme-toggle');
  btn.replaceChildren(icon(THEME_ICON[pref ?? 'null'], { size: 22 }));
  btn.setAttribute('aria-label', `Farbschema: ${THEME_TEXT[pref ?? 'null']}. Klicken zum Wechseln.`);
  btn.title = `Farbschema: ${THEME_TEXT[pref ?? 'null']}`;
}

function initTheme() {
  applyTheme(store.get('theme', null));
  $('#theme-toggle').addEventListener('click', () => {
    const current = store.get('theme', null);
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    store.set('theme', next);
    applyTheme(next);
  });
}

// ── Listen-Badge in der Navigation ──
function updateBadge() {
  const n = shortlist.count();
  for (const el of $$('[data-list-count]')) {
    el.textContent = String(n);
    el.hidden = n === 0;
  }
}

function markNav(route) {
  for (const a of $$('[data-nav]')) {
    if (route?.nav && a.dataset.nav === route.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function showFatal(outlet, err) {
  console.error(err);
  const viaFile = location.protocol === 'file:';
  mount(
    outlet,
    h(
      'section',
      { class: 'container--narrow section' },
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty__mark', lang: 'ja', 'aria-hidden': 'true' }, '刃'),
        h('h1', 'Die Daten konnten nicht geladen werden'),
        h('p', viaFile
          ? 'Die Seite wurde direkt aus dem Dateisystem geöffnet; Browser blockieren dabei das Laden der Katalogdaten. Bitte über einen lokalen Webserver öffnen, z. B. mit „python3 -m http.server“ im Projektordner.'
          : `Fehlermeldung: ${err?.message ?? err}`),
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => location.reload() }, 'Neu laden')
      )
    )
  );
}

async function boot() {
  hydrateIcons();
  initTheme();
  const outlet = $('#app');
  let data;
  try {
    data = await loadData();
  } catch (err) {
    showFatal(outlet, err);
    return;
  }
  updateBadge();
  shortlist.subscribe(updateBadge);
  startRouter({ routes: ROUTES, outlet, data, onNavigate: ({ route }) => markNav(route) });
}

boot();
