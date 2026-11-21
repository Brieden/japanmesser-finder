// Modal-Dialog auf Basis von <dialog>: openDialog({ title, body, sheet }) → <dialog>-Element
// Klick auf den Hintergrund oder Esc schließt; Fokus kehrt automatisch zurück (natives Verhalten).
import { h } from '../dom.js';
import { icon } from '../icons.js';

let counter = 0;

export function openDialog({ title, body, sheet = true, onClose } = {}) {
  const titleId = `dlg-title-${++counter}`;
  const dlg = h(
    'dialog',
    { class: ['dialog', sheet && 'dialog--sheet'], 'aria-labelledby': titleId },
    h(
      'div',
      { class: 'dialog__head' },
      h('h2', { id: titleId }, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', onClick: () => dlg.close() }, icon('close'))
    ),
    h('div', { class: 'dialog__body' }, body)
  );
  dlg.addEventListener('click', (event) => {
    if (event.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  document.body.appendChild(dlg);
  dlg.showModal();
  return dlg;
}
