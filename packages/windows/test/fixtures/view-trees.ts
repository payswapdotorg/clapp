// CLAPP-082 — view-tree fixtures.
//
// The seven-node/depth-3 capture (the honest-measurement fixture: its
// digest is RECOMPUTED independently in the test from the same core
// hash + canonical serializer) and the depth-4 chain (the budget-law
// fixture: depth 4 against maxHierarchyDepth 3 must refuse). Node
// vocabularies are UIA-flavored: automation ids are the UIA
// AutomationId property, control types are the UIA control-type names.

import type { WindowsViewNode } from '../../src/observation';

/** A view node fixture builder (children default to none). */
function node(
  automationId: string,
  controlType: string,
  name = '',
  text = '',
  children: WindowsViewNode[] = [],
): WindowsViewNode {
  return { automationId, controlType, name, text, children };
}

/**
 * Seven nodes, depth 3: MainWindow → (SearchBox, SubmitButton,
 * ResultsList) → (ResultItem1, ResultItem2, ResultItem3). Counted:
 * 1 + 3 + 3 = 7; measured depth 3 (root is depth 1).
 */
export const SEVEN_NODE_TREE: WindowsViewNode = node(
  'MainWindow',
  'Window',
  'Example',
  '',
  [
    node('SearchBox', 'Edit', 'Search', 'type here'),
    node('SubmitButton', 'Button', 'Search', 'Search'),
    node('ResultsList', 'List', 'Results', '', [
      node('ResultItem1', 'ListItem', 'First'),
      node('ResultItem2', 'ListItem', 'Second'),
      node('ResultItem3', 'ListItem', 'Third'),
    ]),
  ],
);

/**
 * A depth-4 chain (root → child → grandchild → great-grandchild) —
 * over any budget of 3; the budget-law fixture.
 */
export const DEPTH_FOUR_TREE: WindowsViewNode = node(
  'MainWindow',
  'Window',
  '',
  '',
  [
    node('ChildPanel', 'Pane', '', '', [
      node('GrandchildPanel', 'Pane', '', '', [
        node('TooDeepText', 'Text', 'too deep'),
      ]),
    ]),
  ],
);
