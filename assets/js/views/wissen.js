// Messerkunde: rendert content/wissen.json (Abschnitte, Diagramme, Atlas, Stahltabelle, Glossar, Quellen).
import { h, rich, loadCss, assetUrl } from '../dom.js';
import { icon } from '../icons.js';
import { figure } from '../ui/figures.js';
import { typeatlas } from '../ui/typeatlas.js';
import { steeltable } from '../ui/steeltable.js';

export const title = 'Messerkunde';

let contentPromise = null;
function loadContent() {
  contentPromise ??= fetch(assetUrl('content/wissen.json'))
    .then((r) => {
      if (!r.ok) throw new Error(`wissen.json: ${r.status}`);
      return r.json();
    })
    .catch((e) => {
      contentPromise = null;
      throw e;
    });
  return contentPromise;
}

let cleanup = null;
export function destroy() {
  cleanup?.();
  cleanup = null;
}

const TONE_ICON = { info: 'info', warn: 'alert', ok: 'check' };

function block(b, ctx) {
  switch (b.type) {
    case 'p':
      return h('p', rich(b.text));
    case 'h3':
      return h('h3', rich(b.text));
    case 'list':
      return h(b.ordered ? 'ol' : 'ul', { class: 'wissen__list' }, (b.items ?? []).map((i) => h('li', rich(i))));
    case 'callout': {
      const tone = TONE_ICON[b.tone] ? b.tone : 'info';
      return h('div', { class: `notice notice--${tone} wissen__callout`, role: 'note' }, h('span', { class: 'notice__icon' }, icon(TONE_ICON[tone], { size: 20 })), h('div', b.title ? h('p', h('strong', rich(b.title))) : null, h('p', rich(b.text))));
    }
    case 'table':
      return h(
        'div',
        { class: 'table-wrap wissen__table', tabindex: '0', role: 'region', 'aria-label': b.caption || 'Tabelle' },
        h('table', { class: 'table' }, b.caption ? h('caption', rich(b.caption)) : null, b.head ? h('thead', h('tr', b.head.map((c) => h('th', { scope: 'col' }, rich(c))))) : null, h('tbody', (b.rows ?? []).map((r) => h('tr', r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, rich(c)) : h('td', rich(c))))))))
      );
    case 'figure':
      return figure(b.id, b.caption ? rich(b.caption) : null);
    case 'typeatlas':
      return typeatlas(ctx);
    case 'steeltable':
      return steeltable(ctx);
    default:
      return null;
  }
}

function sourceList(ids, sources) {
  const items = ids.map((id) => sources[id]).filter(Boolean);
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'wissen__sources' },
    items.map((s) =>
      h('li', s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title) : h('span', s.title), s.publisher ? h('span', { class: 'muted' }, ` – ${s.publisher}`) : null, s.note ? h('span', { class: 'wissen__note muted' }, rich(s.note)) : null)
    )
  );
}

