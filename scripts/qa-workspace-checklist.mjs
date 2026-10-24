import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromeExecutablePath } from './qa-chrome.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const base = new URL(option('--url', 'http://127.0.0.1:4175'));
const dir = option('--evidence-dir', '/tmp/workspace-checklist');
const software = args.includes('--software');
await mkdir(dir, { recursive: true });
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
const result = {
  captures: [],
  externalBrowserRequests: 'blocked',
  providerApiRequests: 'blocked',
  softwareRequested: software,
};
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
  page.on('console', (message) => {
    if (
      /Product state listener failed|Workspace cleanup failed/.test(
        message.text(),
      )
    )
      errors.push(message.text());
  });
  await page.goto(new URL('/?workspacePrototype=1&welcome=0', base).href, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.__godsEyeView?.workspacePrototype, {
    timeout: 120000,
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView.viewer.scene.screenSpaceCameraController
        .enableInputs === true,
    { timeout: 60000 },
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const d = window.__godsEyeView,
      v = d.viewer;
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
    window.__checklistQa = {
      capture,
      before: capture(),
      count: v.scene.primitives.length,
      settings: [
        v.scene.screenSpaceCameraController.enableInputs,
        v.scene.screenSpaceCameraController.enableCollisionDetection,
        v.camera.frustum.near,
      ],
      sceneErrors: [],
    };
    v.scene.renderError.addEventListener((scene, error) =>
      window.__checklistQa.sceneErrors.push(String(error)),
    );
  });
  const desk = async () => {
    await page.evaluate(async () => {
      const w = window.__godsEyeView.workspacePrototype;
      if (!(await w.enter()))
        throw Error(
          'building entry failed ' + JSON.stringify(w.getNavigationState()),
        );
      for (let i = 0; i < 3; i++)
        if (!(await w.enterChild())) throw Error('desk route failed');
      if (w.getNavigationState().scopeId !== 'demo-desk-001')
        throw Error('not desk');
    });
  };
  const waitScope = async (id) =>
    page.waitForFunction(
      (id) => {
        const s = window.__godsEyeView.workspacePrototype.getNavigationState();
        return s.scopeId === id && s.phase === 'stable';
      },
      { timeout: 20000 },
      id,
    );
  const capture = async (name) => {
    await page.screenshot({ path: join(dir, name), waitForFonts: false });
    result.captures.push(name);
  };
  // Projection is the production adapter, not hard-coded screenshot pixels.
  const screenPoint = async (target = page) =>
    target.evaluate(async () => {
      const { createScreenProjection } =
        await import('/src/workspace/screenProjection.js');
      const { createWorkspaceFixture } =
        await import('/src/workspace/fixture.js');
      const p = createScreenProjection({
        viewer: window.__godsEyeView.viewer,
        document: createWorkspaceFixture(),
      })();
      return {
        x: p.reduce((s, v) => s + v[0], 0) / 4,
        y: p.reduce((s, v) => s + v[1], 0) / 4,
      };
    });
  if (!args.includes('--visual-only')) {
    console.log('Ready: starting checklist route');
    await desk();
    for (const width of [1280, 800]) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.evaluate(async () => {
        for (let i = 0; i < 4; i++) {
          window.__godsEyeView.viewer.scene.requestRender();
          await new Promise(requestAnimationFrame);
        }
      });
      const alignment = await page.evaluate(async () => {
        const { createScreenProjection } =
          await import('/src/workspace/screenProjection.js');
        const { createWorkspaceFixture } =
          await import('/src/workspace/fixture.js');
        const { createCoordinateFrames } =
          await import('/src/workspace/coordinates.js');
        const { MONITOR_SCREEN } = await import('/src/workspace/geometry.js');
        const source = await (
          await fetch('/src/workspace/coordinates.js')
        ).text();
        const url = source.match(/from ["']([^"']+cesium[^"']*)["']/)[1];
        const { SceneTransforms, Cartesian3 } = await import(url);
        const v = window.__godsEyeView.viewer,
          doc = createWorkspaceFixture(),
          frames = createCoordinateFrames(doc);
        const a = MONITOR_SCREEN.minM,
          b = MONITOR_SCREEN.maxM;
        const sdk = [
          [a[0], a[1], b[2]],
          [b[0], a[1], b[2]],
          [b[0], a[1], a[2]],
          [a[0], a[1], a[2]],
        ].map((p) =>
          SceneTransforms.worldToWindowCoordinates(
            v.scene,
            new Cartesian3(...frames.localToEcef('demo-desk-001', p)),
          ),
        );
        const projected = createScreenProjection({
          viewer: v,
          document: doc,
        })();
        const polygon = document.querySelector(
          '.workspace-ui__highlight polygon',
        );
        const shown = polygon
          .getAttribute('points')
          .split(' ')
          .map((p) => p.split(',').map(Number));
        const matrix = polygon.getScreenCTM();
        const outlineError = Math.max(
          ...shown.map(([x, y], i) =>
            Math.hypot(
              matrix.a * x + matrix.c * y + matrix.e - sdk[i].x,
              matrix.b * x + matrix.d * y + matrix.f - sdk[i].y,
            ),
          ),
        );
        const projectionError = Math.max(
          ...projected.map(([x, y], i) =>
            Math.hypot(x - sdk[i].x, y - sdk[i].y),
          ),
        );
        if (outlineError > 0.1 || projectionError > 0.1)
          throw Error(
            'screen alignment ' + outlineError + ' ' + projectionError,
          );
        return {
          outlineErrorPx: outlineError,
          projectionErrorPx: projectionError,
        };
      });
      (result.screenAlignment ||= {})[width] = alignment;
      await capture(`desk-${width}.png`);
      const point = await screenPoint();
      await page.mouse.move(point.x, point.y);
      await page.mouse.click(point.x, point.y);
      await waitScope('demo-application-001');
      await page.waitForSelector('.workspace-ui__content input[type=text]');
      if (await page.evaluate(() => document.activeElement?.type !== 'text'))
        throw Error('input not focused');
      // Space and ordinary globe-shortcut letters must remain text, not trigger voice/navigation.
      await page.type(
        '.workspace-ui__content input[type=text]',
        `Review h o v f d c ${width}`,
      );
      await page.keyboard.press('Enter');
      await page.waitForSelector('.workspace-ui__content li');
      await page.click('.workspace-ui__content input[type=checkbox]');
      await page.keyboard.press('Space');
      if (
        await page.evaluate(
          () =>
            window.__godsEyeView.workspacePrototype.getNavigationState()
              .scopeId !== 'demo-application-001',
        )
      )
        throw Error('widget input yielded lease');
      await page.evaluate(() =>
        document
          .querySelector('.workspace-ui__content input[type=checkbox]')
          .click(),
      );
      await capture(`checklist-${width}.png`);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      await waitScope('demo-desk-001');
      if (
        await page.evaluate(
          () => !document.activeElement?.textContent.includes('Open checklist'),
        )
      )
        throw Error('launcher focus not restored');
      // Real keyboard alternative, then persistence across presentation removal.
      await page.keyboard.press('Enter');
      await waitScope('demo-application-001');
      if (
        (await page.$$eval(
          '.workspace-ui__content li',
          (rows) => rows.length,
        )) !== (width === 1280 ? 1 : 2)
      )
        throw Error('tasks not retained');
      await page.evaluate(() => window.__godsEyeView.workspacePrototype.back());
      await waitScope('demo-desk-001');
    }
    // Delete and empty state, persisted separately from camera state.
    await page.click('.workspace-ui__bar button');
    await waitScope('demo-application-001');
    while (
      await page.$$eval('.workspace-ui__content li', (rows) => rows.length)
    )
      await page.click('.workspace-ui__content li button');
    if (
      await page.$eval(
        '.workspace-ui__content',
        (e) => !e.textContent.includes('No tasks yet.'),
      )
    )
      throw Error('missing empty state');
    await page.type(
      '.workspace-ui__content input[type=text]',
      'Survives reload',
    );
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.__godsEyeView.workspacePrototype.back());
    await waitScope('demo-desk-001');
    // Twenty application mount/close cycles, including reduced motion.
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
    await page.evaluate(async () => {
      const d = window.__godsEyeView,
        w = d.workspacePrototype,
        v = d.viewer;
      const count = v.scene.primitives.length;
      for (let i = 0; i < 20; i++) {
        if (
          !(await w.enterChild()) ||
          w.getNavigationState().scopeId !== 'demo-application-001'
        )
          throw Error('cycle entry ' + i);
        if (
          !(await w.back()) ||
          w.getNavigationState().scopeId !== 'demo-desk-001'
        )
          throw Error('cycle back ' + i);
        if (
          v.scene.primitives.length !== count ||
          document.querySelectorAll('[data-workspace-root]').length !== 1 ||
          document.querySelectorAll('[data-workspace-suppressed]').length
        )
          throw Error('cycle leak ' + i);
      }
    });
    result.cycles = 20;
    console.log('Editing, keyboard and 20 reduced-motion cycles passed');
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ]);
    // Rapid entry/Back, entry/Exit, external authority and physical outside input.
    await page.evaluate(async () => {
      const d = window.__godsEyeView,
        w = d.workspacePrototype;
      const pending = w.enterChild();
      await new Promise(requestAnimationFrame);
      const back = w.back();
      if (await pending) throw Error('cancelled app entry committed');
      await back;
      if (
        w.getNavigationState().scopeId !== 'demo-desk-001' ||
        document.querySelectorAll('[data-workspace-suppressed]').length
      )
        throw Error('cancelled app orphan');
    });
    await page.evaluate(() => window.__godsEyeView.workspacePrototype.exit());
    result.return = await page.evaluate(() => {
      const d = window.__godsEyeView,
        v = d.viewer,
        c = window.__checklistQa,
        a = c.capture();
      const angle = (x, y) =>
        (Math.acos(
          Math.min(
            1,
            Math.max(
              -1,
              x.reduce((s, n, i) => s + n * y[i], 0) /
                (Math.hypot(...x) * Math.hypot(...y)),
            ),
          ),
        ) *
          180) /
        Math.PI;
      const distance = Math.hypot(
        ...a.position.map((n, i) => n - c.before.position[i]),
      );
      const orientation = Math.max(
        angle(a.direction, c.before.direction),
        angle(a.up, c.before.up),
      );
      if (distance > 0.01 || orientation > 0.1)
        throw Error('globe return precision');
      if (
        v.scene.primitives.length !== c.count ||
        document.querySelector('[data-workspace-root]') ||
        document.querySelector('[data-workspace-suppressed]')
      )
        throw Error('exit leak');
      if (
        JSON.stringify(c.settings) !==
        JSON.stringify([
          v.scene.screenSpaceCameraController.enableInputs,
          v.scene.screenSpaceCameraController.enableCollisionDetection,
          v.camera.frustum.near,
        ])
      )
        throw Error('settings not restored');
      if (c.sceneErrors.length) throw Error(c.sceneErrors.join(';'));
      return {
        distanceM: distance,
        orientationDeg: orientation,
        sceneErrors: c.sceneErrors,
      };
    });
    await desk();
    await page.evaluate(async () => {
      const d = window.__godsEyeView,
        w = d.workspacePrototype;
      const p = w.enterChild();
      await new Promise(requestAnimationFrame);
      d.styleManager.beginDeferredLocationNavigation();
      if (await p) throw Error('handoff did not cancel');
      if (
        document.querySelector('[data-workspace-root]') ||
        document.querySelector('[data-workspace-suppressed]')
      )
        throw Error('handoff orphan');
    });
    await desk();
    await page.evaluate(async () => {
      const w = window.__godsEyeView.workspacePrototype;
      const p = w.enterChild();
      await new Promise(requestAnimationFrame);
      document.body.dispatchEvent(new Event('wheel', { bubbles: true }));
      if (await p) throw Error('outside input did not cancel');
      if (w.getNavigationState().scopeId !== 'demo-globe-001')
        throw Error('outside input retained scope');
    });
    await desk();
    await page.evaluate(async () => {
      const w = window.__godsEyeView.workspacePrototype;
      const p = w.enterChild();
      await new Promise(requestAnimationFrame);
      const exiting = w.exit();
      if (await p) throw Error('exit did not cancel');
      await exiting;
    });
    // Misses must yield normal ownership, never enter the app. Test a desktop point.
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
    for (const local of [
      [0.2, 0.2, 0.75],
      [0.46, 0.56, 1.16],
      [2.5, -0.5, 0.2],
    ]) {
      await desk();
      await page.evaluate(async () => {
        for (let i = 0; i < 3; i++) {
          window.__godsEyeView.viewer.scene.requestRender();
          await new Promise(requestAnimationFrame);
        }
      });
      const miss = await page.evaluate(async (local) => {
        const { createCoordinateFrames } =
          await import('/src/workspace/coordinates.js');
        const { createWorkspaceFixture } =
          await import('/src/workspace/fixture.js');
        const v = window.__godsEyeView.viewer;
        const p = createCoordinateFrames(createWorkspaceFixture()).localToEcef(
          'demo-desk-001',
          local,
        );
        const rect = v.scene.canvas.getBoundingClientRect(),
          c = v.camera;
        const offset = p.map(
          (n, i) => n - [c.positionWC.x, c.positionWC.y, c.positionWC.z][i],
        );
        const dot = (v) => offset[0] * v.x + offset[1] * v.y + offset[2] * v.z;
        const depth = dot(c.directionWC),
          tan = Math.tan(c.frustum.fovy / 2);
        return {
          x:
            rect.left +
            rect.width / 2 +
            ((dot(c.rightWC) / depth / tan) * rect.height) / 2,
          y:
            rect.top +
            rect.height / 2 -
            ((dot(c.upWC) / depth / tan) * rect.height) / 2,
        };
      }, local);
      await page.mouse.click(miss.x, miss.y);
      if (
        (await page.evaluate(
          () =>
            window.__godsEyeView.workspacePrototype.getNavigationState()
              .scopeId,
        )) !== 'demo-globe-001'
      )
        throw Error('desk miss activated screen or retained scope');
    }
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ]);
    result.pickMiss = ['desktop', 'monitor-frame', 'surrounding-scene'];
    result.beforeReloadSceneErrors = await page.evaluate(
      () => window.__checklistQa.sceneErrors,
    );
    if (result.beforeReloadSceneErrors.length)
      throw Error(result.beforeReloadSceneErrors.join(';'));
    result.cancellation = {
      back: true,
      exit: true,
      searchHandoff: true,
      outsideInput: true,
    };
    // Reload reads the persisted store, not an in-memory singleton.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__godsEyeView?.workspacePrototype, {
      timeout: 120000,
    });
    await page.waitForFunction(
      () =>
        window.__godsEyeView.viewer.scene.screenSpaceCameraController
          .enableInputs,
      { timeout: 60000 },
    );
    await page.evaluate(() => {
      window.__checklistReloadErrors = [];
      window.__godsEyeView.viewer.scene.renderError.addEventListener((s, e) =>
        window.__checklistReloadErrors.push(String(e)),
      );
    });
    await desk();
    await page.click('.workspace-ui__bar button');
    await waitScope('demo-application-001');
    if (
      await page.$eval(
        '.workspace-ui__content',
        (e) => !e.textContent.includes('Survives reload'),
      )
    )
      throw Error('reload lost task');
    result.reloadPersistence = true;
    result.final = await page.evaluate(async () => {
      const d = window.__godsEyeView,
        v = d.viewer,
        w = d.workspacePrototype;
      const gl = v.scene.context._gl,
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : 'unknown';
      const sceneErrors = [];
      v.scene.renderError.addEventListener((s, e) =>
        sceneErrors.push(String(e)),
      );
      await w.back();
      const p = w.enterChild();
      await new Promise(requestAnimationFrame);
      const src = [...document.scripts].find(
        (s) => s.src && new URL(s.src).pathname === '/src/main.js',
      ).src;
      await (await import(src)).application.destroy();
      if (await p) throw Error('destroyed app entry committed');
      if (
        document.querySelector('[data-workspace-root]') ||
        document.querySelector('[data-workspace-suppressed]')
      )
        throw Error('destroy orphan');
      return {
        renderer,
        sceneErrors: [...sceneErrors, ...window.__checklistReloadErrors],
        destroyed: true,
      };
    });
    if (result.final.sceneErrors.length)
      throw Error(result.final.sceneErrors.join(';'));
  } else {
    result.visualOnly = true;
  }
  if (errors.length) throw Error(errors.join(';'));
  // Optional visual-only pages: pause the actual browser animation/clock at
  // 350 ms. Never change the clock in the page used for behavioral smoke tests.
  result.midTransitionPaused = [];
  for (const width of args.includes('--behavior-only') ? [] : [1280, 800]) {
    const visual = await browser.newPage();
    try {
      await visual.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await visual.setRequestInterception(true);
      visual.on('request', (r) =>
        (r.url().startsWith(base.origin + '/') &&
          !new URL(r.url()).pathname.startsWith('/api/')) ||
        /^(data:|blob:)/.test(r.url())
          ? r.continue()
          : r.abort(),
      );
      visual.on('pageerror', (e) => errors.push(String(e)));
      await visual.goto(
        new URL('/?workspacePrototype=1&welcome=0', base).href,
        {
          waitUntil: 'domcontentloaded',
        },
      );
      await visual.waitForFunction(
        () => window.__godsEyeView?.workspacePrototype,
        { timeout: 120000 },
      );
      await visual.waitForFunction(
        () =>
          window.__godsEyeView.viewer.scene.screenSpaceCameraController
            .enableInputs,
        { timeout: 60000 },
      );
      await visual.evaluate(async () => {
        const w = window.__godsEyeView.workspacePrototype;
        if (!(await w.enter())) throw Error('visual entry failed');
        for (let i = 0; i < 3; i++)
          if (!(await w.enterChild())) throw Error('visual desk failed');
      });
      // Visual-only instrumentation pauses the native animation at 350 ms and
      // the browser clock before the same scoped keyboard-launcher action. No static/fake render.
      await visual.evaluate(() => {
        const surface = document.querySelector('.workspace-ui__surface');
        const native = surface.animate.bind(surface);
        surface.animate = (...args) => {
          const animation = native(...args);
          animation.pause();
          animation.currentTime = 350;
          return animation;
        };
        window.__visualErrors = [];
        window.__godsEyeView.viewer.scene.renderError.addEventListener((s, e) =>
          window.__visualErrors.push(String(e)),
        );
      });
      const cdp = await visual.createCDPSession();
      await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
      await visual.evaluate(async () => {
        document.querySelector('.workspace-ui__bar button').click();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      });
      const paused = await visual.evaluate(() =>
        document
          .querySelector('.workspace-ui__surface')
          ?.getAnimations()
          .some((a) => a.playState === 'paused' && a.currentTime === 350),
      );
      if (paused) {
        const name = `transition-paused-${width}.png`;
        await visual.screenshot({ path: join(dir, name), waitForFonts: false });
        result.captures.push(name);
        result.midTransitionPaused.push(width);
      }
      const sceneErrors = await visual.evaluate(() => window.__visualErrors);
      if (sceneErrors.length) throw Error(sceneErrors.join(';'));
      await cdp.detach();
    } finally {
      await visual.close();
    }
  }
  if (errors.length) throw Error(errors.join(';'));
  result.pageErrors = errors;
  await writeFile(
    join(dir, 'browser-results.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
