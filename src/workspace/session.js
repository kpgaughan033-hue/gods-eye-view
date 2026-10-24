/** Instance-owned acquisition/presentation lifetime. Cleanup functions are synchronous. */
export function createWorkspaceSession({
  acquire: acquirePresentation,
  signal,
  onError = (error) => console.error('Workspace cleanup failed', error),
}) {
  let current = null;
  let state = 'idle';
  let disposed = false;

  function close(run) {
    if (run.closed) return;
    run.closed = true;
    run.controller.abort();
    const errors = [];
    for (const dispose of [...run.cleanups.values()].reverse()) {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    run.cleanups.clear();
    if (errors.length)
      throw new AggregateError(errors, 'Workspace release failed');
  }

  function deactivate() {
    const run = current;
    current = null;
    state = disposed ? 'disposed' : 'idle';
    if (run) close(run);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', abort);
    deactivate();
  }
  const abort = () => {
    try {
      dispose();
    } catch (error) {
      onError(error);
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) dispose();

  function acquire() {
    if (disposed) return Promise.resolve(false);
    if (current) return current.promise;
    const run = {
      controller: new AbortController(),
      cleanups: new Map(),
      seen: new Set(),
      closed: false,
      handle: null,
    };
    current = run;
    state = 'acquiring';
    const defer = (cleanup) => {
      if (typeof cleanup !== 'function')
        throw new TypeError('Workspace cleanup must be a function');
      if (run.seen.has(cleanup)) return;
      run.seen.add(cleanup);
      // A non-cooperative adapter may finish after abort. Release its late result.
      if (run.closed) {
        try {
          cleanup();
        } catch (error) {
          onError(error);
        }
      } else run.cleanups.set(cleanup, cleanup);
    };
    const cancelled = new Promise((resolve) =>
      run.controller.signal.addEventListener(
        'abort',
        () => {
          if (!run.failed) resolve(false);
        },
        { once: true },
      ),
    );
    const work = Promise.resolve().then(async () => {
      if (run.closed) return false;
      try {
        const handle = await acquirePresentation({
          signal: run.controller.signal,
          defer,
        });
        if (typeof handle?.dispose === 'function') defer(handle.dispose);
        if (run.closed || current !== run) return false;
        if (
          typeof handle?.activate !== 'function' ||
          typeof handle?.dispose !== 'function'
        )
          throw new TypeError(
            'Workspace presentation requires activate and dispose',
          );
        run.handle = handle;
        state = 'acquired';
        return true;
      } catch (error) {
        if (run.closed) return false;
        // Failure cleanup aborts the same signal. Do not let that cancellation
        // win the race and turn a genuine acquisition error into false.
        run.failed = true;
        try {
          deactivate();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Workspace acquisition and cleanup failed',
          );
        }
        throw error;
      }
    });
    run.promise = Promise.race([work, cancelled]);
    return run.promise;
  }

  async function activate() {
    const pending = acquire();
    const run = current;
    if (!(await pending) || current !== run || run.closed) return false;
    if (state === 'active') return true;
    try {
      run.handle.activate();
      if (current !== run || run.closed) return false;
      state = 'active';
      return true;
    } catch (error) {
      try {
        deactivate();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Workspace activation and cleanup failed',
        );
      }
      throw error;
    }
  }

  return Object.freeze({
    acquire,
    activate,
    deactivate,
    dispose,
    getState: () => state,
  });
}
