// #/liste – „Für wen?“-Einkaufsliste: Personen, Vormerkungen, Summen, Zoll-Orientierung, Kopieren/Drucken/Zeigen im Laden.
import { h, rich, loadCss, assetUrl } from '../dom.js';
import { icon } from '../icons.js';
import { prefs } from '../prefs.js';
import { shortlist, resolvePick, totalJpy, listAsText, sizeKeyOf } from '../shortlist.js';
import { jpy, money, convert, priceParts, sizeText, dateDe, count } from '../format.js';
import { itemHeadline } from '../ui/attrs.js';
import { productPhoto } from '../ui/card.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';

export const title = 'Meine Liste';

let unsubs = [];
let activeDialog = null;

export function destroy() {
  unsubs.forEach((fn) => fn());
  unsubs = [];
  activeDialog?.close();
  activeDialog = null;
}

const CURRENCIES = [
  ['EUR', 'Euro'],
  ['CHF', 'Franken'],
  ['JPY', 'Yen'],
];

export async function render(ctx) {
  await loadCss(assetUrl('assets/css/views/liste.css'));
  const { data } = ctx;
  const root = h('div', { class: 'liste' });
  let pending = null; // Fokus nach Neuaufbau wiederherstellen: data-focus-Schlüssel

  const redraw = () => {
    const active = document.activeElement?.dataset?.focus;
    root.replaceChildren(build(ctx, redraw));
    const key = pending ?? active;
    pending = null;
    if (key) root.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus();
  };
  ctx.focusAfter = (key) => (pending = key);

  unsubs.push(shortlist.subscribe(redraw), prefs.subscribe(redraw));
  redraw();
  return root;
}

function build(ctx, redraw) {
  const { data } = ctx;
  const people = shortlist.all();
  const p = prefs.get();
  const total = people.reduce((n, person) => n + person.picks.length, 0);

  if (!people.length || (people.length === 1 && !total && !people[0].profile)) return emptyState(ctx, people);

  const grand = people.reduce((acc, person) => {
    const t = totalJpy(person, data.byHandle);
    return { sum: acc.sum + t.sum, missing: acc.missing + t.missing };
  }, { sum: 0, missing: 0 });

  return h(
    'section',
    { class: 'container section stack liste__main' },
    h(
      'header',
      { class: 'liste__head' },
      h('div', null, h('p', { class: 'eyebrow' }, 'Einkaufsliste'), h('h1', 'Meine Liste'), h('p', { class: 'muted' }, `${count(total, 'Messer', 'Messer')} für ${count(people.length, 'Person', 'Personen')} vorgemerkt. Preise in Yen laut Online-Katalog, die Euro-/Franken-Angabe ist nur Orientierung.`)),
      h('p', { class: 'liste__printhead' }, `Stand ${dateDe(new Date().toISOString())} · Preise laut Online-Katalog (${dateDe(data.meta.fetchedAt)}), Bestand im Laden kann abweichen.`)
    ),
    h(
      'div',
      { class: 'liste__actions no-print' },
      h('button', { class: 'btn btn--accent', type: 'button', disabled: !total, onClick: () => showInStore(ctx) }, icon('store'), 'Im Laden zeigen'),
      h('button', { class: 'btn', type: 'button', disabled: !total, onClick: () => copyText(ctx) }, icon('copy'), 'Als Text kopieren'),
      h('button', { class: 'btn', type: 'button', disabled: !total, onClick: () => window.print() }, icon('print'), 'Drucken'),
      h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { const person = shortlist.add({}); ctx.focusAfter(`name-${person.id}`); redraw(); } }, icon('plus'), 'Neue Person')
    ),
    currencyBar(ctx),
    ...people.map((person) => personSection(ctx, person, redraw)),
    people.length > 1 || total ? totalsBox(ctx, grand) : null,
    customsBox(ctx, grand)
  );
}

