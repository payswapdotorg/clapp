/**
 * @clapp/codegen — storage bindings (CLAPP-031).
 *
 * A PlannedStorageBinding declares a key the candidate app writes AFTER the
 * transitions listed in `writtenOn`. Since a transition's destination is a
 * route, the codegen interprets "written after transition T" as "written on
 * arrival at T's to-route" and emits:
 *
 * - cookie bindings → a Set-Cookie header (value = the key name, a
 *   documented placeholder: the plan contract carries no captured values)
 *   on every response served for that route path;
 * - localStorage / sessionStorage bindings → a small inline <script>
 *   performing the write (same placeholder value semantics) embedded in
 *   that route's pre-rendered page HTML. Real browsers execute it.
 *
 * HONEST LIMITATION (verbatim, also in the generated README): minidom
 * replay never gates on storage; P4's paired runner owns storage
 * verification. The journey applier does not execute page scripts, so the
 * inline write is invisible to journey replay by design.
 *
 * 'server' storage bindings are documented in the generated README only —
 * the mock backend is deliberately stateless.
 */

import type { PlannedStorageBinding, SynthesisPlan } from './synthesis-contract';

/** Emitted inline script performing a local/session storage write. */
export function storageWriteScript(binding: PlannedStorageBinding): string {
  const target = binding.storage === 'sessionStorage' ? 'sessionStorage' : 'localStorage';
  // JSON.stringify produces a valid double-quoted JS string literal.
  return `<script>try{${target}.setItem(${JSON.stringify(binding.key)},${JSON.stringify(binding.key)})}catch(e){}</script>`;
}

/** The Set-Cookie header value for a cookie binding (placeholder value = key). */
export function storageCookieValue(binding: PlannedStorageBinding): string {
  return `${binding.key}=${binding.key}; Path=/`;
}

export interface ResolvedStorage {
  /** Route path → Set-Cookie values (cookie bindings, declaration order). */
  readonly cookieRoutes: Map<string, string[]>;
  /** Page id → inline script lines (local/session bindings, declaration order). */
  readonly pageScripts: Map<string, string[]>;
  /** How many 'server' bindings were documented-only. */
  readonly serverBindingCount: number;
  /** Human-readable notes for bindings that could not be fully resolved. */
  readonly skipped: string[];
}

/**
 * Resolves every storage binding against the plan's navigation graph and
 * route/page tables. Unresolvable references (transition ids missing from
 * plan.navigation, transitions pointing at unknown routes, to-routes with
 * no page for script bindings) are skipped with an honest note rather than
 * silently dropped or fatally thrown — the caller surfaces `skipped` in the
 * generated README.
 */
export function resolveStorage(plan: SynthesisPlan): ResolvedStorage {
  const transitionsById = new Map(plan.navigation.map((transition) => [transition.id, transition]));
  const routesById = new Map(plan.routes.map((route) => [route.id, route]));
  const pagesByRouteId = new Map(plan.pages.map((page) => [page.routeId, page]));

  const cookieRoutes = new Map<string, string[]>();
  const pageScripts = new Map<string, string[]>();
  const skipped: string[] = [];
  let serverBindingCount = 0;

  for (const binding of plan.storage) {
    if (binding.storage === 'server') {
      serverBindingCount += 1;
      continue;
    }

    // The destination routes of the transitions this binding is written on.
    const routePaths: string[] = [];
    const seenRouteIds = new Set<string>();
    for (const transitionId of binding.writtenOn) {
      const transition = transitionsById.get(transitionId);
      if (transition === undefined) {
        skipped.push(`storage binding ${binding.id} (${binding.key}): writtenOn transition ${transitionId} not found in plan.navigation — write skipped`);
        continue;
      }
      const route = routesById.get(transition.toRouteId);
      if (route === undefined) {
        skipped.push(`storage binding ${binding.id} (${binding.key}): transition ${transitionId} navigates to unknown route ${transition.toRouteId} — write skipped`);
        continue;
      }
      if (!seenRouteIds.has(route.id)) {
        seenRouteIds.add(route.id);
        routePaths.push(route.path);
      }
    }

    if (routePaths.length === 0) {
      continue;
    }

    if (binding.storage === 'cookie') {
      for (const path of routePaths) {
        const existing = cookieRoutes.get(path) ?? [];
        existing.push(storageCookieValue(binding));
        cookieRoutes.set(path, existing);
      }
      continue;
    }

    // localStorage / sessionStorage: embed the write in the destination page.
    for (const path of routePaths) {
      const route = plan.routes.find((candidate) => candidate.path === path);
      const page = route === undefined ? undefined : pagesByRouteId.get(route.id);
      if (page === undefined) {
        skipped.push(`storage binding ${binding.id} (${binding.key}): route ${path} has no rendered page — inline write skipped`);
        continue;
      }
      const existing = pageScripts.get(page.id) ?? [];
      existing.push(storageWriteScript(binding));
      pageScripts.set(page.id, existing);
    }
  }

  return { cookieRoutes, pageScripts, serverBindingCount, skipped };
}
