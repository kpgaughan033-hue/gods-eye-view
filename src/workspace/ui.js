import { Cartesian2 } from 'cesium';
import { t } from '../i18n/index.js';
import { UiLifetime } from '../ui/uiLifetime.js';
import { createSurfaceKeyboard } from '../ui/surfaceKeyboard.js';
import { createChecklistStore } from './checklistStore.js';
import { createChecklistWidget } from './widget.js';
import { createScreenProjection, screenTransform } from './screenProjection.js';
import { screenPickId } from './geometry.js';
import { workspaceStyles } from './uiStyles.js';

/** Own attributes only: never replay HUD settings, styles, hidden flags or layer state. */
export function suppressWorkspaceChrome({ documentRef, root, canvas, token }) {
  const attribute = 'data-workspace-suppressed';
  const owned = new Set();
  const suppress = () => {
    for (const element of documentRef.body.children) {
      if (
        element === root ||
        element.contains(canvas) ||
        ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName) ||
        element.hasAttribute(attribute)
      )
        continue;
      element.setAttribute(attribute, token);
      owned.add(element);
    }
  };
  suppress();
  const Observer = documentRef.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(suppress) : null;
  observer?.observe(documentRef.body, { childList: true });
  return () => {
    observer?.disconnect();
    for (const element of owned)
      if (element.getAttribute(attribute) === token)
        element.removeAttribute(attribute);
    owned.clear();
  };
}