function emptyState(ctx, people) {
  return h(
    'section',
    { class: 'container container--narrow section stack' },
    h('h1', 'Meine Liste'),
    h(
      'div',
      { class: 'empty' },
      h('div', { class: 'empty__mark', lang: 'ja', 'aria-hidden': 'true' }, '刃'),
      h('h2', 'Noch nichts vorgemerkt'),
      h('p', 'Hier sammelst du Messer je Person („Für wen?“) und nimmst die Liste mit in den Laden: mit Größe, Preis in Yen, Originaltitel und Artikelnummer, zum Zeigen, Drucken oder Kopieren. Die Liste bleibt in deinem Browser.'),
      h(
        'div',
        { class: 'cluster', style: { justifyContent: 'center' } },
        h('a', { class: 'btn btn--primary', href: ctx.router.href('/finder') }, icon('compass'), 'Zum Finder'),
        h('a', { class: 'btn', href: ctx.router.href('/katalog') }, icon('search'), 'Katalog durchsuchen')
      )
    ),
    people.length ? h('p', { class: 'muted' }, `Angelegt: ${people[0].name}. `, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => { shortlist.remove(people[0].id); } }, 'Entfernen')) : null
  );
}

function currencyBar(ctx) {
  const p = prefs.get();
  const rates = ctx.data.site?.rates;
  return h(
    'div',
    { class: 'liste__currency no-print' },
    h('div', { class: 'cluster' }, h('span', { id: 'cur-label', class: 'muted' }, 'Orientierung in'), h(
      'div',
      { class: 'segmented', role: 'group', 'aria-labelledby': 'cur-label' },
      CURRENCIES.map(([code, name]) => h('button', { type: 'button', 'aria-pressed': String(p.currency === code), 'aria-label': name, onClick: () => prefs.set({ currency: code }) }, code))
    )),
    rates ? h('p', { class: 'muted liste__rate' }, `${rates.source} vom ${dateDe(rates.asOf)}: 1 € = ¥${String(rates.perUnit.EUR).replace('.', ',')}, 1 CHF = ¥${String(rates.perUnit.CHF).replace('.', ',')}`) : null
  );
}

function priceLine(ctx, amount) {
  const { main, alt } = priceParts(amount, { currency: prefs.get().currency, rates: ctx.data.rates });
  return h('span', { class: 'price' }, h('span', { class: 'price__main' }, main), alt && h('span', { class: 'price__alt' }, alt));
}

function sumLine(ctx, sum, missing) {
  return h('span', { class: 'liste__sumvals' }, priceLine(ctx, sum), missing ? h('span', { class: 'chip chip--warn' }, `${count(missing, 'Eintrag', 'Einträge')} ohne Preis`) : null);
}

function personSection(ctx, person, redraw) {
  const { data } = ctx;
  const t = totalJpy(person, data.byHandle);
  const nameId = `name-${person.id}`;
  const commitName = (input) => {
    const v = input.value.trim();
    if (v && v !== person.name) shortlist.rename(person.id, v);
    else input.value = person.name;
  };
  return h(
    'section',
    { class: 'card liste__person', 'aria-labelledby': `h-${person.id}` },
    h(
      'div',
      { class: 'card__body stack' },
      h(
        'div',
        { class: 'liste__personhead' },
        h(
          'div',
          { class: 'liste__name' },
          h('h2', { id: `h-${person.id}`, class: 'liste__nameprint' }, `Für ${person.name}`),
          h('label', { class: 'no-print', for: nameId }, 'Name der Person'),
          h('input', { class: 'no-print', type: 'text', id: nameId, value: person.name, maxlength: 40, 'data-focus': nameId, autocomplete: 'off', onChange: (e) => commitName(e.target), onKeydown: (e) => e.key === 'Enter' && e.target.blur() })
        ),
        h(
          'div',
          { class: 'cluster no-print' },
          h('a', { class: 'btn btn--sm', href: ctx.router.href('/finder', { for: person.id }) }, icon('compass'), 'Finder für diese Person'),
          h('button', { class: 'btn btn--sm btn--ghost', type: 'button', onClick: () => confirmDelete(person) }, icon('trash'), 'Person löschen')
        )
      ),
      person.profile?.summary ? profileChips(person.profile.summary) : null,
      person.picks.length
        ? h('ul', { class: 'liste__picks', role: 'list' }, person.picks.map((pick) => pickRow(ctx, person, pick)))
        : h('p', { class: 'muted' }, 'Noch keine Messer vorgemerkt. ', h('a', { href: ctx.router.href('/katalog') }, 'Im Katalog stöbern'), ' oder ', h('a', { href: ctx.router.href('/finder', { for: person.id }) }, 'den Finder nutzen'), '.'),
      person.picks.length ? h('p', { class: 'liste__sum' }, h('span', null, `Summe ${person.name}`), sumLine(ctx, t.sum, t.missing)) : null
    )
  );
}

