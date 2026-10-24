import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { chromeExecutablePath } from './qa-chrome.mjs';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const base = new URL(
  urlIndex >= 0 ? args[urlIndex + 1] : 'http://127.0.0.1:4173',
);
const software = args.includes('--software');
const shot = args.includes('--screenshot')
  ? args[args.indexOf('--screenshot') + 1]
  : null;
const evidenceDir = args.includes('--evidence-dir')
  ? args[args.indexOf('--evidence-dir') + 1]
  : null;
if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chromeExecutablePath(),
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    ...(software
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : []),
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (r) =>
    (r.url().startsWith(base.origin + '/') &&
      !new URL(r.url()).pathname.startsWith('/api/')) ||
    /^(data:|blob:)/.test(r.url())
      ? r.continue()
      : r.abort(),
  );
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(new URL('/', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__godsEyeView?.voiceCommands, {
    timeout: 120000,
  });
  if (await page.evaluate(() => !!window.__godsEyeView.workspacePrototype))
    throw Error('default entry present');
  await page.goto(new URL('/?workspacePrototype=1&welcome=0', base).href, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.__godsEyeView?.workspacePrototype, {
    timeout: 120000,
  });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  // Startup flights temporarily disable inputs. Wall time alone is insufficient
  // on a software renderer; capture a free-camera baseline after it completes.
  await page.waitForFunction(
    () =>
      window.__godsEyeView.viewer.scene.screenSpaceCameraController
        .enableInputs === true,
    { timeout: 60000 },
  );
  await page.keyboard.press('Escape');
  console.log('Browser ready; starting fixture route');
  await page.evaluate(async () => {
    const d = window.__godsEyeView,
      v = d.viewer,
      s = d.workspacePrototype;
    const capture = () => ({
      position: [
        v.camera.positionWC.x,
        v.camera.positionWC.y,
        v.camera.positionWC.z,
      ],
      direction: [
        v.camera.directionWC.x,
        v.camera.directionWC.y,
        v.camera.directionWC.z,
      ],
      up: [v.camera.upWC.x, v.camera.upWC.y, v.camera.upWC.z],
    });
    window.__issue7 = {
      before: capture(),
      count: v.scene.primitives.length,
      settings: {
        inputs: v.scene.screenSpaceCameraController.enableInputs,
        collision: v.scene.screenSpaceCameraController.enableCollisionDetection,
        near: v.camera.frustum.near,
      },
      capture,
      sceneErrors: [],
    };
    v.scene.renderError.addEventListener((scene, error) =>
      window.__issue7.sceneErrors.push(String(error)),
    );
    if (!(await s.enter()))
      throw Error('entry failed ' + JSON.stringify(s.getNavigationState()));
  });
  const captures = [];
  for (const scope of ['building', 'floor', 'office', 'desk']) {
    if (scope !== 'building') {
      if (
        !(await page.evaluate(() =>
          window.__godsEyeView.workspacePrototype.enterChild(),
        ))
      )
        throw Error('child failed');
    }
    const state = await page.evaluate(() =>
      window.__godsEyeView.workspacePrototype.getNavigationState(),
    );
    if (state.scopeId !== `demo-${scope}-001`)
      throw Error('unexpected scope ' + JSON.stringify(state));
    for (const width of evidenceDir ? [1280, 800] : [1280]) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.evaluate(async () => {
        for (let i = 0; i < 4; i++) {
          window.__godsEyeView.viewer.scene.requestRender();
          await new Promise(requestAnimationFrame);
        }
      });
      if (evidenceDir) {
        const path = join(evidenceDir, `${scope}-${width}.png`);
        await page.screenshot({ path });
        captures.push({ scope: state.scopeId, width, path });
      }
    }
  }
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  const desk = await page.evaluate(async () => {
    const d = window.__godsEyeView,
      v = d.viewer,
      s = d.workspacePrototype;
    if (s.getNavigationState().scopeId !== 'demo-desk-001')
      throw Error('not at desk');
    if (v.scene.screenSpaceCameraController.enableInputs !== false)
      throw Error('Workspace input constraint lost after Cesium flight');
    for (let i = 0; i < 4; i++) {
      v.scene.requestRender();
      await new Promise(requestAnimationFrame);
    }
    if (window.__issue7.sceneErrors.length)
      throw Error(window.__issue7.sceneErrors.join(';'));
    const gl = v.scene.context._gl,
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      scope: s.getNavigationState().scopeId,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
      map: d.mapStackController.getState().activeId,
    };
  });
  if (shot) await page.screenshot({ path: shot });
  const result = await page.evaluate(async () => {
    const d = window.__godsEyeView,
      v = d.viewer,
      s = d.workspacePrototype,
      check = window.__issue7;
    if (
      !(await s.back()) ||
      s.getNavigationState().scopeId !== 'demo-office-001'
    )
      throw Error('back failed');
    if (!(await s.goTo('demo-building-001'))) throw Error('ancestor failed');
    if (!(await s.exit()))
      throw Error('exit failed ' + JSON.stringify(s.getNavigationState()));
    const after = check.capture(),
      distance = Math.hypot(
        ...after.position.map((n, i) => n - check.before.position[i]),
      );
    const angle = (a, b) =>
      (Math.acos(
        Math.min(
          1,
          Math.max(
            -1,
            a.reduce((sum, n, i) => sum + n * b[i], 0) /
              (Math.hypot(...a) * Math.hypot(...b)),
          ),
        ),
      ) *
        180) /
      Math.PI;
    const orientation = Math.max(
      angle(after.direction, check.before.direction),
      angle(after.up, check.before.up),
    );
    if (distance > 0.01 || orientation > 0.1)
      throw Error('return precision ' + distance + ' ' + orientation);
    if (v.scene.primitives.length !== check.count) throw Error('geometry leak');
    const settings = () => ({
      inputs: v.scene.screenSpaceCameraController.enableInputs,
      collision: v.scene.screenSpaceCameraController.enableCollisionDetection,
      near: v.camera.frustum.near,
    });
    if (JSON.stringify(settings()) !== JSON.stringify(check.settings))
      throw Error(
        'settings not restored ' +
          JSON.stringify({ before: check.settings, after: settings() }),
      );
    for (let i = 0; i < 20; i++) {
      if (!(await s.enter()) || !(await s.exit()))
        throw Error('cycle navigation failed ' + i);
      if (v.scene.primitives.length !== check.count)
        throw Error('cycle primitive leak ' + i);
      if (JSON.stringify(settings()) !== JSON.stringify(check.settings))
        throw Error('cycle settings leak ' + i);
      const pose = check.capture();
      if (
        Math.hypot(
          ...pose.position.map((n, axis) => n - after.position[axis]),
        ) > 0.01 ||
        angle(pose.direction, after.direction) > 0.1 ||
        angle(pose.up, after.up) > 0.1
      )
        throw Error('cycle return precision ' + i);
      if (
        d
          .getRenderGovernorDiagnostics()
          .holds.some((h) => h.startsWith('workspace-flight-'))
      )
        throw Error('cycle hold leak ' + i);
    }
    // Real shell generation handoff during a flight, not a fake coordinator.
    await s.enter();
    const pending = s.enterChild();
    await new Promise(requestAnimationFrame);
    d.styleManager.beginDeferredLocationNavigation();
    if (await pending) throw Error('search did not supersede flight');
    if (s.getNavigationState().scopeId !== 'demo-globe-001')
      throw Error('handoff retained scope');
    if (JSON.stringify(settings()) !== JSON.stringify(check.settings))
      throw Error('handoff settings not restored');
    if (
      d
        .getRenderGovernorDiagnostics()
        .holds.some((h) => h.startsWith('workspace-flight-'))
    )
      throw Error('flight hold leak');
    // Manual takeover must synchronously restore ordinary controls.
    await s.enter();
    v.scene.canvas.dispatchEvent(new Event('wheel'));
    if (
      s.getNavigationState().scopeId !== 'demo-globe-001' ||
      !v.scene.screenSpaceCameraController.enableInputs
    )
      throw Error('manual takeover failed');
    // Import the exact loaded entry URL: Vite can add an HMR timestamp. A bare
    // second URL would execute main again and correctly hit the singleton guard.
    const mainUrl = [...document.scripts].find((script) => {
      return script.src && new URL(script.src).pathname === '/src/main.js';
    })?.src;
    if (!mainUrl) throw Error('Loaded application entry not found');
    await s.enter();
    const owned = v.scene.primitives.get(check.count);
    const destroyingFlight = s.enterChild();
    await new Promise(requestAnimationFrame);
    const { application } = await import(mainUrl);
    await application.destroy();
    if (await destroyingFlight) throw Error('Destroyed flight completed');
    if (!owned.isDestroyed())
      throw Error('Geometry survived application destruction');
    if (d.workspacePrototype !== undefined)
      throw Error('entry survives teardown');
    return {
      cyclesWithoutLeaks: 20,
      distanceM: distance,
      orientationDeg: orientation,
      collectionCountRestored: true,
      cameraSettingsRestored: true,
      searchHandoff: true,
      manualHandoff: true,
      teardown: true,
      sceneErrors: check.sceneErrors,
    };
  });
  if (errors.length) throw Error('Browser page errors: ' + errors.join(';'));
  console.log(
    JSON.stringify({
      captures,
      desk,
      result,
      pageErrors: errors,
      externalBrowserRequests: 'blocked',
      providerApiRequests: 'blocked',
      softwareRequested: software,
    }),
  );
} finally {
  await browser.close();
}
