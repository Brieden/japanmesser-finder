// Geführter Finder (#/finder): wenige Fragen zu EINER Person, danach eine ehrlich begründete Empfehlung.
//
//   #/finder                       → „Weitermachen / Neu starten“ (wenn Antworten gespeichert sind) oder erste Frage
//   #/finder?step=<id>             → Frage (person, einsatz, erfahrung, rost, pflege, hand, griff, groesse, budget, optik)
//   #/finder?step=ergebnis         → Ergebnis; optional avail=0 (auch nicht vorrätige), spec=1 (Spezialmesser zeigen)
//   …&for=<personId>               → Finder für eine Person der Liste (Antworten vorbelegt, Speichern aktualisiert ihr Profil)
//   …&edit=1                       → Antwort aus dem Ergebnis heraus ändern (danach zurück zum Ergebnis)
//
// Antworten liegen im store unter „finder“ (nur auf diesem Gerät). Die gesamte Logik steckt in lib/finder-engine.js.
import { h, mount, loadCss, assetUrl, rich } from '../dom.js';
import { icon } from '../icons.js';
import { shortlist } from '../shortlist.js';
import { num } from '../format.js';
import { productCard } from '../ui/card.js';
import { silhouette } from '../ui/silhouette.js';
import { shopNotice } from '../ui/shop-notice.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import {
  QUESTIONS,
  RESULT_STEP,
  emptyAnswers,
  normalizeAnswers,
  visibleSteps,
  isAnswered,
  isComplete,
  firstOpenStep,
  nextStep,
  prevStep,
  hasProgress,
  summarize,
  steelAdvice,
  matchKnives,
  catalogQuery,
  specialistHint,
  excludedTypes,
  stepNotes,
  explainEntries,
  whyText,
} from '../lib/finder-engine.js';

export const title = 'Finder';

const STORE_KEY = 'finder';
const PAGE = 8; // Treffer je „Mehr anzeigen“
const MAX_LIMIT = 40;

// Zuletzt gezeigter Schritt: Ist der vorige Schritt auch der Schritt davor, ist „Zurück“ das echte Browser-Zurück
// (so wächst die Verlaufsliste beim Hin-und-her nicht).
let lastStep = null;
let watchingLeave = false;

/** Verlässt jemand den Finder, ist „zuletzt gezeigter Schritt“ nicht mehr verlässlich. */
function watchLeave() {
  if (watchingLeave) return;
  watchingLeave = true;
  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#/finder')) lastStep = null;
  });
}

// ───────────────────────── Zustand (store) ─────────────────────────

function readState(store, data) {
  const raw = store.get(STORE_KEY, null);
  return {
    answers: normalizeAnswers(raw?.answers, data),
    personId: typeof raw?.personId === 'string' ? raw.personId : null,
    savedPersonId: typeof raw?.savedPersonId === 'string' ? raw.savedPersonId : null,
  };
}

const writeState = (store, state) => store.set(STORE_KEY, { answers: state.answers, personId: state.personId, savedPersonId: state.savedPersonId, updatedAt: Date.now() });

/** Neuer Durchlauf; für eine Person der Liste mit ihrem gespeicherten Profil vorbelegt. */
function freshState(person, data) {
  if (!person) return { answers: emptyAnswers(), personId: null, savedPersonId: null };
  const saved = person.profile?.answers ? normalizeAnswers(person.profile.answers, data) : emptyAnswers();
  return { answers: { ...saved, who: saved.who || person.name }, personId: person.id, savedPersonId: person.id };
}

// ───────────────────────── Kleine Bausteine ─────────────────────────

/** Hinweiskasten; tone: info | warn | bad | ok */
function note({ tone = 'info', title: heading, text, children }) {
  return h(
    'div',
    { class: ['notice', `notice--${tone}`] },
    h('span', { class: 'notice__icon' }, icon(tone === 'warn' || tone === 'bad' ? 'alert' : 'info', { size: 20 })),
    h('div', heading && h('p', h('strong', heading)), text && h('p', rich(text)), children)
  );
}

