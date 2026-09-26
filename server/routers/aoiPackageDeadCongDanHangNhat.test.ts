/**
 * Lô 4 Mục 1 (BG-74, server) — 'dead' thành công dân hạng nhất của API.
 *
 * Đo TRƯỚC (task description, không suy đoán):
 *   · `listPackages.input.status` — enum CŨ chỉ 5 giá trị
 *     `["pending","uploading","uploaded","committed","failed"]` (aoiPackageRouter.ts:1926),
 *     THIẾU `'dead'` — một gói `'dead'` KHÔNG lọc được dù `status` cột DB (`packagestatusenum`,
 *     drizzle/schema/inspection.ts:452-465) có đủ 6 giá trị từ migration 0344 (BG-65/Pha 1D Task 5).
 *   · `getUploadStats` (tên thật của "getStats" trong brief — không có procedure tên `getStats`
 *     trong router này, xem `aoiPackageRouter.ts:2368`) — `summary.total = count(*)` (MỌI status)
 *     nhưng `committed+failed+pending` cộng theo CASE WHEN chỉ liệt kê
 *     `committed|failed|pending,uploading,uploaded` — KHÔNG có nhánh `dead` ⇒ khi có gói `'dead'`,
 *     `committed+failed+pending < total` (BẤT BIẾN CỘNG-TỔNG bị vỡ). Test này ghim BẤT BIẾN
 *     (tổng nhóm = tổng gói), KHÔNG ghim con số cụ thể — đúng chỉ dẫn brief.
 *
 * Test DB THẬT (đường thật): dùng lại kỹ thuật fixture của
 * `aoiPackageZipChotChanRetry.test.ts` (§1 TRUNG TÂM) — INSERT gói `status:'uploaded'` rồi gọi
 * `commit()` lặp lại tới đúng `AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS` lần lỗi VĨNH VIỄN (ZIP không
 * tồn tại trên đĩa ⇒ NOT_FOUND, xếp loại VĨNH VIỄN) để đường THẬT tự chuyển gói sang `'dead'` —
 * KHÔNG set thẳng `status:'dead'` bằng tay (đó mới là "đường thật" theo yêu cầu brief).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { eq, and, inArray } from "drizzle-orm";
import { aoiPackageRouter, presignCoreObject } from "./aoiPackageRouter";
import * as db from "../db";
import { inspectionPackages, packageActivityLogs, packageImages } from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `BG74-M1-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG74-M1-${STAMP}`,
    name: "Lo 4 Muc 1 (BG-74) — dead cong dan hang nhat test machine",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && packageDbIds.length > 0) {
    await d.delete(packageImages).where(inArray(packageImages.packageId, packageDbIds));
    await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
    await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg74-m1-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS = "3";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

async function taoGoi(suffix: string, storageKey: string): Promise<{ id: number; packageId: string }> {
  const d = await db.getDb();
  const [pkg] = await d!
    .insert(inspectionPackages)
    .values({
      machineId,
      packageId: `BG74-M1-${STAMP}-${suffix}`,
      storageKey,
      status: "uploaded",
    })
    .returning({ id: inspectionPackages.id, packageId: inspectionPackages.packageId });
  packageDbIds.push(pkg.id);
  return pkg;
}

/** Đẩy một gói qua đúng ngưỡng lỗi VĨNH VIỄN (ZIP không tồn tại trên đĩa) tới 'dead' — đường
 * thật, dùng lại kỹ thuật `aoiPackageZipChotChanRetry.test.ts` §1. */
async function daySangDead(packageId: string): Promise<void> {
  const caller = aoiPackageRouter.createCaller({ user: null } as never);
  for (let lan = 1; lan <= 3; lan++) {
    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();
  }
}

