// Reine Logik des geführten Finders – ohne DOM, in Node testbar (tests/finder.test.mjs).
//
//   QUESTIONS, visibleSteps(answers), emptyAnswers(), normalizeAnswers(answers, data?)
//   isAnswered / isComplete / firstOpenStep / nextStep / prevStep   (Ablaufsteuerung der Ansicht)
//   summarize(answers, data)                      → Chips [{ id, step, label, value, text }]
//   recommendTypes(answers, data, opts?)          → [{ typeId, score, reasons[], warnings[], count, availableCount }] (max. 3)
//   steelAdvice(answers, data)                    → { rustAllowed[], headline, bullets[], warnings[], tiers[] }
//   matchKnives(answers, data, opts?)             → { items:[{ item, sizeIndex, score, reasons[], warnings[] }], relaxed[], total, typeRecs,
//                                                     tried[] (versuchte Lockerungen), totalWithUnavailable }
//   excludedTypes(answers, data)                  → Typen, die nur wegen Rost-/Händigkeitsregel fehlen (mit Begründungstext)
//   catalogQuery(answers, data, opts?)            → Query für #/katalog { type, rust, grip, hand, price, len, avail }
//   specialistHint(answers, data)                 → Hinweiskarte „Spezialmesser, anspruchsvoll“ (z. B. Sashimi) für Nicht-Experten
//   stepNotes(stepId, answers, data)              → Hinweise zu einem Schritt (Linkshänder, Spülmaschine, …)
//
// Grundsätze: Eingaben werden nie verändert; fehlende Taxonomie-Felder führen zu Rückfallwerten, nie zu Fehlern.
// Rost- und Händigkeitsregeln sind harte Ausschlüsse und werden nie gelockert; Optik, Griff, Budget und Länge schon
// (und das wird in `relaxed` benannt). Aussagen in reasons/warnings stützen sich auf Katalog- und Taxonomiedaten.

import { jpy, convert, cmText } from '../format.js';

export const RESULT_STEP = 'ergebnis';
export const MAX_TASKS = 2;

// ───────────────────────── Konstanten ─────────────────────────

const ENUMS = {
  level: ['beginner', 'hobby', 'expert'],
  rust: ['full', 'clad', 'any'],
  care: ['careful', 'service', 'rough'],
  hand: ['right', 'left'],
  grip: ['wa', 'yo', 'any'],
  size: ['small', 'standard', 'large'],
  budget: ['lt15', '15-30', '30-60', 'gt60', 'open'],
};
const LOOKS = ['plain', 'damascus', 'hammered', 'rustic', 'any'];

/** Budgetbänder je Messer in Yen (Obergrenze mit Toleranz, siehe BUDGET_TOLERANCE). */
export const BUDGETS = {
  lt15: { min: 0, max: 15000 },
  '15-30': { min: 15000, max: 30000 },
  '30-60': { min: 30000, max: 60000 },
  gt60: { min: 60000, max: Infinity },
  open: { min: 0, max: Infinity },
};
const BUDGET_TOLERANCE = 1.1; // immer erlaubt, wird als „leicht über dem Budget“ gekennzeichnet
const BUDGET_RELAXED = 1.25; // Lockerungsstufe „Budget +25 %“

const SECOND_TASK_WEIGHT = 0.45; // zweite Aufgabe zählt schwächer als die erste
const TYPE_CUTOFF = 0.5; // weitere Typen nur ab 50 % des besten Typ-Scores
const MAX_TYPES = 3;
const MIN_HITS = 4; // darunter wird schrittweise gelockert

const FALLBACK_TASKS = {
  allround: { label: 'Alles Mögliche im Alltag', hint: 'Ein Messer für Gemüse, Fleisch und Fisch.' },
  gemuese: { label: 'Vor allem Gemüse und Kräuter', hint: 'Viel Schneiden auf dem Brett.' },
  fleisch: { label: 'Fleisch, auch Braten aufschneiden', hint: 'Parieren, portionieren, tranchieren.' },
  gefluegel: { label: 'Geflügel zerlegen, Fleisch auslösen', hint: 'Um Knochen herum arbeiten.' },
  fisch: { label: 'Fisch und Sashimi', hint: 'Filetieren oder Sashimi schneiden.' },
  brot: { label: 'Brot', hint: 'Laib und Brötchen.' },
  obst: { label: 'Obst und kleine Handarbeit', hint: 'Schälen, Putzen, Kleinkram.' },
};

const WATERPROOF_MATERIALS = new Set(['steel', 'plastic', 'resin', 'micarta']);
const SYMMETRIC_SHAPES = new Set(['octagonal', 'oval', 'round']);

// ───────────────────────── Zugriff auf Taxonomie/Katalog ─────────────────────────

const entryOf = (data, group, id) => (data?.entry ? data.entry(group, id) : data?.taxonomy?.[group]?.[id]) ?? null;
const labelOf = (data, group, id, fallback) => entryOf(data, group, id)?.label ?? fallback ?? String(id ?? '');
const shortOf = (data, group, id, fallback) => entryOf(data, group, id)?.short ?? entryOf(data, group, id)?.label ?? fallback ?? String(id ?? '');
const tasksOf = (data) => (data?.taxonomy?.tasks && Object.keys(data.taxonomy.tasks).length ? data.taxonomy.tasks : FALLBACK_TASKS);
const taskLabel = (data, key) => tasksOf(data)[key]?.label ?? key;
const rateEur = (data) => data?.rates?.EUR ?? data?.site?.rates?.perUnit?.EUR ?? null;

const caches = new WeakMap();

/** Je data-Objekt einmal aufgebaut: Haushalts-Messer, Gruppierung nach Typ, Typ-Metadaten. */
function index(data) {
  let ix = caches.get(data);
  if (ix) return ix;
  const source = data?.knives ?? data?.items ?? [];
  const home = source.filter((k) => k.category === 'knife' && k.segment === 'home');
  const byType = new Map();
  for (const k of home) {
    if (!k.type) continue;
    if (!byType.has(k.type)) byType.set(k.type, []);
    byType.get(k.type).push(k);
  }
  ix = { home, byType, meta: new Map(), meanMm: new Map() };
  caches.set(data, ix);
  return ix;
}

/**
 * Typ-Metadaten mit Rückfallwerten (fehlendes level → 2). „Spezialmesser“ gilt nur nach Taxonomie (level ≥ 3 oder bevel „single“):
 * Wie viele Artikel eines Typs im Katalog einseitig geschliffen sind, ändert den Typ nicht (z. B. Brotmesser, Honesuki).
 */
function typeMeta(typeId, data) {
  const ix = index(data);
  if (ix.meta.has(typeId)) return ix.meta.get(typeId);
  const entry = entryOf(data, 'types', typeId) ?? {};
  const level = Number.isFinite(entry.level) ? entry.level : 2;
  const bevel = entry.bevel === 'single' || entry.bevel === 'double' ? entry.bevel : null;
  const tasks = entry.tasks && typeof entry.tasks === 'object' ? entry.tasks : null;
  const typical = Array.isArray(entry.typicalMm) && entry.typicalMm.length && entry.typicalMm.every(Number.isFinite) ? [Math.min(...entry.typicalMm), Math.max(...entry.typicalMm)] : null;
  const meta = { id: typeId, entry, level, bevel, tasks, typical, specialist: level >= 3 || bevel === 'single' };
  ix.meta.set(typeId, meta);
  return meta;
}

/** Mittelwert der Katalog-Größen eines Typs (Rückfall, wenn typicalMm fehlt). */
function catalogMeanMm(typeId, data) {
  const ix = index(data);
  if (ix.meanMm.has(typeId)) return ix.meanMm.get(typeId);
  const mms = (ix.byType.get(typeId) ?? []).flatMap((i) => i.sizes.map((s) => (s.mm == null ? null : s.mmMax ? (s.mm + s.mmMax) / 2 : s.mm))).filter((v) => v != null);
  const mean = mms.length ? mms.reduce((a, b) => a + b, 0) / mms.length : null;
  ix.meanMm.set(typeId, mean);
  return mean;
}

// ───────────────────────── Antworten ─────────────────────────

export const emptyAnswers = () => ({ who: '', tasks: [], level: null, rust: null, care: null, hand: null, grip: null, size: null, budget: null, looks: null });

/** Bereinigt beliebige (z. B. gespeicherte) Eingaben auf ein gültiges Antwortobjekt. Mit `data` werden Aufgaben-Schlüssel geprüft. */
export function normalizeAnswers(raw, data = null) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = emptyAnswers();
  out.who = typeof src.who === 'string' ? src.who.trim().slice(0, 60) : '';
  const validTasks = data?.taxonomy?.tasks ? Object.keys(data.taxonomy.tasks) : null;
  out.tasks = [...new Set(Array.isArray(src.tasks) ? src.tasks : [])].filter((t) => typeof t === 'string' && (!validTasks || validTasks.includes(t))).slice(0, MAX_TASKS);
  for (const [key, allowed] of Object.entries(ENUMS)) out[key] = allowed.includes(src[key]) ? src[key] : null;
  if (Array.isArray(src.looks)) {
    const looks = [...new Set(src.looks)].filter((v) => LOOKS.includes(v));
    out.looks = looks.length ? (looks.includes('any') ? ['any'] : looks) : null;
  }
  return out;
}