/** Taxonomie-Erklärungen als Definitionsliste (Rost-Stufen mit Punkt-Symbol, nie nur Farbe). */
function explainList(entries) {
  return h(
    'dl',
    { class: 'fexplain' },
    entries.flatMap((e) => [
      h('dt', e.group === 'rust' ? h('span', { class: ['rust', `rust--${e.id}`] }, e.label) : e.label),
      h('dd', rich(e.text), e.care && h('span', { class: 'fexplain__care' }, ` Pflege: ${e.care}`)),
    ])
  );
}

function disclosure(summary, ...body) {
  return h('details', { class: 'disclosure' }, h('summary', summary), h('div', { class: 'disclosure__body' }, body));
}

const checkList = (items, warn = new Set()) =>
  h(
    'ul',
    { class: 'fbullets' },
    items.map((text) => h('li', { class: ['fbullet', warn.has(text) ? 'fbullet--warn' : ''] }, icon(warn.has(text) ? 'alert' : 'check', { size: 18 }), h('span', rich(text))))
  );

// ───────────────────────── Einstieg ─────────────────────────

export async function render(ctx) {
  await loadCss(assetUrl('assets/css/views/finder.css'));
  watchLeave();
  const { data, router, store, query } = ctx;

  const forPerson = query.for ? shortlist.get(query.for) : null;
  const forId = forPerson?.id ?? null;
  const editing = query.edit === '1';
  const cameFrom = lastStep;

  let state = readState(store, data);
  const env = { ctx, data, router, store, forId, forPerson, editing, cameFrom, query, get state() { return state; }, set state(v) { state = v; } };

  // Tiefenlink mit Person, die nicht zum laufenden Durchlauf gehört: für diese Person neu beginnen
  if (forPerson && query.step && state.personId !== forId) {
    state = freshState(forPerson, data);
    writeState(store, state);
  }

  let step = query.step || null;
  if (!step) {
    if (hasProgress(state.answers)) {
      lastStep = null;
      return resumeView(env);
    }
    if (forPerson && state.personId !== forId) {
      state = freshState(forPerson, data);
      writeState(store, state);
    }
    step = QUESTIONS[0].id;
  }

  // Ungültige oder noch nicht erreichbare Schritte (z. B. Ergebnis ohne Pflichtantworten) → erste offene Frage
  const known = visibleSteps(state.answers);
  if (step === RESULT_STEP ? !isComplete(state.answers) : !known.includes(step)) step = firstOpenStep(state.answers);
  if (step === RESULT_STEP && !isComplete(state.answers)) step = QUESTIONS[0].id;
  const canonical = { step, for: forId, edit: editing ? 1 : null };
  if (step === RESULT_STEP) Object.assign(canonical, { avail: query.avail === '0' ? 0 : null, spec: query.spec === '1' ? 1 : null, edit: null });
  router.replaceQuery(canonical);

  lastStep = step;
  const node = step === RESULT_STEP ? renderResult(env) : renderStep(env, QUESTIONS.find((q) => q.id === step));
  // Innerhalb des Finders springt der Fokus zur Überschrift der neuen Frage (der Router fokussiert sonst nur <main>);
  // erst nach dem Router-Fokus, daher ein Tick Verzögerung.
  if (cameFrom || editing) setTimeout(() => node.querySelector('h1')?.focus({ preventScroll: true }), 0);
  return node;
}

/** Ziel-URL eines Schritts (mit Person und Bearbeitungsmodus). */
const stepHref = (env, step, { edit = false } = {}) => env.router.href('/finder', { step, for: env.forId, edit: edit ? 1 : null });

function resumeView(env) {
  const { data, router, store, forPerson } = env;
  const { answers } = env.state;
  const complete = isComplete(answers);
  const open = firstOpenStep(answers);
  const steps = visibleSteps(answers);
  const chips = summarize(answers, data);
  const restart = () => {
    const fresh = freshState(forPerson, data);
    writeState(store, fresh);
    router.navigate('/finder', { step: QUESTIONS[0].id, for: forPerson?.id });
  };
  return h(
    'section',
    { class: 'container--narrow section finder finder--resume' },
    h('p', { class: 'eyebrow' }, 'Finder'),
    h('h1', 'Weitermachen oder neu starten?'),
    h('p', { class: 'lede' }, complete ? 'Auf diesem Gerät sind vollständige Antworten gespeichert.' : `Auf diesem Gerät sind schon Antworten gespeichert (nächste Frage: ${steps.indexOf(open) + 1} von ${steps.length}).`),
    chips.length > 0 && h('ul', { class: 'fchips', 'aria-label': 'Gespeicherte Antworten' }, chips.map((c) => h('li', h('span', { class: 'chip fchip fchip--static' }, c.text)))),
    h(
      'div',
      { class: 'cluster fresume__actions' },
      h('a', { class: 'btn btn--primary', href: router.href('/finder', { step: open, for: forPerson?.id }) }, complete ? 'Ergebnis ansehen' : 'Weitermachen', icon('arrow-right', { size: 18 })),
      h('button', { class: 'btn', type: 'button', onClick: restart }, forPerson ? `Neu starten für ${forPerson.name}` : 'Neu starten')
    ),
    h('p', { class: 'muted small' }, 'Die Antworten bleiben nur auf diesem Gerät. „Neu starten“ löscht sie hier.')
  );
}

