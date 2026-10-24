/**
 * Fictional layout at a fixed WGS84 test anchor near Austin, Texas:
 * longitude -97.7431°, latitude 30.2672°, height 200 m above the WGS84
 * ellipsoid. Height is an explicit synthetic constant, NOT surveyed ground,
 * an orthometric elevation, or a description of any real building/interior.
 * No terrain lookup, provider, renderer, or startup registration is performed.
 */
export function createWorkspaceFixture() {
  const node = (id, parentId, kind, label, translationM, minM, maxM) => ({
    id,
    parentId,
    kind,
    label,
    transform: { translationM, rotationXYZW: [0, 0, 0, 1] },
    bounds: minM ? { minM, maxM } : null,
  });
  const globe = node(
    'demo-globe-001',
    null,
    'globe',
    'Globe',
    [0, 0, 0],
    null,
    null,
  );
  const building = node(
    'demo-building-001',
    globe.id,
    'building',
    'Fictional demo building',
    [0, 0, 0],
    [-10, -8, 0],
    [10, 8, 6],
  );
  building.anchor = {
    longitudeDeg: -97.7431,
    latitudeDeg: 30.2672,
    ellipsoidalHeightM: 200,
  };
  const floor = node(
    'demo-floor-001',
    building.id,
    'floor',
    'Demo floor',
    [0, 0, 0.2],
    [-9, -7, 0],
    [9, 7, 3],
  );
  const office = node(
    'demo-office-001',
    floor.id,
    'office',
    'Demo office',
    [-3, -2, 0],
    [0, 0, 0],
    [6, 5, 2.8],
  );
  const desk = node(
    'demo-desk-001',
    office.id,
    'desk',
    'Demo desk',
    [2, 2, 0],
    [0, 0, 0],
    [1.6, 0.8, 0.75],
  );
  const application = node(
    'demo-application-001',
    desk.id,
    'application',
    'Task checklist',
    [0.8, 0.4, 0.8],
    [-0.3, -0.1, 0],
    [0.3, 0.1, 0.4],
  );
  application.widget = {
    type: 'task-checklist',
    stateKey: 'demo-checklist-001',
  };
  return {
    version: 1,
    workspaceId: 'fictional-workspace-001',
    rootId: globe.id,
    nodes: [globe, building, floor, office, desk, application],
  };
}