/** Normalisiert und füllt optionale Fragen mit Standardwerten (Griff egal, normale Größe, offenes Budget, Optik egal). */
function prep(raw, data) {
  const a = normalizeAnswers(raw, data);
  if (!a.tasks.length) a.tasks = ['allround'];
  a.grip ??= 'any';
  a.size ??= 'standard';
  a.budget ??= 'open';
  a.looks ??= ['any'];
  return a;
}

/** Welche Rost-Stufen kommen in Frage? Pflege „rough“ und alle Nicht-Experten: nur komplett rostfrei. */
export function rustAllowed(answers) {
  const a = normalizeAnswers(answers);
  if (a.care === 'rough' || a.level !== 'expert') return ['full'];
  if (a.rust === 'clad') return ['full', 'clad'];
  if (a.rust === 'any') return ['full', 'clad', 'none'];
  return ['full'];
}

// ───────────────────────── Fragen ─────────────────────────

const rustCare = (data, id, fallback) => entryOf(data, 'rust', id)?.care ?? fallback;

function taskOptions(data) {
  return Object.entries(tasksOf(data)).map(([value, t]) => ({ value, label: t.label ?? value, sub: t.hint }));
}

function budgetEuro(data, jpyAmount) {
  const rate = rateEur(data);
  const eur = rate ? convert(jpyAmount, 'EUR', { EUR: rate }) : null;
  return eur == null ? null : Math.round(eur);
}
const euroText = (n) => (n == null ? '' : `${n.toLocaleString('de-DE')} €`);

function budgetOptions(data) {
  const e15 = budgetEuro(data, 15000);
  const e30 = budgetEuro(data, 30000);
  const e60 = budgetEuro(data, 60000);
  return [
    { value: 'lt15', label: 'Bis ¥15.000', sub: e15 != null ? `≈ ${euroText(e15)}` : '' },
    { value: '15-30', label: '¥15.000 bis ¥30.000', sub: e15 != null ? `≈ ${e15.toLocaleString('de-DE')} bis ${euroText(e30)}` : '' },
    { value: '30-60', label: '¥30.000 bis ¥60.000', sub: e30 != null ? `≈ ${e30.toLocaleString('de-DE')} bis ${euroText(e60)}` : '' },
    { value: 'gt60', label: 'Über ¥60.000', sub: e60 != null ? `ab etwa ${euroText(e60)}` : '' },
    { value: 'open', label: 'Budget offen', sub: 'Der Preis ist kein Auswahlkriterium.' },
  ];
}

function sizeOptions(data) {
  const typ = entryOf(data, 'types', 'gyuto')?.typicalMm;
  const example = Array.isArray(typ) && typ.length === 2 ? ` Beim Gyuto sind das etwa ${cmText(typ[0])} bis ${cmText(typ[1])} cm.` : '';
  return [
    { value: 'small', label: 'Eher klein', sub: 'Kleine Küche, kleines Brett oder eher kleine Hand: kürzere Klingen.' },
    { value: 'standard', label: 'Normal', sub: `Übliche Klingenlängen.${example}` },
    { value: 'large', label: 'Eher groß', sub: 'Viel Platz oder große Hand: längere Klingen.' },
  ];
}

/**
 * Fragenkatalog. `id` = Schritt in der URL (#/finder?step=<id>), `key` = Schlüssel in den Antworten.
 * kind: 'text' | 'single' | 'multi'. options(data) liefert [{ value, label, sub?, exclusive? }].
 * explain: Taxonomie-Einträge, die die Ansicht unter „Was heißt das?“ aufklappbar zeigt.
 */
export const QUESTIONS = [
  {
    id: 'person',
    key: 'who',
    kind: 'text',
    required: false,
    skippable: true,
    title: 'Für wen suchst du ein Messer?',
    lead: 'Ein Name oder eine kurze Beschreibung genügt, zum Beispiel „Anna“ oder „Papa, kocht am Wochenende“. Das ist freiwillig. Beantworte die folgenden Fragen für die Person, die das Messer benutzt – das kannst auch du selbst sein.',
    label: 'Name oder Beschreibung (optional)',
    placeholder: 'z. B. Anna',
    hint: 'Bleibt nur auf diesem Gerät.',
    whyTitle: 'Warum fragen wir?',
    why: 'Der Name erscheint auf der Ergebnisseite und in deiner Liste, damit du später siehst, für wen ein Vorschlag gedacht war. Er wird nur in deinem Browser gespeichert und nirgendwohin gesendet.',
    options: () => [],
  },
  {
    id: 'einsatz',
    key: 'tasks',
    kind: 'multi',
    max: MAX_TASKS,
    rankLabels: ['Haupteinsatz', 'Zusätzlich'],
    required: true,
    title: 'Wofür soll das Messer hauptsächlich dienen?',
    lead: 'Wähle eine oder zwei Antworten. Die erste Auswahl zählt als Haupteinsatz.',
    whyTitle: 'Warum fragen wir?',
    why: 'Jeder Messertyp ist für bestimmte Arbeiten gebaut. Der Haupteinsatz bestimmt, welche Typen wir vorschlagen. Eine zweite Auswahl zählt schwächer, damit nicht jeder Typ „ein bisschen“ passt.',
    options: taskOptions,
  },
  {
    id: 'erfahrung',
    key: 'level',
    kind: 'single',
    required: true,
    title: 'Wie viel Erfahrung gibt es mit guten Messern?',
    whyTitle: 'Warum fragen wir?',
    why: 'Manche Messer sind anspruchsvoll: einseitig geschliffene Sashimi- und Profi-Gemüsemesser, sehr harte oder nicht rostfreie Stähle. Je nach Erfahrung sortieren wir sie aus oder weisen darauf hin. Das ist keine Wertung, sondern soll Frust und Fehlkäufe vermeiden.',
    options: () => [
      { value: 'beginner', label: 'Einstieg', sub: 'Bisher Supermarkt- oder Haushaltsmesser.' },
      { value: 'hobby', label: 'Kocht gern', sub: 'Hatte schon gute Messer.' },
      { value: 'expert', label: 'Kennt sich aus', sub: 'Schärft selbst und pflegt Messer bewusst.' },
    ],
  },
  {
    id: 'rost',
    key: 'rust',
    kind: 'single',
    required: true,
    visible: (a) => a.level === 'expert',
    title: 'Wie wichtig ist „rostfrei“?',
    lead: 'Du hast die Wahl. Die drei Stufen im Katalog unterscheiden sich vor allem in der Pflege.',
    whyTitle: 'Was heißt das?',
    why: 'Das ist die wichtigste Stahl-Entscheidung: Komplett rostfrei verzeiht Pflegefehler, Kohlenstoffstahl belohnt Pflege mit einer sehr feinen, gut schärfbaren Schneide. Was du ausschließt, zeigen wir nicht – auch nicht, wenn es sonst wenig Treffer gibt.',
    explain: [{ group: 'rust', ids: ['full', 'clad', 'none'] }],
    options: (data) => [
      { value: 'full', label: 'Komplett rostfrei', sub: rustCare(data, 'full', 'Von Hand spülen, abtrocknen.') },
      { value: 'clad', label: 'Teilweise rostfrei ist okay', sub: 'Rostfreier Mantel, Kern mit Schneide aus Kohlenstoffstahl. Nach dem Schneiden abtrocknen.' },
      { value: 'any', label: 'Egal, auch Kohlenstoffstahl mit Patina', sub: rustCare(data, 'none', 'Sofort nach Gebrauch abtrocknen, bei Lagerung einölen.') },
    ],
  },
  {
    id: 'pflege',
    key: 'care',
    kind: 'single',
    required: true,
    title: 'Wie wird das Messer gepflegt?',
    lead: 'Ehrliche Antworten helfen mehr als gute: Wir schlagen nur vor, was zur Pflege passt.',
    whyTitle: 'Warum fragen wir?',
    why: 'Pflege hat großen Einfluss darauf, wie lange ein Messer hält. Je weniger Pflege im Alltag realistisch ist, desto eher empfehlen wir komplett rostfreien Stahl – und bei Spülmaschine ehrlicherweise auch ein anderes Messer.',
    options: () => [
      { value: 'careful', label: 'Von Hand spülen und abtrocknen', sub: 'Schärfen mit dem Wasserstein ist denkbar.' },
      { value: 'service', label: 'Von Hand spülen', sub: 'Schärfen eher über einen Schleifdienst – oder gar nicht.' },
      { value: 'rough', label: 'Ehrlich: oft Spülmaschine oder nass liegen gelassen', sub: 'Das kommt vor. Wir sagen dir, was dann passt.' },
    ],
  },
  {
    id: 'hand',
    key: 'hand',
    kind: 'single',
    required: true,
    title: 'Rechts- oder Linkshänder?',
    whyTitle: 'Warum fragen wir?',
    why: 'Die meisten Messer im Katalog sind beidseitig geschliffen und passen für beide Hände. Einseitig geschliffene Messer sind händigkeitsgebunden: Für Linkshänder zeigen wir nur Linkshänder-Ausführungen.',
    explain: [{ group: 'bevels', ids: ['single'] }],
    options: () => [
      { value: 'right', label: 'Rechtshänder' },
      { value: 'left', label: 'Linkshänder', sub: 'Wir achten auf den Schliff.' },
    ],
  },
  {
    id: 'griff',
    key: 'grip',
    kind: 'single',
    required: false,
    skippable: true,
    default: 'any',
    title: 'Welcher Griff ist gewohnt oder gewünscht?',
    whyTitle: 'Was heißt das?',
    why: 'Der Griff bestimmt, wie sich das Messer in der Hand anfühlt – das ist weitgehend Gewohnheit. Wir zeigen zuerst Messer mit deinem Griff; gibt es zu wenige, lockern wir das und sagen es dir.',
    explain: [{ group: 'handleStyles', ids: ['wa', 'yo'] }],
    options: () => [
      { value: 'wa', label: 'Japanischer Griff (Wa)', sub: 'Meist Holz, leichter, Schwerpunkt nahe an der Klinge.' },
      { value: 'yo', label: 'Westlicher Griff (Yō)', sub: 'Schwerer und meist vernietet, wie bei vielen europäischen Messern.' },
      { value: 'any', label: 'Egal', sub: 'Beide Griffarten sind willkommen.' },
    ],
  },
  {
    id: 'groesse',
    key: 'size',
    kind: 'single',
    required: false,
    skippable: true,
    default: 'standard',
    title: 'Wie groß sind Küche, Brett und Hand?',
    whyTitle: 'Warum fragen wir?',
    why: 'Die Klinge muss zu Brett und Hand passen: Zu lang wird unhandlich, zu kurz bremst bei großen Zutaten. Wir übersetzen deine Antwort für jeden Messertyp in eine Wunschlänge und suchen die passende Größe.',
    options: sizeOptions,
  },
  {
    id: 'budget',
    key: 'budget',
    kind: 'single',
    required: false,
    skippable: true,
    default: 'open',
    title: 'Wie viel darf ein Messer kosten?',
    lead: 'Gemeint ist der Preis je Messer. Im Katalog stehen die Preise in Yen; die Euro-Werte sind nur eine Orientierung.',
    whyTitle: 'Warum fragen wir?',
    why: (data) => {
      const rate = rateEur(data);
      return `Wir lassen bis zu 10 % über der Obergrenze zu und kennzeichnen das. ${rate ? `Die Euro-Werte rechnen mit ¥${rate.toLocaleString('de-DE')} je Euro (${data?.site?.rates?.source ?? 'Referenzkurs'}). ` : ''}Versand, Zoll und Steuern sind nicht enthalten.`;
    },
    options: budgetOptions,
  },
  {
    id: 'optik',
    key: 'looks',
    kind: 'multi',
    max: 4,
    required: false,
    skippable: true,
    default: ['any'],
    title: 'Welche Optik gefällt?',
    lead: 'Freiwillig, Mehrfachauswahl möglich.',
    whyTitle: 'Was heißt das?',
    why: 'Die Optik sagt wenig über die Schneidleistung. Deshalb gehört sie zu den ersten Dingen, auf die wir bei zu wenigen Treffern verzichten.',
    explain: [{ group: 'finishes', ids: ['damascus', 'tsuchime', 'kurouchi'] }],
    options: () => [
      { value: 'plain', label: 'Schlicht', sub: 'Glatte oder fein polierte Klinge, kein Muster.' },
      { value: 'damascus', label: 'Damast', sub: 'Sichtbares Lagenmuster.' },
      { value: 'hammered', label: 'Hammerschlag (Tsuchime)', sub: 'Gehämmerte Oberfläche.' },
      { value: 'rustic', label: 'Rustikal (Kurouchi)', sub: 'Dunkle Schmiedehaut.' },
      { value: 'any', label: 'Egal', exclusive: true },
    ],
  },
];

