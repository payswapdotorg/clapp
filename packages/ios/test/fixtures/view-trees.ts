// CLAPP-084 — view-tree fixtures.
//
// The seven-node/depth-3 capture (the honest-measurement fixture: its
// digest is RECOMPUTED independently in the test from the same core
// hash + canonical serializer) and the depth-4 chain (the budget-law
// fixture: depth 4 against maxHierarchyDepth 3 must refuse). Node
// vocabularies are XCUITest-flavored: element ids are the app's
// accessibility identifiers, element types are the XCUIElement type
// names.

import type { IOSViewNode } from '../../src/observation';

/** A view node fixture builder (children default to none). */
function node(
  elementId: string,
  elementType: string,
  label = '',
  value = '',
  children: IOSViewNode[] = [],
): IOSViewNode {
  return { elementId, elementType, label, value, children };
}

/**
 * Seven nodes, depth 3: main_window → (search_field, submit_button,
 * results_list) → (result_row_1, result_row_2, result_row_3). Counted:
 * 1 + 3 + 3 = 7; measured depth 3 (root is depth 1).
 */
export const SEVEN_NODE_TREE: IOSViewNode = node(
  'main_window',
  'window',
  'Example',
  '',
  [
    node('search_field', 'searchField', 'Search', 'type here'),
    node('submit_button', 'button', 'Search', ''),
    node('results_list', 'list', 'Results', '', [
      node('result_row_1', 'cell', 'First'),
      node('result_row_2', 'cell', 'Second'),
      node('result_row_3', 'cell', 'Third'),
    ]),
  ],
);

/**
 * A depth-4 chain (root → child → grandchild → great-grandchild) —
 * over any budget of 3; the budget-law fixture.
 */
export const DEPTH_FOUR_TREE: IOSViewNode = node(
  'main_window',
  'window',
  '',
  '',
  [
    node('child_group', 'group', '', '', [
      node('grandchild_group', 'group', '', '', [
        node('too_deep_text', 'staticText', '', 'too deep'),
      ]),
    ]),
  ],
);
