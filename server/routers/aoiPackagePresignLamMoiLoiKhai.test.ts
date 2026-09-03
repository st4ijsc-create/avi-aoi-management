/**
 * ⛔ N-1 (re-review lượt 8) — bản vá I-7 KHOÁ VĨNH VIỄN một gói TỐT.
 *
 * ── Lỗi được đóng ở đây ────────────────────────────────────────────────────
 * I-7 lưu lời khai `sha256` của bước `presign` vào `inspection_packages.
 * "sha256Presign"` rồi đối chiếu nó với byte ZIP THẬT ở HAI cửa (tuyến
 * `PUT /api/aoi/upload/:packageId` trong `server/_core/index.ts`, và backstop
 * `status==='pending'` của `commit` trong `aoiPackageRouter.ts`). Cả hai cửa
 * đều miễn trừ phép so khi đây là một RETRY — nhưng "retry" ở đó được định
 * nghĩa bằng `status==='uploaded' || 'uploading'`, tức MỘT TRẠNG THÁI MÀ MỘT
 * LẦN DỰNG LẠI ZIP *TRƯỚC* UPLOAD KHÔNG BAO GIỜ CHẠM TỚI.
 *
 * Chuỗi khoá vĩnh viễn (đo được, là nội dung file này):
 *   1. `presign` #1: Agent khai `sha256 = A` ⇒ cột `sha256Presign = A`,
 *      `status='pending'`.
 *   2. Upload hỏng / chưa chạy ⇒ `status` VẪN `'pending'` (cột chỉ thành
 *      `'uploaded'` SAU một lượt PUT THÀNH CÔNG).
 *   3. Agent dựng lại ZIP — rất phổ biến trong vòng retry. ZIP CÙNG NỘI DUNG
 *      có CÙNG `sizeBytes` nhưng KHÁC BYTE (mtime nằm trong local header của
 *      ZIP) ⇒ digest B ≠ A. Cổng `sizeBytes` (có từ BG-87) KHÔNG bắt được vì
 *      kích thước không đổi — file này GHIM điều đó bằng một cầu chì.
 *   4. `presign` #2: rơi vào nhánh "gói đã tồn tại", trả presign cũ và —
 *      TRƯỚC bản vá N-1 — KHÔNG cập nhật `sha256Presign` lẫn `fileSizeBytes`.
 *   5. Byte của ZIP-B tới cửa: `isRetry === false` (`status` vẫn `'pending'`)
 *      ⇒ phép so chạy ⇒ `B ≠ A` ⇒ TỪ CHỐI ⇒ `status` VẪN `'pending'` ⇒ quay
 *      lại bước 3, VÔ HẠN. `packageId` đó không bao giờ dùng được nữa.
 *
 * ⚠ Thông điệp lỗi của cả hai cửa đang kê đơn *"tải lại ZIP"* — một cách chữa
 * KHÔNG THỂ hiệu quả: tải lại bao nhiêu lần cũng cùng kết quả, chỉ một
 * `packageId` MỚI mới thoát. Đây là một bo TỐT bị CHẶN, không phải một bo xấu
 * bị bắt.
 *
 * ── Bán kính hôm nay và vì sao vẫn phải vá NGAY ───────────────────────────
 * `count(*) where "sha256Presign" is not null` = **0** ở `aoi_management` và
 * **0/296** ở `aoi_management_test` ⇒ chưa Agent nào khai. NHƯNG tài liệu I-2
 * vừa viết lại DẠY MỌI AGENT gửi `sha256` ở presign — lỗi này TỰ LÊN ĐẠN đúng
 * lúc bên tích hợp làm theo tài liệu.
 *
 * ── Bất biến được khôi phục ───────────────────────────────────────────────
 * *"Lời khai toàn vẹn MỚI NHẤT thắng, chừng nào byte chưa được nhận."*
 * `presign` gọi lại trên một gói CHƯA `'uploaded'`/`'committed'` LÀM MỚI cả
 * `sha256Presign` lẫn `fileSizeBytes`. Gói đã `'uploaded'`/`'committed'` giữ
 * NGUYÊN hành vi bảo vệ (§4) — ở đó byte THẬT đã tới và đã được đối chiếu.
 *
 * ── Phạm vi đo được của file này (khai rõ, không khai vống) ───────────────
 * §1/§2 đi qua ĐƯỜNG THẬT của backstop `commit` (`status==='pending'`), có DB
 * thật. Tuyến `PUT /api/aoi/upload/:packageId` nằm trong `server/_core/index.ts`
 * — một bootstrap Express không export app factory nào, nên KHÔNG chạy được
 * trong vitest mà không dựng máy chủ sống. §3 vì thế đo tuyến đó bằng CENSUS
 * NGUỒN: nó chứng minh tuyến ấy đọc ĐÚNG hai cột mà §2 vừa khẳng định đã được
 * làm mới, và chốt miễn trừ của nó là `!isRetry` — tức §2 là TIỀN ĐỀ ĐỦ để
 * PUT byte-của-B thành công. Đây là một phép đo GIÁN TIẾP và được khai là gián
 * tiếp.
 *
 * ⚠ WORM — ca §1 tạo MỘT hàng `product_inspections` ở lại vĩnh viễn.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { readFileSync, promises as fsp } from "node:fs";
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
const API_KEY = `N1-PRESIGN-${STAMP}`;

let machineId: number;
const packageDbIds: number[] = [];
const inspectionIds: number[] = [];

beforeAll(async () => {
  machineId = await db.createMachine({
    stationId: 1,
    code: `N1-PRESIGN-${STAMP}`,
    name: "N-1 — presign lặp phải LÀM MỚI lời khai toàn vẹn",
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
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `n1-presign-${STAMP}-${Math.random().toString(36).slice(2)}`);
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
      station: "N1-ST", machine: "N1-MC", line: "N1-LN", plant: "N1-PL",
      country: "VN", solutionName: "N1-SOL", appVersion: "1.0.0",
    },
    productId: `N1-PID-${serial}`,
    serialNumber: serial,
    overallResult: "OK",
    ntf: false,
    summary: { surfaces: n, positions: n, captures: n, components: n },
    surfaces: [{
      name: "TOP", result: "OK", ntf: false,
      positions: [{
        positionId: "P01", result: "OK", ntf: false,
        captures: [{ captureId, result: "OK", ntf: false, components: [{ componentId: `N1-COMP-${STAMP}`, result: "OK", ntf: false }] }],
      }],
    }],
  };
}

/**
 * Dựng ZIP thật với mtime CHỈ ĐỊNH — hai lượt dựng cùng nội dung, khác `date`,
 * cho ra CÙNG số byte nhưng KHÁC digest. Đây ĐÚNG là hình dạng bước 3 của
 * chuỗi khoá vĩnh viễn (không phải một ZIP nội dung khác được nguỵ trang).
 */