const QUESTION_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
export const questionById = (id) => QUESTION_BY_ID.get(id) ?? null;

/** Reihenfolge der sichtbaren Fragen (ohne Ergebnisseite). „Rost“ gibt es nur für Erfahrene. */
export function visibleSteps(answers) {
  const a = normalizeAnswers(answers);
  return QUESTIONS.filter((q) => !q.visible || q.visible(a)).map((q) => q.id);
}

/** Ist die Frage beantwortet? (Optionale Fragen: erst, wenn ein Wert – auch ein Standardwert per „Überspringen“ – gespeichert ist.) */
export function isAnswered(stepId, answers) {
  const q = QUESTION_BY_ID.get(stepId);
  if (!q) return false;
  if (q.kind === 'text') return true;
  const v = normalizeAnswers(answers)[q.key];
  return Array.isArray(v) ? v.length > 0 : v != null;
}

/** Sind alle Pflichtfragen (der sichtbaren Schritte) beantwortet? Dann kann das Ergebnis berechnet werden. */
export function isComplete(answers) {
  const a = normalizeAnswers(answers);
  return QUESTIONS.filter((q) => q.required && (!q.visible || q.visible(a))).every((q) => isAnswered(q.id, a));
}

/** Erste sichtbare, noch unbeantwortete Frage – sonst die Ergebnisseite. */
export function firstOpenStep(answers) {
  const a = normalizeAnswers(answers);
  return visibleSteps(a).find((id) => !isAnswered(id, a)) ?? RESULT_STEP;
}

export function nextStep(stepId, answers) {
  const steps = visibleSteps(answers);
  const i = steps.indexOf(stepId);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : RESULT_STEP;
}

export function prevStep(stepId, answers) {
  const steps = visibleSteps(answers);
  if (stepId === RESULT_STEP) return steps[steps.length - 1] ?? null;
  const i = steps.indexOf(stepId);
  return i > 0 ? steps[i - 1] : null;
}

/** Ist schon eine Frage beantwortet? Der freiwillige Name allein zählt nicht (für „Weitermachen / Neu starten“). */
export function hasProgress(answers) {
  const a = normalizeAnswers(answers);
  return Boolean(a.tasks.length || a.level || a.rust || a.care || a.hand || a.grip || a.size || a.budget || a.looks);
}

/** Taxonomie-Erklärungen zu einer Frage (für das aufklappbare „Was heißt das?“). */
export function explainEntries(question, data) {
  return (question?.explain ?? []).flatMap(({ group, ids }) =>
    ids
      .map((id) => ({ group, id, entry: entryOf(data, group, id) }))
      .filter((x) => x.entry?.explain)
      .map(({ group: g, id, entry }) => ({ group: g, id, label: entry.label ?? id, short: entry.short ?? entry.label ?? id, text: entry.explain, care: entry.care ?? null }))
  );
}

export const whyText = (question, data) => (typeof question.why === 'function' ? question.why(data) : question.why ?? '');

// ───────────────────────── Hinweise je Schritt ─────────────────────────

const SPECIALIST_SHORT = 'Die klassischen Messer für Fisch und Sashimi (Yanagiba, Deba) sind einseitig geschliffen und anspruchsvoll. Für den Anfang passt oft ein Gyuto oder Santoku – im Ergebnis erklären wir das genauer.';

/** Hinweise, die zu einer Frage passend (live) unter den Antworten erscheinen; mit position: 'top' stünden sie über der Frage. */
export function stepNotes(stepId, answers, data) {
  const a = normalizeAnswers(answers, data);
  const notes = [];
  if (stepId === 'erfahrung' && a.level && a.level !== 'expert' && a.tasks.includes('fisch')) {
    notes.push({ tone: 'info', title: 'Fisch und Sashimi: Spezialmesser', text: SPECIALIST_SHORT });
  }
  if (stepId === 'rost' && a.rust === 'any') {
    notes.push({ tone: 'info', title: 'Nicht rostfrei heißt: Pflege gehört dazu', text: rustCare(data, 'none', 'Sofort nach Gebrauch abwischen und abtrocknen; bei längerer Lagerung dünn einölen.') });
  }
  if (stepId === 'pflege') {
    if (a.level !== 'expert') {
      notes.push({
        tone: 'info',
        title: 'Rostfrei: für dich automatisch „komplett rostfrei“',
        text: 'Für Einstieg und Hobby suchen wir nur komplett rostfreie Messer: Die Klinge ist durchgehend rostfrei, bekommt keine Patina und verzeiht vergessenes Abtrocknen eher. Teilweise und nicht rostfreie Messer zeigen wir nur bei der Erfahrung „Kennt sich aus“.',
        explain: [{ group: 'rust', ids: ['full', 'clad', 'none'] }],
      });
    }
    if (a.care === 'rough') {
      notes.push({
        tone: 'warn',
        title: 'Ehrlicher Hinweis zur Spülmaschine',
        text: 'Japanische Messer haben oft eine dünne, sehr harte Klinge. In der Spülmaschine werden sie herumgeschleudert, und Hitze, Wasser und Reiniger schädigen auch den Griff – selbst bei rostfreiem Stahl. Wenn das zum Alltag gehört, passt ein robustes, auch europäisches Messer womöglich besser. Wir zeigen dir trotzdem komplett rostfreie Messer; bitte nur von Hand spülen.',
      });
      if (a.level === 'expert' && a.rust && a.rust !== 'full') {
        notes.push({ tone: 'info', title: 'Deine Rost-Wahl wird hier übergangen', text: 'Bei dieser Pflege zeigen wir ausschließlich komplett rostfreie Messer.' });
      }
    }
  }
  if (stepId === 'hand' && a.hand === 'left') {
    notes.push({
      tone: 'info',
      title: 'Linkshänder: auf den Schliff achten',
      text: 'Beidseitig geschliffene Messer (z. B. Gyuto, Santoku, Nakiri) passen für beide Hände. Einseitig geschliffene Messer gibt es als eigene Linkshänder-Ausführung – nur diese zeigen wir. Bei Wa-Griffen sind D-förmige Formen oft für Rechtshänder geformt; achteckige oder ovale Griffe sind neutraler.',
    });
  }
  return notes;
}

