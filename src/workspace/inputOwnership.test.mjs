import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandlePushToTalkKeyDown } from '../voice/realtimeInputPolicy.js';
import { testDocument } from './testDom.mjs';
test('Space belongs to every scoped workspace control; ordinary map/background semantics remain', () => {
  const d = testDocument(),
    root = d.createElement('section');
  root.dataset.workspaceInput = '';
  d.body.append(root);
  for (const tag of ['input', 'button', 'section']) {
    const target = d.createElement(tag);
    root.append(target);
    assert.equal(
      shouldHandlePushToTalkKeyDown({ code: 'Space', target }),
      false,
    );
  }
  const target = d.createElement('div');
  d.body.append(target);
  assert.equal(shouldHandlePushToTalkKeyDown({ code: 'Space', target }), true);
  assert.equal(
    shouldHandlePushToTalkKeyDown({ code: 'Space', target, metaKey: true }),
    false,
  );
});
