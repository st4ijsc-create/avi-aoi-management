/**
 * I-7 (review lượt 8) — `presign.sha256` KHÔNG còn "nhận rồi vứt".
 *
 * ── Lỗi được đóng ở đây ────────────────────────────────────────────────────
 * Chuẩn gói ảnh §6 TỰ GỌI TÊN cái bẫy: *"trường trông như bảo đảm toàn vẹn mà
 * không phải còn nguy hiểm hơn không có trường."* BG-87 (`cc322bca`) đóng NỬA
 * `commit` (băm byte thật, so, lệch ⇒ từ chối). Nửa `presign` nguyên vẹn:
 * `presignCoreObject.sha256` được nhận, KHÔNG lưu, KHÔNG so, không cả log.
 *
 * Và `presign` lại là nơi DUY NHẤT hai tài liệu hướng máy dạy đặt trường đó
 * (`docs/CSHARP_CLIENT_UPLOAD_GUIDE.md`; tab Presign của `AoiPackageSection.tsx`
 * còn gọi thẳng nó là "integrity check"). ⇒ Một Agent làm ĐÚNG tài liệu công bố
 * nhận 0 kiểm toàn vẹn trong khi tin rằng mình có. Đây không phải "thiếu bảo
 * đảm", mà là bảo đảm GIẢ.
 *
 * Không kiểm được NGAY tại `presign` (byte ZIP chưa tồn tại), nên lời khai được
 * lưu vào `inspection_packages."sha256Presign"` (migration 0346) và đối chiếu ở
 * đúng khoảnh khắc byte thật xuất hiện. File này đo NHÁNH `commit`
 * (`status==='pending'` — gói ghi thẳng vào storage, không qua Express); nhánh
 * tuyến `PUT /api/aoi/upload/:packageId` dùng CÙNG một cột và cùng phép so, đo
 * bằng cùng cách nhưng cần một máy chủ HTTP sống nên khai rõ là NGOÀI phạm vi
 * file này (xem báo cáo).
 *
 * ⚠ WORM — ca "đối chứng dương" tạo MỘT hàng `product_inspections` ở lại vĩnh
 * viễn; các ca từ chối không tạo hàng nào.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  packageImages,
  inspectionSurfaces,
  inspectionPositions,
  inspectionCaptures,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `I7-SHA-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `I7-SHA-${STAMP}`,
    name: "I-7 — sha256 khai ở presign được KIỂM THẬT",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (inspectionIds.length > 0) {
      await d.delete(inspectionCaptures).where(inArray(inspectionCaptures.inspectionId, inspectionIds));
      await d.delete(inspectionPositions).where(inArray(inspectionPositions.inspectionId, inspectionIds));
      await d.delete(inspectionSurfaces).where(inArray(inspectionSurfaces.inspectionId, inspectionIds));
    }
    if (packageDbIds.length > 0) {
      await d.delete(packageImages).where(inArray(packageImages.packageId, packageDbIds));
      await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
      await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
    }
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `i7-sha-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

function metaCayToiThieu(serial: string, captureId: string) {
  const n = { total: 1, pass: 1, ng: 0, ntf: 0 };
  return {
    identity: {
      station: "I7-ST", machine: "I7-MC", line: "I7-LN", plant: "I7-PL",
      country: "VN", solutionName: "I7-SOL", appVersion: "1.0.0",
    },
    productId: `I7-PID-${serial}`,
    serialNumber: serial,
    overallResult: "OK",
    ntf: false,
    summary: { surfaces: n, positions: n, captures: n, components: n },
    surfaces: [{
      name: "TOP", result: "OK", ntf: false,
      positions: [{
        positionId: "P01", result: "OK", ntf: false,
        captures: [{ captureId, result: "OK", ntf: false, components: [{ componentId: `I7-COMP-${STAMP}`, result: "OK", ntf: false }] }],
      }],
    }],
  };
}

/** Dựng ZIP thật, trả cả buffer để test tự băm — KHÔNG chép lại công thức băm của mã sản xuất. */
async function dungZip(serial: string, captureId: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("meta.json", JSON.stringify(metaCayToiThieu(serial, captureId)));
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * Đi ĐÚNG vòng Agent: `presign` (khai sha256) → ghi ZIP xuống local storage
 * bằng ĐÚNG `storageKey` presign trả về → gói ở lại `status='pending'` (KHÔNG
 * đi qua tuyến PUT upload) ⇒ đây LÀ đường mà nhánh backstop của `commit` phủ.
 */
async function presignRoiGhiZip(
  suffix: string,
  zipBuffer: Buffer,
  sha256?: string,
): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `I7-SHA-${STAMP}-${suffix}`;
  const caller = aoiPackageRouter.createCaller({ user: null } as never);
  const res = await caller.presign({
    apiKey: API_KEY,
    inspectionId: packageId,
    sizeBytes: zipBuffer.length,
    ...(sha256 ? { sha256 } : {}),
  });
  const storageKey = (res as { objectKey?: string }).objectKey!;
  expect(storageKey, "presign phải trả về objectKey để test ghi ZIP đúng chỗ").toBeTruthy();

  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, zipBuffer);

  const d = (await db.getDb())!;
  const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
  packageDbIds.push(row.id);
  return { packageId, pkgDbId: row.id };
}

