import test from 'node:test';
import assert from 'node:assert/strict';
import { createChecklistStore } from './checklistStore.js';
const memory = () => {
  const data = new Map();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
};
const make = (storage, extra = {}) => {
  let id = 0;
  return createChecklistStore({
    workspaceId: 'w',
    stateKey: 's',
    getStorage: () => storage,
    makeId: () => `task-${++id}`,
    ...extra,
  });
};
test('add/toggle/delete save synchronously; fresh presentation/reload restores bounded plain data', () => {
  const storage = memory(),
    a = make(storage);
  assert.equal(a.add('  <b>literal text</b>  '), true);
  assert.equal(a.toggle('task-1'), true);
  const b = make(storage);
  assert.deepEqual(b.getState().tasks, [
    { id: 'task-1', text: '<b>literal text</b>', done: true },
  ]);
  b.getState().tasks[0].text = 'mutated';
  assert.equal(b.getState().tasks[0].text, '<b>literal text</b>');
  b.delete('task-1');
  assert.deepEqual(make(storage).getState().tasks, []);
});
for (const raw of [
  '{',
  'null',
  '{}',
  JSON.stringify({ version: 2, tasks: [] }),
  JSON.stringify({
    version: 1,
    tasks: Array(101).fill({ id: 'a', text: 'x', done: false }),
  }),
  JSON.stringify({
    version: 1,
    tasks: [
      { id: 'a', text: 'x', done: false },
      { id: 'a', text: 'x', done: true },
    ],
  }),
  JSON.stringify({ version: 1, tasks: [{ id: 'a', text: '', done: false }] }),
  JSON.stringify({ version: 1, tasks: [{ id: 'a', text: 'x', done: 'yes' }] }),
  ' '.repeat(262145),
]) {
  test(`corruption rejected atomically (${raw.length} chars, ${raw.slice(0, 20)})`, () => {
    const s = memory();
    s.setItem('gev:workspace-checklist:v1:w:s', raw);
    const store = make(s);
    assert.deepEqual(store.getState().tasks, []);
    assert.equal(store.add('recover'), true);
    assert.equal(make(s).getState().tasks[0].text, 'recover');
  });
}
test('security/quota/read failures retain usable in-memory state across edits', () => {
  for (const getStorage of [
    () => {
      throw Error('SecurityError');
    },
    () => ({
      getItem() {
        throw Error('read');
      },
      setItem() {
        throw Error('quota');
      },
    }),
    () => ({
      getItem: () => null,
      setItem() {
        throw Error('quota');
      },
    }),
  ]) {
    const a = make(null, { getStorage });
    assert.equal(a.add('keep'), true);
    assert.equal(a.toggle('task-1'), true);
    assert.equal(a.getState().persistent, false);
    assert.equal(a.getState().tasks[0].done, true);
  }
});
test('limits, duplicate IDs and independent state keys; worst-case escaped text round-trips', () => {
  const storage = memory(),
    a = make(storage);
  assert.equal(a.add(' '), false);
  assert.equal(a.add('x'.repeat(241)), false);
  for (let i = 0; i < 100; i++) assert.equal(a.add('\u0000'.repeat(240)), true);
  assert.equal(a.add('overflow'), false);
  assert.equal(make(storage).getState().tasks.length, 100);
  assert.deepEqual(make(storage, { stateKey: 'other' }).getState().tasks, []);
  const b = make(memory(), { makeId: () => '' });
  assert.equal(b.add('invalid ID'), false);
  const c = make(memory(), { makeId: () => 'same' });
  assert.equal(c.add('first'), true);
  assert.equal(c.add('duplicate'), false);
});