function profileChips(summary) {
  const parts = Array.isArray(summary) ? summary : String(summary).split(/\s*[·|;]\s*/);
  return h('div', { class: 'cluster liste__profile', 'aria-label': 'Profil' }, parts.filter(Boolean).map((s) => h('span', { class: 'chip chip--outline' }, String(s))));
}

function pickRow(ctx, person, pick) {
  const { data } = ctx;
  const r = resolvePick(pick, data.byHandle);
  const rowId = `pick-${pick.id}`;
  if (!r.item) {
    return h(
      'li',
      { class: 'liste__pick liste__pick--gone' },
      h('div', { class: 'liste__body' },
        h('p', { class: 'liste__title' }, h('span', { class: 'chip chip--warn' }, 'Nicht mehr im Katalog'), ' ', h('span', { lang: 'en' }, pick.handle)),
        h('p', { class: 'muted' }, 'Der Artikel ist in den aktuellen Katalogdaten nicht mehr vorhanden. Der Eintrag bleibt als Merkzettel erhalten.'),
        noteField(person, pick, rowId)
      ),
      h('button', { class: 'btn btn--sm btn--ghost no-print', type: 'button', onClick: () => shortlist.removePick(person.id, pick.id) }, icon('trash'), 'Entfernen')
    );
  }
  const head = itemHeadline(data, r.item);
  const sizes = r.item.sizes;
  const currentKey = r.size ? sizeKeyOf(r.size, sizes.indexOf(r.size)) : pick.sizeKey;
  const sizeId = `size-${pick.id}`;
  return h(
    'li',
    { class: 'liste__pick' },
    h('a', { class: 'liste__photo', href: ctx.router.href(`/messer/${r.item.handle}`), 'aria-label': `Details: ${r.item.title}`, tabindex: -1 }, productPhoto(r.item, { width: 160 })),
    h(
      'div',
      { class: 'liste__body' },
      h('p', { class: 'liste__title' }, h('a', { href: ctx.router.href(`/messer/${r.item.handle}`) }, head.title), head.steel ? h('span', { class: 'muted' }, ` · ${head.steel}`) : null),
      h('p', { class: 'liste__orig', lang: 'en' }, r.item.title),
      h(
        'div',
        { class: 'liste__meta' },
        sizes.length > 1
          ? h('div', { class: 'liste__size' }, h('label', { for: sizeId }, 'Größe'), h(
              'select',
              { id: sizeId, 'data-focus': sizeId, onChange: (e) => changeSize(ctx, person, pick, sizes, e.target.value, sizeId) },
              sizes.map((s, i) => h('option', { value: sizeKeyOf(s, i), selected: sizeKeyOf(s, i) === currentKey }, `${sizeText(s)}${s.available ? '' : ' (nicht vorrätig)'}`))
            ))
          : h('p', { class: 'liste__size' }, h('span', { class: 'muted' }, 'Größe '), h('strong', sizes[0] ? sizeText(sizes[0]) : 'nicht angegeben')),
        priceLine(ctx, r.priceJpy),
        r.available == null ? null : h('span', { class: ['chip', r.available ? 'chip--ok' : 'chip--warn'] }, r.available ? 'Laut Katalog vorrätig' : 'Laut Katalog nicht vorrätig'),
        r.size?.sku ? h('span', { class: 'liste__sku muted' }, 'Art.-Nr. ', h('span', { class: 'mono' }, r.size.sku)) : null
      ),
      noteField(person, pick, rowId)
    ),
    h('button', { class: 'btn btn--sm btn--ghost no-print liste__remove', type: 'button', 'aria-label': `${head.title} entfernen`, onClick: () => shortlist.removePick(person.id, pick.id) }, icon('trash'), 'Entfernen')
  );
}

