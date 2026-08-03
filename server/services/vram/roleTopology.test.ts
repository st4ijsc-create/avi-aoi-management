import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cắt đúng THÂN của một hàm top-level `export (async )?function <name>(...)` bằng
 * đếm ngoặc — không phải regex tham lam trên toàn file (sẽ dính luôn thân các hàm
 * khác nằm sau). Trả về "" nếu không tìm thấy hàm.
 */
function extractFunctionBody(src: string, fnName: string): string {
  const m = src.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${fnName}\\s*\\([^)]*\\)[^{]*\\{`));
  if (!m || m.index === undefined) return "";
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return src.slice(start, i - 1);
}

/**
 * Pha 1.5 Task 4 — ROLE=api: nhật ký BẬT ở mọi vai trò, đối chiếu CHỈ ở vai trò
 * chạy scheduler. `describeTopologyHint()` là phần "cảnh báo phải nêu đúng khả
 * năng" — khi hệ tách vai trò api/worker, một khoản lệch DƯƠNG có thể là của
 * tiến trình ANH EM (sổ riêng từng tiến trình, không có sổ chung ở Pha 1.5),
 * không phải kẻ lạ. Xem `.superpowers/sdd/2026-08-03-vram-pha1-5-go-chan/task-4-brief.md`.
 */
describe("ROLE=api — nhật ký BẬT, đối chiếu TẮT", () => {
  const originalRole = process.env.ROLE;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalRole === undefined) delete process.env.ROLE;
    else process.env.ROLE = originalRole;
  });

  it("★ cảnh báo lệch phải NÊU khả năng tiến trình anh em khi hệ tách vai trò (ROLE=worker)", async () => {
    process.env.ROLE = "worker";
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toMatch(/tiến trình anh em|api/i);
  });

  it("★ cảnh báo lệch phải NÊU khả năng tiến trình anh em khi hệ tách vai trò (ROLE=api)", async () => {
    process.env.ROLE = "api";
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toMatch(/tiến trình anh em|api/i);
  });

  it("vai trò all-in-one (ROLE không đặt) thì KHÔNG nêu tiến trình anh em", async () => {
    delete process.env.ROLE;
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toBe("");
  });

  it("vai trò LẠ (không phải api/worker) thì KHÔNG nêu tiến trình anh em", async () => {
    process.env.ROLE = "something-else";
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toBe("");
  });

  const MIB = 1024 * 1024;

  // ⚠ Ba test dưới đây kiểm CHỖ NỐI thật (Step 4 của brief), không chỉ hàm độc lập —
  // mock lại reconcileOnce() giống vramReconciler.test.ts để bắt trường hợp ai đó thêm
  // đúng hàm `describeTopologyHint()` nhưng QUÊN nối nó vào câu cảnh báo, hoặc nối
  // nhầm sang nhánh âm.
  it("cảnh báo LỆCH DƯƠNG khi ROLE=worker phải CHỨA gợi ý tiến trình anh em", async () => {
    process.env.ROLE = "worker";
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/tiến trình anh em/i);
    warnSpy.mockRestore();
  });

  it("cảnh báo LỆCH DƯƠNG khi ROLE không đặt (all-in-one) KHÔNG được chứa gợi ý tiến trình anh em", async () => {
    delete process.env.ROLE;
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).not.toMatch(/tiến trình anh em/i);
    warnSpy.mockRestore();
  });

  it("cảnh báo LỆCH ÂM khi ROLE=worker KHÔNG được nối gợi ý (âm là giấy phép treo CỦA CHÍNH tiến trình này)", async () => {
    process.env.ROLE = "worker";
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 11_000 * MIB, totalBytes: 32_607 * MIB, source: "native" }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reconcileOnce } = await import("./vramReconciler");
    await reconcileOnce();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).not.toMatch(/tiến trình anh em/i);
    warnSpy.mockRestore();
  });
});

/**
 * Pha 1.5 Task 4, review vòng 1 (Critical) — HỒI QUY: lượt bật nhật ký bị chuyển
 * lên `index.ts`, nhưng `index.ts` KHÔNG PHẢI đường vào của vai trò `worker`.
 * Hai đường vào worker THẬT SỰ đều đi qua `runWorkerProcess()` trong
 * `backgroundJobs.ts`, KHÔNG BAO GIỜ chạm dòng bật ở `index.ts`:
 *   1. `server/worker.ts` (`npm run start:worker` / `dev:worker`) import THẲNG
 *      `runWorkerProcess` — không import `index.ts`.
 *   2. `ROLE=worker` qua `index.ts` — `startServer()` early-return ở đầu hàm
 *      (TRƯỚC lượt bật đặt gần `SERVER_ROLE === "api"`, vốn nằm rất xa phía sau).
 *
 * Test này quét MÃ NGUỒN thật (không import module — tránh phải giả lập toàn bộ
 * observability/DB-check/email/leader-election mà `runWorkerProcess()` gọi, và
 * tránh interval KHÔNG unref'd ở cuối hàm làm treo tiến trình test) để khẳng định
 * lượt bật nằm ĐÚNG bên trong thân hàm `runWorkerProcess`, không phải chỉ tồn tại
 * đâu đó trong file. Đây là "cách rẻ" — cùng kiểu quét đã dùng ở
 * `server/worker.smoke.test.ts` ("binds no HTTP").
 */
describe("worker — runWorkerProcess() PHẢI tự bật nhật ký (không dựa vào index.ts)", () => {
  const backgroundJobsSrc = fs.readFileSync(
    path.join(HERE, "..", "..", "_core", "backgroundJobs.ts"),
    "utf-8",
  );

  it("thân hàm runWorkerProcess() gọi __setVramLogTimerEnabled(true)", () => {
    const body = extractFunctionBody(backgroundJobsSrc, "runWorkerProcess");
    expect(body, "không tìm thấy hàm runWorkerProcess trong backgroundJobs.ts").not.toBe("");
    expect(body).toMatch(/__setVramLogTimerEnabled\(\s*true\s*\)/);
  });
});
