// Hash-Router (#/pfad?schlüssel=wert). Funktioniert auf GitHub Pages ohne Server-Konfiguration.
//
// View-Vertrag (assets/js/views/<name>.js):
//   export const title = 'Katalog';                     // optional: <title>-Zusatz
//   export async function render(ctx) → Node            // ctx: siehe unten
//   export function destroy() {}                        // optional: Aufräumen beim Verlassen
//
// ctx = { params, query, path, data, router, store }
//   router.href(path, query) → '#/…'   router.navigate(path, query, {replace})
//   router.replaceQuery(query)          – URL still aktualisieren, KEIN Neu-Rendern (für Filter)
//   router.query()                      – aktuelle Query (nach replaceQuery aktuell, ctx.query nicht)

import { h, mount, $ } from './dom.js';
import { store } from './store.js';

export function parseHash(hash = globalThis.location?.hash ?? '') {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = `/${pathPart.replace(/^\/+|\/+$/g, '')}`;
  return { path, query: Object.fromEntries(new URLSearchParams(queryPart)) };
}

export function buildHash(path, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

/** '/messer/:handle' → { regex, keys } */
function compile(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/+$/g, '')
    .replace(/:([A-Za-z_]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
  return { regex: new RegExp(`^${source || ''}/?$`), keys };
}

export function matchRoute(routes, path) {
  for (const route of routes) {
    const { regex, keys } = route._compiled ?? (route._compiled = compile(route.pattern));
    const m = path.match(regex);
    if (m) return { route, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function startRouter({ routes, outlet, data, onNavigate }) {
  let current = null;
  let token = 0;
  let query = parseHash().query;
  let first = true;
  const scrollPositions = new Map();

  const router = {
    href: buildHash,
    navigate(path, q = {}, { replace = false } = {}) {
      const target = buildHash(path, q);
      if (replace) {
        history.replaceState(history.state, '', target);
        render();
      } else if (location.hash === target) {
        render();
      } else {
        location.hash = target;
      }
    },
    replaceQuery(q) {
      const { path } = parseHash();
      query = Object.fromEntries(Object.entries(q).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]));
      history.replaceState(history.state, '', buildHash(path, query));
    },
    query: () => query,
  };

  async function render() {
    const mine = ++token;
    const { path, query: q } = parseHash();
    query = q;
    const restore = !first && history.state?.jmf ? scrollPositions.get(location.hash) : undefined;

    const match = matchRoute(routes, path);
    let node;
    let mod = null;
    try {
      if (!match) throw Object.assign(new Error('not-found'), { notFound: true });
      mod = await match.route.load();
      const ctx = { params: match.params, query: q, path, data, router, store };
      node = await mod.render(ctx);
    } catch (err) {
      if (mine !== token) return;
      if (!err?.notFound) console.error(err);
      node = errorView(err);
      mod = null;
    }
    if (mine !== token) return; // inzwischen woanders hin navigiert

    if (current?.destroy) {
      try {
        current.destroy();
      } catch (e) {
        console.error(e);
      }
    }
    mount(outlet, node);
    current = { destroy: mod?.destroy };
    document.title = mod?.title ? `${mod.title} · Japanmesser-Finder` : 'Japanmesser-Finder – das richtige Messer für die richtige Person';
    history.replaceState({ ...(history.state ?? {}), jmf: true }, '');

    if (restore != null) window.scrollTo(0, restore);
    else window.scrollTo(0, 0);
    if (!first) $('#main')?.focus({ preventScroll: true });
    first = false;
    onNavigate?.({ path, query: q, route: match?.route ?? null });
  }

  // Scrollposition je Hash laufend merken; beim Zurück/Vor (Eintrag wurde schon gerendert → history.state.jmf) wiederherstellen
  window.addEventListener('scroll', () => scrollPositions.set(location.hash, window.scrollY), { passive: true });
  window.addEventListener('hashchange', render);

  render();
  return router;
}

function errorView(err) {
  const notFound = err?.notFound;
  return h(
    'section',
    { class: 'container--narrow section' },
    h('div', { class: 'empty' },
      h('div', { class: 'empty__mark', lang: 'ja', 'aria-hidden': 'true' }, '刃'),
      h('h1', notFound ? 'Seite nicht gefunden' : 'Das hat nicht geklappt'),
      h('p', notFound ? 'Diesen Pfad gibt es nicht.' : `Beim Laden der Ansicht ist ein Fehler aufgetreten: ${err?.message ?? err}`),
      h('a', { class: 'btn btn--primary', href: '#/' }, 'Zur Startseite')
    )
  );
}
