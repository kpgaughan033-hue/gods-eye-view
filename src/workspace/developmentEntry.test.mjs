import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installWorkspaceDevelopmentEntry,
  workspacePrototypeEnabled,
} from './developmentEntry.js';
import { createApplication } from '../app/application.js';
import { createWorkspaceNavigation } from './navigation.js';
import { createWorkspaceCameraAdapter } from './cameraAdapter.js';
import { createWorkspaceFixture } from './fixture.js';
import { Cartesian3 } from 'cesium';

const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const firstAttempt of [
  'refused',
  'unsupported',
  'acquisition failure',
  'flight failure',
  'refused then handoff',
  'refused then input',
]) {
  test(`retry after first entry ${firstAttempt} preserves the correct captured ECEF return (CPU simulation)`, async () => {
    const original = {
      position: [6378137.123456789, 1234.987654321, 56.123456789],
      direction: [Math.cos(0.25), Math.sin(0.25), 0],
      up: [0, 0, 1],
    };
    const drift = {
      position: [6378167.123456789, 1244.987654321, 76.123456789],
      direction: [-Math.sin(0.25), Math.cos(0.25), 0],
      up: [0, 0, 1],
    };
    let fail = true,
      handoff,
      resolveModule;
    const controller = new AbortController(),
      cleanups = [],
      canvas = new EventTarget();
    const camera = {
      positionWC: new Cartesian3(...original.position),
      directionWC: new Cartesian3(...original.direction),
      upWC: new Cartesian3(...original.up),
      frustum: { near: 1 },
      setView({ destination, orientation }) {
        if (firstAttempt === 'flight failure' && fail) {
          fail = false;
          throw Error('first flight failed');
        }
        this.positionWC = destination;
        this.directionWC = orientation.direction;
        this.upWC = orientation.up;
      },
    };
    const viewer = {
      camera,
      isDestroyed: () => false,
      scene: {
        canvas,
        screenSpaceCameraController: {
          enableInputs: true,
          enableCollisionDetection: true,
        },
      },
    };
    const document = createWorkspaceFixture();
    const module = {
      createWorkspacePrototypeAdapter: () => ({
        acquire() {
          if (firstAttempt === 'acquisition failure' && fail) {
            fail = false;
            throw Error('first acquisition failed');
          }
          return { activate() {}, dispose() {} };
        },
      }),
      createWorkspacePrototypeNavigation: ({ session, initialPose }) =>
        createWorkspaceNavigation({
          document,
          session,
          initialPose,
          signal: controller.signal,
          supported() {
            if (firstAttempt === 'unsupported' && fail) {
              fail = false;
              return false;
            }
            return true;
          },
          camera: createWorkspaceCameraAdapter({
            viewer,
            document,
            reducedMotion: () => true,
            requestRender() {},
            holdRender() {},
            releaseRender() {},
          }),
          claim() {
            if (firstAttempt.startsWith('refused') && fail) {
              fail = false;
              return null;
            }
            // The real owner's successful claim publishes a handoff of its own.
            handoff?.();
            const authority = new AbortController();
            return {
              signal: authority.signal,
              isCurrent: () => !authority.signal.aborted,
              release: () => authority.abort(),
            };
          },
        }),
    };
    const entry = installWorkspaceDevelopmentEntry({
      viewer,
      signal: controller.signal,
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
      defer: (fn) => cleanups.push(fn),
      load: () =>
        new Promise((resolve) => {
          resolveModule = resolve;
        }),
    });
    try {
      const pending = entry.enter();
      // Simulate camera drift during lazy loading, without a new user intent.
      camera.positionWC = new Cartesian3(...drift.position);
      camera.directionWC = new Cartesian3(...drift.direction);
      await tick();
      resolveModule(module);
      assert.equal(await pending, false);
      // A genuine newer user intent invalidates the old candidate, unlike
      // passive startup drift or a retry of the same refused/failed entry.
      if (firstAttempt === 'refused then handoff') handoff();
      if (firstAttempt === 'refused then input')
        canvas.dispatchEvent(new Event('wheel'));
      const expected = firstAttempt.includes(' then ') ? drift : original;
      assert.equal(await entry.enter(), true);
      assert.equal(await entry.exit(), true);
      const positionError = Cartesian3.distance(
        camera.positionWC,
        new Cartesian3(...expected.position),
      );
      const angle = (actual, expected) =>
        (Cartesian3.angleBetween(actual, new Cartesian3(...expected)) * 180) /
        Math.PI;
      const orientationError = Math.max(
        angle(camera.directionWC, expected.direction),
        angle(camera.upWC, expected.up),
      );
      assert.ok(
        positionError <= 0.01,
        `return position error ${positionError} m`,
      );
      assert.ok(
        orientationError <= 0.1,
        `return orientation error ${orientationError} degrees`,
      );
      // Once a cycle commits and exits, a new entry must capture a fresh pose.
      const fresh = {
        ...original,
        position: drift.position.map((value) => value + 50),
      };
      camera.positionWC = new Cartesian3(...fresh.position);
      camera.directionWC = new Cartesian3(...fresh.direction);
      assert.equal(await entry.enter(), true);
      assert.equal(await entry.exit(), true);
      assert.ok(
        Cartesian3.distance(
          camera.positionWC,
          new Cartesian3(...fresh.position),
        ) <= 0.01,
      );
      assert.ok(angle(camera.directionWC, fresh.direction) <= 0.1);
    } finally {
      for (const cleanup of cleanups.reverse()) cleanup();
    }
  });
}
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
