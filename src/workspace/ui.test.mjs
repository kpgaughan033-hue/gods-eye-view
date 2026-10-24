import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceUi, suppressWorkspaceChrome } from './ui.js';
import { createWorkspaceFixture } from './fixture.js';
import { createStateChannel } from '../app/stateChannel.js';
import { screenPickId } from './geometry.js';
import { testDocument } from './testDom.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture({ reduced = true, getStorage, onAnimate, project } = {}) {
  const documentRef = testDocument(),
    document = createWorkspaceFixture(),
    controller = new AbortController();
  const canvas = documentRef.createElement('canvas');
  const globe = documentRef.createElement('div');
  globe.append(canvas);
  documentRef.body.append(globe);
  const hud = documentRef.createElement('aside');
  hud.style.display = 'grid';
  documentRef.body.append(hud);
  let state = { scopeId: 'demo-globe-001', targetId: null, phase: 'idle' },
    back = 0,
    exit = 0,
    opens = 0;
  const channel = createStateChannel(() => state);
  const update = (next) => {
    state = { ...state, ...next };
    channel.publish();
  };
  const renderCallbacks = new Set();
  let renderRequests = 0;
  const animations = [];
  const primitive = {},
    screens = new Set([primitive]);
  const scene = {
    canvas,
    pick: () => ({ id: screenPickId(document), primitive }),
  };
  const store = new Map();
  const ui = createWorkspaceUi({
    viewer: { scene, isDestroyed: () => false },
    document,
    documentRef,
    screens,
    signal: controller.signal,
    reducedMotion: () => reduced,
    requestRender: () => {
      renderRequests++;
    },
    afterRender: (listener) => {
      renderCallbacks.add(listener);
      return () => renderCallbacks.delete(listener);
    },
    project:
      project ||
      (() => [
        [100, 100],
        [200, 100],
        [200, 200],
        [100, 200],
      ]),
    getStorage:
      getStorage ||
      (() => ({
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, v),
      })),
    animate(element, frames, options) {
      const d = deferred();
      const a = {
        frames,
        options,
        finished: d.promise,
        resolve: d.resolve,
        cancelled: 0,
        cancel() {
          this.cancelled++;
          d.reject(Error('cancelled'));
        },
      };
      animations.push(a);
      onAnimate?.(a);
      return a;
    },
    navigation: {
      getState: channel.getSnapshot,
      subscribe: channel.subscribe,
      back() {
        back++;
      },
      exit() {
        exit++;
      },
      goTo(id) {
        assert.equal(id, 'demo-application-001');
        opens++;
      },
    },
  });
  const root = () =>
    documentRef.body.children.find((e) => e.className === 'workspace-ui');
  const surface = () => root()?.querySelector('.workspace-ui__surface');
  const desk = () =>
    update({ scopeId: 'demo-desk-001', phase: 'stable', targetId: null });
  const nodes = Object.fromEntries(document.nodes.map((n) => [n.kind, n]));
  const run = new AbortController();
  let current = true;
  const enter = () => {
    update({ phase: 'moving', targetId: nodes.application.id });
    return ui.transition({
      from: nodes.desk,
      to: nodes.application,
      signal: run.signal,
      current: () => current,
    });
  };
  const commit = () =>
    update({ scopeId: nodes.application.id, phase: 'stable', targetId: null });
  return {
    ui,
    controller,
    documentRef,
    canvas,
    hud,
    scene,
    primitive,
    root,
    surface,
    desk,
    run,
    enter,
    commit,
    update,
    animations,
    renderCallbacks,
    renderRequests: () => renderRequests,
    store,
    back: () => back,
    exit: () => exit,
    opens: () => opens,
    current: (v) => {
      current = v;
    },
  };
}
test('only owned screen pixels protect input; forged IDs, other parts and polygon misses do not', () => {
  const f = fixture();
  f.desk();
  const hit = {
    type: 'pointerdown',
    target: f.canvas,
    clientX: 150,
    clientY: 150,
    stopPropagation() {
      this.stopped = true;
    },
  };
  assert.equal(f.ui.ownsInput(hit), true);
  assert.equal(hit.stopped, true);
  assert.equal(f.ui.ownsInput({ ...hit, clientX: 210 }), false);
  f.scene.pick = () => ({ id: 'demo-desk-001', primitive: f.primitive });
  assert.equal(f.ui.ownsInput({ ...hit }), false);
  f.scene.pick = () => ({
    id: 'fictional-workspace-001:demo-desk-001:screen',
    primitive: {},
  });
  assert.equal(f.ui.ownsInput({ ...hit }), false);
  assert.equal(f.ui.ownsInput({ ...hit, target: f.hud }), false);
  f.ui.dispose();
  assert.equal(f.canvas.listenerCount(), 0);
});
test('screen click and native keyboard alternative request only scoped application navigation', () => {
  const f = fixture();
  f.desk();
  const bar = f.root().querySelector('nav');
  const open = bar.children[1];
  assert.equal(f.documentRef.activeElement, open);
  assert.equal(
    f.ui.ownsInput({ type: 'keydown', target: open, key: 'Enter' }),
    true,
  );
  open.click();
  assert.equal(f.opens(), 1);
  f.canvas.dispatch('click', { clientX: 150, clientY: 150 });
  assert.equal(f.opens(), 2);
  f.canvas.dispatch('click', { clientX: 250, clientY: 150 });
  assert.equal(f.opens(), 2);
  f.ui.dispose();
});
test('checklist DOM is labeled, literal text and native controls; task edits survive remount and are immediate', async () => {
  const f = fixture();
  f.desk();
  await f.enter();
  f.commit();
  const content = f.surface().querySelector('section'),
    form = content.querySelector('form'),
    input = content.querySelector('input[type=text]');
  assert.equal(input.required, true);
  assert.equal(input.maxLength, 240);
  assert.equal(f.documentRef.activeElement, input);
  assert.equal(content.getAttribute('aria-label'), 'Task checklist');
  input.value = '<img src=x onerror=alert(1)>';
  form.dispatch('submit');
  const list = content.querySelector('ul');
  assert.equal(list.children.length, 1);
  assert.equal(list.querySelector('img'), null);
  const checkbox = list.querySelector('input');
  checkbox.checked = true;
  checkbox.dispatch('change');
  assert.equal(list.children[0].dataset.done, 'true');
  assert.equal(JSON.parse([...f.store.values()][0]).tasks[0].done, true);
  f.desk();
  await f.enter();
  f.commit();
  assert.equal(content.querySelector('ul').children.length, 1);
  content.querySelector('ul').querySelector('button').click();
  assert.equal(content.querySelector('ul').children.length, 0);
  assert.ok(content.textContent.includes('No tasks yet.'));
  f.ui.dispose();
  input.value = 'stale';
  form.dispatch('submit');
  assert.equal(JSON.parse([...f.store.values()][0]).tasks.length, 0);
});
test('inside key/pointer/scroll ownership, focus cycle, Escape and IME composition; outside remains unowned', async () => {
  const f = fixture();
  f.desk();
  await f.enter();
  f.commit();
  const content = f.surface().querySelector('section'),
    input = content.querySelector('input[type=text]');
  assert.equal(f.ui.ownsInput({ type: 'wheel', target: input }), true);
  assert.equal(f.ui.ownsInput({ type: 'keydown', target: f.hud }), false);
  let global = 0;
  f.documentRef.addEventListener('keydown', () => global++);
  input.dispatch('keydown', { key: 'h' });
  assert.equal(global, 0);
  input.dispatch('compositionstart');
  input.dispatch('keydown', { key: 'Escape', isComposing: true });
  assert.equal(f.back(), 0);
  input.dispatch('compositionend');
  input.dispatch('keydown', { key: 'Escape' });
  assert.equal(f.back(), 1);
  assert.equal(global, 0);
  const buttons = content.querySelectorAll('button');
  buttons.at(-1).focus();
  const tab = buttons.at(-1).dispatch('keydown', { key: 'Tab' });
  assert.equal(tab.defaultPrevented, true);
  assert.equal(f.documentRef.activeElement, buttons[0]);
  f.ui.dispose();
});
test('cancelled animation, late completion and destroy cannot remount, restore stale focus or keep HUD suppressed', async () => {
  const f = fixture({ reduced: false });
  f.desk();
  const opening = f.enter();
  assert.equal(f.hud.hasAttribute('data-workspace-suppressed'), true);
  assert.match(f.animations[0].frames[0].transform, /matrix3d/);
  assert.equal(f.surface().getAttribute('aria-busy'), 'true');
  f.current(false);
  f.run.abort();
  f.update({ scopeId: 'demo-globe-001', phase: 'idle', targetId: null });
  assert.equal(await opening, false);
  f.animations[0].resolve();
  await Promise.resolve();
  assert.equal(f.root(), undefined);
  assert.equal(f.hud.hasAttribute('data-workspace-suppressed'), false);
  const focus = f.documentRef.activeElement;
  f.ui.dispose();
  f.ui.dispose();
  assert.equal(f.canvas.listenerCount(), 0);
  assert.equal(f.documentRef.listenerCount(), 0);
  assert.equal(f.documentRef.activeElement, focus);
});
test('twenty UI entry/Back cycles keep task data and listener/DOM counts bounded; abort releases everything', async () => {
  const f = fixture();
  f.desk();
  const listeners = f.canvas.listenerCount();
  for (let i = 0; i < 20; i++) {
    await f.enter();
    f.commit();
    const content = f.surface().querySelector('section'),
      input = content.querySelector('input[type=text]');
    if (i === 0) {
      input.value = 'persist';
      content.querySelector('form').dispatch('submit');
    }
    f.desk();
    assert.equal(f.hud.hasAttribute('data-workspace-suppressed'), false);
    assert.equal(f.canvas.listenerCount(), listeners);
    assert.equal(f.documentRef.listenerCount(), 0);
    assert.equal(
      f.documentRef.body.children.filter((e) => e.className === 'workspace-ui')
        .length,
      1,
    );
  }
  await f.enter();
  f.commit();
  assert.ok(f.surface().textContent.includes('persist'));
  f.controller.abort();
  assert.equal(f.root(), undefined);
  assert.equal(f.documentRef.listenerCount(), 0);
  assert.equal(f.canvas.listenerCount(), 0);
});
test('HUD suppression removes only own attributes; other visibility/layer edits and other owners survive', () => {
  const d = testDocument(),
    root = d.createElement('div'),
    canvas = d.createElement('canvas'),
    hud = d.createElement('aside'),
    other = d.createElement('aside');
  other.setAttribute('data-workspace-suppressed', 'other-owner');
  d.body.append(canvas, hud, other, root);
  const restore = suppressWorkspaceChrome({
    documentRef: d,
    root,
    canvas,
    token: 'ours',
  });
  assert.equal(hud.getAttribute('data-workspace-suppressed'), 'ours');
  hud.hidden = true;
  hud.style.display = 'none';
  other.style.display = 'grid';
  restore();
  restore();
  assert.equal(hud.hidden, true);
  assert.equal(hud.style.display, 'none');
  assert.equal(hud.hasAttribute('data-workspace-suppressed'), false);
  assert.equal(other.getAttribute('data-workspace-suppressed'), 'other-owner');
});

