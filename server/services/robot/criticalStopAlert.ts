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
}): Promise<void> {
  console.error(`[StopAlert] CRITICAL: ${a.message}`);
  const work = (async () => {
    const { publishAnomalyDetected } = await import("../ecosystem/ecosystemEvents");
    publishAnomalyDetected({ kind: a.kind, severity: "critical", source: a.source ?? "robot", machineId: null, message: a.message }, a.source ?? "robot");
    const { sendNotification } = await import("../notificationService");
    for (const userId of [...new Set(a.recipients)].filter((u) => Number.isSafeInteger(u) && u > 0)) {
      await sendNotification(
        userId,
        { type: "ALERT", priority: "URGENT", title: a.title, message: a.message, entityType: a.entityType ?? "robot", entityId: a.entityId as never, metadata: { kind: a.kind } },
        { safetyCritical: true, capExempt: "ot_stop_unverified", dedupKey: a.dedupKey },
      );
    }
  })();
  return withDeadline(work, CRITICAL_STOP_ALERT_DEADLINE_MS, `${a.kind} alert`).catch((err) => {
    console.error(`[StopAlert] ${a.kind} alert failed or is stuck: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  });
}