// ───────────────────────── Frage ─────────────────────────

function renderStep(env, q) {
  const { data, router, store, forId, editing, cameFrom } = env;
  const steps = visibleSteps(env.state.answers);
  const index = steps.indexOf(q.id);
  const draft = { ...env.state.answers, tasks: [...env.state.answers.tasks], looks: env.state.answers.looks ? [...env.state.answers.looks] : null };

  const go = (step, opts = {}) => router.navigate('/finder', { step, for: forId, edit: editing && step !== RESULT_STEP ? 1 : null }, opts);
  const commit = () => {
    env.state = { ...env.state, answers: normalizeAnswers(draft, data) };
    writeState(store, env.state);
  };

  // Hinweise: „top“ einmal beim Aufbau, die übrigen live unter den Antworten
  const liveNotes = h('div', { class: 'fq__notes stack', 'aria-live': 'polite' });
  const topNotes = h('div', { class: 'fq__notes stack' });
  const noteNode = (n) =>
    note({
      tone: n.tone,
      title: n.title,
      text: n.text,
      children: n.explain && disclosure('Was heißt das?', explainList(explainEntries({ explain: n.explain }, data))),
    });
  const paintNotes = () => {
    const all = stepNotes(q.id, normalizeAnswers(draft, data), data);
    mount(topNotes, all.filter((n) => n.position === 'top').map(noteNode));
    mount(liveNotes, all.filter((n) => n.position !== 'top').map(noteNode));
  };

  const error = h('p', { class: 'fq__error', role: 'alert', hidden: true });
  const clearError = () => {
    error.hidden = true;
  };

  const control = q.kind === 'text' ? textControl(q, draft, { onInput: () => { commit(); clearError(); } }) : choiceControl(q, draft, data, { onChange: () => { commit(); paintNotes(); clearError(); } });

  // Weiter: Pflichtfragen brauchen eine Antwort; leere optionale Mehrfachauswahl gilt als Standard
  const proceed = (event) => {
    event?.preventDefault();
    if (q.kind === 'text') draft.who = control.input.value;
    if (q.kind === 'multi' && !draft[q.key]?.length && q.default) draft[q.key] = [...q.default];
    commit();
    if (q.required && !isAnswered(q.id, env.state.answers)) {
      error.textContent = q.kind === 'multi' ? 'Bitte wähle mindestens eine Antwort aus.' : 'Bitte wähle eine Antwort aus.';
      error.hidden = false;
      (control.first ?? control.input)?.focus();
      return;
    }
    const after = env.state.answers;
    go(editing ? firstOpenStep(after) : nextStep(q.id, after));
  };

  const skip = () => {
    draft[q.key] = Array.isArray(q.default) ? [...q.default] : q.default ?? '';
    commit();
    go(nextStep(q.id, env.state.answers));
  };

  const back = () => {
    const prev = editing ? RESULT_STEP : prevStep(q.id, env.state.answers);
    if (!prev) return;
    if (cameFrom === prev && history.length > 1) history.back();
    else go(prev);
  };

  const canGoBack = editing || index > 0;
  const showSkip = q.skippable && q.kind !== 'text' && !editing;
  const defaultLabel = q.kind === 'single' ? q.options(data).find((o) => o.value === q.default)?.label : null;
  const last = index === steps.length - 1;
  const nextLabel = editing ? 'Übernehmen' : last ? 'Ergebnis anzeigen' : 'Weiter';

  const why = h(
    'details',
    { class: 'disclosure fq__why' },
    h('summary', q.whyTitle ?? 'Warum fragen wir?'),
    h('div', { class: 'disclosure__body' }, h('p', rich(whyText(q, data))), explainEntries(q, data).length > 0 && explainList(explainEntries(q, data)))
  );

  const form = h(
    'form',
    { class: 'fq', novalidate: true, onSubmit: proceed },
    topNotes,
    control.node,
    error,
    liveNotes,
    why,
    h(
      'div',
      { class: 'fbar' },
      canGoBack ? h('button', { class: 'btn btn--ghost', type: 'button', onClick: back }, icon('arrow-left', { size: 18 }), editing ? 'Zum Ergebnis' : 'Zurück') : h('span'),
      h(
        'div',
        { class: 'fbar__main' },
        showSkip && h('button', { class: 'btn btn--ghost', type: 'button', onClick: skip, title: defaultLabel ? `Es gilt: ${defaultLabel}` : undefined }, 'Überspringen'),
        h('button', { class: 'btn btn--primary', type: 'submit' }, nextLabel, icon(last && !editing ? 'check' : 'arrow-right', { size: 18 }))
      )
    )
  );
  paintNotes();

  return h(
    'section',
    { class: 'container--narrow section finder finder--step' },
    h(
      'div',
      { class: 'fhead' },
      h('p', { class: 'eyebrow' }, editing ? `Antwort ändern · Frage ${index + 1} von ${steps.length}` : `Finder · Frage ${index + 1} von ${steps.length}`),
      h(
        'div',
        { class: 'progress', role: 'progressbar', 'aria-label': 'Fortschritt im Finder', 'aria-valuemin': '1', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(index + 1), 'aria-valuetext': `Frage ${index + 1} von ${steps.length}`, style: { '--value': `${Math.round(((index + 1) / steps.length) * 100)}%` } },
        h('span')
      )
    ),
    form
  );
}

