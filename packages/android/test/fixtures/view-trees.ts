// CLAPP-080 — view-tree fixtures.
//
// The seven-node/depth-3 capture (the honest-measurement fixture: its
// digest is RECOMPUTED independently in the test from the same core
// hash + canonical serializer) and the depth-4 chain (the budget-law
// fixture: depth 4 against maxHierarchyDepth 3 must refuse).

import type { AndroidViewNode } from '../../src/observation';

/** A view node fixture builder (children default to none). */
function node(
  resourceId: string,
  className: string,
  text = '',
  contentDescription = '',
  children: AndroidViewNode[] = [],
): AndroidViewNode {
  return { resourceId, className, text, contentDescription, children };
}

/**
 * Seven nodes, depth 3: root → (input, camera, list) →
 * (item_1, item_2, item_3). Counted: 1 + 3 + 3 = 7; measured depth 3
 * (root is depth 1).
 */
export const SEVEN_NODE_TREE: AndroidViewNode = node(
  'com.example:id/root',
  'android.view.ViewGroup',
  '',
  'the example screen root',
  [
    node('com.example:id/input', 'android.widget.EditText', 'type here', 'the search input'),
    node('com.example:id/camera', 'android.widget.Button', 'Snap', 'take a photo'),
    node('com.example:id/list', 'android.widget.RecyclerView', '', 'recent items', [
      node('com.example:id/item_1', 'android.widget.TextView', 'first'),
      node('com.example:id/item_2', 'android.widget.TextView', 'second'),
      node('com.example:id/item_3', 'android.widget.TextView', 'third'),
    ]),
  ],
);

/**
 * A depth-4 chain (root → child → grandchild → great-grandchild) —
 * over any budget of 3; the budget-law fixture.
 */
export const DEPTH_FOUR_TREE: AndroidViewNode = node(
  'com.example:id/root',
  'android.view.ViewGroup',
  '',
  '',
  [
    node('com.example:id/child', 'android.view.ViewGroup', '', '', [
      node('com.example:id/grandchild', 'android.view.ViewGroup', '', '', [
        node('com.example:id/great_grandchild', 'android.widget.TextView', 'too deep'),
      ]),
    ]),
  ],
);
