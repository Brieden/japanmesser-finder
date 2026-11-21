// „Zur Liste hinzufügen“-Dialog: Größe wählen, Person wählen (oder neu anlegen), optional Notiz.
//
//   openPickDialog({ data, item, sizeIndex?, onDone? })   onDone({ person, pick, existed })
import { h } from '../dom.js';
import { shortlist, sizeKeyOf } from '../shortlist.js';
import { jpy, sizeText } from '../format.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { uid } from '../util.js';
import { itemHeadline } from './attrs.js';
import { productPhoto } from './card.js';

export function openPickDialog({ data, item, sizeIndex = 0, onDone } = {}) {
  const people = shortlist.all();
  const active = shortlist.active();
  const head = itemHeadline(data, item);
  const uidn = uid('pick');

  // Vorauswahl: gewünschte Größe, sonst erste vorrätige, sonst erste
  const preferred = item.sizes[sizeIndex] ?? null;
  let sizeSel = preferred && preferred.available ? sizeIndex : item.sizes.findIndex((s) => s.available);
  if (sizeSel < 0) sizeSel = Math.min(sizeIndex, item.sizes.length - 1) || 0;

  const radio = (name, value, checked, label, sub) =>
    h('label', { class: 'choice' },
      h('input', { type: 'radio', name, value: String(value), checked }),
      h('span', { class: 'choice__text' }, h('span', label), sub && h('span', { class: 'choice__sub' }, sub))
    );

  const sizeBlock =
    item.sizes.length > 1
      ? h('fieldset', { class: 'pick__block' },
          h('legend', 'Größe'),
          h('div', { class: 'choices' }, item.sizes.map((s, i) => radio(`${uidn}-size`, i, i === sizeSel, `${sizeText(s)} – ${jpy(s.priceJpy)}`, s.available ? 'Laut Katalog vorrätig' : 'Laut Katalog nicht vorrätig')))
        )
      : h('p', { class: 'muted pick__single' }, `${sizeText(item.sizes[0])} – ${jpy(item.sizes[0]?.priceJpy)} · ${item.sizes[0]?.available ? 'laut Katalog vorrätig' : 'laut Katalog nicht vorrätig'}`);

  const defaultPerson = active?.id ?? people[0]?.id ?? 'new';
  const newName = h('input', { type: 'text', id: `${uidn}-new`, placeholder: 'Name oder Beschreibung, z. B. „Anna“', maxlength: '40', autocomplete: 'off', value: people.length ? '' : '' });
  const personRadios = [
    ...people.map((p) => radio(`${uidn}-person`, p.id, p.id === defaultPerson, p.name, p.picks.length ? `${p.picks.length} vorgemerkt` : 'noch nichts vorgemerkt')),
    people.length ? h('label', { class: 'choice' }, h('input', { type: 'radio', name: `${uidn}-person`, value: 'new', checked: defaultPerson === 'new' }), h('span', { class: 'choice__text' }, h('span', 'Neue Person'), newName)) : null,
  ].filter(Boolean);
  const noteInput = h('input', { type: 'text', id: `${uidn}-note`, placeholder: 'z. B. Wunschlänge, Griff, Farbe', maxlength: '120', autocomplete: 'off' });

  const form = h(
    'form',
    { class: 'pick', onSubmit: (event) => event.preventDefault() },
    h('div', { class: 'pick__item' }, h('div', { class: 'pick__photo' }, productPhoto(item, { width: 160, eager: true })), h('div', h('p', { class: 'pick__title' }, `${head.title}${head.steel ? ` · ${head.steel}` : ''}`), h('p', { class: 'muted small', lang: 'en' }, item.title))),
    sizeBlock,
    h('fieldset', { class: 'pick__block' },
      h('legend', 'Für wen?'),
      people.length ? h('div', { class: 'choices' }, personRadios) : h('div', h('label', { for: `${uidn}-new` }, 'Name oder Beschreibung der Person'), newName)
    ),
    h('div', h('label', { for: `${uidn}-note` }, 'Notiz (optional)'), noteInput),
    h('div', { class: 'cluster' }, h('button', { class: 'btn btn--primary', type: 'submit' }, 'Zur Liste hinzufügen'), h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => dlg.close() }, 'Abbrechen'))
  );

  const dlg = openDialog({ title: 'Zur Liste hinzufügen', body: form });

  // Beim Tippen im Namensfeld „Neue Person“ automatisch auswählen
  newName.addEventListener('input', () => {
    const radioNew = form.querySelector(`input[name="${uidn}-person"][value="new"]`);
    if (radioNew) radioNew.checked = true;
  });

  form.addEventListener('submit', () => {
    const sizeValue = item.sizes.length > 1 ? form.querySelector(`input[name="${uidn}-size"]:checked`)?.value ?? '0' : '0';
    const idx = Number(sizeValue);
    const size = item.sizes[idx];
    const chosen = people.length ? form.querySelector(`input[name="${uidn}-person"]:checked`)?.value ?? 'new' : 'new';

    let person;
    if (chosen === 'new') person = shortlist.add({ name: newName.value });
    else {
      person = shortlist.get(chosen);
      shortlist.setActive(person.id);
    }
    const existedBefore = person.picks.some((k) => k.handle === item.handle && k.sizeKey === sizeKeyOf(size, idx));
    const pick = shortlist.addPick(person.id, { handle: item.handle, sizeKey: sizeKeyOf(size, idx), sizeMm: size?.mm ?? null, note: noteInput.value.trim() });
    toast(existedBefore ? `Schon vorgemerkt für ${person.name}.` : `Für ${person.name} vorgemerkt.`);
    dlg.close();
    onDone?.({ person, pick, existed: existedBefore });
  });

  newName.closest('fieldset')?.querySelector('input[type="radio"]:checked') ?? form.querySelector('input[type="text"]')?.focus();
  return dlg;
}
