/**
 * ★ Đợt 9 (2026-10-25, dieu-phoi duyệt) — tick QUYẾT ĐỊNH khi tiến trình CHƯA có nhịp reconcile nào.
 *
 * ĐO ĐƯỢC (tmp/do-broker-vitest.ts, 2026-10-25): trong tiến trình không chạy reconciler (vitest, script, và :3000 vài giây đầu sau boot)
 * `readDecisionTick()` = null ⇒ broker quyết định "mù" (basis ledger-only, usedBytes 0) ⇒ CẤP 22,4 GB cho 35B trong khi nvidia-smi báo
 * 25,8 GB đã dùng (llama-server :8091). Nhãn "no-tick" chỉ cộng biên ~5 GB, không thấy byte của tiến trình khác.
 *
 * Luật: tick null ⇒ đo thiết bị TƯƠI một lần (`readDeviceVramUncached`, hạn 3 s) và dựng tick tạm với `deviceUsedBytes` THẬT (cap sự-thật-
 * thiết-bị của broker áp vào), nền KHÔNG tin (`chua-chup-nen`). Không đo được ⇒ coi như card ĐẦY (fail-closed — broker từ chối với
 * `VramRefusedError` như mọi lượt từ chối khác). CHỈ cho lượt xin LỚN (> 8 GiB — người gọi `vramWiring` lọc): lượt nhỏ giữ `null` như cũ,
 * không tốn lượt đo (đường nóng embed/FIM/fast không đổi một microtask nào).
 */
import type { VramDecisionTick } from "./vramTickCell";
import { readDecisionTick } from "./vramTickCell";

const GiB = 1024 ** 3;
export const NGUONG_LUOT_LON_BYTES = 8 * GiB;

type DocThietBi = () => Promise<{ usedBytes: number; totalBytes: number } | null>;
let docThietBi: DocThietBi = async () => (await import("./vramProbe")).readDeviceVramUncached();

/** Chỉ lưới: thay bộ đo thiết bị (trả lại bộ cũ). */
export function __datDocThietBiChoTest(f: DocThietBi | null): DocThietBi {
  const cu = docThietBi;
  if (f) docThietBi = f;
  return cu;
}

export async function tickChoQuyetDinh(
  estimatedBytes: number,
  tongThietBiBytes: number,
  hanMs = 3000,
): Promise<VramDecisionTick | null> {
  const t = readDecisionTick();
  if (t) return t;
  let hen: ReturnType<typeof setTimeout> | undefined;
  const tuoi = await Promise.race([
    docThietBi().catch(() => null),
    new Promise<null>((r) => {
      hen = setTimeout(() => r(null), hanMs);
    }),
  ]);
  if (hen) clearTimeout(hen);
  const nowMs = Date.now();
  const tam = (deviceUsedBytes: number): VramDecisionTick => ({
    attributableBytes: null,
    deviceUsedBytes,
    baselineVerified: false,
    baselineUnverifiedReasons: ["chua-chup-nen"],
    baselineOrigin: "local",
    atMs: nowMs,
    consecutiveFailures: 0,
  });
  if (tuoi && Number.isFinite(tuoi.usedBytes)) return tam(tuoi.usedBytes);
  if (estimatedBytes > NGUONG_LUOT_LON_BYTES) {
    console.warn(
      `[vram] chưa có nhịp đo và KHÔNG đo tươi được thiết bị ⇒ lượt xin ${(estimatedBytes / GiB).toFixed(1)} GB (> 8 GiB) bị coi như card ĐẦY (fail-closed).`,
    );
    return tam(tongThietBiBytes);
  }
  return null;
}