describe("Mục 1.1 — listPackages lọc được status:'dead' (đo TRƯỚC: enum input CŨ thiếu 'dead')", () => {
  it("input schema của listPackages CHẤP NHẬN status:'dead' (không ném ZodError ở tầng input)", () => {
    const inputSchema = (aoiPackageRouter._def.procedures as any).listPackages._def.inputs[0];
    const parsed = inputSchema.safeParse({ page: 1, pageSize: 20, status: "dead" });
    expect(parsed.success, `enum input phải nhận 'dead' — lỗi: ${parsed.success ? "" : JSON.stringify(parsed.error?.issues)}`).toBe(true);
  });

  it("★★★ TRUNG TÂM — một gói THẬT chuyển 'dead' qua đường commit() rồi lọc status:'dead' TRẢ VỀ đúng gói đó", async () => {
    const pkg = await taoGoi("filter", `aoi-packages/${STAMP}-filter-KHONG-TON-TAI.zip`);
    await daySangDead(pkg.packageId);

    const [row] = await (await db.getDb())!.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkg.id));
    expect(row.status, "fixture phải thật sự đưa gói tới 'dead' trước khi test bộ lọc").toBe("dead");

    const caller = aoiPackageRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const result = await caller.listPackages({ page: 1, pageSize: 50, status: "dead" as any, machineId });
    const packageIds = result.data.map((p) => p.packageId);
    expect(packageIds).toContain(pkg.packageId);
    expect(result.data.every((p) => p.status === "dead"), "lọc status:'dead' không được lẫn gói status khác").toBe(true);
  });
});

describe("Mục 1.2 — getUploadStats: bất biến CỘNG-TỔNG (tổng nhóm = tổng gói), có 'dead'", () => {
  it("★★★ TRUNG TÂM — trước bản vá: committed+failed+pending+dead < total khi có gói 'dead' thật; sau bản vá: bằng NHAU", async () => {
    const pkgA = await taoGoi("stat-a", `aoi-packages/${STAMP}-stat-a-KHONG-TON-TAI.zip`);
    await daySangDead(pkgA.packageId);

    const caller = aoiPackageRouter.createCaller({ user: { id: 1, role: "admin" } } as never);
    const stats = await caller.getUploadStats({});

    // Đo trên phạm vi MÁY của fixture này (không lẫn dữ liệu toàn hệ thống khác) — lọc lại
    // bằng cách đếm trực tiếp trên DB cho đúng máy, rồi so với cách getUploadStats cộng.
    const d = (await db.getDb())!;
    const rowsCuaMay = await d.select().from(inspectionPackages).where(eq(inspectionPackages.machineId, machineId));
    const tongThat = rowsCuaMay.length;
    const deadThat = rowsCuaMay.filter((r) => r.status === "dead").length;
    expect(deadThat, "fixture phải tạo được ít nhất 1 gói 'dead' thật").toBeGreaterThan(0);

    // getUploadStats không lọc theo machineId ở test này (dateFrom/dateTo cũng optional) — nên
    // ta không so trực tiếp summary.total với tongThat (có thể lẫn gói từ test khác chạy song
    // song/trước đó). Thay vào đó ghim BẤT BIẾN: bất kỳ lúc nào summary có mặt, tổng các nhóm đã
    // biết CỘNG ĐÚNG BẰNG total — bất biến này phải đúng ngay cả khi tồn tại gói 'dead' (đây là
    // điều brief gọi "cộng không khớp": tổng nhóm cũ KHÔNG kể 'dead').
    const s = stats.summary as any;
    const tongNhom = Number(s.committed) + Number(s.failed) + Number(s.pending) + Number(s.dead ?? NaN);
    expect(s.dead, "getUploadStats phải trả nhóm 'dead' riêng (bản vá Mục 1.2)").not.toBeUndefined();
    expect(tongNhom, `bất biến cộng-tổng vỡ: committed(${s.committed})+failed(${s.failed})+pending(${s.pending})+dead(${s.dead}) phải bằng total(${s.total})`).toBe(Number(s.total));
  });
});
