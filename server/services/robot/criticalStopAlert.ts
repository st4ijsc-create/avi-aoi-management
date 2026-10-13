/**
 * doc 81 Đợt 10 task D fix review 1 (M-4) — THE durable critical alert of a STOP that could not be delivered / confirmed:
 *   • the unified alert stream (publishAnomalyDetected, severity critical — toasts even while snoozed);
 *   • a persisted URGENT safety-critical inbox row (sendNotification, safetyCritical: delivered past opt-out / quiet hours, deduped
 *     per occurrence) to every recipient — the row survives a missed toast;
 *   • a log line (no secrets).
 * Fire-and-forget, bounded; never throws, never writes to a device. Central only (on the edge the device stage reports through
 * the journal sink instead — R-10-x).
 */
import { withDeadline } from "../ot/drivers/boundedClose";

export const CRITICAL_STOP_ALERT_DEADLINE_MS = 10_000;

export function raiseCriticalStopAlert(a: {
  kind: string;
  title: string;
  message: string;
  recipients: ReadonlyArray<number>;
  dedupKey: string;
  source?: "robot" | "ot";
  entityType?: string;
  entityId?: number | string;
  /**
   * doc 81 Đợt 10 task D fix review 4 (R-10-av) — keep trying to PERSIST the inbox row (the DB may be down right when the alert is
   * raised — exactly when a no-session STOP could not be sent): every `everyMs`, up to `attempts` more times, only for the
   * recipients whose row did not land (each retry its own dedup key, so a retry is never swallowed as a duplicate).
   */
  retryUntilPersisted?: { everyMs?: number; attempts?: number };
}): Promise<void> {
  console.error(`[StopAlert] CRITICAL: ${a.message}`);
  const pending = new Set([...new Set(a.recipients)].filter((u) => Number.isSafeInteger(u) && u > 0));
  const persist = async (attempt: number) => {
    const { sendNotification } = await import("../notificationService");
    for (const userId of [...pending]) {
      const row = await sendNotification(
        userId,
        { type: "ALERT", priority: "URGENT", title: a.title, message: a.message, entityType: a.entityType ?? "robot", entityId: a.entityId as never, metadata: { kind: a.kind } },
        { safetyCritical: true, capExempt: "stop_undelivered", dedupKey: attempt === 0 ? a.dedupKey : `${a.dedupKey}:retry${attempt}` },
      ).catch(() => null);
      if (row) pending.delete(userId);
    }
  };
  const work = (async () => {
    const { publishAnomalyDetected } = await import("../ecosystem/ecosystemEvents");
    publishAnomalyDetected({ kind: a.kind, severity: "critical", source: a.source ?? "robot", machineId: null, message: a.message }, a.source ?? "robot");
    await persist(0);
  })();
  const retry = (attempt: number) => {
    const max = a.retryUntilPersisted?.attempts ?? 0;
    if (!a.retryUntilPersisted || pending.size === 0 || attempt > max) {
      if (a.retryUntilPersisted && pending.size > 0) console.error(`[StopAlert] ${a.kind}: the inbox row could not be persisted after ${max} retries (recipients ${[...pending].join(", ")}) — the log line and the alert stream carried it`);
      return;
    }
    const t = setTimeout(() => {
      void withDeadline(persist(attempt), CRITICAL_STOP_ALERT_DEADLINE_MS, `${a.kind} alert retry ${attempt}`)
        .catch(() => undefined)
        .finally(() => retry(attempt + 1));
    }, a.retryUntilPersisted.everyMs ?? 30_000);
    if (typeof t.unref === "function") t.unref();
  };
  return withDeadline(work, CRITICAL_STOP_ALERT_DEADLINE_MS, `${a.kind} alert`)
    .catch((err) => {
      console.error(`[StopAlert] ${a.kind} alert failed or is stuck: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    })
    .finally(() => retry(1));
}
