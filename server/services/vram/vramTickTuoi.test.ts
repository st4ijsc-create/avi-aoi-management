/**
 * ★ Đợt 9 (2026-10-25, dieu-phoi duyệt) — broker khi tiến trình CHƯA có nhịp reconcile (`readDecisionTick()` = null): đo thiết bị TƯƠI
 * một lần cho lượt xin LỚN. Ca bắt buộc (số đo thật 2026-10-25): tiến trình không reconciler + thiết bị đã dùng 25,8 GB ⇒ TỪ CHỐI lượt
 * 22,4 GB (35B). Phủ cả :3000 vài giây đầu sau boot (cùng nhánh tick null).
 * Đột biến phải bắt: bỏ đo tươi trong `vramWiring` (về `readDecisionTick()`) ⇒ §B đỏ; bỏ fail-closed ⇒ §C đỏ; đo cả lượt nhỏ ⇒ §D đỏ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./vramEventLog", () => ({
  logVramEvent: () => {},
  flushVramEvents: async () => 0,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));
// Không preempt được gì (tiến trình mới, sổ rỗng) — giữ lượt từ chối là từ chối.
vi.mock("./vramPreempt", () => ({ preempt: async () => ({ reclaimed: [], steps: [] }) }));

const GiB = 1024 ** 3;
const M35 = 22_360_456_160; // byte tệp Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf

beforeEach(() => {
  vi.resetModules();
  process.env.VRAM_DEVICE_TOTAL_MB = String(32_607);
});

async function chuan(doc: () => Promise<{ usedBytes: number; totalBytes: number } | null>) {
  const tt = await import("./vramTickTuoi");
  const goiDo = vi.fn(doc);
  tt.__datDocThietBiChoTest(goiDo);
  const wiring = await import("./vramWiring");
  const broker = await import("./vramBroker");
  const { VramRefusedError } = await import("./vramRefusal");
  return { tt, wiring, broker, goiDo, VramRefusedError };
}
const xin = (wiring: typeof import("./vramWiring"), bytes: number, owner = "gguf:Qwen3.6-35B-A3B-UD-Q4_K_XL") =>
  wiring.beginVramAllocation({ owner, kind: "gguf-model", priority: "interactive", fileBytes: bytes });

describe("§A — tickChoQuyetDinh", () => {
  it("đã có tick ⇒ trả nguyên, KHÔNG đo", async () => {
    const { tt, goiDo } = await chuan(async () => ({ usedBytes: 1, totalBytes: 2 }));
    const cell = await import("./vramTickCell");
    cell.publishDecisionTick({ attributableBytes: 0, deviceUsedBytes: 5 * GiB, baselineVerified: true, baselineUnverifiedReasons: [], baselineOrigin: "captured" }, Date.now());
    const t = await tt.tickChoQuyetDinh(M35, 32 * GiB);
    expect(t?.deviceUsedBytes).toBe(5 * GiB);
    expect(goiDo).not.toHaveBeenCalled();
  });
  it("đo treo quá hạn ⇒ coi như không đo được ⇒ card ĐẦY", async () => {
    const { tt } = await chuan(() => new Promise(() => {}));
    const t = await tt.tickChoQuyetDinh(M35, 32 * GiB, 30);
    expect(t?.deviceUsedBytes).toBe(32 * GiB);
  });
});

describe("§B — ★ CA BẮT BUỘC: không reconciler + thiết bị đã dùng 25,8 GB ⇒ TỪ CHỐI 22,4 GB", () => {
  it("beginVramAllocation ném VramRefusedError, đã đo tươi đúng một lần", async () => {
    const { wiring, goiDo, VramRefusedError } = await chuan(async () => ({ usedBytes: 25_842_155_520, totalBytes: 34_190_917_632 }));
    const e = await xin(wiring, M35).catch((x) => x);
    expect(e).toBeInstanceOf(VramRefusedError);
    expect(goiDo).toHaveBeenCalled();
  });
  it("đối chứng: thiết bị TRỐNG ⇒ cấp như cũ", async () => {
    const { wiring } = await chuan(async () => ({ usedBytes: 0.5 * GiB, totalBytes: 34_190_917_632 }));
    const t = await xin(wiring, M35);
    expect(t).toBeDefined();
    t.release?.();
  });
});

describe("§C — không đo được ⇒ lượt LỚN fail-closed", () => {
  it("đầu dò null + 22,4 GB ⇒ TỪ CHỐI", async () => {
    const { wiring, VramRefusedError } = await chuan(async () => null);
    const e = await xin(wiring, M35).catch((x) => x);
    expect(e).toBeInstanceOf(VramRefusedError);
  });
});

describe("§D — lượt NHỎ (≤ 8 GiB) giữ hành vi cũ, KHÔNG tốn lượt đo", () => {
  it("2,5 GB + đầu dò null ⇒ cấp, không gọi đầu dò", async () => {
    const { wiring, goiDo } = await chuan(async () => null);
    const t = await xin(wiring, 2.5 * GiB, "gguf:Qwen3-4B");
    expect(t).toBeDefined();
    expect(goiDo).not.toHaveBeenCalled();
    t.release?.();
  });
});
