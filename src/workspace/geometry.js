// The sole interactive surface; local desk metres, front face toward -Y.
export const MONITOR_SCREEN = Object.freeze({
  minM: Object.freeze([0.49, 0.55, 0.98]),
  maxM: Object.freeze([1.11, 0.555, 1.34]),
});
export const screenPickId = (document) =>
  `${document.workspaceId}:${document.nodes.find((node) => node.kind === 'desk').id}:screen`;

/**
 * Static cutaway presentation, not spatial identity or surveyed architecture.
 * Dimensions are metres in each fixture node's local frame. Open south faces
 * and roof rails keep the nested subjects visible without tileset clipping.
 */
export function workspaceBoxParts(node) {
  const parts = [];
  const box = (part, minM, maxM, color, outline = false) =>
    parts.push({ part, minM, maxM, color, outline });
  const { minM: a, maxM: b } = node.bounds;
  if (node.kind === 'building') {
    box('foundation', [a[0], a[1], -0.2], [b[0], b[1], 0], '#34465c');
    box('rear-facade', [a[0], b[1] - 0.2, 0], [b[0], b[1], b[2]], '#7796ab');
    for (const x of [a[0], b[0] - 0.25]) {
      box(
        `column-${x}`,
        [x, a[1], 0],
        [x + 0.25, a[1] + 0.25, b[2]],
        '#c5d4df',
      );
      box(
        `roof-side-${x}`,
        [x, a[1], b[2] - 0.2],
        [x + 0.25, b[1], b[2]],
        '#c5d4df',
      );
    }
    box(
      'roof-front',
      [a[0], a[1], b[2] - 0.2],
      [b[0], a[1] + 0.25, b[2]],
      '#c5d4df',
    );
    box(
      'entrance',
      [-1.2, a[1] - 0.4, 0.02],
      [1.2, a[1] + 0.8, 0.12],
      '#e9ae55',
    );
    // A door frame with a genuine opening, not an opaque wall.
    for (const x of [-1.2, 1])
      box(
        `door-post-${x}`,
        [x, a[1], 0.1],
        [x + 0.2, a[1] + 0.2, 2.5],
        '#e9ae55',
      );
    box('door-lintel', [-1.2, a[1], 2.3], [1.2, a[1] + 0.2, 2.5], '#e9ae55');
    box('silhouette', a, b, '#bad5e6', true);
  } else if (node.kind === 'floor') {
    box('slab', [a[0], a[1], 0], [b[0], b[1], 0.12], '#667d93');
    box('perimeter', [a[0], a[1], 0.13], [b[0], b[1], 0.16], '#b5cddd', true);
    box('partition', [-6, 3.4, 0.12], [-3.3, 3.55, 1.2], '#9bb2c5');
    box('aisle', [-0.6, -6.5, 0.125], [0.6, -2.2, 0.14], '#e9ae55');
  } else if (node.kind === 'office') {
    box('room-pad', [0, 0, 0.125], [6, 5, 0.15], '#b7a58c');
    box('rear-wall', [0, 4.85, 0.15], [6, 5, 2.8], '#d9cbb5');
    box('side-wall', [0, 0, 0.15], [0.15, 5, 2.8], '#baaa92');
    box('front-left', [0, 0, 0.15], [1.4, 0.15, 0.65], '#d9cbb5');
    box('front-right', [2.8, 0, 0.15], [6, 0.15, 0.65], '#d9cbb5');
    box('doorstep', [1.4, -0.15, 0.15], [2.8, 0.25, 0.18], '#e9ae55');
    box('room-edge', [0, 0, 0.15], [6, 5, 2.8], '#efdcb6', true);
  } else if (node.kind === 'desk') {
    box('desktop', [0, 0, 0.69], [1.6, 0.8, 0.75], '#ca8b4f');
    box('desktop-edge', [0, 0, 0.69], [1.6, 0.8, 0.75], '#f2c48c', true);
    for (const x of [0.1, 1.4])
      for (const y of [0.1, 0.62])
        box(
          `leg-${x}-${y}`,
          [x, y, 0.15],
          [x + 0.08, y + 0.08, 0.69],
          '#33475b',
        );
    box('monitor-base', [0.62, 0.43, 0.75], [0.98, 0.69, 0.78], '#33475b');
    box('monitor-stand', [0.77, 0.55, 0.78], [0.83, 0.61, 0.96], '#33475b');
    box('monitor', [0.45, 0.56, 0.94], [1.15, 0.64, 1.38], '#24394e');
    box('screen', MONITOR_SCREEN.minM, MONITOR_SCREEN.maxM, '#79c4d6');
    box('keyboard', [0.48, 0.14, 0.75], [1.12, 0.34, 0.78], '#d5dee5');
  }
  return parts;
}
