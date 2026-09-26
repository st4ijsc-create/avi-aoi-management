/**
 * Lô 4 Mục 3 (BG-36) — kiểm tra NỐI DÂY THẬT: `aoiPackageRouter.listDeadLetters`/
 * `getDeadLetterDetail` gọi tới `deadLetterReader.ts` (đã có test đơn vị riêng ở
 * `server/services/inspection/deadLetterReader.test.ts`) qua ĐÚNG tầng tRPC
 * (permission gate `admin_system`/`canView` + input schema), không chỉ đọc mã rồi
 * tin. File dead-letter TRỎ VÀO thư mục tạm qua `INSPECTION_STORE_FORWARD_FILE` —
 * KHÔNG đụng `data/inspection-store-forward.dead.jsonl` thật (101 mục, 7,4 MB).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { aoiPackageRouter } from "./aoiPackageRouter";

const TMP_DIR = path.join(os.tmpdir(), `bg36-router-wire-${Date.now()}`);

function walFilePath(): string {
  return path.join(TMP_DIR, "inspection-store-forward.jsonl");
}
function deadLetterFilePath(): string {
  return path.join(TMP_DIR, "inspection-store-forward.dead.jsonl");
}

beforeEach(async () => {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  process.env.INSPECTION_STORE_FORWARD_FILE = walFilePath();
});

afterEach(async () => {
  delete process.env.INSPECTION_STORE_FORWARD_FILE;
  await fsp.rm(TMP_DIR, { recursive: true, force: true }).catch(() => undefined);
});

function dongDeadLetter(key: string, machineCode: string): string {
  return JSON.stringify({
    key,
    deadAt: new Date().toISOString(),
    attempts: 1,
    error: "UNAUTHORIZED: Invalid API key",
    payload: { machineCode, apiKey: "mk_secret_should_not_leak", serialNumber: `SN-${key}`, measurements: [{ imageBase64: "X".repeat(10000) }] },
  });
}

describe("aoiPackageRouter.listDeadLetters — nối dây THẬT qua tRPC", () => {
  it("empty-state trung thực khi file chưa tồn tại (0 mục)", async () => {
    const caller = aoiPackageRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const result = await caller.listDeadLetters({ offset: 0, limit: 20 });
    expect(result.total).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it("★★★ TRUNG TÂM — đọc được mục thật qua tRPC, KHÔNG rò payload/apiKey qua tầng router", async () => {
    await fsp.writeFile(
      deadLetterFilePath(),
      [dongDeadLetter("r1", "M-ROUTER-1"), dongDeadLetter("r2", "M-ROUTER-2")].join("\n") + "\n",
      "utf8",
    );
    const caller = aoiPackageRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const result = await caller.listDeadLetters({ offset: 0, limit: 20 });
    expect(result.total).toBe(2);
    expect(result.entries.map((e) => e.machineCode).sort()).toEqual(["M-ROUTER-1", "M-ROUTER-2"]);
    expect(JSON.stringify(result)).not.toContain("mk_secret_should_not_leak");
    expect(JSON.stringify(result)).not.toContain("imageBase64");
  });
});

describe("aoiPackageRouter.listDeadLetters — cổng quyền THẬT chặn vai không có quyền (không tự thoả bằng admin)", () => {
  it("user role='operator' (không có hàng permissions.admin_system) BỊ TỪ CHỐI — chứng minh cổng THẬT, không phải luôn mở", async () => {
    const caller = aoiPackageRouter.createCaller({ user: { id: 999999, role: "operator" } } as never);
    await expect(caller.listDeadLetters({ offset: 0, limit: 20 })).rejects.toThrow();
  });
});

describe("aoiPackageRouter.getDeadLetterDetail — nối dây THẬT qua tRPC", () => {
  it("không tìm thấy ⇒ null (không ném TRPCError NOT_FOUND)", async () => {
    const caller = aoiPackageRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const result = await caller.getDeadLetterDetail({ key: "khong-ton-tai" });
    expect(result).toBeNull();
  });

  it("★★★ TRUNG TÂM — chi tiết thật qua tRPC, ảnh base64 bị cắt gọn, apiKey bị xoá", async () => {
    await fsp.writeFile(deadLetterFilePath(), dongDeadLetter("d1", "M-DETAIL") + "\n", "utf8");
    const caller = aoiPackageRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const detail = await caller.getDeadLetterDetail({ key: "d1" });
    expect(detail).not.toBeNull();
    expect(detail!.machineCode).toBe("M-DETAIL");
    const asString = JSON.stringify(detail);
    expect(asString).not.toContain("mk_secret_should_not_leak");
    expect(asString).not.toContain("X".repeat(10000));
    expect(asString.length).toBeLessThan(5000);
  });
});
