/**
 * I-6 (review lượt 8) — `package_images` PHẢI được ghi lại từ `images[]` đã
 * thẩm định; ảnh không được biến mất khỏi API.
 *
 * ── Lỗi được đóng ở đây ────────────────────────────────────────────────────
 * BG-85 bỏ hẳn INSERT vào `package_images` ở nhánh cây, với lý do đúng nhưng
 * cách xử lý sai: "`pointCode` varchar(50) < `captureId` cho phép tới 64 ⇒ nguy
 * cơ cắt cụt âm thầm". Hậu quả ĐO ĐƯỢC (`aoi_management_test`): 2 gói
 * `committed` hình dạng cây có `imageCount>0` mà **0 hàng `package_images`** ⇒
 * `getPackage.images` và `getPackageImages` trả RỖNG, `getImage({pointCode})`
 * mất bảng tra `pointCode → fileName` ⇒ người phán mất ảnh NG để nhìn.
 * Migration 0345 nới cột lên varchar(64) = ĐÚNG trần hợp đồng
 * (`imageRefSchema.captureId .max(64)`) nên không còn phải chọn giữa "cắt cụt
 * âm thầm" và "không ghi gì".
 *
 * ── Bốn mệnh đề, đo bằng commit SỐNG + SELECT/tRPC query THẬT ──────────────
 *   1. Gói cây + `images[]` ⇒ đúng số hàng `package_images`, mỗi hàng mang
 *      `pointCode=captureId`, `pointName=captureName`, `fileName`, và `result`
 *      = `rolledResult` CUỘN TỪ CÂY (không phải `result` máy khai) — bất biến 3
 *      áp cho cả cột báo cáo này.
 *   2. `getPackageImages` (hộ tiêu thụ THẬT của API) trả đúng danh sách đó.
 *   3. `captureId` DÀI 64 ký tự (trần hợp đồng) ghi được NGUYÊN VĂN — bằng
 *      chứng migration 0345 đã đóng lỗ 22001/cắt cụt. Đây là ca "hình dạng HỢP
 *      ĐỒNG CHO PHÉP", không phải "hình dạng đang có trong DB" (bài học L-4).
 *   4. Idempotency — `commit` chạy lại KHÔNG nhân đôi hàng ảnh.
 *
 * ⚠ WORM — `product_inspections` KHÔNG DELETE được; mỗi ca chapNhan để lại một
 * hàng VĨNH VIỄN. `package_images` thì KHÔNG WORM (avi_app có DELETE — đo bằng
 * information_schema.role_table_grants) nên `afterAll` dọn được.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, inArray } from "drizzle-orm";
import { aoiPackageRouter } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  packageImages,
  productInspections,
  inspectionSurfaces,
  inspectionPositions,
  inspectionCaptures,
} from "../../drizzle/schema";

const STAMP = Date.now();
const API_KEY = `I6-ANH-GOI-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `I6-ANH-GOI-${STAMP}`,
    name: "I-6 — package_images ghi lại từ images[] đã thẩm định",
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
    // KHÔNG delete `productInspections` — WORM (migration 0279).
  }
  if (machineId) await db.deleteMachine(machineId);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `i6-anh-goi-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

type Anh = { captureId: string; fileName: string; captureName?: string };

/** meta.json CÂY: hai capture (một OK, một NG) + `images[]` tham số hoá. */
function metaCayHaiCapture(opts: { serial: string; capOk: string; capNg: string; images: Anh[] }) {
  const { serial, capOk, capNg, images } = opts;
  const n2 = { total: 2, pass: 1, ng: 1, ntf: 0 };
  const n1 = { total: 1, pass: 0, ng: 1, ntf: 0 };
  return {
    identity: {
      station: "I6-ST", machine: "I6-MC", line: "I6-LN", plant: "I6-PL",
      country: "VN", solutionName: "I6-SOL", appVersion: "1.0.0",
    },
    productId: `I6-PID-${serial}`,
    serialNumber: serial,
    overallResult: "NG",
    ntf: false,
    summary: { surfaces: n1, positions: n1, captures: n2, components: n2 },
    surfaces: [{
      name: "TOP", result: "NG", ntf: false,
      positions: [{
        positionId: "P01", result: "NG", ntf: false,
        // ⚠ `componentId` KHÔNG dẫn xuất từ `captureId`: hợp đồng áp `.max(64)`
        // cho CẢ HAI, nên `${captureId}-C` sẽ vượt trần ở ca captureId dài 64.
        captures: [
          { captureId: capOk, result: "OK", ntf: false, components: [{ componentId: `I6-COMP-OK-${STAMP}`, result: "OK", ntf: false }] },
          { captureId: capNg, result: "NG", ntf: false, components: [{ componentId: `I6-COMP-NG-${STAMP}`, result: "NG", ntf: false }] },
        ],
      }],
    }],
    images,
  };
}

