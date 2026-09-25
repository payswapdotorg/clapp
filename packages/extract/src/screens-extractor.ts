/**
 * @clapp/extract — screens & components extractor.
 *
 * dom-tree payloads are grouped by the CURRENT DOCUMENT ROUTE (the route
 * of the most recent document request at the capture's position — see
 * route-timeline.ts):
 *
 *   - first capture for a route MINTS the IrScreen (first capture wins:
 *     treeRef is that capture's dom evidence ref; later captures for the
 *     same route only APPEND components not already present, deduped by
 *     the role+name+attrs signature);
 *   - components are the actionable elements of the serialized tree —
 *     nodes whose role is in the local COMPONENT_ROLES vocabulary
 *     (a/button/input/form/select/textarea mapping, consistent with the
 *     @clapp/observe ROLE_TABLE; see component-semantics.ts);
 *   - screenshot captures attach to the current route's screen as
 *     visualRef (first wins; a screenshot recorded before the route's
 *     first dom capture is held pending and attaches when the screen is
 *     minted; a screenshot that can never be attributed produces a
 *     warning, never a fabricated screen);
 *   - a dom-tree capture with no preceding document request cannot be
 *     attributed to ANY route honestly — warning + skipped (no screen);
 *   - truncated DOM captures degrade to an assumption (component
 *     inventory may be incomplete), never to silent truncation.
 *
 * Provenance: screens and components are 'derived' (deterministic
 * transformations of recorded evidence) and cite the dom refs that
 * produced them.
 */

import type { EvidenceRef } from '@clapp/core';
import type { IrComponent, IrScreen, Provenance } from './ir-contract';
import type { AssumptionCollector } from './assumptions';
import { componentSignature, componentName, eventsForRole, isComponentRole } from './component-semantics';
import type { ConsumedCapture } from './capture-reader';
import { newComponentId, newScreenId } from './ids';
import type { RouteTimeline } from './route-timeline';
import type { SerializedNode } from '@clapp/observe';

export interface ScreenRecord {
  screen: IrScreen;
  route: string;
  /** every dom evidence ref that contributed to this screen, in order. */
  domRefs: EvidenceRef[];
  /** dedupe signatures of components already emitted for this screen. */
  componentSignatures: Set<string>;
}

export interface ScreensExtraction {
  screens: IrScreen[];
  components: IrComponent[];
  /** screen records keyed by normalized route (screen lookup for transitions). */
  recordsByRoute: Map<string, ScreenRecord>;
  warnings: string[];
}

interface PendingScreenshot {
  route: string;
  ref: EvidenceRef;
}

export function extractScreens(
  captures: readonly ConsumedCapture[],
  timeline: RouteTimeline,
  collector: AssumptionCollector,
): ScreensExtraction {
  const warnings: string[] = [];
  const recordsByRoute = new Map<string, ScreenRecord>();
  const components: IrComponent[] = [];
  const pendingScreenshots: PendingScreenshot[] = [];

  const upsertRef = (refs: EvidenceRef[], ref: EvidenceRef): void => {
    if (!refs.some((existing) => existing.evidenceId === ref.evidenceId)) {
      refs.push({ ...ref });
    }
  };

  for (const capture of captures) {
    if (capture.kind === 'dom') {
      const routeEvent = timeline.routeAt(capture.index);
      if (routeEvent === null) {
        warnings.push(`dom-tree evidence ${capture.ref.evidenceId} has no preceding document request — route unknown, no screen emitted`);
        continue;
      }
      if (capture.payload.truncated) {
        collector.note(`DOM capture for route ${routeEvent.route} was truncated at ${capture.payload.nodeCount} nodes — the component inventory for this screen may be incomplete`, {
          confidence: 0.4,
          evidenceRefs: [capture.ref],
        });
      }
      const record = recordsByRoute.get(routeEvent.route);
      if (record === undefined) {
        const screen: IrScreen = {
          id: newScreenId(),
          route: routeEvent.route,
          provenance: {
            level: 'derived',
            confidence: {
              value: 0.9,
              rationale: 'route and DOM structure derived deterministically from recorded document requests and DOM captures',
              evidenceRefs: [{ ...capture.ref }],
            },
          },
          treeRef: { ...capture.ref },
        };
        const newRecord: ScreenRecord = {
          screen,
          route: routeEvent.route,
          domRefs: [{ ...capture.ref }],
          componentSignatures: new Set<string>(),
        };
        recordsByRoute.set(routeEvent.route, newRecord);
        attachPendingScreenshot(newRecord, pendingScreenshots);
        collectComponents(capture.payload.root, newRecord, components, capture.ref);
      } else {
        upsertRef(record.domRefs, capture.ref);
        upsertRef(record.screen.provenance.confidence.evidenceRefs, capture.ref);
        collectComponents(capture.payload.root, record, components, capture.ref);
      }
      continue;
    }

    if (capture.kind === 'screenshot') {
      const routeEvent = timeline.routeAt(capture.index);
      if (routeEvent === null) {
        warnings.push(`screenshot evidence ${capture.ref.evidenceId} has no preceding document request — not attributable to any screen`);
        continue;
      }
      const record = recordsByRoute.get(routeEvent.route);
      if (record === undefined) {
        const alreadyPending = pendingScreenshots.some((pending) => pending.route === routeEvent.route);
        if (!alreadyPending) {
          pendingScreenshots.push({ route: routeEvent.route, ref: { ...capture.ref } });
        }
        continue;
      }
      attachScreenshot(record, capture.ref);
      continue;
    }
  }

  for (const pending of pendingScreenshots) {
    warnings.push(`screenshot evidence ${pending.ref.evidenceId} for route ${pending.route} could not be attributed to a screen (no dom capture for that route) — left uncited`);
  }

  return {
    screens: [...recordsByRoute.values()].map((record) => cloneScreen(record.screen)),
    components: components.map(cloneComponent),
    recordsByRoute,
    warnings,
  };
}

