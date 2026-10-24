import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installWorkspaceDevelopmentEntry,
  workspacePrototypeEnabled,
} from './developmentEntry.js';
import { createApplication } from '../app/application.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const log = [],
    cleanups = [];
  const controller = new AbortController();
  const debug = {};
  let resolve;
  const loaded = new Promise((done) => {
    resolve = done;
  });
  const entry = installWorkspaceDevelopmentEntry({
    viewer: { identity: 'borrowed' },
    signal: controller.signal,
    defer: (fn) => cleanups.push(fn),
    debug,
    load: () => {
      log.push('load');
      return loaded;
    },
  });
  const module = {
    createWorkspacePrototypeAdapter({ viewer }) {
      assert.equal(viewer.identity, 'borrowed');
      log.push('adapter');
      return {
        acquire() {
          log.push('acquire');
          return {
            activate: () => log.push('show'),
            dispose: () => log.push('dispose'),
          };
        },
      };
    },
  };
  return {
    entry,
    log,
    cleanups,
    controller,
    debug,
    complete: () => resolve(module),
  };
}

test('entry requires an explicit development-only query flag', () => {
  for (const development of [false, undefined])
    assert.equal(
      workspacePrototypeEnabled({
        development,
        search: '?workspacePrototype=1',
      }),
      false,
    );
  for (const search of [
    '',
    '?workspacePrototype=0',
    '?workspacePrototype=true',
  ])
    assert.equal(
      workspacePrototypeEnabled({ development: true, search }),
      false,
    );
  assert.equal(
    workspacePrototypeEnabled({
      development: true,
      search: '?workspacePrototype=1',
    }),
    true,
  );
});

for (const kind of ['globe handoff', 'manual input']) {
  test(`newer ${kind} during lazy module load prevents a late navigation claim`, async () => {
    let handoff, resolve;
    const canvas = new EventTarget(),
      cleanups = [],
      controller = new AbortController();
    const entry = installWorkspaceDevelopmentEntry({
      viewer: { scene: { canvas } },
      signal: controller.signal,
      defer: (fn) => cleanups.push(fn),
      debug: {
        styleManager: {
          subscribeCameraHandoff(fn) {
            handoff = fn;
            return () => {
              handoff = null;
            };
          },
        },
      },
      load: () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    });
    const pending = entry.enter();
    await tick();
    if (kind === 'globe handoff') handoff();
    else canvas.dispatchEvent(new Event('wheel'));
    resolve({
      createWorkspacePrototypeNavigation() {
        assert.fail('stale navigation construction');
      },
    });
    assert.equal(await pending, false);
    for (const cleanup of cleanups.reverse()) cleanup();
    assert.equal(handoff, null);
  });
}

test('rapid enter then exit during lazy import never dispatches the older entry', async () => {
  let resolve;
  const cleanups = [],
    calls = [],
    controller = new AbortController();
  const entry = installWorkspaceDevelopmentEntry({
    viewer: {},
    signal: controller.signal,
    debug: {},
    defer: (fn) => cleanups.push(fn),
    load: () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  });
  const enter = entry.enter(),
    exit = entry.exit();
  await tick();
  resolve({
    createWorkspacePrototypeNavigation: () => ({
      enter() {
        calls.push('BAD enter');
      },
      exit() {
        calls.push('exit');
        return true;
      },
      dispose() {},
    }),
  });
  assert.equal(await enter, false);
  assert.equal(await exit, true);
  assert.deepEqual(calls, ['exit']);
  for (const cleanup of cleanups.reverse()) cleanup();
});

test('first navigation captures ECEF before awaiting lazy code', async () => {
  let resolve, captured;
  const cleanups = [],
    controller = new AbortController();
  const camera = {
    positionWC: { x: 1.123456789, y: 2, z: 3 },
    directionWC: { x: 0, y: 1, z: 0 },
    upWC: { x: 0, y: 0, z: 1 },
  };
  const entry = installWorkspaceDevelopmentEntry({
    viewer: { camera },
    signal: controller.signal,
    debug: {},
    defer: (fn) => cleanups.push(fn),
    load: () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  });
  const pending = entry.enter();
  camera.positionWC.x = 100;
  await tick();
  resolve({
    createWorkspacePrototypeNavigation({ initialPose }) {
      captured = initialPose;
      return { enter: () => true, dispose() {} };
    },
  });
  assert.equal(await pending, true);
  assert.equal(captured.position[0], 1.123456789);
  for (const cleanup of cleanups.reverse()) cleanup();
});

test('installer registers cleanup synchronously and remains lazy until explicit activation', async () => {
  const f = fixture();
  assert.ok(f.cleanups.length);
  assert.deepEqual(f.log, []);
  assert.equal(f.debug.workspacePrototype, f.entry);
  const pending = f.entry.activate();
  await tick();
  assert.deepEqual(f.log, ['load']);
  f.complete();
  assert.equal(await pending, true);
  assert.deepEqual(f.log, ['load', 'adapter', 'acquire', 'show']);
  for (const cleanup of f.cleanups.reverse()) cleanup();
  assert.equal(f.debug.workspacePrototype, undefined);
  assert.equal(f.entry.getState(), 'disposed');
  assert.equal(f.log.at(-1), 'dispose');
});

test('app abort during lazy import settles promptly and cannot create a late adapter', async () => {
  const f = fixture();
  const pending = f.entry.activate();
  await tick();
  f.controller.abort();
  assert.equal(await pending, false);
  assert.equal(f.debug.workspacePrototype, undefined);
  f.complete();
  await tick();
  assert.deepEqual(f.log, ['load']);
  for (const cleanup of f.cleanups.reverse()) cleanup();
});

test('deactivation during lazy load prevents stale activation but allows retry', async () => {
  const f = fixture();
  const pending = f.entry.activate();
  await tick();
  f.entry.deactivate();
  assert.equal(await pending, false);
  f.complete();
  await tick();
  assert.deepEqual(f.log, ['load']);
  assert.equal(await f.entry.activate(), true);
  for (const cleanup of f.cleanups.reverse()) cleanup();
});

test('application composition disposes workspace before borrowed scene/viewer resources', async () => {
  const log = [];
  let entry;
  const app = createApplication({
    createScene({ defer }) {
      const viewer = { alive: true };
      defer(() => {
        viewer.alive = false;
        log.push('scene');
      });
      return { viewer };
    },
    createControls() {
      return {};
    },
    createData() {
      return {};
    },
    createTools({ scene: { viewer }, signal, defer }) {
      entry = installWorkspaceDevelopmentEntry({
        viewer,
        signal,
        defer,
        debug: {},
        load: async () => ({
          createWorkspacePrototypeAdapter: () => ({
            acquire: () => ({
              activate() {},
              dispose() {
                assert.equal(viewer.alive, true);
                log.push('workspace');
              },
            }),
          }),
        }),
      });
      return {};
    },
  });
  await app.start();
  await entry.activate();
  await app.destroy();
  assert.deepEqual(log, ['workspace', 'scene']);
});