// ───────────────────────── Zusammenfassung (Profil-Chips) ─────────────────────────

const LEVEL_TEXT = { beginner: 'Einstieg', hobby: 'Kocht gern', expert: 'Kennt sich aus' };
const CARE_TEXT = { careful: 'Von Hand, selbst schärfen', service: 'Von Hand, Schleifdienst', rough: 'Oft Spülmaschine oder nass' };
const SIZE_TEXT = { small: 'Eher klein', standard: 'Normal', large: 'Eher groß' };
const GRIP_TEXT = { wa: 'Japanisch (Wa)', yo: 'Westlich (Yō)', any: 'Egal' };
const LOOKS_TEXT = { plain: 'Schlicht', damascus: 'Damast', hammered: 'Hammerschlag', rustic: 'Rustikal (Kurouchi)', any: 'Egal' };

export function budgetText(value, data) {
  const band = BUDGETS[value];
  if (!band) return '';
  const euro = (n) => budgetEuro(data, n);
  const eurPart = (txt) => (rateEur(data) ? ` (≈ ${txt})` : '');
  switch (value) {
    case 'lt15':
      return `bis ${jpy(15000)}${eurPart(euroText(euro(15000)))}`;
    case '15-30':
      return `${jpy(15000)} bis ${jpy(30000)}${eurPart(`${euro(15000)} bis ${euroText(euro(30000))}`)}`;
    case '30-60':
      return `${jpy(30000)} bis ${jpy(60000)}${eurPart(`${euro(30000)} bis ${euroText(euro(60000))}`)}`;
    case 'gt60':
      return `über ${jpy(60000)}${eurPart(`ab ${euroText(euro(60000))}`)}`;
    default:
      return 'offen';
  }
}

/** Profil-Chips in Fragenreihenfolge. `step` = Schritt, zu dem ein Klick zurückführt (null: nicht änderbar, z. B. automatisch). */
export function summarize(answers, data) {
  const a = normalizeAnswers(answers, data);
  const chips = [];
  const add = (id, step, label, value) => value && chips.push({ id, step, label, value, text: `${label}: ${value}` });

  add('who', 'person', 'Für', a.who);
  if (a.tasks.length) add('tasks', 'einsatz', 'Einsatz', a.tasks.map((k) => taskLabel(data, k)).join(' + '));
  add('level', 'erfahrung', 'Erfahrung', LEVEL_TEXT[a.level]);
  if (a.level) {
    if (a.level === 'expert' && a.care !== 'rough') {
      const text = { full: 'komplett rostfrei', clad: 'teilweise rostfrei okay', any: 'egal, auch Kohlenstoffstahl' }[a.rust ?? 'full'];
      add('rust', 'rost', 'Rostfrei', text);
    } else {
      add('rust', null, 'Rostfrei', `komplett (automatisch${a.care === 'rough' ? ', wegen Pflege' : ''})`);
    }
  }
  add('care', 'pflege', 'Pflege', CARE_TEXT[a.care]);
  add('hand', 'hand', 'Händigkeit', a.hand === 'left' ? 'Linkshänder' : a.hand === 'right' ? 'Rechtshänder' : '');
  add('grip', 'griff', 'Griff', GRIP_TEXT[a.grip]);
  add('size', 'groesse', 'Größe', SIZE_TEXT[a.size]);
  add('budget', 'budget', 'Budget', budgetText(a.budget, data));
  if (a.looks) add('looks', 'optik', 'Optik', a.looks.map((k) => LOOKS_TEXT[k]).join(', '));
  return chips;
}

// ───────────────────────── Längen ─────────────────────────

/**
 * Wunschlänge in mm für einen Typ. small = unteres Ende von typicalMm, standard = Mitte,
 * large = oberes Ende (bei sehr enger Spanne eine Stufe, +15 mm, darüber). Fehlt typicalMm: Mittelwert der Katalog-Größen
 * (small/large dann ∓15 mm). Ohne Daten: null.
 */
export function targetLengthMm(typeId, size, data) {
  const meta = typeMeta(typeId, data);
  const s = ENUMS.size.includes(size) ? size : 'standard';
  if (meta.typical) {
    const [lo, hi] = meta.typical;
    if (s === 'small') return lo;
    if (s === 'large') return hi - lo < 20 ? hi + 15 : hi;
    return Math.round((lo + hi) / 2);
  }
  const mean = catalogMeanMm(typeId, data);
  if (mean == null) return null;
  const base = Math.round(mean);
  return s === 'small' ? base - 15 : s === 'large' ? base + 15 : base;
}

const toleranceMm = (target) => Math.min(30, Math.max(12, Math.round(target * 0.12)));

function sizeDistance(size, target) {
  if (target == null || size?.mm == null) return null;
  const lo = size.mm;
  const hi = size.mmMax ?? size.mm;
  if (target < lo) return lo - target;
  if (target > hi) return target - hi;
  return 0;
}

function lengthLabel(size) {
  if (size?.mm == null) return size?.label ?? '';
  if (size.mmMax) return `${cmText(size.mm)}–${cmText(size.mmMax)} cm`;
  return `${size.approx ? 'ca. ' : ''}${cmText(size.mm)} cm`;
}

// ───────────────────────── Filter und Passung ─────────────────────────

/** Händigkeit: Linkshänder → keine Rechtshänder-Messer und einseitige nur als Linkshänder-Ausführung; Rechtshänder → keine Linkshänder-Ausführung. */
function handOk(item, hand) {
  if (hand === 'left') return !(item.handed === 'right' || (item.bevel === 'single' && item.handed !== 'left'));
  if (hand === 'right') return item.handed !== 'left';
  return true;
}

/** Harte Regeln (werden nie gelockert): Rost-Stufe und Händigkeit. */
function passesHard(item, a, allowed) {
  return Boolean(item.rust) && allowed.includes(item.rust) && handOk(item, a.hand);
}

function matchesLooks(item, looks) {
  if (!looks?.length || looks.includes('any')) return true;
  const f = item.finish ?? [];
  const decorated = f.some((x) => ['damascus', 'tsuchime', 'kurouchi', 'nashiji', 'dimple'].includes(x));
  return looks.some((l) => {
    if (l === 'plain') return !decorated;
    if (l === 'damascus') return f.includes('damascus');
    if (l === 'hammered') return f.includes('tsuchime') || f.includes('dimple');
    if (l === 'rustic') return f.includes('kurouchi');
    return false;
  });
}

const looksText = { plain: 'Schlicht', damascus: 'Damast-Optik', hammered: 'Hammerschlag', rustic: 'Kurouchi-Optik' };

function waterproofGrip(item) {
  return item.grip?.style === 'steel' || WATERPROOF_MATERIALS.has(item.grip?.material);
}

// Brotmesser: Der Katalog führt sie als „einseitig“, der Wellenschliff wird aber ohnehin nicht auf dem Stein geschärft.
const isSerrated = (meta) => meta.entry?.group === 'brot';

const VAGUE_STEEL = /nicht angegeben|laut Shop|Sammelbezeichnung/i;
const UNKNOWN_STEELS = new Set(['unknown']);

function hardness(entry) {
  const h = entry?.hardnessHrc;
  return Array.isArray(h) && h.length === 2 && h.every(Number.isFinite) ? h : null;
}

// ───────────────────────── Typ-Empfehlung ─────────────────────────

function levelFactor(meta, level, includeSpecialists) {
  if (level === 'expert') return 1;
  if (meta.specialist) return includeSpecialists ? 1 : 0;
  if (meta.level <= 1) return 1;
  return level === 'beginner' ? 0.6 : 0.85; // Stufe 2 (z. B. Honesuki, Sujihiki) dämpfen
}

/** Wie gut passt der Typ zu den gewählten Aufgaben? → Text oder null (Aufgabengewichte: ≥ 0,8 passt, ≥ 0,5 geeignet, ≥ 0,25 bedingt). */
function taskFitText(meta, tasks, data) {
  const strong = [];
  const medium = [];
  const weak = [];
  tasks.forEach((key) => {
    const w = Number(meta.tasks?.[key]) || 0;
    const label = `„${taskLabel(data, key)}“`;
    if (w >= 0.8) strong.push(label);
    else if (w >= 0.5) medium.push(label);
    else if (w >= 0.25) weak.push(label);
  });
  if (strong.length) return `passt zu ${strong.join(' und ')}${medium.length ? `, geeignet für ${medium.join(' und ')}` : ''}`;
  if (medium.length) return `geeignet für ${medium.join(' und ')}`;
  if (weak.length) return `bedingt geeignet für ${weak.join(' und ')}`;
  return null;
}