async function ghiZipVaTaoGoi(
  suffix: string,
  meta: Record<string, unknown>,
  anhThat: string[],
): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `I6-ANH-GOI-${STAMP}-${suffix}`;
  const storageKey = `aoi-packages/${packageId}.zip`;
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  const zip = new JSZip();
  zip.file("meta.json", JSON.stringify(meta));
  for (const fileName of anhThat) zip.file(`images/${fileName}`, Buffer.from(`i6-fake-${fileName}`));
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, zipBuffer);

  const d = await db.getDb();
  const [pkg] = await d!
    .insert(inspectionPackages)
    .values({ machineId, packageId, storageKey, status: "uploaded" })
    .returning({ id: inspectionPackages.id });
  packageDbIds.push(pkg.id);
  return { packageId, pkgDbId: pkg.id };
}

async function docHangAnh(pkgDbId: number) {
  const d = (await db.getDb())!;
  return d.select().from(packageImages).where(eq(packageImages.packageId, pkgDbId)).orderBy(packageImages.id);
}

describe("I-6 — `package_images` ghi lại từ `images[]` đã thẩm định (ảnh không biến mất khỏi API)", () => {
  it("mệnh đề 1 — gói cây + 2 ảnh ⇒ 2 hàng package_images, pointCode/pointName/fileName đúng, result CUỘN TỪ CÂY", async () => {
    const serial = `I6-MD1-SN-${STAMP}`;
    const capOk = `I6-MD1-CAP-OK-${STAMP}`;
    const capNg = `I6-MD1-CAP-NG-${STAMP}`;
    const meta = metaCayHaiCapture({
      serial, capOk, capNg,
      images: [
        { captureId: capOk, fileName: "top-ok.jpg", captureName: "Default" },
        { captureId: capNg, fileName: "top-ng.jpg" },
      ],
    });
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("md1", meta, ["top-ok.jpg", "top-ng.jpg"]);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success).toBe(true);
    if ((ket as { inspectionId?: number }).inspectionId) inspectionIds.push((ket as { inspectionId: number }).inspectionId);

    const hang = await docHangAnh(pkgDbId);
    expect(
      hang.length,
      "SELECT package_images — gói có 2 ảnh khai trong images[] PHẢI để lại ĐÚNG 2 hàng. 0 hàng = hồi quy BG-85: " +
        "getPackage/getPackageImages trả rỗng, người phán mất ảnh NG để nhìn.",
    ).toBe(2);

    const theoFile = Object.fromEntries(hang.map((h) => [h.fileName, h]));
    expect(theoFile["top-ok.jpg"].pointCode, "pointCode = captureId (khoá join §4 chuẩn gói ảnh)").toBe(capOk);
    expect(theoFile["top-ok.jpg"].pointName, "pointName = captureName khai trong images[]").toBe("Default");
    expect(theoFile["top-ok.jpg"].result, "result = rolledResult CUỘN TỪ CÂY của capture đó").toBe("OK");
    expect(theoFile["top-ng.jpg"].pointCode).toBe(capNg);
    expect(theoFile["top-ng.jpg"].pointName, "images[] không khai captureName ⇒ NULL, KHÔNG bịa giá trị").toBeNull();
    expect(theoFile["top-ng.jpg"].result, "capture NG ⇒ hàng ảnh mang NG").toBe("NG");
    expect(
      theoFile["top-ng.jpg"].measurementValue,
      "hợp đồng cây mang trị đo ở cấp COMPONENT — gán trị vào hàng cấp capture là bịa, phải NULL",
    ).toBeNull();
  });

  it("mệnh đề 2 — `getPackageImages` (hộ tiêu thụ THẬT của API) trả đúng danh sách vừa ghi", async () => {
    const serial = `I6-MD2-SN-${STAMP}`;
    const capOk = `I6-MD2-CAP-OK-${STAMP}`;
    const capNg = `I6-MD2-CAP-NG-${STAMP}`;
    const meta = metaCayHaiCapture({
      serial, capOk, capNg,
      images: [{ captureId: capNg, fileName: "chi-ng.jpg", captureName: "NG view" }],
    });
    const { packageId } = await ghiZipVaTaoGoi("md2", meta, ["chi-ng.jpg"]);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    if ((ket as { inspectionId?: number }).inspectionId) inspectionIds.push((ket as { inspectionId: number }).inspectionId);

    const callerNguoiDung = aoiPackageRouter.createCaller({ user: { id: 1, role: "admin", name: "I6" } } as never);
    const ds = await callerNguoiDung.getPackageImages({ packageId });
    expect(ds.length, "getPackageImages PHẢI trả về ảnh — RỖNG là đúng triệu chứng hồi quy I-6").toBe(1);
    expect(ds[0].fileName).toBe("chi-ng.jpg");
    expect(ds[0].pointCode).toBe(capNg);

    const goi = await callerNguoiDung.getPackage({ packageId });
    expect(goi.images.length, "getPackage.images cũng đọc từ package_images — cùng nguồn, cùng kết quả").toBe(1);
  });

  it("★ mệnh đề 3 — captureId DÀI 64 ký tự (trần hợp đồng) ghi NGUYÊN VĂN, không 22001, không cắt cụt (migration 0345)", async () => {
    // 64 ký tự CHẴN — đúng `imageRefSchema.captureId .max(64)`. Cột cũ varchar(50)
    // sẽ ném Postgres 22001 giữa transaction ⇒ TỪ CHỐI CẢ GÓI HỢP LỆ.
    const capDai = `I6-64-${STAMP}-`.padEnd(64, "X").slice(0, 64);
    expect(capDai.length, "fixture phải dài ĐÚNG 64 để đo đúng trần hợp đồng").toBe(64);
    const serial = `I6-MD3-SN-${STAMP}`;
    const capOk = `I6-MD3-CAP-OK-${STAMP}`;
    const meta = metaCayHaiCapture({
      serial, capOk, capNg: capDai,
      images: [{ captureId: capDai, fileName: "dai64.jpg" }],
    });
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("md3", meta, ["dai64.jpg"]);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    expect(ket.success, "captureId 64 ký tự là hình dạng HỢP ĐỒNG CHO PHÉP ⇒ gói KHÔNG được bị từ chối").toBe(true);
    if ((ket as { inspectionId?: number }).inspectionId) inspectionIds.push((ket as { inspectionId: number }).inspectionId);

    const hang = await docHangAnh(pkgDbId);
    expect(hang.length).toBe(1);
    expect(
      hang[0].pointCode,
      "pointCode phải giữ NGUYÊN VĂN 64 ký tự — một chuỗi 50 ký tự ở đây nghĩa là DB đã cắt cụt âm thầm và " +
        "khoá join `pointCode → captureId` đã HỎNG mà không ai báo",
    ).toBe(capDai);
    expect(hang[0].pointCode.length).toBe(64);
  });

  it("mệnh đề 4 — commit lặp lại KHÔNG nhân đôi hàng ảnh (DELETE-rồi-INSERT trong một transaction)", async () => {
    const serial = `I6-MD4-SN-${STAMP}`;
    const capOk = `I6-MD4-CAP-OK-${STAMP}`;
    const capNg = `I6-MD4-CAP-NG-${STAMP}`;
    const meta = metaCayHaiCapture({
      serial, capOk, capNg,
      images: [{ captureId: capOk, fileName: "a.jpg" }, { captureId: capNg, fileName: "b.jpg" }],
    });
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("md4", meta, ["a.jpg", "b.jpg"]);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    if ((ket as { inspectionId?: number }).inspectionId) inspectionIds.push((ket as { inspectionId: number }).inspectionId);
    expect((await docHangAnh(pkgDbId)).length).toBe(2);

    await caller.commit({ apiKey: API_KEY, packageId });
    expect(
      (await docHangAnh(pkgDbId)).length,
      "lượt commit thứ hai (gói đã 'committed' ⇒ nhánh alreadyCommitted) KHÔNG được sinh thêm hàng ảnh",
    ).toBe(2);
  });

  it("ĐỐI CHỨNG — gói cây KHÔNG khai `images[]` ⇒ 0 hàng ảnh, và đó là ĐÚNG (không bịa hàng từ tệp có trong ZIP)", async () => {
    const serial = `I6-DC-SN-${STAMP}`;
    const capOk = `I6-DC-CAP-OK-${STAMP}`;
    const capNg = `I6-DC-CAP-NG-${STAMP}`;
    const meta = metaCayHaiCapture({ serial, capOk, capNg, images: [] });
    // ZIP VẪN có một tệp ảnh vật lý — nhưng `images[]` rỗng nghĩa là máy KHÔNG
    // khai ảnh nào nối được vào capture nào; bịa hàng từ tên tệp là đoán khoá join.
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi("doi-chung", meta, ["khong-khai.jpg"]);
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });
    if ((ket as { inspectionId?: number }).inspectionId) inspectionIds.push((ket as { inspectionId: number }).inspectionId);

    expect((await docHangAnh(pkgDbId)).length, "0 hàng — nguồn DUY NHẤT là images[] đã thẩm định, không phải danh sách tệp trong ZIP").toBe(0);
    const d = (await db.getDb())!;
    const [pkgRow] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(pkgRow.imageCount, "imageCount vẫn đếm THEO Ổ ĐĨA (1 tệp) — hai con số đo hai thứ khác nhau, cố ý").toBe(1);
  });
});