/** Freitext (Name der Person). */
function textControl(q, draft, { onInput }) {
  const input = h('input', { type: 'text', id: 'fq-who', name: q.key, maxlength: '60', autocomplete: 'off', placeholder: q.placeholder, value: draft.who ?? '', 'aria-describedby': 'fq-who-hint', onInput: (e) => { draft.who = e.target.value; onInput(); } });
  const node = h(
    'div',
    { class: 'fq__set' },
    h('h1', { class: 'fq__title', tabindex: '-1' }, q.title),
    q.lead && h('p', { class: 'fq__lead' }, q.lead),
    h('div', { class: 'fq__field' }, h('label', { for: 'fq-who' }, q.label), input, h('p', { id: 'fq-who-hint', class: 'muted small' }, q.hint))
  );
  return { node, input };
}

/** Radio-Gruppe oder Checkbox-Gruppe in einem <fieldset> (Legende = Frage). */
function choiceControl(q, draft, data, { onChange }) {
  const multi = q.kind === 'multi';
  const opts = q.options(data);
  const name = `fq-${q.key}`;
  const exclusiveValues = new Set(opts.filter((o) => o.exclusive).map((o) => o.value));
  const rows = [];
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const hint = h('p', { class: 'fq__max muted small', hidden: true });

  const selected = () => (multi ? draft[q.key] ?? [] : draft[q.key] ? [draft[q.key]] : []);

  // Zustand → Oberfläche: Häkchen, Rang-Marken („Haupteinsatz“), gesperrte Optionen bei Höchstzahl
  const sync = () => {
    const sel = selected();
    for (const { opt, input, tag } of rows) {
      input.checked = sel.includes(opt.value);
      const rank = multi && q.rankLabels ? sel.indexOf(opt.value) : -1;
      tag.hidden = rank < 0;
      tag.textContent = rank >= 0 ? q.rankLabels[Math.min(rank, q.rankLabels.length - 1)] : '';
      input.disabled = multi && q.max && !exclusiveValues.has(opt.value) && !sel.includes(opt.value) && sel.filter((v) => !exclusiveValues.has(v)).length >= q.max;
    }
    const atMax = multi && q.max && sel.length >= q.max && opts.length > q.max + 1;
    hint.hidden = !atMax;
    hint.textContent = atMax ? `Höchstens ${q.max} Antworten. Entferne eine, um eine andere zu wählen.` : '';
    if (multi && q.rankLabels) {
      live.textContent = sel.length ? sel.map((v, i) => `${q.rankLabels[Math.min(i, q.rankLabels.length - 1)]}: ${opts.find((o) => o.value === v)?.label}`).join('. ') : 'Keine Auswahl.';
    }
  };

  const change = (opt, checked) => {
    if (!multi) draft[q.key] = opt.value;
    else {
      let sel = (draft[q.key] ?? []).filter((v) => v !== opt.value);
      if (checked) sel = exclusiveValues.has(opt.value) ? [opt.value] : [...sel.filter((v) => !exclusiveValues.has(v)), opt.value];
      draft[q.key] = sel;
    }
    sync();
    onChange();
  };

  const nodes = opts.map((opt) => {
    const input = h('input', { type: multi ? 'checkbox' : 'radio', name, value: opt.value, onChange: (e) => change(opt, e.target.checked) });
    const tag = h('span', { class: 'chip chip--info fopt__tag', hidden: true });
    rows.push({ opt, input, tag });
    return h('label', { class: ['choice', 'fopt'] }, input, h('span', { class: 'choice__text' }, h('span', { class: 'fopt__label' }, opt.label, tag), opt.sub && h('span', { class: 'choice__sub' }, opt.sub)));
  });
  sync();

  const wide = opts.length >= 5 || opts.length === 2; // viele oder sehr kurze Optionen: zwei Spalten ab Tablet-Breite
  const node = h(
    'fieldset',
    { class: 'fq__set' },
    h('legend', { class: 'fq__legend' }, h('h1', { class: 'fq__title', tabindex: '-1' }, q.title)),
    q.lead && h('p', { class: 'fq__lead' }, q.lead),
    h('div', { class: ['choices', 'fopts', wide ? 'fopts--grid' : ''] }, nodes),
    hint,
    live
  );
  return { node, first: rows[0]?.input, input: rows[0]?.input };
}

