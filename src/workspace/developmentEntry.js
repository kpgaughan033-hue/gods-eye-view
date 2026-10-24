import { createWorkspaceSession } from './session.js';

export function workspacePrototypeEnabled({ development, search = '' }) {
  return (
    development === true &&
    new URLSearchParams(search).get('workspacePrototype') === '1'
  );
}

/** Register ownership synchronously; load renderer code only on explicit acquire. */
export function installWorkspaceDevelopmentEntry({
  viewer,
  signal,
  defer,
  debug,
  load = () => import('./prototype.js'),
}) {
  let pending = null;
  const session = createWorkspaceSession({
    signal,
    async acquire({ signal: acquisitionSignal, defer: own }) {
      pending ||= Promise.resolve()
        .then(load)
        .catch((error) => {
          pending = null;
          throw error;
        });
      const module = await pending;
      acquisitionSignal.throwIfAborted();
      return module.createWorkspacePrototypeAdapter({ viewer }).acquire({
        signal: acquisitionSignal,
        defer: own,
      });
    },
  });
  const dispose = () => {
    if (debug.workspacePrototype === session) delete debug.workspacePrototype;
    session.dispose();
  };
  defer(dispose);
  // Application abort removes the dev handle as well as cancelling the session.
  const abort = () => dispose();
  signal.addEventListener('abort', abort, { once: true });
  defer(() => signal.removeEventListener('abort', abort));
  if (signal.aborted) dispose();
  else debug.workspacePrototype = session;
  return session;
}
