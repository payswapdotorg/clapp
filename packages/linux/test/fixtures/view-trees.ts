// CLAPP-081 — view-tree fixtures.
//
// The seven-node/depth-3 capture (the honest-measurement fixture: its
// digest is RECOMPUTED independently in the test from the same core
// hash + canonical serializer) and the depth-4 chain (the budget-law
// fixture: depth 4 against maxHierarchyDepth 3 must refuse). Node
// vocabularies are AT-SPI-flavored: resource ids are the accessible
// ids, class names are the AT-SPI role names.

import type { LinuxViewNode } from '../../src/observation';

/** A view node fixture builder (children default to none). */
function node(
  resourceId: string,
  className: string,
  text = '',
  contentDescription = '',
  children: LinuxViewNode[] = [],
): LinuxViewNode {
  return { resourceId, className, text, contentDescription, children };
}

/**
 * Seven nodes, depth 3: root-pane → (search-entry, submit-button,
 * item-list) → (item_1, item_2, item_3). Counted: 1 + 3 + 3 = 7;
 * measured depth 3 (root is depth 1).
 */
export const SEVEN_NODE_TREE: LinuxViewNode = node(
  'root-pane',
  'root pane',
  '',
  'the example window root',
  [
    node('search-entry', 'text', 'type here', 'the search input'),
    node('submit-button', 'push button', 'Search', 'run the search'),
    node('item-list', 'list', '', 'recent items', [
      node('item_1', 'list item', 'first'),
      node('item_2', 'list item', 'second'),
      node('item_3', 'list item', 'third'),
    ]),
  ],
);

/**
 * A depth-4 chain (root → child → grandchild → great-grandchild) —
 * over any budget of 3; the budget-law fixture.
 */
export const DEPTH_FOUR_TREE: LinuxViewNode = node(
  'root-pane',
  'root pane',
  '',
  '',
  [
    node('child-panel', 'panel', '', '', [
      node('grandchild-panel', 'panel', '', '', [
        node('too-deep-label', 'label', 'too deep'),
      ]),
    ]),
  ],
);
