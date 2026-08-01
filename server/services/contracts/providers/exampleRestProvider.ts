/**
 * Example REST reconciliation provider — SYNAPSE §5.9.2 (doc 33 §11 · I6 completion).
 *
 * A reference {@link ReconcileProvider} that pulls the external metric map from a REST endpoint (the
 * external "system of record"). A REAL MES/ERP/WMS provider implements the SAME interface against its
 * own API + auth; this one proves the seam end-to-end and is registered from env so a demo/staging
 * endpoint can be reconciled without touching code. Honest: unless RECONCILE_EXAMPLE_URL is set,
 * nothing is registered (the cycle then reports "no providers").
 */
import type { ReconcileProvider } from "../reconciliationCron";
import type { ReconcileInput } from "../reconciliation";

export interface RestProviderConfig {
  id: string;
  description: string;
  /** GET → JSON { internal?: Record<string,number>, external: Record<string,number>, toleranceAbs?, toleranceRel? }. */
  url: string;
  toleranceAbs?: number;
  toleranceRel?: number;
  /** Optional request headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Injectable fetch (tests pass a mock); defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Build a REST-backed reconciliation provider. Pure factory. */
export function makeRestReconcileProvider(cfg: RestProviderConfig): ReconcileProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    id: cfg.id,
    description: cfg.description,
    async pull(): Promise<ReconcileInput> {
      const res = await doFetch(cfg.url, { headers: cfg.headers });
      if (!res.ok) throw new Error(`reconcile provider ${cfg.id}: HTTP ${res.status}`);
      const body: any = await res.json();
      return {
        internal: (body?.internal ?? {}) as Record<string, number>,
        external: (body?.external ?? {}) as Record<string, number>,
        toleranceAbs: body?.toleranceAbs ?? cfg.toleranceAbs,
        toleranceRel: body?.toleranceRel ?? cfg.toleranceRel,
      };
    },
  };
}

/**
 * Register example provider(s) from env (called at cron startup). Honest no-op when unset.
 * Returns the number registered.
 */
export function registerExampleReconcileProviders(
  register: (p: ReconcileProvider) => void,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const url = env.RECONCILE_EXAMPLE_URL;
  if (!url) return 0;
  register(
    makeRestReconcileProvider({
      id: "example-rest",
      description: "Example REST reconciliation (external system of record)",
      url,
      toleranceRel: env.RECONCILE_EXAMPLE_TOL_REL ? Number(env.RECONCILE_EXAMPLE_TOL_REL) : undefined,
      headers: env.RECONCILE_EXAMPLE_AUTH ? { Authorization: env.RECONCILE_EXAMPLE_AUTH } : undefined,
    }),
  );
  return 1;
}
