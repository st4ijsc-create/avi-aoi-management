/**
 * Daily reconciliation cron — SYNAPSE §5.9.2 (doc 33 integration wave / I6).
 *
 * Wires the F7 reconciliation ENGINE into a schedulable cycle. Data sources (MES/ERP/WMS) are
 * PLUGGABLE providers — register one per external system; the cron runs them all daily and
 * collects out-of-tolerance discrepancies as investigation tickets (never silent self-heal).
 * Honest until providers are wired: with none registered, a cycle reports "no providers".
 *
 * Flag RECONCILE_CRON (default OFF → the scheduled job is not started; the cycle can still be
 * invoked on demand). The cron framework is real; the providers are the later, per-integration step.
 */
import { reconcile, type ReconcileInput, type ReconciliationReport } from "./reconciliation";

/** A reconciliation source: pulls (internal, external) metric maps for one external system. */
export interface ReconcileProvider {
  id: string;
  /** e.g. "MES production vs SYNAPSE". */
  description: string;
  /** Fetch the two metric maps to compare (+ optional tolerances). */
  pull(): Promise<ReconcileInput>;
}

const providers = new Map<string, ReconcileProvider>();

/** Register (or replace) a reconciliation provider. Register-and-go. */
export function registerReconcileProvider(p: ReconcileProvider): void {
  providers.set(p.id, p);
}

export function listReconcileProviders(): { id: string; description: string }[] {
  return [...providers.values()].map((p) => ({ id: p.id, description: p.description }));
}

export function _clearReconcileProviders(): void {
  providers.clear();
}

export interface CycleResult {
  providers: number;
  reports: { id: string; description: string; report: ReconciliationReport | null; error?: string }[];
  /** Total investigation tickets across all providers. */
  tickets: number;
  ok: boolean;
}

/**
 * Run one reconciliation cycle across all registered providers. Pure orchestration over the
 * engine; a provider that throws is isolated (recorded as an error, does not abort the cycle).
 */
export async function runReconciliationCycle(): Promise<CycleResult> {
  const reports: CycleResult["reports"] = [];
  let tickets = 0;
  for (const p of providers.values()) {
    try {
      const input = await p.pull();
      const report = reconcile(input);
      tickets += report.tickets.length;
      reports.push({ id: p.id, description: p.description, report });
    } catch (err) {
      reports.push({ id: p.id, description: p.description, report: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { providers: providers.size, reports, tickets, ok: tickets === 0 && reports.every((r) => !r.error) };
}

/** Is the scheduled reconciliation cron enabled? Default OFF. */
export function reconcileCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RECONCILE_CRON === "true" || env.RECONCILE_CRON === "1";
}