// ───────────────────────── Ergebnis ─────────────────────────

function renderResult(env) {
  const { data, router, store, forId, forPerson, query } = env;
  const answers = env.state.answers;
  let limit = PAGE;
  let onlyAvailable = query.avail !== '0';
  let includeSpecialists = query.spec === '1';

  const chips = summarize(answers, data);
  const hint = specialistHint(answers, data);
  const advice = steelAdvice(answers, data);
  const homeCount = data.knives.filter((k) => k.segment === 'home').length;

  const syncUrl = () => router.replaceQuery({ step: RESULT_STEP, for: forId, avail: onlyAvailable ? null : 0, spec: includeSpecialists ? 1 : null });

  // ── Kopf mit Profil-Chips ──
  const head = h(
    'section',
    { class: 'container fres-head' },
    h('p', { class: 'eyebrow' }, 'Dein Ergebnis'),
    h('h1', { tabindex: '-1' }, answers.who ? `Empfehlung für ${answers.who}` : 'Deine Empfehlung'),
    h('p', { class: 'lede' }, `Aus ${num(homeCount)} Haushalts- und Hobbymessern im Katalog – nach deinen Angaben und mit Begründung. Preise und Bestand laut Online-Katalog.`),
    h(
      'ul',
      { class: 'fchips', 'aria-label': 'Deine Angaben' },
      chips.map((c) =>
        h(
          'li',
          c.step
            ? h('a', { class: 'chip fchip', href: stepHref(env, c.step, { edit: true }), 'aria-label': `${c.text}. Antwort ändern` }, c.text)
            : h('span', { class: 'chip fchip fchip--static', title: 'Wird aus deinen anderen Antworten abgeleitet' }, c.text)
        )
      )
    ),
    h('p', { class: 'muted small' }, 'Tippe auf eine Angabe, um sie zu ändern.')
  );

  // ── Hinweis „Spezialmesser“ (Schalter bleibt an Ort und Stelle, nur sein Zustand ändert sich) ──
  let hintSection = null;
  let hintButton = null;
  const paintHintButton = () => {
    if (!hintButton) return;
    hintButton.setAttribute('aria-pressed', String(includeSpecialists));
    hintButton.replaceChildren(icon(includeSpecialists ? 'check' : 'plus', { size: 16 }), includeSpecialists ? `${hint.toggleLabel.replace('Trotzdem ', '').replace(' zeigen', '')} werden gezeigt – wieder ausblenden` : hint.toggleLabel);
  };
  if (hint.show) {
    hintButton = h('button', { class: 'btn btn--sm', type: 'button', onClick: () => { includeSpecialists = !includeSpecialists; limit = PAGE; syncUrl(); paintHintButton(); paint(); } });
    hintSection = note({ tone: 'info', title: hint.title, text: hint.text, children: h('p', hintButton) });
    paintHintButton();
  }

  // ── Dynamische Bereiche ──
  const typesHost = h('div', { class: 'ftypes-host' });
  const matchesHost = h('div', { class: 'fmatches-host' });
  const catalogLink = h('a', { class: 'btn btn--primary' }, icon('search', { size: 18 }), 'Im Katalog verfeinern');

  const typeCard = (rec, i) => {
    const e = data.entry('types', rec.typeId) ?? {};
    const name = data.t('types', rec.typeId);
    return h(
      'article',
      { class: 'card ftype' },
      h('div', { class: 'ftype__sil' }, silhouette(rec.typeId, { width: 260 })),
      h(
        'div',
        { class: 'card__body' },
        h('p', { class: 'eyebrow ftype__rank' }, i === 0 ? 'Hauptempfehlung' : 'Auch passend'),
        h('h3', { class: 'card__title' }, name, e.kanji && h('span', { class: 'ftype__ja', lang: 'ja' }, ` ${e.kanji}`)),
        e.gloss && h('p', { class: 'ftype__gloss muted' }, e.gloss),
        e.summary && h('p', { class: 'ftype__summary' }, rich(e.summary)),
        rec.reasons.length > 0 && h('ul', { class: 'pcard__reasons' }, rec.reasons.map((t) => h('li', { class: 'pcard__reason' }, icon('check', { size: 16 }), h('span', t)))),
        rec.warnings.length > 0 && h('ul', { class: 'pcard__warnings' }, rec.warnings.map((t) => h('li', { class: 'pcard__warning' }, icon('alert', { size: 16 }), h('span', t)))),
        e.avoid && h('p', { class: 'muted small' }, h('strong', 'Weniger geeignet für: '), e.avoid),
        h('p', { class: 'muted small' }, `Nach deinen Vorgaben zu Rost und Händigkeit: ${num(rec.count)} Artikel, ${num(rec.availableCount)} laut Katalog vorrätig`),
        h('a', { class: 'ftype__link', href: '#/wissen/typen', 'aria-label': `Mehr zu ${name} in der Messerkunde` }, 'Mehr in der Messerkunde', icon('arrow-right', { size: 16 }))
      )
    );
  };

  const changeLink = (step, text) => h('a', { href: stepHref(env, step, { edit: true }) }, text);

  const noTypes = () => {
    const excluded = excludedTypes(answers, data);
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'empty__mark', lang: 'ja', 'aria-hidden': 'true' }, '刃'),
      h('h3', 'Dazu gibt es im Katalog keinen passenden Messertyp'),
      excluded.map((x) => h('p', x.text)),
      h('p', 'Rost- und Händigkeitsregel lockern wir nie. Du kannst aber eine Angabe ändern:'),
      h('p', changeLink('einsatz', 'Einsatz'), ' · ', changeLink('hand', 'Händigkeit'), ' · ', changeLink('erfahrung', 'Erfahrung'), ' · ', changeLink('pflege', 'Pflege'))
    );
  };

  const matchesNode = (result) => {
    const { items, total, relaxed, tried } = result;
    const parts = [];
    parts.push(
      h(
        'div',
        { class: 'fcontrols' },
        h('p', { class: 'fcontrols__count', 'aria-live': 'polite' }, items.length ? `${items.length} von ${num(total)} passenden Messern${onlyAvailable ? ', laut Katalog vorrätig' : ''}` : 'Keine passenden Messer gefunden'),
        h(
          'label',
          { class: 'fswitch' },
          h('input', { type: 'checkbox', role: 'switch', checked: onlyAvailable, onChange: (e) => { onlyAvailable = e.target.checked; limit = PAGE; syncUrl(); paint(); matchesHost.querySelector('.fswitch input')?.focus(); } }),
          h('span', 'Nur laut Katalog vorrätig')
        )
      )
    );
    if (onlyAvailable && result.totalWithUnavailable > total && items.length) {
      parts.push(h('p', { class: 'muted small' }, `${num(result.totalWithUnavailable - total)} weitere passende ${result.totalWithUnavailable - total === 1 ? 'Messer ist' : 'Messer sind'} laut Katalog nicht vorrätig.`));
    }
    if (relaxed.length) {
      parts.push(note({ tone: 'info', title: 'Zu wenige Treffer – darum haben wir gelockert:', children: [h('ul', relaxed.map((t) => h('li', t))), h('p', 'Rostfrei-Wahl und Händigkeit lockern wir nie.')] }));
    }
    if (!items.length) {
      const hidden = onlyAvailable ? result.totalWithUnavailable : 0;
      parts.push(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty__mark', lang: 'ja', 'aria-hidden': 'true' }, '刃'),
          h('h3', 'Dazu gibt es laut Katalog gerade nichts Passendes'),
          tried.length > 0 && h('p', `Auch nach dem Lockern von ${tried.map((t) => t.split(':')[0]).join(', ')} bleibt nichts übrig.`),
          hidden > 0 && h('p', `${num(hidden)} passende ${hidden === 1 ? 'Messer ist' : 'Messer sind'} laut Katalog nicht vorrätig.`),
          hidden > 0 && h('button', { class: 'btn', type: 'button', onClick: () => { onlyAvailable = false; syncUrl(); paint(); matchesHost.querySelector('.fswitch input')?.focus(); } }, 'Auch nicht vorrätige zeigen'),
          h('p', changeLink('budget', 'Budget'), ' · ', changeLink('hand', 'Händigkeit'), ' · ', changeLink('einsatz', 'Einsatz'), ' · ', changeLink('rost', 'Rostfrei'))
        )
      );
    } else {
      const top = [...new Set(items.map((x) => x.item.handle))].slice(0, 4);
      if (top.length >= 2) {
        parts.push(h('p', { class: 'fcompare' }, h('a', { class: 'btn', href: `#/vergleich?m=${top.map(encodeURIComponent).join(',')}` }, icon('check', { size: 18 }), `Die ersten ${top.length} Treffer vergleichen`), h('span', { class: 'muted small' }, ' Sterne und Eckdaten nebeneinander')));
      }
      parts.push(h('div', { class: 'grid fgrid', style: { '--grid-min': '19rem' } }, items.map((x) => productCard(x.item, { data, reasons: x.reasons, warnings: x.warnings, sizeIndex: x.sizeIndex }))));
      if (total > items.length && limit < MAX_LIMIT) {
        parts.push(
          h(
            'p',
            { class: 'fmore' },
            h('button', { class: 'btn', type: 'button', onClick: () => { const before = items.length; limit = Math.min(MAX_LIMIT, limit + PAGE); paint(); matchesHost.querySelectorAll('.pcard')[before]?.querySelector('.pcard__title a')?.focus(); } }, `Mehr Treffer anzeigen (${items.length} von ${num(total)})`)
          )
        );
      } else if (total > items.length) {
        parts.push(h('p', { class: 'muted' }, 'Für alle weiteren Treffer: Im Katalog verfeinern.'));
      }
    }
    return parts;
  };

  function paint() {
    const result = matchKnives(answers, data, { limit, onlyAvailable, includeSpecialists });
    mount(typesHost, result.typeRecs.length ? h('div', { class: 'ftypes' }, result.typeRecs.map(typeCard)) : noTypes());
    mount(matchesHost, matchesNode(result));
    const q = { ...catalogQuery(answers, data, { includeSpecialists }) };
    if (!onlyAvailable) delete q.avail;
    catalogLink.setAttribute('href', router.href('/katalog', q));
  }
  paint();

  // ── Stahl und Pflege ──
  const warnSet = new Set(advice.warnings);
  const steel = h(
    'section',
    { class: 'container section--tight', 'aria-labelledby': 'fr-steel' },
    h('h2', { id: 'fr-steel' }, 'Stahl und Pflege'),
    h(
      'div',
      { class: 'card fsteel' },
      h(
        'div',
        { class: 'card__body' },
        h('h3', { class: 'card__title' }, advice.headline),
        checkList(advice.bullets, warnSet),
        disclosure(
          'Was heißt komplett, teilweise oder nicht rostfrei?',
          h(
            'ul',
            { class: 'ftiers' },
            advice.tiers.map((t) =>
              h(
                'li',
                { class: 'ftier' },
                h('p', { class: 'ftier__head' }, h('span', { class: ['rust', `rust--${t.id}`] }, t.label), h('span', { class: ['chip', t.allowed ? 'chip--ok' : 'chip--outline'] }, t.allowed ? 'In deinen Treffern' : 'Nicht in deinen Treffern')),
                t.explain && h('p', rich(t.explain)),
                t.care && h('p', { class: 'muted' }, `Pflege: ${t.care}`)
              )
            )
          )
        )
      )
    )
  );

  // ── Speichern, nächste Person ──
  const saveHost = h('div', { class: 'fsave' });
  const savedPerson = () => [env.state.savedPersonId, forId].map((id) => (id ? shortlist.get(id) : null)).find(Boolean) ?? null;
  const saveProfile = () => {
    const profile = { answers, summary: summarize(answers, data) };
    const existing = savedPerson();
    if (existing) {
      shortlist.setProfile(existing.id, profile);
      shortlist.setActive(existing.id);
      toast(`Profil von ${existing.name} aktualisiert.`);
    } else {
      const person = shortlist.add({ name: answers.who, profile });
      env.state = { ...env.state, savedPersonId: person.id };
      writeState(store, env.state);
      toast(`Für ${person.name} gespeichert. Die Liste findest du oben unter „Liste“.`);
    }
    paintSave();
    return true;
  };
  function paintSave() {
    const existing = savedPerson();
    mount(
      saveHost,
      h('button', { class: 'btn', type: 'button', onClick: saveProfile }, icon('bookmark', { size: 18 }), existing ? `Profil von ${existing.name} aktualisieren` : answers.who ? `Für ${answers.who} speichern` : 'Für diese Person speichern'),
      existing && h('a', { class: 'btn btn--ghost', href: '#/liste' }, 'Zur Liste', icon('arrow-right', { size: 18 }))
    );
  }
  paintSave();

  const startNext = () => {
    env.state = { answers: emptyAnswers(), personId: null, savedPersonId: null };
    writeState(store, env.state);
    router.navigate('/finder', { step: QUESTIONS[0].id });
  };
  const nextPerson = () => {
    if (savedPerson()) return startNext();
    const name = answers.who;
    const body = h(
      'div',
      { class: 'stack' },
      h('p', `Die Antworten${name ? ` für ${name}` : ''} sind noch nicht gespeichert. Wenn du jetzt zur nächsten Person gehst, gehen sie verloren.`),
      h(
        'div',
        { class: 'cluster' },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => { dlg.close(); saveProfile(); startNext(); } }, 'Speichern und weiter'),
        h('button', { class: 'btn', type: 'button', onClick: () => { dlg.close(); startNext(); } }, 'Verwerfen und weiter'),
        h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => dlg.close() }, 'Abbrechen')
      )
    );
    const dlg = openDialog({ title: 'Antworten speichern?', body });
  };

  return h(
    'div',
    { class: 'finder finder--result' },
    head,
    h('section', { class: 'container section--tight', 'aria-labelledby': 'fr-types' }, h('h2', { id: 'fr-types' }, 'Das passt zu …'), hintSection, typesHost),
    steel,
    h('section', { class: 'container section--tight', 'aria-labelledby': 'fr-matches' }, h('h2', { id: 'fr-matches' }, 'Passende Messer im Katalog'), matchesHost),
    h(
      'section',
      { class: 'container section--tight', 'aria-label': 'Wie geht es weiter?' },
      h('div', { class: 'cluster fres-actions' }, catalogLink, saveHost, h('button', { class: 'btn btn--ghost', type: 'button', onClick: nextPerson }, icon('users', { size: 18 }), 'Nächste Person')),
      h('p', { class: 'muted small' }, forPerson ? `Der Finder läuft für ${forPerson.name} aus deiner Liste.` : 'Zum Vergleichen: Vormerken geht direkt an jeder Karte („Merken“).')
    ),
    h('section', { class: 'container section--tight' }, shopNotice(data, { compact: true }))
  );
}