/** Attaches the first pending screenshot for a record's route, if any. */
function attachPendingScreenshot(record: ScreenRecord, pendingScreenshots: PendingScreenshot[]): void {
  const position = pendingScreenshots.findIndex((pending) => pending.route === record.route);
  if (position === -1) return;
  const [matched] = pendingScreenshots.splice(position, 1);
  if (matched !== undefined) {
    attachScreenshot(record, matched.ref);
  }
}

function attachScreenshot(record: ScreenRecord, ref: EvidenceRef): void {
  if (record.screen.visualRef !== undefined) return; // first wins
  record.screen.visualRef = { ...ref };
  if (!record.screen.provenance.confidence.evidenceRefs.some((existing) => existing.evidenceId === ref.evidenceId)) {
    record.screen.provenance.confidence.evidenceRefs.push({ ...ref });
  }
}

function collectComponents(
  root: SerializedNode,
  record: ScreenRecord,
  components: IrComponent[],
  domRef: EvidenceRef,
): void {
  const visit = (node: SerializedNode): void => {
    if (isComponentRole(node.role)) {
      const name = componentName(node);
      const signature = componentSignature(node.role, name, node.attrs);
      if (!record.componentSignatures.has(signature)) {
        record.componentSignatures.add(signature);
        const properties: Record<string, unknown> = { tag: node.tag, name };
        if (node.text !== undefined && node.text !== '') {
          properties['text'] = node.text;
        }
        if (node.attrs !== undefined && Object.keys(node.attrs).length > 0) {
          properties['attrs'] = { ...node.attrs };
        }
        components.push({
          id: newComponentId(),
          role: node.role,
          screenId: record.screen.id,
          properties,
          events: eventsForRole(node.role),
          provenance: {
            level: 'derived',
            confidence: {
              value: 0.8,
              rationale: 'role, tag, attributes, and name derived deterministically from a serialized DOM capture',
              evidenceRefs: [{ ...domRef }],
            },
          },
        });
      }
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
}

function cloneScreen(screen: IrScreen): IrScreen {
  return {
    id: screen.id,
    route: screen.route,
    provenance: cloneProvenance(screen.provenance),
    ...(screen.treeRef !== undefined ? { treeRef: { ...screen.treeRef } } : {}),
    ...(screen.visualRef !== undefined ? { visualRef: { ...screen.visualRef } } : {}),
  };
}

function cloneComponent(component: IrComponent): IrComponent {
  return {
    id: component.id,
    role: component.role,
    screenId: component.screenId,
    properties: JSON.parse(JSON.stringify(component.properties)) as Record<string, unknown>,
    events: [...component.events],
    provenance: cloneProvenance(component.provenance),
  };
}

export function cloneProvenance(provenance: Provenance): Provenance {
  return {
    level: provenance.level,
    confidence: {
      value: provenance.confidence.value,
      rationale: provenance.confidence.rationale,
      evidenceRefs: provenance.confidence.evidenceRefs.map((ref) => ({ ...ref })),
    },
  };
}