function typeReasons(meta, a, data, target, pool) {
  const reasons = [];
  const fit = taskFitText(meta, a.tasks, data);
  if (fit) reasons.push(fit.charAt(0).toUpperCase() + fit.slice(1));
  // „Beidseitig geschliffen“ nur behaupten, wenn es auch für die Artikel im Katalog gilt (Brotmesser stehen dort als einseitig)
  const mostlySingle = pool.length > 0 && pool.filter((i) => i.bevel === 'single').length / pool.length >= 0.5;
  const bothHands = a.hand === 'left' && meta.bevel === 'double' && !mostlySingle;
  if (a.level !== 'expert' && meta.level <= 1) {
    if (mostlySingle) reasons.push('Einsteigerfreundlich (Stufe 1 von 3)');
    else reasons.push(bothHands ? 'Einsteigerfreundlich: beidseitig geschliffen, für Links- und Rechtshänder' : 'Einsteigerfreundlich: beidseitig geschliffen, wenig Übung nötig');
  } else if (bothHands) reasons.push('Beidseitig geschliffen: für Links- und Rechtshänder');
  if (target != null) {
    const typ = meta.typical;
    reasons.push(`Wunschlänge etwa ${cmText(target)} cm${typ ? ` (üblich: ${cmText(typ[0])}${typ[1] !== typ[0] ? `–${cmText(typ[1])}` : ''} cm)` : ''}`);
  }
  return reasons;
}

function typeWarnings(meta, a, pool) {
  const count = pool.length;
  const warnings = [];
  if (meta.bevel === 'single') {
    if (a.hand === 'left') warnings.push('Einseitig geschliffen: nur in Linkshänder-Ausführung sinnvoll');
    if (a.level !== 'expert') warnings.push('Anspruchsvoll: einseitig geschliffen, braucht Übung beim Schneiden und Schleiferfahrung');
  } else if (meta.level >= 3 && a.level !== 'expert') {
    warnings.push('Anspruchsvoll: braucht Übung und Pflege');
  } else if (meta.level === 2 && a.level === 'beginner') {
    warnings.push('Etwas anspruchsvoller als ein Allround-Messer (Stufe 2 von 3)');
  }
  const singles = pool.filter((i) => i.bevel === 'single').length;
  if (meta.bevel !== 'single' && !isSerrated(meta) && a.level !== 'expert' && count >= 2 && singles / count >= 0.5) {
    warnings.push(`Im Katalog meist einseitig geschliffen (${singles} von ${count} Artikeln): braucht Übung und Schleiferfahrung`);
  }
  if (count < MIN_HITS) warnings.push(`Im Katalog nur ${count} passende${count === 1 ? 'r Artikel' : ' Artikel'}`);
  return warnings;
}

/**
 * Bis zu drei passende Messertypen, Haupt-Empfehlung zuerst. Typen müssen im Katalog (Segment „home“) mit den harten Regeln
 * (Rost, Händigkeit) vorkommen. Nicht-Experten bekommen Spezialmesser (einseitig geschliffen oder Stufe 3) nur mit includeSpecialists.
 */
export function recommendTypes(answers, data, { includeSpecialists = false } = {}) {
  const a = prep(answers, data);
  const ix = index(data);
  const allowed = rustAllowed(a);
  const level = a.level ?? 'hobby';
  const [mainTask, secondTask] = a.tasks;
  const typeIds = Object.keys(data?.taxonomy?.types ?? {}).filter((id) => ix.byType.has(id));

  const rows = [];
  for (const typeId of typeIds) {
    const meta = typeMeta(typeId, data);
    if (!meta.tasks) continue;
    const factor = levelFactor(meta, level, includeSpecialists);
    if (factor <= 0) continue;
    const pool = ix.byType.get(typeId).filter((i) => passesHard(i, a, allowed));
    if (!pool.length) continue;
    const wMain = Number(meta.tasks[mainTask]) || 0;
    const wSecond = secondTask ? Number(meta.tasks[secondTask]) || 0 : 0;
    const taskScore = wMain + SECOND_TASK_WEIGHT * wSecond;
    if (taskScore <= 0) continue;
    const presence = 0.88 + 0.12 * Math.min(1, pool.length / 5);
    rows.push({
      typeId,
      meta,
      pool,
      score: taskScore * factor * presence,
      secondFit: wSecond * factor * presence,
    });
  }
  rows.sort((p, q) => q.score - p.score || p.typeId.localeCompare(q.typeId));
  if (!rows.length) return [];

  const top = rows[0].score;
  const picks = rows.filter((r) => r.score >= top * TYPE_CUTOFF).slice(0, MAX_TYPES);
  // Zweite Aufgabe: ihr bester Typ bekommt einen Platz, wenn er sonst fehlen würde (z. B. Brotmesser neben Gyuto)
  if (secondTask) {
    const second = [...rows].filter((r) => (Number(r.meta.tasks[secondTask]) || 0) >= 0.6).sort((p, q) => q.secondFit - p.secondFit)[0];
    if (second && !picks.includes(second)) {
      if (picks.length >= MAX_TYPES) picks[MAX_TYPES - 1] = second;
      else picks.push(second);
    }
  }
  // Für Nicht-Experten mit „Trotzdem zeigen“: mindestens ein einsteigerfreundlicher Typ bleibt als ehrliche Alternative
  if (level !== 'expert' && includeSpecialists) {
    const gentle = rows.find((r) => !r.meta.specialist);
    if (gentle && !picks.some((r) => !r.meta.specialist)) {
      if (picks.length >= MAX_TYPES) picks[picks.length - 1] = gentle;
      else picks.push(gentle);
    }
  }

  return picks.map((r) => {
    const target = targetLengthMm(r.typeId, a.size, data);
    const count = r.pool.length;
    return {
      typeId: r.typeId,
      score: Math.round(r.score * 1000) / 1000,
      reasons: typeReasons(r.meta, a, data, target, r.pool),
      warnings: typeWarnings(r.meta, a, r.pool),
      count,
      availableCount: r.pool.filter((i) => i.available).length,
    };
  });
}

/** Hinweiskarte für Nicht-Experten, wenn Spezialmesser (z. B. Yanagiba/Deba/Usuba) ganz oben stünden. */
export function specialistHint(answers, data) {
  const a = prep(answers, data);
  const none = { show: false, types: [], typeLabels: [], title: '', text: '', toggleLabel: '', alternatives: [] };
  if (a.level === 'expert') return none;
  const specs = recommendTypes(a, data, { includeSpecialists: true }).filter((r) => typeMeta(r.typeId, data).specialist);
  if (!specs.length) return none;
  const types = specs.slice(0, 2).map((r) => r.typeId);
  const typeLabels = types.map((id) => labelOf(data, 'types', id));
  const alternatives = recommendTypes(a, data).slice(0, 2).map((r) => labelOf(data, 'types', r.typeId));
  const fish = types.some((id) => entryOf(data, 'types', id)?.group === 'fisch');
  const names = typeLabels.join(' und ');
  const alt = alternatives.length ? alternatives.join(' oder ') : 'Gyuto oder Santoku';
  return {
    show: true,
    types,
    typeLabels,
    title: fish ? 'Fisch und Sashimi: Spezialmesser, anspruchsvoll' : `${names}: Spezialmesser, anspruchsvoll`,
    text: `${names} ${types.length > 1 ? 'sind' : 'ist'} einseitig geschliffen (oder sonst anspruchsvoll): Das Messer braucht Übung beim Schneiden und Schleiferfahrung beim Schärfen. Für den Anfang passt oft ${alt} – beidseitig geschliffen und verzeihender.`,
    toggleLabel: fish ? 'Trotzdem Sashimi-Messer zeigen' : `Trotzdem ${names} zeigen`,
    alternatives,
  };
}

/**
 * Typen, die zu den Aufgaben passen würden, aber wegen der harten Regeln (Rost, Händigkeit) im Katalog gar nicht vorkommen,
 * z. B. Brotmesser für Linkshänder, wenn alle Artikel einseitig geschliffene Rechtshänder-Messer sind.
 * → [{ typeId, reason: 'rust' | 'hand', count, text }]
 */
