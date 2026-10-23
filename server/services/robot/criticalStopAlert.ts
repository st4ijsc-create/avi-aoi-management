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

/** Cửa sổ khử trùng BỀN VỮNG mặc định (24 giờ): cùng (người nhận, khoá cảnh báo) KHÔNG sinh hàng thứ hai trong cửa sổ — ở MỌI môi trường. */
export const CRITICAL_STOP_ALERT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** (người nhận, khoá) ĐANG được ghi trong tiến trình — hai lượt gọi chạy chồng (vd. lượt trước chạm trần 10 s nhưng việc nền chưa xong) không cùng ghi một hàng. */
const dangGhi = new Set<string>();
/** (người nhận, khoá) vừa GHI xong trong tiến trình — đóng khe giữa lần kiểm CSDL (trước khi ghi) và lần ghi của lượt khác chạy chồng. */
const vuaGhi = new Map<string, number>();
const VUA_GHI_TOI_DA = 50_000;

/** Chỉ lưới: quên bộ nhớ trong tiến trình (mô phỏng KHỞI ĐỘNG LẠI) — phần còn lại phải do khử trùng BỀN VỮNG ở CSDL gánh. */
export function __quenBoNhoKhuTrungChoTest(): void {
  dangGhi.clear();
  vuaGhi.clear();
}

function cuaSoKhuTrungMs(): number {
  const n = Number(process.env.STOP_ALERT_DEDUP_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : CRITICAL_STOP_ALERT_DEDUP_WINDOW_MS;
}

/**
 * Trong `ids` người nào ĐÃ có hàng thông báo mang đúng `dedupKey` trong cửa sổ? Một truy vấn (index theo userId + createdAt), không ném:
 * lỗi ⇒ tập rỗng (nghiêng về GỬI — cảnh báo an toàn không được mất vì kiểm trùng hỏng).
 */
async function nguoiDaCoCanhBao(ids: number[], dedupKey: string, windowMs: number): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (!db) return new Set();
    const { notifications } = await import("../../../drizzle/schema");
    const { and, gt, inArray, sql } = await import("drizzle-orm");
    const tu = new Date(Date.now() - windowMs);
    const rows = await db
      .selectDistinct({ userId: notifications.userId })
      .from(notifications)
      .where(and(gt(notifications.createdAt, tu), sql`${notifications.metadata}->>'dedupKey' = ${dedupKey}`, inArray(notifications.userId, ids)));
    return new Set(rows.map((r) => Number(r.userId)));
  } catch (err) {
    console.error(`[StopAlert] kiểm trùng bền vững lỗi (gửi như thường): ${String((err as Error)?.message ?? err).slice(0, 160)}`);
    return new Set();
  }
}

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
  /**
   * ★ P-S1b / 2026-10-23 — KHỬ TRÙNG BỀN VỮNG cho cảnh báo TRẠNG THÁI (không phải theo lần xảy ra): cùng (người nhận, `dedupKey`) đã có hàng trong
   * `windowMs` (mặc định 24 giờ, đổi bằng `STOP_ALERT_DEDUP_WINDOW_MS`) ⇒ KHÔNG ghi hàng thứ hai. Bộ nhớ trong tiến trình (`factoryDriftAlerted`) chỉ chống lặp
   * TRONG MỘT lần chạy; mỗi lần khởi động lại nó rỗng ⇒ cùng một nhà máy-lệch bắn lại cho MỌI quản trị viên (đo: 1,8 triệu hàng `edge_owner_factory_drift`
   * ở CSDL test). Cảnh báo THEO LẦN (`dedupKey` có `Date.now()`) KHÔNG đặt cờ này — luôn ghi. Lỗi kiểm trùng ⇒ gửi như thường.
   */
  khuTrungBenVung?: { windowMs?: number };
}): Promise<void> {
  console.error(`[StopAlert] CRITICAL: ${a.message}`);
  const pending = new Set([...new Set(a.recipients)].filter((u) => Number.isSafeInteger(u) && u > 0));
  const persist = async (attempt: number) => {
    const { sendNotification } = await import("../notificationService");
    if (attempt === 0 && a.khuTrungBenVung) {
      // đã có hàng cùng khoá trong cửa sổ ⇒ coi như ĐÃ gửi (rút khỏi hàng đợi; không thử lại)
      const da = await nguoiDaCoCanhBao([...pending], a.dedupKey, a.khuTrungBenVung.windowMs ?? cuaSoKhuTrungMs());
      for (const u of da) pending.delete(u);
    }
    for (const userId of [...pending]) {
      const khoaGhi = a.khuTrungBenVung && attempt === 0 ? `${userId}|${a.dedupKey}` : null;
      if (khoaGhi) {
        const luc = vuaGhi.get(khoaGhi);
        if (dangGhi.has(khoaGhi) || (luc !== undefined && Date.now() - luc < (a.khuTrungBenVung?.windowMs ?? cuaSoKhuTrungMs()))) {
          pending.delete(userId); // lượt khác đang ghi / vừa ghi đúng hàng này
          continue;
        }
        dangGhi.add(khoaGhi);
      }
      const row = await sendNotification(
        userId,
        { type: "ALERT", priority: "URGENT", title: a.title, message: a.message, entityType: a.entityType ?? "robot", entityId: a.entityId as never, metadata: { kind: a.kind, ...(a.khuTrungBenVung ? { dedupKey: a.dedupKey } : {}) } },
        { safetyCritical: true, capExempt: "stop_undelivered", dedupKey: attempt === 0 ? a.dedupKey : `${a.dedupKey}:retry${attempt}` },
      )
        .catch(() => null)
        .finally(() => {
          if (khoaGhi) dangGhi.delete(khoaGhi);
        });
      if (row) {
        pending.delete(userId);
        if (khoaGhi) {
          if (vuaGhi.size >= VUA_GHI_TOI_DA) vuaGhi.clear();
          vuaGhi.set(khoaGhi, Date.now());
        }
      }
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
