/**
 * @clapp/extract — assumption collector.
 *
 * Doc §7 / the work-item contract: every degradation chosen during
 * extraction (truncated preview, unknown subkind, unparsable schema, ...)
 * becomes an IrAssumption with confidence <= 0.5 and a precise statement,
 * so the model never silently upgrades guesswork into fact. Assumptions are
 * 'assumed' level — the only level where empty evidenceRefs are legal — but
 * when the degraded capture is available we still cite it, because citing
 * what WAS observed is strictly more honest than citing nothing.
 *
 * Duplicate statements collapse to one entry (first occurrence wins), which
 * keeps repeated degradations honest without spamming the model.
 */

import type { EvidenceRef } from '@clapp/core';
import type { IrAssumption } from './ir-contract';
import { newAssumptionId } from './ids';

/** Hard ceiling the work item places on assumption confidence. */
export const ASSUMPTION_CONFIDENCE_CEILING = 0.5;

export interface NoteOptions {
  /** confidence value (clamped to [0, ASSUMPTION_CONFIDENCE_CEILING]); default 0.3 */
  confidence?: number;
  /** evidence backing the degradation statement when available */
  evidenceRefs?: EvidenceRef[];
}

export class AssumptionCollector {
  private readonly byStatement = new Map<string, IrAssumption>();

  /** Record one degradation. Idempotent per distinct statement. */
  note(statement: string, options: NoteOptions = {}): void {
    if (typeof statement !== 'string' || statement === '') {
      // The collector itself never throws: an empty statement would be a
      // programming bug, so we keep the model honest by ignoring it rather
      // than emitting an unfindable assumption.
      return;
    }
    if (this.byStatement.has(statement)) return;
    const requested = options.confidence ?? 0.3;
    const value = Math.min(Math.max(requested, 0), ASSUMPTION_CONFIDENCE_CEILING);
    this.byStatement.set(statement, {
      id: newAssumptionId(),
      statement,
      provenance: {
        level: 'assumed',
        confidence: {
          value,
          rationale: 'degradation recorded as an assumption so the model never silently upgrades guesswork',
          evidenceRefs: options.evidenceRefs ? options.evidenceRefs.map((ref) => ({ ...ref })) : [],
        },
      },
    });
  }

  /** Every recorded assumption, first-occurrence order (detached copies). */
  list(): IrAssumption[] {
    return [...this.byStatement.values()].map((assumption) => cloneAssumption(assumption));
  }

  get size(): number {
    return this.byStatement.size;
  }
}

function cloneAssumption(assumption: IrAssumption): IrAssumption {
  return {
    id: assumption.id,
    statement: assumption.statement,
    provenance: {
      level: assumption.provenance.level,
      confidence: {
        value: assumption.provenance.confidence.value,
        rationale: assumption.provenance.confidence.rationale,
        evidenceRefs: assumption.provenance.confidence.evidenceRefs.map((ref) => ({ ...ref })),
      },
    },
  };
}
