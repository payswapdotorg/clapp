// CLAPP-083 — view-tree fixtures.
//
// The seven-node/depth-3 capture (the honest-measurement fixture: its
// digest is RECOMPUTED independently in the test from the same core
// hash + canonical serializer) and the depth-4 chain (the budget-law
// fixture: depth 4 against maxHierarchyDepth 3 must refuse). Node
// vocabularies are AX-flavored: ax ids are the macOS Accessibility
// API's AXIdentifier, roles are the AX role names.

import type { MacOSViewNode } from '../../src/observation';

/** A view node fixture builder (children default to none). */
function node(
  axId: string,
  role: string,
  title = '',
  description = '',
  children: MacOSViewNode[] = [],
): MacOSViewNode {
  return { axId, role, title, description, children };
}

/**
 * Seven nodes, depth 3: AXMainWindow → (AXSearchField, AXSubmitButton,
 * AXResultsList) → (AXResultRow1, AXResultRow2, AXResultRow3). Counted:
 * 1 + 3 + 3 = 7; measured depth 3 (root is depth 1).
 */
export const SEVEN_NODE_TREE: MacOSViewNode = node(
  'AXMainWindow',
  'AXWindow',
  'Example',
  '',
  [
    node('AXSearchField', 'AXTextField', 'Search', 'type here'),
    node('AXSubmitButton', 'AXButton', 'Search', ''),
    node('AXResultsList', 'AXList', 'Results', '', [
      node('AXResultRow1', 'AXRow', 'First'),
      node('AXResultRow2', 'AXRow', 'Second'),
      node('AXResultRow3', 'AXRow', 'Third'),
    ]),
  ],
);

/**
 * A depth-4 chain (root → child → grandchild → great-grandchild) —
 * over any budget of 3; the budget-law fixture.
 */
export const DEPTH_FOUR_TREE: MacOSViewNode = node(
  'AXMainWindow',
  'AXWindow',
  '',
  '',
  [
    node('AXChildGroup', 'AXGroup', '', '', [
      node('AXGrandchildGroup', 'AXGroup', '', '', [
        node('AXTooDeepText', 'AXStaticText', 'too deep'),
      ]),
    ]),
  ],
);
