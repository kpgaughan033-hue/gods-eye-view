import { createWorkspaceFixture } from './fixture.js';
import { createCesiumWorkspaceAdapter } from './cesiumAdapter.js';
import { governorRequestRender } from '../renderGovernor.js';

/** Called only by the explicit development entry; borrows the existing viewer. */
export function createWorkspacePrototypeAdapter({ viewer }) {
  // Static geometry needs one-shot renders, never a continuous-render hold.
  return createCesiumWorkspaceAdapter({
    viewer,
    document: createWorkspaceFixture(),
    requestRender: governorRequestRender,
  });
}