async function dungZip(serial: string, captureId: string, mtime: Date): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("meta.json", JSON.stringify(metaCayToiThieu(serial, captureId)), { date: mtime });
  return zip.generateAsync({ type: "nodebuffer" });
}

function bam(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function ghiZipVaoStorage(storageKey: string, zipBuffer: Buffer) {
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, zipBuffer);
}

describe("⛔ N-1 — `presign` gọi lại trên gói CHƯA upload phải LÀM MỚI `sha256Presign`/`fileSizeBytes`", () => {
  it("cầu chì — hai lượt dựng ZIP cùng nội dung cho CÙNG số byte nhưng KHÁC digest (nếu không, ca §1 chứng minh nhầm thứ)", async () => {
    const zipA = await dungZip(`N1-FUSE-${STAMP}`, `N1-FUSE-CAP-${STAMP}`, new Date("2026-01-01T00:00:00Z"));
    const zipB = await dungZip(`N1-FUSE-${STAMP}`, `N1-FUSE-CAP-${STAMP}`, new Date("2026-06-15T12:34:56Z"));
    expect(zipA.length, "cùng nội dung ⇒ cổng sizeBytes (BG-87) KHÔNG bắt được ca này").toBe(zipB.length);
    expect(bam(zipA), "khác mtime trong local header ⇒ khác byte ⇒ khác digest").not.toBe(bam(zipB));
  });

  it("★★★ §1 — presign(A) → presign(B) → byte-của-B tới cửa ⇒ THÀNH CÔNG (trước bản vá: khoá VĨNH VIỄN, mọi lượt sau đều 400)", async () => {
    const serial = `N1-MD1-SN-${STAMP}`;
    const capture = `N1-MD1-CAP-${STAMP}`;
    const zipA = await dungZip(serial, capture, new Date("2026-01-01T00:00:00Z"));
    const zipB = await dungZip(serial, capture, new Date("2026-06-15T12:34:56Z"));
    const packageId = `N1-PRESIGN-${STAMP}-md1`;
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    // 1. presign #1 — khai digest của ZIP-A
    const res1 = await caller.presign({
      apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipA.length, sha256: bam(zipA),
    });
    const storageKey = (res1 as { objectKey?: string }).objectKey!;
    expect(storageKey, "presign #1 phải trả objectKey").toBeTruthy();
    const d = (await db.getDb())!;
    const [rowTao] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(rowTao.id);
    expect(rowTao.status, "upload chưa chạy ⇒ gói ở lại 'pending' — ĐÚNG trạng thái mà miễn trừ !isRetry KHÔNG phủ").toBe("pending");

    // 2. Agent dựng lại ZIP (bước 3 của chuỗi) và presign #2 khai digest MỚI
    await caller.presign({
      apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipB.length, sha256: bam(zipB),
    });

    // 3. Byte của ZIP-B tới cửa (đường ghi thẳng vào storage ⇒ backstop `commit`)
    await ghiZipVaoStorage(storageKey, zipB);
    const ket = await caller.commit({ apiKey: API_KEY, packageId });

    expect(
      ket.success,
      "Agent khai LẠI digest ĐÚNG của ZIP mình sắp gửi mà vẫn bị từ chối = một bo TỐT bị CHẶN vĩnh viễn " +
        "(thông điệp lỗi còn kê đơn 'tải lại ZIP' — cách chữa không thể hiệu quả)",
    ).toBe(true);
    if ((ket as { inspectionId?: number }).inspectionId) inspectionIds.push((ket as { inspectionId: number }).inspectionId);

    const [rowSau] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, rowTao.id));
    expect(rowSau.status, "SELECT thật — gói phải đi tới 'committed', không kẹt ở 'pending' vô hạn").toBe("committed");
  });

  it("§2 — SELECT: sau presign #2, `sha256Presign` = digest MỚI và `fileSizeBytes` = kích thước MỚI (đây là hai cột tuyến PUT đọc)", async () => {
    const zipA = await dungZip(`N1-MD2-SN-${STAMP}`, `N1-MD2-CAP-${STAMP}`, new Date("2026-01-01T00:00:00Z"));
    const zipB = await dungZip(`N1-MD2-SN-${STAMP}-DAI-HON-DE-KHAC-KICH-THUOC`, `N1-MD2-CAP-${STAMP}`, new Date("2026-06-15T12:34:56Z"));
    const packageId = `N1-PRESIGN-${STAMP}-md2`;
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    await caller.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipA.length, sha256: bam(zipA).toUpperCase() });
    const d = (await db.getDb())!;
    const [truoc] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(truoc.id);
    expect(truoc.sha256Presign).toBe(bam(zipA));

    await caller.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipB.length, sha256: bam(zipB).toUpperCase() });
    const [sau] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, truoc.id));

    expect(
      sau.sha256Presign,
      "lời khai MỚI NHẤT thắng chừng nào byte chưa tới — và chuẩn hoá chữ THƯỜNG ngay tại chỗ ghi (cùng quy ước lượt INSERT)",
    ).toBe(bam(zipB));
    expect(
      Number(sau.fileSizeBytes),
      "`fileSizeBytes` đóng băng cùng lý do: cổng (2) của tuyến PUT/backstop commit so nó với byte THẬT",
    ).toBe(zipB.length);
  });

  it("§3 census (đo GIÁN TIẾP tuyến PUT) — tuyến `PUT /api/aoi/upload/:packageId` đọc ĐÚNG hai cột trên và miễn trừ theo `!isRetry`", () => {
    const nguon = readFileSync(path.join(__dirname, "..", "_core", "index.ts"), "utf-8");
    expect(nguon.length, "chống đọc-file-rỗng: một đường dẫn hỏng im lặng làm mọi khẳng định dưới thành XANH GIẢ").toBeGreaterThan(1000);

    const MOC_MO = 'app.put("/api/aoi/upload/:packageId"';
    const batDau = nguon.indexOf(MOC_MO);
    expect(batDau, "marker tuyến upload phải còn đúng chỗ").toBeGreaterThan(-1);
    const conLai = nguon.slice(batDau + MOC_MO.length);
    const khop = conLai.match(/\n {2}app\.(get|put|post|delete|patch)\(/);
    const vung = conLai.slice(0, khop?.index ?? conLai.length);
    expect(vung.length, "cầu chì: vùng cắt được phải đủ lớn để chứa thân tuyến").toBeGreaterThan(2000);

    expect(vung, "tuyến PUT so byte THẬT với `pkg.sha256Presign` — cột §2 vừa làm mới").toContain("pkg.sha256Presign");
    expect(vung, "tuyến PUT so byte THẬT với `pkg.fileSizeBytes` — cột §2 vừa làm mới").toContain("pkg.fileSizeBytes");
    expect(
      vung.replace(/\s+/g, " "),
      "miễn trừ của tuyến PUT là `!isRetry`, và `isRetry` = uploaded||uploading ⇒ một gói 'pending' KHÔNG được miễn " +
        "⇒ làm mới ở presign là TIỀN ĐỀ ĐỦ để byte-của-B đi qua",
    ).toContain("if (!isRetry && pkg.sha256Presign)");
    expect(vung, "định nghĩa `isRetry` phải còn nguyên hình dạng mà §3 dựa vào").toContain(
      'const isRetry = pkg.status === "uploaded" || pkg.status === "uploading";',
    );
  });

  it("§4 ĐỐI CHỨNG BẢO VỆ — gói ĐÃ `'uploaded'` thì presign KHÔNG làm mới lời khai (byte thật đã tới và đã được đối chiếu)", async () => {
    const zipA = await dungZip(`N1-MD4-SN-${STAMP}`, `N1-MD4-CAP-${STAMP}`, new Date("2026-01-01T00:00:00Z"));
    const zipB = await dungZip(`N1-MD4-SN-${STAMP}`, `N1-MD4-CAP-${STAMP}`, new Date("2026-06-15T12:34:56Z"));
    const packageId = `N1-PRESIGN-${STAMP}-md4`;
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    await caller.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipA.length, sha256: bam(zipA) });
    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    packageDbIds.push(row.id);

    // Mô phỏng ĐÚNG hậu quả của một lượt PUT thành công (tuyến đó set 'uploaded'
    // + ghi đè fileSizeBytes bằng byte THẬT) — không dựng được máy chủ Express
    // trong vitest, nhưng trạng thái DB thì dựng được y hệt.
    await d.update(inspectionPackages)
      .set({ status: "uploaded", fileSizeBytes: zipA.length, uploadedAt: new Date() })
      .where(eq(inspectionPackages.id, row.id));

    await caller.presign({ apiKey: API_KEY, inspectionId: packageId, sizeBytes: zipB.length, sha256: bam(zipB) });
    const [sau] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, row.id));

    expect(
      sau.sha256Presign,
      "gói đã 'uploaded' ⇒ GIỮ NGUYÊN hành vi bảo vệ hiện tại: một lời khai presign muộn KHÔNG được ghi đè lên " +
        "digest đã dùng để nghiệm thu byte thật",
    ).toBe(bam(zipA));
    expect(Number(sau.fileSizeBytes), "cùng lý do — kích thước THẬT của lượt upload đã diễn ra không bị lời khai muộn ghi đè").toBe(zipA.length);
    expect(sau.status, "presign KHÔNG được kéo trạng thái lùi lại").toBe("uploaded");
  });
});