export async function render(ctx) {
  destroy();
  await loadCss(assetUrl('assets/css/views/wissen.css'));
  let content;
  try {
    content = await loadContent();
  } catch {
    return h('section', { class: 'container--narrow section' }, h('h1', 'Messerkunde'), h('div', { class: 'notice notice--bad', role: 'alert' }, 'Die Inhalte der Messerkunde konnten nicht geladen werden. Bitte lade die Seite neu.'));
  }
  const sections = content.sections ?? [];
  const sources = content.sources ?? {};
  const wanted = ctx.params?.section;
  const unknown = wanted && wanted !== 'glossar' && wanted !== 'quellen' && !sections.some((s) => s.id === wanted);
  const sid = (id) => `wissen-${id}`;

  const tocItems = [...sections.map((s) => ({ id: s.id, label: s.title })), { id: 'glossar', label: 'Glossar' }, { id: 'quellen', label: 'Quellen' }];

  const sectionNodes = sections.map((s) =>
    h(
      'section',
      { class: 'wissen__section', id: sid(s.id), 'aria-labelledby': `${sid(s.id)}-h` },
      s.kicker ? h('p', { class: 'eyebrow' }, s.kicker) : null,
      h('h2', { id: `${sid(s.id)}-h`, tabindex: '-1' }, s.title),
      s.summary ? h('p', { class: 'lede' }, rich(s.summary)) : null,
      h('div', { class: 'wissen__blocks' }, (s.blocks ?? []).map((b) => block(b, ctx))),
      s.sources?.length && sourceList(s.sources, sources) ? h('details', { class: 'disclosure wissen__src' }, h('summary', `Quellen zu diesem Abschnitt (${s.sources.filter((i) => sources[i]).length})`), h('div', { class: 'disclosure__body' }, sourceList(s.sources, sources))) : null
    )
  );

  const glossary = content.glossary?.length
    ? h(
        'section',
        { class: 'wissen__section', id: sid('glossar'), 'aria-labelledby': `${sid('glossar')}-h` },
        h('h2', { id: `${sid('glossar')}-h`, tabindex: '-1' }, 'Glossar'),
        h('dl', { class: 'wissen__glossary' }, content.glossary.map((g) => h('div', { class: 'wissen__term' }, h('dt', g.term, g.ja ? [' ', h('span', { lang: 'ja', class: 'wissen__ja' }, g.ja)] : null), h('dd', rich(g.text)))))
      )
    : null;

  // Gesamt-Quellenliste: gruppiert nach dem Abschnitt, der die Quelle zuerst nennt; Rest unter „Weitere“
  const seen = new Set();
  const groups = [];
  for (const s of sections) {
    const ids = (s.sources ?? []).filter((i) => sources[i] && !seen.has(i));
    ids.forEach((i) => seen.add(i));
    if (ids.length) groups.push([s.title, ids]);
  }
  const rest = Object.keys(sources).filter((i) => !seen.has(i));
  if (rest.length) groups.push(['Messertypen, Stähle und weitere Angaben', rest]);
  const allSources = h(
    'section',
    { class: 'wissen__section', id: sid('quellen'), 'aria-labelledby': `${sid('quellen')}-h` },
    h('h2', { id: `${sid('quellen')}-h`, tabindex: '-1' }, 'Quellen'),
    h('p', { class: 'muted' }, 'Alle Quellen der Messerkunde, nach Abschnitt gruppiert. Externe Links öffnen in einem neuen Tab.'),
    h('details', { class: 'disclosure' }, h('summary', `Alle Quellen anzeigen (${Object.keys(sources).length})`), h('div', { class: 'disclosure__body' }, groups.map(([name, ids]) => h('div', { class: 'wissen__srcgroup' }, h('h3', name), sourceList(ids, sources)))))
  );

  const tocLinks = tocItems.map((t) => h('a', { class: 'wissen__toclink', href: ctx.router.href(`/wissen/${t.id}`), dataset: { id: t.id } }, t.label));
  const toc = h('nav', { class: 'wissen__toc', 'aria-label': 'Inhalt der Messerkunde' }, h('p', { class: 'wissen__toc-title eyebrow' }, 'Inhalt'), h('div', { class: 'wissen__toclinks' }, tocLinks));

  const root = h(
    'div',
    { class: 'container wissen section' },
    h('header', { class: 'wissen__intro' }, h('h1', content.intro?.title ?? 'Messerkunde'), content.intro?.lede ? h('p', { class: 'lede' }, rich(content.intro.lede)) : null),
    unknown ? h('div', { class: 'notice notice--warn wissen__unknown', role: 'status' }, h('span', { class: 'notice__icon' }, icon('alert', { size: 20 })), h('p', `Den Abschnitt „${wanted}“ gibt es nicht. Hier ist die ganze Messerkunde.`)) : null,
    h('div', { class: 'wissen__layout' }, toc, h('div', { class: 'wissen__main' }, sectionNodes, glossary, allSources))
  );

  // Zu einem Abschnitt springen: scrollen + Fokus auf die Überschrift
  const goto = (id, smooth = false) => {
    const sec = root.querySelector(`#${sid(id)}`);
    if (!sec) return false;
    sec.scrollIntoView({ block: 'start', behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    sec.querySelector('h2')?.focus({ preventScroll: true });
    return true;
  };

  toc.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-id]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    history.pushState(history.state, '', a.getAttribute('href'));
    goto(a.dataset.id, true);
  });

  // Scroll-Spy
  const setActive = (id) => {
    for (const a of tocLinks) {
      const on = a.dataset.id === id;
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
      if (on && toc.scrollWidth > toc.clientWidth && getComputedStyle(toc.querySelector('.wissen__toclinks')).overflowX !== 'visible') {
        const box = a.parentElement;
        const left = a.offsetLeft - box.clientWidth / 2 + a.clientWidth / 2;
        box.scrollTo({ left, behavior: 'auto' });
      }
    }
  };
  let io = null;
  if ('IntersectionObserver' in window) {
    const visible = new Map();
    io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) visible.set(en.target.id, en.isIntersecting ? en.boundingClientRect.top : null);
        const cur = [...visible.entries()].filter(([, v]) => v != null).sort((a, b) => a[1] - b[1])[0];
        if (cur) setActive(cur[0].replace(/^wissen-/, ''));
      },
      { rootMargin: '-20% 0px -65% 0px' }
    );
    root.querySelectorAll('.wissen__section').forEach((n) => io.observe(n));
  }
  setActive(wanted && !unknown ? wanted : sections[0]?.id);
  cleanup = () => io?.disconnect();

  // Der Router scrollt nach dem Einhängen nach oben – danach zum Ziel springen
  if (wanted && !unknown) setTimeout(() => goto(wanted), 60);
  return root;
}
