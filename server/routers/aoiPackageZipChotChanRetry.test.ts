/**
 * Pha 1D Task 5 (BG-52 ⛔) — chốt chặn retry vô hạn ở cửa ZIP (`aoiPackage.commit`).
 *
 * Trước bản vá: `commit` bắt lỗi, đặt `status='failed'`, rồi ném — nhưng nhánh
 * idempotent chỉ ngắn mạch `status==='committed'`. KHÔNG có gì chặn Agent gọi
 * lại `commit` trên một gói `failed` VĨNH VIỄN (Postgres 22xxx/23xxx, hoặc
 * TRPCError NOT_FOUND/FORBIDDEN/BAD_REQUEST/…) vô hạn lần.
 *
 * Sau bản vá: mỗi lỗi VĨNH VIỄN (`isPermanentSubmitError`, dùng lại từ
 * `inspectionStoreForward.ts`) được đếm qua `package_activity_logs` (không thêm
 * cột mới); đủ `AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS` lần liên tiếp ⇒ gói chuyển
 * `'dead'` (migration 0344) — `commit` từ chối NGAY ở đầu handler cho các lượt
 * gọi SAU, không tải lại ZIP/không đụng DB thêm.
 *
 * Hai kịch bản THẬT, trên DB thật (avi_app), KHÔNG suy đoán từ đọc mã:
 *   §1 — lỗi VĨNH VIỄN (ZIP không tồn tại trên đĩa ⇒ TRPCError NOT_FOUND) lặp
 *        lại N lần ⇒ đúng lượt thứ N chuyển 'dead'; lượt N+1 bị từ chối NGAY,
 *        KHÔNG ghi thêm entry `commit_fail` nào (chứng minh short-circuit thật,
 *        không chỉ đọc code rồi tin).
 *   §2 — lỗi TẠM THỜI (ZIP tồn tại nhưng nội dung KHÔNG PHẢI zip hợp lệ ⇒ lỗi
 *        JSZip chung, không khớp TRPCError/SQLSTATE) lặp lại NHIỀU HƠN ngưỡng
 *        ⇒ gói VẪN 'failed' (KHÔNG BAO GIỜ 'dead') — mệnh đề 4, chống siết quá.
 *
 * ⚠ Giới hạn ĐÃ BIẾT (ghi trong report, không giấu): JSZip parse lỗi trên một
 * file rác thực ra là lỗi VĨNH VIỄN về mặt nghiệp vụ (thử lại CÙNG byte không
 * bao giờ thành công) — nhưng `isPermanentSubmitError` (tái dùng nguyên văn,
 * không viết bản thứ hai) không nhận diện được lỗi JSZip vì nó không phải
 * TRPCError/SQLSTATE. §2 dùng chính kịch bản này làm PROXY cho "lỗi bị xếp
 * TẠM THỜI" — đúng hành vi thật của hệ thống hôm nay, không phải hành vi lý
 * tưởng.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { eq, and, inArray } from "drizzle-orm";
import { aoiPackageRouter, demSoLoiVinhVienTuLichSu } from "./aoiPackageRouter";
import * as db from "../db";
import { inspectionPackages, packageActivityLogs } from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `BG52-PKG-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `BG52-PKG-${STAMP}`,
    name: "Pha 1D Task 5 (BG-52) retry-cap test machine",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && packageDbIds.length > 0) {
    await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
    await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg52-pkg-retry-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS = "3";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

async function taoGoi(suffix: string, storageKey: string): Promise<number> {
  const d = await db.getDb();
  const [pkg] = await d!
    .insert(inspectionPackages)
    .values({
      machineId,
      packageId: `BG52-PKG-${STAMP}-${suffix}`,
      storageKey,
      status: "uploaded",
    })
    .returning({ id: inspectionPackages.id, packageId: inspectionPackages.packageId });
  packageDbIds.push(pkg.id);
  return pkg.id;
}

async function demSoCommitFail(pkgDbId: number): Promise<number> {
  const d = await db.getDb();
  const rows = await d!
    .select()
    .from(packageActivityLogs)
    .where(and(eq(packageActivityLogs.packageDbId, pkgDbId), eq(packageActivityLogs.event, "commit_fail")));
  return rows.length;
}

describe("demSoLoiVinhVienTuLichSu — hàm THUẦN, không DB (đơn vị)", () => {
  it("chỉ đếm entry có metadata.permanent === true", () => {
    expect(
      demSoLoiVinhVienTuLichSu([{ permanent: true }, { permanent: false }, { permanent: true }, {}, null, "x"]),
    ).toBe(2);
  });
  it("mảng rỗng ⇒ 0", () => {
    expect(demSoLoiVinhVienTuLichSu([])).toBe(0);
  });
});

describe("§1 — lỗi VĨNH VIỄN (ZIP không tồn tại ⇒ NOT_FOUND) lặp lại ⇒ chạm 'dead', rồi từ chối KHÔNG xử lý thêm", () => {
  it("lượt 1..2 (< ngưỡng=3): status vẫn 'failed', vẫn retry được", async () => {
    const packageId = `BG52-PKG-${STAMP}-perm-a`;
    const pkgDbId = await taoGoi("perm-a", `aoi-packages/${packageId}-KHONG-TON-TAI.zip`);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    for (let lan = 1; lan <= 2; lan++) {
      await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();
      const [row] = await (await db.getDb())!.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
      expect(row.status, `sau lượt ${lan}: status phải vẫn 'failed' (chưa chạm ngưỡng)`).toBe("failed");
    }
    expect(await demSoCommitFail(pkgDbId)).toBe(2);
  });

  it("★★★ TRUNG TÂM — lượt thứ 3 (đúng ngưỡng): status chuyển 'dead'; lượt thứ 4 bị TỪ CHỐI NGAY, KHÔNG ghi thêm commit_fail (short-circuit thật)", async () => {
    const packageId = `BG52-PKG-${STAMP}-perm-b`;
    const pkgDbId = await taoGoi("perm-b", `aoi-packages/${packageId}-KHONG-TON-TAI.zip`);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    // Lượt 1, 2: dưới ngưỡng — 'failed'.
    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();
    await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();

    // Lượt 3: ĐÚNG ngưỡng (AOI_PACKAGE_ZIP_MAX_PERMANENT_FAILS=3) — chuyển 'dead'.
    let loi3: any;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi3 = e;
    }
    expect(loi3).toBeTruthy();
    expect(String(loi3.message)).toContain("HỎNG VĨNH VIỄN");
    const [rowSauLan3] = await (await db.getDb())!.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(rowSauLan3.status, "TRƯỚC: 'dead' KHÔNG tồn tại — Agent retry vô hạn lần vẫn 'failed'; SAU: đúng lượt thứ 3 chuyển 'dead'").toBe("dead");
    expect(rowSauLan3.errorMessage).toContain("HỎNG VĨNH VIỄN");
    const soLoiSauLan3 = await demSoCommitFail(pkgDbId);
    expect(soLoiSauLan3).toBe(3);

    // Lượt 4: gói ĐÃ 'dead' — commit phải từ chối NGAY, không tải ZIP/không ghi
    // commit_fail thêm (đây là bằng chứng SHORT-CIRCUIT — không phải chỉ đọc
    // code rồi tin nó chạy nhánh sớm).
    let loi4: any;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi4 = e;
    }
    expect(loi4).toBeTruthy();
    expect(String(loi4.message)).toContain("KHÔNG được thử lại");
    const soLoiSauLan4 = await demSoCommitFail(pkgDbId);
    expect(soLoiSauLan4, "lượt 4 KHÔNG được ghi thêm commit_fail — chứng minh short-circuit ở đầu handler, không chạy lại try/catch").toBe(3);
    const [rowSauLan4] = await (await db.getDb())!.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(rowSauLan4.status).toBe("dead");
  });
});

describe("§2 — mệnh đề 4 (chống siết quá): lỗi TẠM THỜI lặp lại NHIỀU HƠN ngưỡng ⇒ KHÔNG BAO GIỜ 'dead', vẫn retry được", () => {
  it("ZIP tồn tại nhưng KHÔNG PHẢI zip hợp lệ (JSZip ném lỗi chung, không khớp TRPCError/SQLSTATE) — 5 lượt (> ngưỡng=3) ⇒ status vẫn 'failed'", async () => {
    const packageId = `BG52-PKG-${STAMP}-tmp-a`;
    const storageKey = `aoi-packages/${packageId}.zip`;
    const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, Buffer.from("khong-phai-file-zip-hop-le"));

    const pkgDbId = await taoGoi("tmp-a", storageKey);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    for (let lan = 1; lan <= 5; lan++) {
      await expect(caller.commit({ apiKey: API_KEY, packageId })).rejects.toThrow();
    }
    const [row] = await (await db.getDb())!.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status, "5 lượt lỗi TẠM THỜI (vượt ngưỡng 3) — KHÔNG được biến gói chớp-nháy thành gói chết").toBe("failed");
    // Vẫn ghi commit_fail đủ 5 lần — bằng chứng hệ thống VẪN xử lý đầy đủ mỗi
    // lượt (không tự ý short-circuit một gói còn cứu được).
    expect(await demSoCommitFail(pkgDbId)).toBe(5);
  });
});
