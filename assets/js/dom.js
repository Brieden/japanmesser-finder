// DOM-Helfer: Elemente bauen ohne innerHTML (kein XSS-Risiko), Mini-Markup für Inhalte, CSS nachladen.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'defs', 'use', 'symbol', 'text', 'title', 'clipPath', 'mask', 'linearGradient', 'stop']);
const PROP_KEYS = new Set(['value', 'checked', 'selected', 'indeterminate']);

/**
 * h('div', { class: 'card', onClick: fn, dataset: { id: 1 } }, 'Text', childNode, [weitere])
 * - props.class: string | string[]
 * - props.style: string | object (Custom Properties mit '--x' erlaubt)
 * - props.on<Event>: Event-Handler (onClick, onInput, …)
 * - null/false/undefined werden ignoriert; true setzt ein leeres Attribut
 */
export function h(tag, props, ...children) {
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) applyProp(el, key, value);
  appendChildren(el, children);
  return el;
}

function applyProp(el, key, value) {
  if (value == null || value === false) return;
  if (key === 'class' || key === 'className') {
    el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value));
  } else if (key === 'style' && typeof value === 'object') {
    for (const [prop, v] of Object.entries(value)) {
      if (v == null) continue;
      if (prop.startsWith('--')) el.style.setProperty(prop, String(v));
      else el.style[prop] = v;
    }
  } else if (key === 'dataset') {
    Object.assign(el.dataset, value);
  } else if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
    el.addEventListener(key.slice(2).toLowerCase(), value);
  } else if (PROP_KEYS.has(key)) {
    el[key] = value;
  } else if (value === true) {
    el.setAttribute(key, '');
  } else {
    el.setAttribute(key, String(value));
  }
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Ersetzt den Inhalt eines Containers. */
export const mount = (container, ...nodes) => {
  container.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
  return container;
};

const CJK = /[　-ヿ㐀-鿿＀-￯]+/g;

/** Text → Fragment; japanische Zeichen werden mit lang="ja" ausgezeichnet. */
export function withJa(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of String(text).matchAll(CJK)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(h('span', { lang: 'ja' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;
const SAFE_URL = /^(https?:\/\/|#\/|\.{0,2}\/|mailto:)/i;

/**
 * Mini-Markup für Inhalte (kein HTML!):  **fett**, *kursiv*, [Text](https://…), Zeilenumbruch \n.
 * Japanische Zeichen bekommen automatisch lang="ja".
 */
export function rich(text) {
  const frag = document.createDocumentFragment();
  String(text ?? '')
    .split('\n')
    .forEach((line, i) => {
      if (i > 0) frag.append(h('br'));
      let last = 0;
      for (const m of line.matchAll(INLINE)) {
        if (m.index > last) frag.append(withJa(line.slice(last, m.index)));
        const token = m[0];
        if (token.startsWith('**')) frag.append(h('strong', withJa(token.slice(2, -2))));
        else if (token.startsWith('*')) frag.append(h('em', withJa(token.slice(1, -1))));
        else {
          const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
          if (link && SAFE_URL.test(link[2])) {
            const external = /^https?:/i.test(link[2]);
            frag.append(h('a', { href: link[2], ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, withJa(link[1])));
          } else frag.append(token);
        }
        last = m.index + token.length;
      }
      if (last < line.length) frag.append(withJa(line.slice(last)));
    });
  return frag;
}

const loadedCss = new Map();

/** Lädt ein Stylesheet genau einmal; löst auf, sobald geladen (spätestens nach 2 s). */
export function loadCss(href) {
  if (loadedCss.has(href)) return loadedCss.get(href);
  const promise = new Promise((resolve) => {
    const link = h('link', { rel: 'stylesheet', href });
    const done = () => resolve();
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    setTimeout(done, 2000);
    document.head.appendChild(link);
  });
  loadedCss.set(href, promise);
  return promise;
}

/** Relative URL zu einer Datei im Projektroot (funktioniert auch unter /repo-name/ auf GitHub Pages). */
export const assetUrl = (path) => new URL(path.replace(/^\//, ''), new URL('../../', import.meta.url)).href;