function noteField(person, pick, rowId) {
  const id = `note-${pick.id}`;
  return h(
    'div',
    { class: 'liste__note' },
    h('label', { for: id, class: 'no-print' }, 'Notiz'),
    h('input', { type: 'text', id, class: 'no-print', value: pick.note ?? '', maxlength: 200, placeholder: 'z. B. Rechtshänder, Geschenk, nach Alternative fragen', autocomplete: 'off', onChange: (e) => shortlist.updatePick(person.id, pick.id, { note: e.target.value.trim() }) }),
    pick.note ? h('p', { class: 'liste__noteprint' }, `Notiz: ${pick.note}`) : null
  );
}

function changeSize(ctx, person, pick, sizes, key, focusKey) {
  const idx = sizes.findIndex((s, i) => sizeKeyOf(s, i) === key);
  if (idx < 0) return;
  const dup = shortlist.get(person.id)?.picks.find((k) => k.handle === pick.handle && k.sizeKey === key && k.id !== pick.id);
  if (dup) {
    toast('Diese Größe ist für die Person schon vorgemerkt.');
    ctx.focusAfter(focusKey);
    shortlist.updatePick(person.id, pick.id, {}); // Neuaufbau, Auswahl zurücksetzen
    return;
  }
  ctx.focusAfter(focusKey);
  shortlist.updatePick(person.id, pick.id, { sizeKey: key, sizeMm: sizes[idx].mm ?? null });
}

function confirmDelete(person) {
  const dlg = openDialog({
    title: 'Person löschen?',
    sheet: true,
    body: h(
      'div',
      { class: 'stack' },
      h('p', `„${person.name}“ und ${count(person.picks.length, 'Vormerkung', 'Vormerkungen')} werden aus deiner Liste entfernt. Das lässt sich nicht rückgängig machen.`),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => { shortlist.remove(person.id); dlg.close(); toast('Person gelöscht'); } }, icon('trash'), 'Löschen'),
        h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Abbrechen'))
    ),
  });
}

function totalsBox(ctx, grand) {
  return h(
    'section',
    { class: 'card liste__total', 'aria-labelledby': 'total-h' },
    h('div', { class: 'card__body' }, h('h2', { id: 'total-h', class: 'liste__totalh' }, 'Gesamtsumme'), sumLine(ctx, grand.sum, grand.missing),
      h('p', { class: 'muted' }, 'Preise in Yen laut Online-Katalog (in Japan üblicherweise inkl. Verbrauchsteuer). Ob und wie viel Steuer erstattet wird, hängt vom Erstattungsverfahren ab.'))
  );
}

