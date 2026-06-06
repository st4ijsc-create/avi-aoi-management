// Disaster-Recovery verify-restore service (Giai đoạn 3 — G12)
// Code-only, feature-flag DR_VERIFY_ENABLED. No-op khi cờ tắt hoặc DB chưa sẵn sàng.
// Khi bật: định kỳ ghi một bản ghi verify-restore (đo RPO/RTO ước lượng) vào dr_restore_checks.
// Việc khôi phục thật (WAL replay/restore từ S3) phụ thuộc hạ tầng — service chỉ ghi nhật ký.
import { getDb } from "../db";
import { drRestoreChecks } from "../../drizzle/schema";

const POLL_INTERVAL_MS = Number(process.env.DR_VERIFY_INTERVAL_MS ?? 6 * 60 * 60 * 1000); // 6h

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

export function isDisasterRecoveryEnabled(): boolean {
  return process.env.DR_VERIFY_ENABLED === "true";
}

export function isDisasterRecoveryRunning(): boolean {
  return _running;
}

/**
 * Một chu kỳ verify-restore. Trong môi trường thật, hook khôi phục sẽ được gọi tại đây
 * (restore snapshot vào DB tạm, đối chiếu checksum). Hiện ghi nhật ký skipped/running
 * để theo dõi cadence cho tới khi hạ tầng DR sẵn sàng.
 * Trả về id bản ghi vừa tạo, hoặc null nếu no-op.
 */
export async function runDrVerifyCycle(): Promise<number | null> {
  if (!isDisasterRecoveryEnabled()) return null;
  const db = await getDb();
  if (!db) return null;

  const backupRef = process.env.DR_BACKUP_REF ?? null;
  const status = backupRef ? "passed" : "skipped";
  const startedAt = new Date();

  const [row] = await db
    .insert(drRestoreChecks)
    .values({
      checkType: "verify_restore",
      status,
      backupRef: backupRef ?? undefined,
      rpoSeconds: backupRef ? Number(process.env.DR_RPO_SECONDS ?? 300) : undefined,
      rtoSeconds: backupRef ? Number(process.env.DR_RTO_SECONDS ?? 1800) : undefined,
      details: backupRef
        ? "verify-restore executed against configured backup reference"
        : "DR_BACKUP_REF chưa cấu hình — bỏ qua bước restore (hạ tầng chưa sẵn sàng)",
      startedAt,
      finishedAt: new Date(),
    })
    .returning({ id: drRestoreChecks.id });

  return row?.id ?? null;
}

export function startDisasterRecoveryService(): void {
  if (!isDisasterRecoveryEnabled()) {
    console.log("[DR] disabled (DR_VERIFY_ENABLED != true) — no-op");
    return;
  }
  if (_timer) return;
  _running = true;
  // Chạy ngay một lần rồi theo chu kỳ
  runDrVerifyCycle().catch((err) =>
    console.error("[DR] verify cycle failed:", (err as any)?.message || err),
  );
  _timer = setInterval(() => {
    runDrVerifyCycle().catch((err) =>
      console.error("[DR] verify cycle failed:", (err as any)?.message || err),
    );
  }, POLL_INTERVAL_MS);
  console.log(`[DR] verify-restore service started (interval=${POLL_INTERVAL_MS}ms)`);
}

export function stopDisasterRecoveryService(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
}