test('HUD nodes arriving while open are suppressed by the owned observer and restored without state replay', () => {
  const d = testDocument(),
    root = d.createElement('div'),
    canvas = d.createElement('canvas');
  d.body.append(canvas, root);
  let callback,
    disconnected = 0;
  d.defaultView.MutationObserver = class {
    constructor(fn) {
      callback = fn;
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  };
  const restore = suppressWorkspaceChrome({
    documentRef: d,
    root,
    canvas,
    token: 'late',
  });
  const late = d.createElement('aside');
  d.body.append(late);
  callback();
  assert.equal(late.getAttribute('data-workspace-suppressed'), 'late');
  late.setAttribute('data-workspace-suppressed', 'successor');
  restore();
  assert.equal(late.getAttribute('data-workspace-suppressed'), 'successor');
  assert.equal(disconnected, 1);
});

test('Escape during entry cancels through Back even before the checklist controls are enabled', async () => {
  const f = fixture({ reduced: false });
  f.desk();
  const p = f.enter();
  assert.equal(f.documentRef.activeElement, f.surface());
  f.surface().dispatch('keydown', { key: 'Escape' });
  assert.equal(f.back(), 1);
  f.run.abort();
  assert.equal(await p, false);
  f.ui.dispose();
});

test('storage denial is visible and remains editable across Back/reopen', async () => {
  const f = fixture({
    getStorage() {
      throw Error('SecurityError');
    },
  });
  f.desk();
  await f.enter();
  f.commit();
  const content = f.surface().querySelector('section'),
    input = content.querySelector('input[type=text]');
  assert.ok(content.textContent.includes('Storage unavailable.'));
  input.value = 'kept in memory';
  content.querySelector('form').dispatch('submit');
  f.desk();
  await f.enter();
  f.commit();
  assert.ok(content.querySelector('ul').textContent.includes('kept in memory'));
  f.ui.dispose();
});

test('animation acquired after a reentrant abort is cancelled immediately without timer/DOM arrivals', async () => {
  let f;
  f = fixture({
    reduced: false,
    onAnimate() {
      f.current(false);
      f.run.abort();
      f.update({ scopeId: 'demo-globe-001', targetId: null, phase: 'idle' });
    },
  });
  f.desk();
  assert.equal(await f.enter(), false);
  assert.equal(f.animations[0].cancelled, 1);
  assert.equal(f.root(), undefined);
  assert.equal(f.hud.hasAttribute('data-workspace-suppressed'), false);
  f.ui.dispose();
});

test('resize highlight waits for the real rendered frustum; one-shot render callbacks cannot outlive desk', () => {
  let points = [
    [100, 100],
    [200, 100],
    [200, 200],
    [100, 200],
  ];
  const f = fixture({ project: () => points });
  f.desk();
  const outline = f.root().querySelector('polygon');
  const before = outline.getAttribute('points');
  f.documentRef.defaultView.dispatch('resize');
  assert.equal(outline.getAttribute('points'), before);
  points = [
    [80, 150],
    [160, 150],
    [160, 220],
    [80, 220],
  ];
  assert.equal(f.renderCallbacks.size, 1);
  for (const callback of [...f.renderCallbacks]) callback();
  assert.equal(outline.getAttribute('points'), '80,150 160,150 160,220 80,220');
  assert.equal(f.renderCallbacks.size, 0);
  assert.ok(f.renderRequests() >= 2);
  f.documentRef.defaultView.dispatch('resize');
  assert.equal(f.renderCallbacks.size, 1);
  f.update({ scopeId: 'demo-globe-001', phase: 'idle', targetId: null });
  assert.equal(f.renderCallbacks.size, 0);
  f.ui.dispose();
});
