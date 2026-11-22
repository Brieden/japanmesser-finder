// Quellenangaben nachladen: Die Messerkunde-Inhalte (content/wissen.json) liefern Titel und Link zu den Quellen-IDs.
import { h } from '../dom.js';
import { loadWissen } from '../content.js';

const newTab = () => h('span', { class: 'visually-hidden' }, ' (öffnet in neuem Tab)');

/** [' Quelle: ', Link, ', ', Link …] als flache Liste (replaceChildren() wandelt verschachtelte Arrays in Text um). */
export function sourceNodes(ids, sources) {
  const list = ids.map((id) => sources?.[id]).filter(Boolean);
  if (!list.length) return [];
  return [' Quelle: ', ...list.flatMap((s, i) => [i ? ', ' : '', s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.title }, s.publisher ?? s.title, newTab()) : (s.publisher ?? s.title)])];
}

/** slots: [[Element, [Quellen-IDs]], …]. Ohne Quellenliste bleiben die Elemente leer; die Aussagen bleiben lesbar. */
export function fillSources(slots) {
  loadWissen()
    .then((content) => {
      for (const [slot, ids] of slots) slot.replaceChildren(...sourceNodes(ids, content.sources));
    })
    .catch(() => {});
}
