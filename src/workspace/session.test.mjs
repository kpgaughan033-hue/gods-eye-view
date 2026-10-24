import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSession } from './session.js';

const delayed = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('construction is inert; acquire is shared, activate idempotent, release reverse ordered', async () => {
  const log = [];
  const session = createWorkspaceSession({
    acquire({ defer }) {
      log.push('acquire');
      const dispose = () => log.push('parent');
      defer(dispose);
      defer(() => log.push('child'));
      return { activate: () => log.push('show'), dispose };
    },
  });
  assert.equal(session.getState(), 'idle');
  assert.deepEqual(log, []);
  const a = session.acquire(),
    b = session.acquire();
  assert.equal(a, b);
  assert.equal(await a, true);
  assert.equal(session.getState(), 'acquired');
  await Promise.all([session.activate(), session.activate()]);
  assert.equal(session.getState(), 'active');
  session.deactivate();
  session.deactivate();
  assert.deepEqual(log, ['acquire', 'show', 'child', 'parent']);
  assert.equal(await session.activate(), true);
  session.dispose();
  session.dispose();
  assert.equal(await session.activate(), false);
  assert.equal(session.getState(), 'disposed');
  assert.deepEqual(log.slice(4), ['acquire', 'show', 'child', 'parent']);
});

test('partial acquisition failure drains all registered resources and permits retry', async () => {
  const log = [];
  const session = createWorkspaceSession({
    acquire({ defer }) {
      defer(() => log.push(1));
      defer(() => log.push(2));
      throw Error('partial');
    },
  });
  await assert.rejects(session.acquire(), /partial/);
  assert.deepEqual(log, [2, 1]);
  assert.equal(session.getState(), 'idle');
  await assert.rejects(session.acquire(), /partial/);
  session.dispose();
  assert.deepEqual(log, [2, 1, 2, 1]);
});

test('deactivate promptly settles an uncooperative acquisition; late handles never activate', async () => {
  const gate = delayed();
  const log = [];
  let lateDefer;
  const session = createWorkspaceSession({
    async acquire({ defer, signal }) {
      lateDefer = defer;
      defer(() => log.push('early'));
      await gate.promise;
      assert.equal(signal.aborted, true);
      return {
        activate: () => log.push('BAD show'),
        dispose: () => log.push('late'),
      };
    },
  });
  const active = session.activate();
  await tick();
  session.deactivate();
  assert.equal(await active, false);
  assert.deepEqual(log, ['early']);
  lateDefer(() => log.push('late partial'));
  gate.resolve();
  await tick();
  assert.deepEqual(log, ['early', 'late partial', 'late']);
  assert.equal(session.getState(), 'idle');
});

test('late old generation cannot replace or dispose a new active presentation', async () => {
  const gate = delayed();
  const log = [];
  let count = 0;
  const session = createWorkspaceSession({
    async acquire() {
      const id = ++count;
      if (id === 1) await gate.promise;
      return {
        activate: () => log.push(`show ${id}`),
        dispose: () => log.push(`dispose ${id}`),
      };
    },
  });
  const old = session.activate();
  await tick();
  session.deactivate();
  assert.equal(await old, false);
  await session.activate();
  gate.resolve();
  await tick();
  assert.equal(session.getState(), 'active');
  assert.deepEqual(log, ['show 2', 'dispose 1']);
  session.dispose();
  assert.deepEqual(log, ['show 2', 'dispose 1', 'dispose 2']);
});

test('application abort disposes active work and already-aborted construction stays inert', async () => {
  const controller = new AbortController();
  let releases = 0,
    acquisitions = 0;
  const acquire = () => {
    acquisitions++;
    return {
      activate() {},
      dispose() {
        releases++;
      },
    };
  };
  const session = createWorkspaceSession({
    acquire,
    signal: controller.signal,
  });
  await session.activate();
  controller.abort();
  session.dispose();
  assert.equal(releases, 1);
  const inactive = createWorkspaceSession({
    acquire,
    signal: controller.signal,
  });
  assert.equal(await inactive.acquire(), false);
  assert.equal(acquisitions, 1);
});

test('destroy during async acquisition releases late resources exactly once', async () => {
  const gate = delayed();
  const controller = new AbortController();
  let releases = 0;
  const dispose = () => {
    releases++;
  };
  const session = createWorkspaceSession({
    signal: controller.signal,
    async acquire({ defer }) {
      defer(dispose);
      await gate.promise;
      return {
        activate() {
          assert.fail('late activation');
        },
        dispose,
      };
    },
  });
  const pending = session.activate();
  await tick();
  controller.abort();
  assert.equal(await pending, false);
  gate.resolve();
  await tick();
  assert.equal(releases, 1);
  assert.equal(session.getState(), 'disposed');
});

test('activation failure and cleanup errors release siblings in reverse order', async () => {
  const log = [];
  const session = createWorkspaceSession({
    acquire({ defer }) {
      defer(() => log.push('first'));
      return {
        activate() {
          throw Error('show failed');
        },
        dispose() {
          log.push('last');
          throw Error('release failed');
        },
      };
    },
  });
  await assert.rejects(session.activate(), AggregateError);
  assert.deepEqual(log, ['last', 'first']);
  assert.equal(session.getState(), 'idle');
  session.dispose();
});

test('late rejection after cancellation is handled and cannot change disposed state', async () => {
  const gate = delayed();
  const session = createWorkspaceSession({ acquire: () => gate.promise });
  const pending = session.activate();
  await tick();
  session.dispose();
  assert.equal(await pending, false);
  gate.reject(Error('late failure'));
  await tick();
  assert.equal(session.getState(), 'disposed');
});

test('twenty activation cycles leave no owned resources', async () => {
  let live = 0;
  const session = createWorkspaceSession({
    acquire({ defer }) {
      for (let i = 0; i < 4; i++) {
        live++;
        defer(() => live--);
      }
      return { activate() {}, dispose() {} };
    },
  });
  for (let i = 0; i < 20; i++) {
    await session.activate();
    assert.equal(live, 4);
    session.deactivate();
    assert.equal(live, 0);
  }
  session.dispose();
});