export function excludedTypes(answers, data) {
  const a = prep(answers, data);
  const ix = index(data);
  const allowed = rustAllowed(a);
  const [mainTask, secondTask] = a.tasks;
  const taskWeight = (typeId) => {
    const tasks = typeMeta(typeId, data).tasks;
    return tasks ? (Number(tasks[mainTask]) || 0) + SECOND_TASK_WEIGHT * (secondTask ? Number(tasks[secondTask]) || 0 : 0) : 0;
  };
  // Nur melden, was ohne die harten Regeln mindestens so gut passen würde wie die beste tatsächliche Empfehlung
  const best = recommendTypes(a, data)[0];
  const bar = Math.max(0.5, best ? taskWeight(best.typeId) : 0);
  const out = [];
  for (const typeId of Object.keys(data?.taxonomy?.types ?? {})) {
    const items = ix.byType.get(typeId);
    const meta = typeMeta(typeId, data);
    if (!items?.length || !meta.tasks || (meta.specialist && a.level !== 'expert')) continue;
    const weight = taskWeight(typeId);
    if (weight < bar || items.some((i) => passesHard(i, a, allowed))) continue;
    const rustOk = items.filter((i) => i.rust && allowed.includes(i.rust)).length;
    const reason = rustOk === 0 ? 'rust' : 'hand';
    const name = labelOf(data, 'types', typeId);
    const text =
      reason === 'rust'
        ? `${name}: ${items.length} ${items.length === 1 ? 'Artikel' : 'Artikel'} im Katalog, aber keiner ist ${allowed.length === 1 ? 'komplett rostfrei' : 'rostfrei genug für deine Vorgabe'}.`
        : `${name}: Alle ${items.length} Artikel sind laut Katalog einseitig geschliffen und für ${a.hand === 'left' ? 'Rechtshänder' : 'Linkshänder'} gemacht – ${a.hand === 'left' ? 'Linkshändern' : 'Rechtshändern'} zeigen wir sie nicht.`;
    out.push({ typeId, reason, count: items.length, text, weight });
  }
  return out.sort((p, q) => q.weight - p.weight).map(({ weight, ...rest }) => rest);
}

// ───────────────────────── Stahl und Pflege ─────────────────────────

function candidatePool(a, data, recs, includeSpecialists = false) {
  const ix = index(data);
  const allowed = rustAllowed(a);
  return recs.flatMap((r) => (ix.byType.get(r.typeId) ?? []).filter((i) => passesHard(i, a, allowed)));
}

function frequentSteels(pool, data, { family, beginner }) {
  const counts = new Map();
  for (const i of pool) {
    const id = i.steel?.id;
    if (!id || UNKNOWN_STEELS.has(id) || i.steel.family !== family) continue;
    const e = entryOf(data, 'steels', id);
    if (!e || !hardness(e) || VAGUE_STEEL.test(`${e.label} ${e.summary ?? ''}`)) continue;
    if (beginner && e.beginnerFriendly !== true) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))
    .slice(0, 4)
    .map(([id]) => {
      const e = entryOf(data, 'steels', id);
      const [lo, hi] = hardness(e);
      return `${e.short ?? e.label} (${lo}–${hi} HRC)`;
    });
}

/** Stahl- und Pflege-Empfehlung mit Erklärung der drei Rost-Stufen (`tiers`, `allowed` je Stufe). */
export function steelAdvice(answers, data) {
  const a = prep(answers, data);
  const allowed = rustAllowed(a);
  const expert = a.level === 'expert';
  const rough = a.care === 'rough';
  const bullets = [];
  const warnings = [];

  const tiers = ['full', 'clad', 'none'].map((id) => {
    const e = entryOf(data, 'rust', id) ?? {};
    return { id, label: e.label ?? id, short: e.short ?? e.label ?? id, explain: e.explain ?? '', care: e.care ?? '', allowed: allowed.includes(id) };
  });

  let headline;
  if (rough) {
    headline = 'Nur komplett rostfrei – und ehrlich: Ein robustes Messer passt womöglich besser';
    const dish = 'Nicht in die Spülmaschine: Das Messer wird herumgeschleudert, Hitze, Wasser und Reiniger schädigen auch den Griff – selbst bei komplett rostfreiem Stahl.';
    warnings.push(dish);
    bullets.push(dish);
    bullets.push('Wenn Spülmaschine oder nasses Liegenlassen zum Alltag gehören, passt ein robustes, auch europäisches Messer oft besser als ein japanisches mit dünner, sehr harter Klinge.');
    bullets.push('Wir zeigen dir trotzdem komplett rostfreie Messer und bevorzugen Griffe, die nicht quellen (Edelstahl, Kunststoff, Harz). Von Hand spülen und abtrocknen bleibt die beste Pflege.');
  } else if (!expert) {
    headline = 'Komplett rostfreier Stahl: die sichere Wahl für den Einstieg';
    bullets.push('Wir zeigen dir nur komplett rostfreie Messer: Die Klinge besteht durchgehend aus rostfreiem Stahl, bildet keine Patina und verzeiht es eher, wenn das Abtrocknen einmal vergessen wird.');
    bullets.push(`Pflege: ${tiers[0].care || 'Von Hand spülen, abtrocknen.'}`);
  } else if (allowed.length === 1) {
    headline = 'Komplett rostfrei, wie gewünscht';
    bullets.push(`Pflege: ${tiers[0].care || 'Von Hand spülen, abtrocknen.'}`);
  } else if (!allowed.includes('none')) {
    headline = 'Komplett oder teilweise rostfrei';
    bullets.push(`Komplett rostfrei: ${tiers[0].care}`);
    bullets.push(`Teilweise rostfrei: ${tiers[1].care}`);
  } else {
    headline = 'Auch Kohlenstoffstahl – mit Patina und Pflege';
    bullets.push(`Nicht rostfrei: ${tiers[2].care}`);
    bullets.push(`Teilweise rostfrei: ${tiers[1].care}`);
    bullets.push(`Komplett rostfrei: ${tiers[0].care}`);
  }

  if (!rough) {
    if (a.care === 'careful') {
      bullets.push('Schärfen: Mit einem Wasserstein (1000er zum Schärfen, 3000er oder feiner zum Verfeinern) lassen sich japanische Messer am besten schärfen. Durchzieh-Schleifer entfernen zu viel Material und passen nicht zu dünnen Klingen.');
    } else if (a.care === 'service') {
      bullets.push('Schärfen: Wer nicht selbst schärfen mag, lässt schleifen. Durchzieh-Schleifer passen nicht zu dünnen japanischen Klingen – frage den Schleifdienst vorher, ob er japanische Messer schleift.');
      if (allowed.length > 1) bullets.push('Kohlenstoffstahl lässt sich besonders gut schärfen; das nützt vor allem, wenn du selbst schärfst. Lässt du schleifen, bleibt vor allem der Mehraufwand bei der Pflege.');
    }
  }

  const recs = recommendTypes(a, data);
  const pool = candidatePool(a, data, recs);
  const beginner = a.level === 'beginner';
  const stainless = frequentSteels(pool, data, { family: 'stainless', beginner });
  if (stainless.length) bullets.push(`Rostfreie Stähle, die bei deinen Typen im Katalog häufig vorkommen (typische Härte): ${stainless.join(', ')}.`);
  if (allowed.includes('none') || allowed.includes('clad')) {
    const carbon = frequentSteels(pool, data, { family: 'carbon', beginner: false });
    if (carbon.length) bullets.push(`Kohlenstoffstähle, die häufig vorkommen (typische Härte): ${carbon.join(', ')}.`);
  }
  if (a.level !== 'expert') {
    bullets.push('Sehr harte Stähle (ab etwa 65 HRC, z. B. ZDP-189) halten die Schärfe lange, sind aber weniger zäh: Ausbrüche bei Knochen oder Verdrehen sind eher möglich. Für den Anfang sind weniger harte Stähle tendenziell verzeihender.');
  }

  return { rustAllowed: allowed, headline, bullets, warnings, tiers };
}

// ───────────────────────── Treffer ─────────────────────────

function allocateQuotas(weights, limit) {
  const n = weights.length;
  if (!n || limit <= 0) return weights.map(() => 0);
  if (limit <= n) return weights.map((_, i) => (i < limit ? 1 : 0));
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const q = weights.map((w) => Math.max(1, Math.floor((limit * w) / sum)));
  let total = q.reduce((s, v) => s + v, 0);
  const rest = weights.map((w, i) => ({ i, r: (limit * w) / sum - Math.floor((limit * w) / sum) })).sort((p, r) => r.r - p.r);
  for (let k = 0; total < limit; k = (k + 1) % n) {
    q[rest[k].i] += 1;
    total += 1;
  }
  for (let k = n - 1; total > limit; k = k > 0 ? k - 1 : n - 1) {
    if (q[k] > 1) {
      q[k] -= 1;
      total -= 1;
    }
  }
  return q;
}

/** Lexikographischer Vergleich zweier Zahlenlisten. */
function compareKeys(p, q) {
  for (let i = 0; i < p.length; i += 1) if (p[i] !== q[i]) return p[i] - q[i];
  return 0;
}

/** Beste Größe eines Artikels: nächste an der Wunschlänge, dann vorrätig, dann günstiger. null, wenn keine Größe die Filter besteht. */
function pickSize(item, target, tol, { onlyAvailable, budgetMax, lengthWindow }) {
  let best = null;
  item.sizes.forEach((size, index) => {
    if (onlyAvailable && !size.available) return;
    const price = size.priceJpy;
    if (Number.isFinite(budgetMax) && !(price != null && price <= budgetMax)) return;
    const dist = sizeDistance(size, target);
    if (lengthWindow && target != null && (dist == null || dist > tol)) return;
    const key = [dist ?? 1e9, size.available ? 0 : 1, price ?? 1e9, index];
    if (!best || compareKeys(key, best.key) < 0) best = { size, index, dist, key };
  });
  return best;
}

