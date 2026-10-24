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