export function createWorkspaceUi({
  viewer,
  document,
  navigation,
  screens,
  signal,
  documentRef = viewer.scene.canvas.ownerDocument,
  reducedMotion = () =>
    documentRef.defaultView.matchMedia('(prefers-reduced-motion: reduce)')
      .matches,
  project = createScreenProjection({ viewer, document }),
  animate = (element, frames, options) => element.animate(frames, options),
  getStorage,
  requestRender = () => viewer.scene.requestRender(),
  afterRender = (listener) =>
    viewer.scene.postRender.addEventListener(listener),
}) {
  const lifetime = new UiLifetime();
  const canvas = viewer.scene.canvas;
  const application = document.nodes.find((n) => n.kind === 'application');
  const deskId = application.parentId;
  const token = `workspace-${globalThis.crypto.randomUUID()}`;
  const store = createChecklistStore({
    workspaceId: document.workspaceId,
    stateKey: application.widget.stateKey,
    getStorage,
  });
  const el = (tag, text) => {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  const root = el('div');
  root.className = 'workspace-ui';
  root.dataset.workspaceRoot = token;
  root.dataset.workspaceInput = '';
  const style = el('style');
  style.textContent =
    workspaceStyles +
    `\n[data-workspace-suppressed="${token}"], [data-workspace-suppressed="${token}"] * {visibility:hidden!important;pointer-events:none!important}`;
  const bar = el('nav');
  bar.className = 'workspace-ui__bar';
  bar.setAttribute('aria-label', t('Workspace'));
  const open = el('button', t('Open checklist'));
  const back = el('button', t('Back'));
  const exit = el('button', t('Exit workspace'));
  bar.append(el('span', t('Workspace')), open, back, exit);
  const surface = el('div');
  surface.className = 'workspace-ui__surface';
  surface.hidden = true;
  surface.tabIndex = -1;
  const widget = createChecklistWidget({
    documentRef,
    store,
    back: () => navigation.back(),
    exit: () => navigation.exit(),
  });
  surface.append(widget.root);
  const highlight = documentRef.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg',
  );
  highlight.classList.add('workspace-ui__highlight');
  highlight.setAttribute('aria-hidden', 'true');
  highlight.setAttribute('hidden', '');
  const outline = documentRef.createElementNS(
    'http://www.w3.org/2000/svg',
    'polygon',
  );
  highlight.append(outline);
  root.append(style, highlight, bar, surface);
  let closed = false,
    restoreChrome = null,
    cancelAnimation = null,
    composing = false,
    wasDesk = false,
    pickLifetime = null,
    priorCursor = null,
    removeHighlightRender = null,
    hovered = false;
  const state = () => navigation.getState();
  const stableDesk = () =>
    state().scopeId === deskId && state().phase === 'stable';
  const keyboard = createSurfaceKeyboard({
    root: surface,
    documentRef,
    isActive: () => !surface.hidden && !composing,
    onEscape: () => navigation.back(),
    fallbackFocus: () => open,
  });
  function drawHighlight(on) {
    const points = on && stableDesk() ? project() : null;
    highlight.toggleAttribute('hidden', !points);
    if (!points) return;
    highlight.setAttribute(
      'viewBox',
      `0 0 ${documentRef.documentElement.clientWidth} ${documentRef.documentElement.clientHeight}`,
    );
    outline.setAttribute('points', points.map((p) => p.join(',')).join(' '));
  }
  function refreshAfterRender() {
    removeHighlightRender?.();
    removeHighlightRender = afterRender(() => {
      removeHighlightRender?.();
      removeHighlightRender = null;
      if (!closed && stableDesk())
        drawHighlight(hovered || documentRef.activeElement === open);
    });
    requestRender('workspace-screen-highlight');
  }
  function clearCursor() {
    if (priorCursor !== null && canvas.style.cursor === 'pointer')
      canvas.style.cursor = priorCursor;
    priorCursor = null;
  }
  function screenHit(event) {
    if (!stableDesk() || viewer.isDestroyed() || event.target !== canvas)
      return false;
    const touch = event.touches?.[0] || event;
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX,
      y = touch.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const points = project();
    if (!points) return false;
    // Pixel-exact front surface, not the bounding rectangle or monitor frame.
    const crosses = points.map((p, i) => {
      const next = points[(i + 1) % 4];
      return (next[0] - p[0]) * (y - p[1]) - (next[1] - p[1]) * (x - p[0]);
    });
    if (!crosses.every((v) => v >= 0) && !crosses.every((v) => v <= 0))
      return false;
    const hit = viewer.scene.pick(
      new Cartesian2(x - rect.left, y - rect.top),
      1,
      1,
    );
    return hit?.id === screenPickId(document) && screens.has(hit.primitive);
  }
  const hitCache = new WeakMap();
  function ownsInput(event) {
    if (closed || !root.isConnected) return false;
    if (root.contains(event.target)) return true;
    if (['pointerdown', 'touchstart'].includes(event.type)) {
      if (!hitCache.has(event)) hitCache.set(event, screenHit(event));
      if (hitCache.get(event)) {
        // Avoid unrelated Cesium LEFT_CLICK handlers seeing the activation gesture.
        event.stopPropagation();
        return true;
      }
    }
    return false;
  }
  function stopPicking() {
    removeHighlightRender?.();
    removeHighlightRender = null;
    hovered = false;
    pickLifetime?.destroy();
    pickLifetime = null;
    clearCursor();
    highlight.setAttribute('hidden', '');
  }
  function startPicking() {
    if (pickLifetime) return;
    pickLifetime = new UiLifetime();
    let last = -Infinity;
    pickLifetime.listen(canvas, 'pointermove', (event) => {
      if (event.timeStamp - last < 80) return;
      last = event.timeStamp;
      const hit = screenHit(event);
      hovered = hit;
      drawHighlight(hit || documentRef.activeElement === open);
      if (hit) {
        if (priorCursor === null) priorCursor = canvas.style.cursor;
        canvas.style.cursor = 'pointer';
      } else clearCursor();
    });
    pickLifetime.listen(canvas, 'pointerleave', () => {
      hovered = false;
      clearCursor();
      drawHighlight(documentRef.activeElement === open);
    });
    // Cesium applies the new aspect/frustum during rendering, after resize dispatch.
    pickLifetime.listen(documentRef.defaultView, 'resize', refreshAfterRender);
    pickLifetime.listen(
      canvas,
      'click',
      (event) => {
        if (!screenHit(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void navigation.goTo(application.id);
      },
      true,
    );
  }
  function hideSurface() {
    cancelAnimation?.();
    cancelAnimation = null;
    keyboard.deactivate();
    surface.hidden = true;
    widget.root.inert = false;
    surface.style.pointerEvents = 'auto';
    surface.style.transform = 'none';
    restoreChrome?.();
    restoreChrome = null;
  }
  function showSurface() {
    if (!root.isConnected) documentRef.body.append(root);
    surface.hidden = false;
    bar.hidden = true;
    restoreChrome ||= suppressWorkspaceChrome({
      documentRef,
      root,
      canvas,
      token,
    });
  }
  function reconcile({ state: next }) {
    if (closed) return;
    const desk = next.scopeId === deskId && next.phase === 'stable';
    const app = next.scopeId === application.id;
    if (
      (next.scopeId === document.rootId && !next.targetId) ||
      next.phase === 'disposed'
    ) {
      stopPicking();
      hideSurface();
      root.remove();
      wasDesk = false;
      return;
    }
    if (next.scopeId !== document.rootId && !root.isConnected)
      documentRef.body.append(root);
    if (desk) startPicking();
    else stopPicking();
    open.hidden = !desk;
    bar.hidden = app || !surface.hidden;
    if (next.phase === 'stable' && app) {
      showSurface();
      widget.root.inert = false;
      surface.style.pointerEvents = 'auto';
      surface.setAttribute('aria-busy', 'false');
      keyboard.activate();
    } else if (next.phase === 'stable' && !app) {
      hideSurface();
      bar.hidden = false;
    }
    if (desk && !wasDesk) open.focus({ preventScroll: true });
    wasDesk = desk;
  }
  const unwatch = navigation.subscribe(reconcile);
  lifetime.listen(open, 'click', () => {
    void navigation.goTo(application.id);
  });
  lifetime.listen(back, 'click', () => {
    void navigation.back();
  });
  lifetime.listen(exit, 'click', () => {
    void navigation.exit();
  });
  // Keep native controls/scrolling, but don't bubble shortcuts or pointer gestures
  // from this scoped DOM into unrelated globe/voice UI.
  for (const type of [
    'keydown',
    'keyup',
    'pointerdown',
    'pointerup',
    'click',
    'wheel',
    'touchstart',
    'touchend',
  ])
    lifetime.listen(root, type, (event) => event.stopPropagation());
  lifetime.listen(root, 'compositionstart', () => {
    composing = true;
  });
  lifetime.listen(root, 'compositionend', () => {
    composing = false;
  });
  const focusHighlight = () => {
    drawHighlight(true);
    refreshAfterRender();
  };
  lifetime.listen(open, 'focus', focusHighlight);
  lifetime.listen(open, 'blur', () => {
    drawHighlight(false);
  });
  function transition({ from, to, destination, signal: runSignal, current }) {
    if (closed || runSignal.aborted || !current())
      return Promise.resolve(false);
    if (from.kind !== 'application' && to.kind !== 'application')
      return undefined;
    cancelAnimation?.();
    const entering = to.kind === 'application';
    const points = project(entering ? undefined : destination);
    const width = documentRef.documentElement.clientWidth,
      height = documentRef.documentElement.clientHeight;
    const transform = screenTransform(points, width, height);
    showSurface();
    keyboard.deactivate();
    widget.root.inert = true;
    surface.style.pointerEvents = 'none';
    surface.setAttribute('aria-busy', 'true');
    bar.hidden = false;
    keyboard.activate();
    surface.focus({ preventScroll: true });
    widget.render();
    if (entering) surface.style.transform = transform || 'none';
    const finish = () => {
      if (!current()) return;
      surface.style.transform = entering ? 'none' : transform || 'none';
    };
    if (reducedMotion() || !transform || from.id === to.id) {
      finish();
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let settled = false,
        animation,
        timer;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        runSignal.removeEventListener('abort', abort);
        if (cancelAnimation === abort) cancelAnimation = null;
        if (ok) finish();
        animation?.cancel();
        if (!ok) {
          surface.hidden = true;
          restoreChrome?.();
          restoreChrome = null;
        }
        resolve(ok);
      };
      const abort = () => done(false);
      cancelAnimation = abort;
      runSignal.addEventListener('abort', abort, { once: true });
      try {
        animation = animate(
          surface,
          [
            { transform: entering ? transform : 'none' },
            { transform: entering ? 'none' : transform },
          ],
          { duration: 700, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' },
        );
        animation.finished.then(
          () => done(current() && !runSignal.aborted),
          () => done(false),
        );
        if (settled) {
          animation.cancel();
          return;
        }
        // Bounded fallback for throttled/unsupported animation implementations.
        timer = setTimeout(() => done(current() && !runSignal.aborted), 1200);
      } catch {
        done(current() && !runSignal.aborted);
      }
      if (runSignal.aborted || !current()) abort();
    });
  }
  // Focus follows commit only; never an aborted animation's completion.
  const focusWatch = navigation.subscribe(
    ({ state: next }) => {
      if (
        next.scopeId === application.id &&
        next.phase === 'stable' &&
        !surface.hidden
      )
        widget.input.focus({ preventScroll: true });
    },
    { emitCurrent: false },
  );
  const dispose = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', dispose);
    unwatch();
    focusWatch();
    stopPicking();
    hideSurface();
    keyboard.destroy();
    widget.dispose?.();
    lifetime.destroy();
    root.remove();
  };
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  return Object.freeze({ ownsInput, transition, dispose });
}