function steelKnown(entry, steelId) {
  if (!steelId || UNKNOWN_STEELS.has(steelId) || !entry) return 0;
  return VAGUE_STEEL.test(`${entry.label} ${entry.summary ?? ''}`) ? 0.3 : 1;
}

/** Passung 0–100. Nicht gefragte Kriterien zählen als erfüllt (100 = alles passt). */
function scoreCandidate(c, ctx) {
  const { a, band, typeScoreTop, typeScores } = ctx;
  const { item, size, dist, tol, target } = c;
  const steelE = entryOf(ctx.data, 'steels', item.steel?.id);
  const typeFit = (typeScores.get(item.type) ?? 0) / (typeScoreTop || 1);
  const lengthFit = target == null || dist == null ? 0.6 : Math.max(0, 1 - dist / (2 * tol));
  const price = size.priceJpy;
  let priceFit = 1;
  if (band && a.budget !== 'open') {
    if (price == null) priceFit = 0.3;
    else if (price > band.max * BUDGET_TOLERANCE) priceFit = 0.2;
    else if (price > band.max) priceFit = 0.6;
    else if (band.min > 0 && price < band.min) priceFit = Math.max(0.35, 1 - 0.65 * ((band.min - price) / band.min));
  }
  const gripFit = a.grip === 'any' || item.grip?.style === a.grip ? 1 : 0;
  const looksFit = matchesLooks(item, a.looks) ? 1 : 0;
  // Einsteiger und „rough“: Stähle bevorzugen, die laut Taxonomie für den Einstieg taugen
  const gentle = a.level === 'beginner' || a.care === 'rough';
  const steelFit = gentle ? (steelE?.beginnerFriendly === true ? 1 : steelE?.beginnerFriendly === false ? 0 : 0.4) : 1;
  const easeFit = item.bevel !== 'single' || a.level === 'expert' || isSerrated(typeMeta(item.type, ctx.data)) ? 1 : a.level === 'beginner' ? 0 : 0.4;
  const careFit = a.care === 'rough' ? (waterproofGrip(item) ? 1 : 0.4) : 1;
  const availFit = size.available ? 1 : 0;
  const s = 0.26 * typeFit + 0.18 * lengthFit + 0.12 * priceFit + 0.1 * gripFit + 0.07 * looksFit + 0.07 * steelFit + 0.05 * steelKnown(steelE, item.steel?.id) + 0.06 * easeFit + 0.03 * careFit + 0.06 * availFit;
  return Math.round(s * 1000) / 10;
}

function itemTaskText(meta, a, data, typeName) {
  const fit = taskFitText(meta, a.tasks, data);
  return fit ? `${typeName} – ${fit}` : `${typeName}`;
}

function explainItem(c, ctx) {
  const { a, data, band } = ctx;
  const { item, size, dist, tol, target } = c;
  const meta = typeMeta(item.type, data);
  const reasons = [];
  const warnings = [];
  const typeName = labelOf(data, 'types', item.type);
  const steelE = entryOf(data, 'steels', item.steel?.id);

  // Typ
  reasons.push(itemTaskText(meta, a, data, typeName));
  // Rost
  if (item.rust === 'full') reasons.push('komplett rostfrei');
  else if (item.rust === 'clad') warnings.push('Teilweise rostfrei: Schneide aus Kohlenstoffstahl – nach dem Schneiden sofort abtrocknen');
  else if (item.rust === 'none') warnings.push('Kohlenstoffstahl: nach jedem Gebrauch abtrocknen');
  // Händigkeit
  if (a.hand === 'left') {
    if (item.handed === 'left') reasons.push(item.bevel === 'single' ? 'Linkshänder-Ausführung (einseitig geschliffen)' : 'Linkshänder-Ausführung');
    else if (item.bevel === 'double') reasons.push('Beidseitig geschliffen: für Links- und Rechtshänder');
    if (item.grip?.style === 'wa' && !SYMMETRIC_SHAPES.has(item.grip.shape)) warnings.push(`Wa-Griff, Form ${item.grip.shape ? `„${shortOf(data, 'handleShapes', item.grip.shape).toLowerCase()}“` : 'nicht angegeben'}: D-förmige Griffe sind oft für Rechtshänder geformt`);
  }
  // Länge
  if (target != null && size.mm != null) {
    const desc = a.size === 'small' ? 'eher kurz' : a.size === 'large' ? 'eher lang' : 'Standardlänge';
    if (dist != null && dist <= tol) reasons.push(`${lengthLabel(size)} (${desc})`);
    else warnings.push(`${lengthLabel(size)} weicht von der Wunschlänge (etwa ${cmText(target)} cm) ab`);
  }
  // Preis
  const price = size.priceJpy;
  if (price != null && band && a.budget !== 'open') {
    if (price > band.max * BUDGET_TOLERANCE) warnings.push(`${jpy(price)} – über dem Budget (gelockert)`);
    else if (price > band.max) warnings.push(`${jpy(price)} – leicht über dem Budget (bis +10 % Toleranz)`);
    else if (band.min > 0 && price < band.min) reasons.push(`${jpy(price)} – günstiger als dein Budgetrahmen`);
    else reasons.push(`${jpy(price)} – im Budget`);
  }
  // Griff
  if (a.grip !== 'any') {
    const style = item.grip?.style;
    if (style === a.grip) reasons.push(`${shortOf(data, 'handleStyles', style)} wie gewünscht`);
    else warnings.push(`${style && style !== 'unknown' ? shortOf(data, 'handleStyles', style) : 'Griff nicht angegeben'} statt ${shortOf(data, 'handleStyles', a.grip)}`);
  }
  // Optik
  if (!a.looks.includes('any')) {
    const hit = a.looks.find((l) => l !== 'any' && matchesLooks(item, [l]));
    if (hit) reasons.push(`${looksText[hit]} wie gewünscht`);
  }
  // Stahl
  const vague = steelE && VAGUE_STEEL.test(`${steelE.label} ${steelE.summary ?? ''}`);
  if (a.level === 'beginner' && steelE?.beginnerFriendly === true && !vague) reasons.push(`${steelE.short ?? steelE.label}: für Einsteiger geeignet`);
  if (a.care === 'rough' && waterproofGrip(item)) reasons.push('Griff quillt nicht durch Wasser');
  // Warnungen: Härte, Stahlangabe, Schliff, Shop-Hinweise
  const hrc = hardness(steelE);
  if (hrc && hrc[1] >= 65) warnings.push(`Sehr hart (${hrc[0] >= 65 ? `${hrc[0]}+` : `bis ${hrc[1]}`} HRC): Ausbrüche bei Knochen oder Verdrehen möglich`);
  if (!item.steel || UNKNOWN_STEELS.has(item.steel.id)) warnings.push('Sorte nicht angegeben');
  else if (vague) warnings.push(`Sorte nicht angegeben (nur „${steelE.short ?? steelE.label}“ laut Shop)`);
  if (item.flags?.some((f) => String(f).startsWith('steel-family-conflict'))) warnings.push('Stahlangabe im Katalog widersprüchlich – im Laden nachfragen');
  if (item.bevel === 'single' && a.level !== 'expert' && !isSerrated(meta)) warnings.push('Einseitig geschliffen: braucht Übung beim Schneiden und Schleiferfahrung');
  if (item.notes?.includes('rusts-easily-per-shop')) warnings.push('Laut Shop rostet das Messer leicht');
  if (item.notes?.includes('one-off')) warnings.push('Einzelstück laut Shop');

  const uniq = (list) => [...new Set(list)];
  return { reasons: uniq(reasons).slice(0, 6), warnings: uniq(warnings).slice(0, 5) };
}

/** Lockerungsplan: nur Schritte, die für diese Antworten überhaupt etwas ändern. */
function relaxationPlan(a, hasTarget) {
  const plan = [];
  if (!a.looks.includes('any')) plan.push('looks');
  if (a.grip !== 'any') plan.push('grip');
  if (a.budget !== 'open') plan.push('budget');
  if (hasTarget) plan.push('length');
  return plan;
}

function relaxText(id, a, band) {
  switch (id) {
    case 'looks':
      return 'Optik: auch andere Oberflächen';
    case 'grip':
      return `Griff: auch ${a.grip === 'wa' ? 'westliche (Yō-)' : 'japanische (Wa-)'}Griffe`;
    case 'budget':
      return Number.isFinite(band?.max) ? `Budget: bis ${jpy(Math.round(band.max * BUDGET_RELAXED))} statt ${jpy(band.max)} (+25 %)` : 'Budget';
    default:
      return 'Länge: auch kürzere und längere Größen';
  }
}

/**
 * Konkrete Treffer aus dem Katalog. Je Artikel wird die beste Größe gewählt (sizeIndex): nah an der Wunschlänge, im Budget,
 * bei onlyAvailable nur vorrätige Größen. Bei zu wenigen Treffern wird schrittweise gelockert (Optik → Griff → Budget +25 % → Länge);
 * Rost- und Händigkeitsregeln bleiben immer erhalten.
 */