function customsBox(ctx, grand) {
  const c = ctx.data.site?.customs;
  const rates = ctx.data.rates;
  const cur = prefs.get().currency;
  if (!c) return null;
  const regions = cur === 'EUR' ? ['EU'] : cur === 'CHF' ? ['CH'] : ['EU', 'CH'];
  const lines = regions.map((key) => {
    const r = c[key];
    if (!r) return null;
    const amount = convert(grand.sum, r.currency, rates);
    if (amount == null) return null;
    const under = amount <= r.limit;
    return h(
      'li',
      null,
      h('span', { class: ['chip', under ? 'chip--ok' : 'chip--warn'] }, under ? 'Unter der Grenze' : 'Über der Grenze'),
      ' ',
      `${r.label}: Die Summe von ${money(amount, r.currency)} liegt ${under ? 'unter' : 'über'} der Freigrenze von ${money(r.limit, r.currency)}.${grand.missing ? ' Einträge ohne Preis sind nicht eingerechnet.' : ''}`
    );
  }).filter(Boolean);
  return h(
    'section',
    { class: 'notice notice--info liste__customs no-print', 'aria-labelledby': 'customs-h' },
    h('div', { class: 'stack' },
      h('h2', { id: 'customs-h', class: 'liste__totalh' }, 'Zoll & Steuer – Orientierung'),
      lines.length ? h('ul', { class: 'liste__customslist', role: 'list' }, lines) : h('p', 'Für die gewählte Währung lässt sich kein Vergleich berechnen.'),
      h('p', null, 'Japan erstattet Touristen die Verbrauchsteuer seit dem 1.11.2026 im Erstattungsverfahren: Der Mindestbetrag liegt bei 5.000 ¥ ohne Steuer je Einkauf, und die Zollbestätigung muss bei der Ausreise innerhalb von 90 Tagen vorliegen.'),
      h('p', { class: 'muted' }, `${c.note ?? 'Orientierung, keine Rechtsberatung.'} Stand der Grenzwerte: ${dateDe(c.asOf)}. `, h('a', { href: ctx.router.href('/wissen/mitbringen') }, 'Mehr dazu: Messer mitbringen'), '.')
    )
  );
}

// ── Aktionen ──

function copyText(ctx) {
  const text = listAsText(shortlist.all(), { byHandle: ctx.data.byHandle, t: ctx.data.t, rates: ctx.data.rates, currency: prefs.get().currency });
  const fallback = () => {
    const ta = h('textarea', { rows: 12, readonly: true, 'aria-label': 'Liste als Text', class: 'liste__ta' });
    ta.value = text;
    const dlg = openDialog({ title: 'Liste als Text', body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Kopieren war nicht möglich. Markiere den Text und kopiere ihn von Hand.'), ta) });
    ta.focus();
    ta.select();
    return dlg;
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('Liste als Text kopiert'), fallback);
  else fallback();
}

function showInStore(ctx) {
  const { data } = ctx;
  const cards = shortlist.all().flatMap((person) => person.picks.map((pick) => ({ person, pick, r: resolvePick(pick, data.byHandle) })));
  if (!cards.length) return;
  let i = 0;
  const stage = h('div', { class: 'show__stage', 'aria-live': 'polite' });
  const pos = h('span', { class: 'show__pos' });
  const prev = h('button', { class: 'btn', type: 'button', onClick: () => go(-1) }, icon('arrow-left'), 'Zurück');
  const next = h('button', { class: 'btn btn--primary', type: 'button', onClick: () => go(1) }, 'Weiter', icon('arrow-right'));
  const go = (d) => { i = Math.min(cards.length - 1, Math.max(0, i + d)); draw(); };
  const draw = () => {
    const { person, pick, r } = cards[i];
    const typeName = r.item ? itemHeadline(data, r.item).title : 'Nicht mehr im Katalog';
    stage.replaceChildren(
      h('p', { class: 'show__who' }, `Für ${person.name}`),
      h('p', { class: 'show__type' }, typeName),
      h('p', { class: 'show__size' }, r.size ? sizeText(r.size) : 'Größe nicht angegeben'),
      h('p', { class: 'show__orig', lang: 'en' }, r.item?.title ?? pick.handle),
      r.size?.sku ? h('p', { class: 'show__sku' }, 'Art.-Nr. ', h('span', { class: 'mono' }, r.size.sku)) : null,
      h('p', { class: 'show__price' }, jpy(r.priceJpy)),
      pick.note ? h('p', { class: 'show__note' }, pick.note) : null
    );
    pos.textContent = `${i + 1} von ${cards.length}`;
    prev.disabled = i === 0;
    next.disabled = i === cards.length - 1;
  };
  draw();
  activeDialog = openDialog({
    title: 'Im Laden zeigen',
    sheet: false,
    body: h('div', { class: 'show' }, stage, h('div', { class: 'show__nav' }, prev, pos, next)),
    onClose: () => (activeDialog = null),
  });
  activeDialog.classList.add('dialog--show');
  activeDialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  });
}