describe("I-7 — `sha256` khai ở presign được LƯU và ĐỐI CHIẾU trên byte ZIP thật", () => {
  it("mệnh đề 1 — presign LƯU lời khai vào `inspection_packages.sha256Presign`, chuẩn hoá chữ THƯỜNG", async () => {
    const zipBuffer = await dungZip(`I7-MD1-SN-${STAMP}`, `I7-MD1-CAP-${STAMP}`);
    const shaThat = createHash("sha256").update(zipBuffer).digest("hex");
    // Agent .NET (`Convert.ToHexString`) trả HOA — hoa/thường KHÔNG phải "lệch nội dung".
    const { pkgDbId } = await presignRoiGhiZip("md1", zipBuffer, shaThat.toUpperCase());

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(
      row.sha256Presign,
      "SELECT inspection_packages.sha256Presign — lời khai presign PHẢI được LƯU (trước bản vá: nhận rồi vứt, " +
        "cột này không tồn tại) và chuẩn hoá về chữ thường ngay tại chỗ ghi",
    ).toBe(shaThat.toLowerCase());
  });

  it("★★★ mệnh đề 2 — sha256 presign LỆCH byte ZIP thật ⇒ commit TỪ CHỐI, gói KHÔNG 'committed'", async () => {
    const zipBuffer = await dungZip(`I7-MD2-SN-${STAMP}`, `I7-MD2-CAP-${STAMP}`);
    const shaSai = "b".repeat(64); // hex hợp lệ về hình dạng, SAI về nội dung
    const { packageId, pkgDbId } = await presignRoiGhiZip("md2", zipBuffer, shaSai);

    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    let loi: unknown;
    try {
      await caller.commit({ apiKey: API_KEY, packageId });
    } catch (e) {
      loi = e;
    }
    expect(
      loi,
      "commit PHẢI ném lỗi — lời khai toàn vẹn ở presign không khớp byte thật. Trước bản vá này gói commit " +
        "THÀNH CÔNG trong khi tài liệu gọi trường đó là 'integrity check'.",
    ).toBeTruthy();
    expect(String((loi as { message?: string })?.message)).toMatch(/sha256 Agent khai ở presign/);

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status, "SELECT thật — gói KHÔNG được commit im lặng").not.toBe("committed");
  });

  it("ĐỐI CHỨNG DƯƠNG — sha256 presign ĐÚNG (khai chữ HOA) ⇒ commit thành công, không từ chối nhầm", async () => {
    const zipBuffer = await dungZip(`I7-MD3-SN-${STAMP}`, `I7-MD3-CAP-${STAMP}`);
    const shaThat = createHash("sha256").update(zipBuffer).digest("hex").toUpperCase();
    const { packageId, pkgDbId } = await presignRoiGhiZip("md3", zipBuffer, shaThat);

    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success, "khai ĐÚNG (chỉ khác hoa/thường) KHÔNG được coi là lệch nội dung").toBe(true);
    if ((ket as { inspectionId?: number }).inspectionId) inspectionIds.push((ket as { inspectionId: number }).inspectionId);

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status).toBe("committed");
  });

  it("ĐỐI CHỨNG ÂM — KHÔNG khai sha256 ở presign ⇒ cột NULL, commit vẫn qua (tuỳ chọn, nguyên tắc di trú §7/Đ-20)", async () => {
    const zipBuffer = await dungZip(`I7-MD4-SN-${STAMP}`, `I7-MD4-CAP-${STAMP}`);
    const { packageId, pkgDbId } = await presignRoiGhiZip("md4", zipBuffer);

    const d = (await db.getDb())!;
    const [truoc] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(truoc.sha256Presign, "không khai ⇒ NULL, KHÔNG bịa một digest nào").toBeNull();

    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(
      ket.success,
      "bắt buộc NGAY sẽ từ chối 100% lưu lượng thật (đo: 0/296 gói committed trong aoi_management_test có khai " +
        "sha256) — tuỳ chọn là quyết định đã duyệt, KHÔNG được siết ở bản vá này",
    ).toBe(true);
    if ((ket as { inspectionId?: number }).inspectionId) inspectionIds.push((ket as { inspectionId: number }).inspectionId);
  });
});