export function matchKnives(answers, data, { limit = 8, onlyAvailable = true, includeSpecialists = false } = {}) {
  const a = prep(answers, data);
  const ix = index(data);
  const typeRecs = recommendTypes(a, data, { includeSpecialists });
  const allowed = rustAllowed(a);
  const band = BUDGETS[a.budget] ?? BUDGETS.open;
  const typeScores = new Map(typeRecs.map((r) => [r.typeId, r.score]));
  const typeScoreTop = typeRecs[0]?.score ?? 1;
  const targets = new Map(
    typeRecs.map((r) => {
      const target = targetLengthMm(r.typeId, a.size, data);
      return [r.typeId, { target, tol: target == null ? 0 : toleranceMm(target) }];
    })
  );
  const ctx = { a, data, band, typeScores, typeScoreTop };

  const pools = typeRecs.map((r) => ix.byType.get(r.typeId).filter((i) => passesHard(i, a, allowed)));
  const plan = relaxationPlan(a, [...targets.values()].some((t) => t.target != null));

  const collect = (relaxedIds, avail) => {
    const relaxed = new Set(relaxedIds);
    const budgetMax = a.budget === 'open' || !Number.isFinite(band.max) ? Infinity : band.max * (relaxed.has('budget') ? BUDGET_RELAXED : BUDGET_TOLERANCE);
    const out = [];
    for (const item of pools.flat()) {
      if (!relaxed.has('grip') && a.grip !== 'any' && item.grip?.style !== a.grip) continue;
      if (!relaxed.has('looks') && !matchesLooks(item, a.looks)) continue;
      const { target, tol } = targets.get(item.type);
      const best = pickSize(item, target, tol, { onlyAvailable: avail, budgetMax, lengthWindow: !relaxed.has('length') });
      if (!best) continue;
      const candidate = { item, size: best.size, sizeIndex: best.index, dist: best.dist, tol, target };
      candidate.score = scoreCandidate(candidate, ctx);
      out.push(candidate);
    }
    return out.sort((p, q) => q.score - p.score || p.item.handle.localeCompare(q.item.handle));
  };

  // Schrittweise lockern, bis genug Treffer da sind. Danach nur die Schritte nennen, die wirklich neue Treffer gebracht haben.
  const wanted = Math.max(1, Math.min(limit, MIN_HITS));
  const mainType = typeRecs[0]?.typeId;
  const mainWanted = Math.min(2, pools[0]?.length ?? 0);
  const enough = (list) => list.length >= wanted && (!mainType || list.filter((c) => c.item.type === mainType).length >= mainWanted);
  let applied = [];
  let candidates = collect(applied, onlyAvailable);
  for (const step of plan) {
    if (enough(candidates)) break;
    applied = [...applied, step];
    candidates = collect(applied, onlyAvailable);
  }
  const tried = applied.map((id) => relaxText(id, a, band)); // alles, was versucht wurde (auch ohne Erfolg)
  for (const step of [...applied].reverse()) {
    const without = applied.filter((s) => s !== step);
    if (collect(without, onlyAvailable).length === candidates.length) applied = without;
  }
  const relaxed = applied.map((id) => relaxText(id, a, band));
  const totalWithUnavailable = onlyAvailable ? collect(applied, false).length : candidates.length;

  const items = arrange(candidates, typeRecs, limit).map((c) => {
    const { reasons, warnings } = explainItem(c, ctx);
    return { item: c.item, sizeIndex: c.sizeIndex, score: c.score, reasons, warnings, priceJpy: c.size.priceJpy ?? null };
  });

  return { items, relaxed, relaxedIds: applied, tried, total: candidates.length, totalWithUnavailable, typeRecs };
}

const comboOf = (c) => `${c.item.steel?.id ?? '?'}|${c.item.grip?.style ?? '?'}`;
const MAX_COMBO_RUN = 3;

/**
 * Bringt die Treffer in eine Reihenfolge, in der nie mehr als MAX_COMBO_RUN gleiche Stahl-/Griffstil-Kombinationen
 * hintereinander stehen. Die Reihenfolge der Eingabe bleibt so weit wie möglich erhalten; ein Element wird nur gesetzt,
 * wenn sich der Rest danach noch ohne zu lange Läufe anordnen lässt (sonst wären die Trenn-Elemente zu früh verbraucht).
 * Besteht der Rest ohnehin nur aus einer Kombination, ist die Wiederholung unvermeidbar.
 */
function limitRuns(list, maxRun = MAX_COMBO_RUN) {
  const rest = [...list];
  const out = [];
  const feasible = (tailKey, tailRun, remaining) => {
    const counts = new Map();
    for (const c of remaining) counts.set(comboOf(c), (counts.get(comboOf(c)) ?? 0) + 1);
    return [...counts].every(([key, m]) => m <= maxRun * (remaining.length - m + 1) - (key === tailKey ? tailRun : 0));
  };
  while (rest.length) {
    const tailKey = out.length ? comboOf(out[out.length - 1]) : null;
    let tailRun = 0;
    for (let i = out.length - 1; i >= 0 && comboOf(out[i]) === tailKey; i -= 1) tailRun += 1;
    const allowed = (c) => !(comboOf(c) === tailKey && tailRun >= maxRun);
    let idx = rest.findIndex((c, i) => allowed(c) && feasible(comboOf(c), comboOf(c) === tailKey ? tailRun + 1 : 1, rest.filter((_, j) => j !== i)));
    if (idx < 0) idx = rest.findIndex(allowed);
    if (idx < 0) idx = 0;
    out.push(...rest.splice(idx, 1));
  }
  return out;
}

/**
 * Auswahl und Reihenfolge der Treffer: Jeder empfohlene Typ bekommt einen Anteil (nach Typ-Score). Innerhalb davon gewinnt die
 * beste Passung; bei ähnlicher Passung wird abwechslungsreich gewählt (Abzug je bereits gezeigter Stahl-/Griff-Kombination und
 * je gezeigtem Stahl). Zum Schluss sorgt limitRuns dafür, dass keine Kombination mehr als dreimal hintereinander steht.
 */
function arrange(sorted, typeRecs, limit) {
  const quotas = allocateQuotas(typeRecs.map((r) => r.score), Math.min(limit, sorted.length));
  const left = new Map(typeRecs.map((r, i) => [r.typeId, quotas[i]]));
  const pool = [...sorted];
  const picked = [];
  const combos = new Map();
  const steels = new Map();
  const value = (c) => c.score - 2 * (combos.get(comboOf(c)) ?? 0) - (steels.get(c.item.steel?.id) ?? 0);
  const choose = (accept) => {
    let best = -1;
    let bestValue = -Infinity;
    pool.forEach((c, i) => {
      if (!accept(c)) return;
      const v = value(c);
      if (v > bestValue) {
        best = i;
        bestValue = v;
      }
    });
    return best;
  };
  while (picked.length < limit && pool.length) {
    let idx = choose((c) => (left.get(c.item.type) ?? 0) > 0);
    if (idx < 0) idx = choose(() => true);
    const [pick] = pool.splice(idx, 1);
    left.set(pick.item.type, (left.get(pick.item.type) ?? 0) - 1);
    combos.set(comboOf(pick), (combos.get(comboOf(pick)) ?? 0) + 1);
    steels.set(pick.item.steel?.id, (steels.get(pick.item.steel?.id) ?? 0) + 1);
    picked.push(pick);
  }
  return limitRuns(picked);
}

// ───────────────────────── Katalog-Abfrage ─────────────────────────

const roundTo = (n, step) => Math.round(n / step) * step;

/**
 * Query-Objekt für #/katalog (Schlüssel: type, rust, grip, hand, price, len, avail; Format wie lib/filters.js). Listen als Arrays
 * (router.href macht daraus „a,b“), price = „min-max“ in Yen (Obergrenze inkl. 10 % Toleranz, offen: „60000-“),
 * len = „min-max“ in mm (Wunschlängen der empfohlenen Typen ± Spielraum), avail = 1.
 */
export function catalogQuery(answers, data, { includeSpecialists = false } = {}) {
  const a = prep(answers, data);
  const recs = recommendTypes(a, data, { includeSpecialists });
  const q = {};
  if (recs.length) q.type = recs.map((r) => r.typeId);
  const allowed = rustAllowed(a);
  if (allowed.length < 3) q.rust = allowed;
  if (a.grip !== 'any') q.grip = a.grip;
  if (a.hand) q.hand = a.hand;
  const band = BUDGETS[a.budget];
  if (band && a.budget !== 'open') {
    q.price = Number.isFinite(band.max) ? `${band.min}-${roundTo(band.max * BUDGET_TOLERANCE, 500)}` : `${band.min}-`; // „60000-“ = ab ¥60.000
  }
  const ranges = recs
    .map((r) => targetLengthMm(r.typeId, a.size, data))
    .filter((t) => t != null)
    .map((t) => [t - toleranceMm(t), t + toleranceMm(t)]);
  if (ranges.length) q.len = `${Math.round(Math.min(...ranges.map((r) => r[0])))}-${Math.round(Math.max(...ranges.map((r) => r[1])))}`;
  q.avail = 1;
  return q;
}

