import { UiLifetime } from '../ui/uiLifetime.js';
import { t } from '../i18n/index.js';
import { TASK_TEXT_LIMIT } from './checklistStore.js';

/** Accessible DOM only. Text is never parsed as HTML; edits save before navigation can unmount. */
export function createChecklistWidget({ documentRef, store, back, exit }) {
  const lifetime = new UiLifetime();
  let rows = new UiLifetime();
  const element = (tag, text) => {
    const el = documentRef.createElement(tag);
    if (text) el.textContent = text;
    return el;
  };
  const root = element('section');
  root.className = 'workspace-ui__content';
  root.setAttribute('aria-label', t('Task checklist'));
  const nav = element('nav');
  nav.className = 'workspace-ui__nav';
  nav.setAttribute('aria-label', t('Workspace'));
  const backButton = element('button', t('Back to desk'));
  const exitButton = element('button', t('Exit workspace'));
  nav.append(backButton, element('span', t('Workspace')), exitButton);
  const heading = element('h1', t('Task checklist'));
  const storage = element('p');
  const form = element('form');
  const label = element('label', t('New task'));
  const input = element('input');
  input.type = 'text';
  input.maxLength = TASK_TEXT_LIMIT;
  input.required = true;
  label.append(input);
  const add = element('button', t('Add task'));
  add.type = 'submit';
  form.append(label, add);
  const status = element('p');
  status.className = 'workspace-ui__status';
  status.setAttribute('role', 'status');
  const empty = element('p', t('No tasks yet.'));
  const list = element('ul');
  list.setAttribute('aria-label', t('Tasks'));
  root.append(nav, heading, storage, form, status, empty, list);
  const render = () => {
    const state = store.getState();
    storage.textContent = state.persistent
      ? t('Saved locally on this device.')
      : t('Storage unavailable. Changes last for this page only.');
    empty.hidden = state.tasks.length > 0;
    rows.destroy();
    rows = new UiLifetime();
    list.replaceChildren();
    for (const task of state.tasks) {
      const row = element('li');
      row.dataset.done = String(task.done);
      const label = element('label');
      const check = element('input');
      check.type = 'checkbox';
      check.checked = task.done;
      const text = element('span', task.text);
      label.append(check, text);
      const remove = element('button', t('Delete task'));
      remove.setAttribute(
        'aria-label',
        t('Delete task: {task}', { task: task.text }),
      );
      rows.listen(check, 'change', () => {
        store.toggle(task.id);
        // Preserve the native checkbox and its focus during keyboard toggling.
        row.dataset.done = String(check.checked);
        storage.textContent = store.getState().persistent
          ? t('Saved locally on this device.')
          : t('Storage unavailable. Changes last for this page only.');
      });
      rows.listen(remove, 'click', () => {
        store.delete(task.id);
        render();
        input.focus({ preventScroll: true });
      });
      row.append(label, remove);
      list.append(row);
    }
  };
  lifetime.listen(form, 'submit', (event) => {
    event.preventDefault();
    if (!store.add(input.value)) {
      status.textContent = t('Use 1–240 characters, up to 100 tasks.');
      return;
    }
    input.value = '';
    status.textContent = '';
    render();
    input.focus({ preventScroll: true });
  });
  lifetime.listen(backButton, 'click', back);
  lifetime.listen(exitButton, 'click', exit);
  render();
  return {
    root,
    input,
    render,
    dispose() {
      rows.destroy();
      lifetime.destroy();
    },
  };
}
