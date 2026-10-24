export const TASK_LIMIT = 100;
export const TASK_TEXT_LIMIT = 240;
const MAX_BYTES = 262144;

/** Local plain data outlives a presentation, not the application owner. No IO beyond storage. */
export function createChecklistStore({
  workspaceId,
  stateKey,
  getStorage = () => globalThis.localStorage,
  makeId = () => globalThis.crypto.randomUUID(),
}) {
  const key = `gev:workspace-checklist:v1:${workspaceId}:${stateKey}`;
  let tasks = [],
    storage = null,
    persistent = true;
  try {
    storage = getStorage();
    if (!storage) throw Error('No storage');
    const raw = storage.getItem(key);
    if (raw !== null) {
      if (typeof raw !== 'string' || raw.length > MAX_BYTES)
        throw Error('Invalid checklist');
      const data = JSON.parse(raw);
      if (
        data?.version !== 1 ||
        !Array.isArray(data.tasks) ||
        data.tasks.length > TASK_LIMIT
      )
        throw Error('Invalid checklist');
      const ids = new Set();
      for (const task of data.tasks) {
        if (
          !task ||
          typeof task.id !== 'string' ||
          !task.id.length ||
          task.id.length > 128 ||
          ids.has(task.id) ||
          typeof task.text !== 'string' ||
          !task.text.trim() ||
          task.text.length > TASK_TEXT_LIMIT ||
          typeof task.done !== 'boolean'
        )
          throw Error('Invalid checklist');
        ids.add(task.id);
      }
      tasks = data.tasks.map(({ id, text, done }) => ({ id, text, done }));
    }
  } catch {
    // Corrupt records are ignored, not merged or rendered. A later edit can replace them.
    tasks = [];
    persistent = false;
  }
  const snapshot = () => ({ tasks: tasks.map((t) => ({ ...t })), persistent });
  function save() {
    try {
      if (!storage) throw Error('No storage');
      storage.setItem(key, JSON.stringify({ version: 1, tasks }));
      persistent = true;
    } catch {
      persistent = false;
    }
  }
  return Object.freeze({
    getState: snapshot,
    add(text) {
      if (
        typeof text !== 'string' ||
        !text.trim() ||
        text.trim().length > TASK_TEXT_LIMIT ||
        tasks.length >= TASK_LIMIT
      )
        return false;
      const id = makeId();
      if (
        typeof id !== 'string' ||
        !id.length ||
        id.length > 128 ||
        tasks.some((t) => t.id === id)
      )
        return false;
      tasks.push({ id, text: text.trim(), done: false });
      save();
      return true;
    },
    toggle(id) {
      const task = tasks.find((t) => t.id === id);
      if (!task) return false;
      task.done = !task.done;
      save();
      return true;
    },
    delete(id) {
      const next = tasks.filter((t) => t.id !== id);
      if (next.length === tasks.length) return false;
      tasks = next;
      save();
      return true;
    },
  });
}
