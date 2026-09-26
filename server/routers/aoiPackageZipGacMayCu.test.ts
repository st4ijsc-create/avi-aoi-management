/**
 * server/routers/aoiPackageZipGacMayCu.test.ts
 *
 * Lô 3 Mục 3 (BG-39 gđ2) — GÁC CỬA ZIP bằng ĐÚNG cổng chặn máy cũ mà đường v1 trực tiếp
 * (`submitInspection`/`submitInspectionBatch`, `machineApiRouters.ts`) dùng: cờ
 * `INGEST_REJECT_LEGACY_MACHINE_ENABLED` + vị từ `laHinhDangCayV2` + thông điệp
 * `loiMayChuaNangCap` — CẢ BA dùng CHUNG (export/import), không viết bộ nhận diện/thông
 * điệp thứ hai (docs/superpowers/specs — xem `.superpowers/sdd/2026-09-05-aoi-khoi-c-no-con-mo/
 * lo-3-brief.md` Mục 3).
 *
 * ── ĐO TRƯỚC (khai trong docblock tại điểm gác thật, aoiPackageRouter.ts, và lặp lại ở đây vì
 *    nó QUYẾT ĐỊNH hình dạng của lưới này) ──────────────────────────────────────────────────
 * `metaJsonSchema` (BG-85) yêu cầu `surfaces: z.array(surfaceV2)` BẮT BUỘC (không `.optional()`).
 * Hệ quả ĐO ĐƯỢC bằng `safeParse` sống (node, không đoán):
 *   - Payload PHẲNG THẬT (`measurements[]`, không có `surfaces`) ⇒ `metaJsonSchema.parse()` ném
 *     `ZodError` (8 issue: thiếu `identity`/`productId`/`ntf`/`summary.*`/`surfaces`) — KHÔNG BAO
 *     GIỜ tới được `metaData`. Do đó gác PHẢI hỏi trên JSON THÔ (`metaRaw`, trước `.parse()`),
 *     không phải trên `metaData` (sau `.parse()`).
 *   - `surfaces: []` (mảng RỖNG) VẪN qua được `.parse()` (không có `.min(1)`) ⇒
 *     `laHinhDangCayV2(metaData)` sau parse LUÔN `true` (chỉ kiểm `Array.isArray`) — hỏi
 *     `laHinhDangCayV2` SAU `.parse()` là mã CHẾT, nhánh phủ định không bao giờ chạm được.
 * ⇒ Lưới này canh ĐÚNG điểm gác thật: `ingestRejectLegacyMachineEnabled() &&
 *   !laHinhDangCayV2(metaRaw)` — TRÊN JSON thô, TRƯỚC `metaJsonSchema.parse()`.
 *
 * ── BA MỆNH ĐỀ ──────────────────────────────────────────────────────────────────────────────
 *   1. Cờ BẬT + payload PHẲNG ⇒ từ chối với thông điệp CÙNG HỌ `loiMayChuaNangCap` (chứa "2.0",
 *      y hệt chuỗi đường v1 — mirror, không chép) + ghi ĐÚNG MỘT hàng
 *      `ingest_shape_legacy_rejected` (BG-57b) mang máy ĐÃ XÁC THỰC.
 *   2. Cờ TẮT (mặc định) + CÙNG payload ⇒ hành vi HÔM NAY không đổi MỘT BYTE: vẫn `ZodError`
 *      (KHÔNG PHẢI `loiMayChuaNangCap`), vẫn `'failed'`, KHÔNG BAO GIỜ `'dead'`, retry được vô
 *      hạn — same shape với mệnh đề 4 của `aoiPackageBienBg85.test.ts` (không lặp lại: file kia
 *      ĐÃ canh cờ-TẮT-mặc-định; ca ở đây RUN LẠI cùng lời khẳng định với cờ TẮT TƯỜNG MINH, làm
 *      đối chứng trực tiếp cho mệnh đề 1 ở trên — cùng payload, cùng máy, chỉ đổi cờ).
 *   3. Cờ BẬT + payload CÂY hợp lệ ⇒ KHÔNG bị gác nhầm (đối chứng: gác không cắt oan hình dạng
 *      mới).
 *
 * ── ĐỘT BIẾN (chứng minh test không xanh vì tình cờ) ────────────────────────────────────────
 * Tắt nhánh gác (comment `if` ra, patch runtime bằng cách gọi thẳng logic đã tách) ⇒ test cờ-BẬT
 * (mệnh đề 1) PHẢI đỏ. Thực hiện bằng thay `ingestRejectLegacyMachineEnabled` (import từ
 * `machineApiRouters`) — không patch được named export ES module trực tiếp, nên đột biến THẬT ở
 * đây là: gọi `commit` với cờ BẬT trên một BẢN SAO mã nguồn đã xoá nhánh gác, xác nhận nhánh đó
 * THẬT SỰ là điều kiện cần bằng cách đọc lại chính đoạn mã nguồn (kiểm tra tĩnh neo + hành vi từ
 * hai phía cờ) — xem §M.
 *
 * ── QUYẾT ĐỊNH "gói đã nằm trong kho khi cờ TẮT rồi commit lúc cờ BẬT" (brief Mục 3 điểm 4) ──
 * TỪ CHỐI như lượt live — nhất quán, không có nhánh nhân nhượng theo lịch sử gói. Bo KHÔNG mất:
 * gói còn NGUYÊN trong storage (`commit` chỉ đổi `status`, không xoá ZIP), máy/người vận hành
 * retry SAU KHI máy nâng cấp lên hình dạng cây — ĐÚNG con đường vận hành mà `laLoiVinhVienDemVao
 * NguongDeadZip` đã mở cho lớp lỗi hình dạng (xem §3 dưới: KHÔNG bị khoá 'dead', `presign` gọi lại
 * vẫn nhận info retry). KHÔNG phá mệnh đề WAL/dead-letter: `loiMayChuaNangCap` là `Error` THƯỜNG
 * (không `TRPCError`/ZodError-`"too_big"`) ⇒ `laLoiVinhVienDemVaoNguongDeadZip` xếp TẠM THỜI —
 * cùng lớp với mệnh đề 4 hình dạng cũ, không đếm vào ngưỡng 'dead'.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import { eq, and, inArray } from "drizzle-orm";
import { aoiPackageRouter } from "./aoiPackageRouter";
import * as db from "../db";
import {
  inspectionPackages,
  packageActivityLogs,
  packageImages,
  productInspections,
  auditLogs,
} from "../../drizzle/schema";
import { AUDIT_ACTIONS } from "../services/auditTrailService";
import { choTinHieuHinhDangIngestGhiXong } from "./machineApiRouters";

const STAMP = Date.now();

const packageDbIds: number[] = [];
const machineIds: number[] = [];
const inspectionIds: number[] = [];

/**
 * ★ CÔ LẬP — MỖI CA một MÁY RIÊNG (mã duy nhất), CÙNG kỷ luật
 * `dangKyTinHieuHinhDangIngestBg89.test.ts` §A: `demTinHieuRejected` đếm THEO entityName
 * (mã máy) nên hai ca dùng CHUNG một máy sẽ CỘNG DỒN số hàng của nhau — số đếm phải là số
 * TUYỆT ĐỐI trên một máy DUY NHẤT của CHÍNH ca đó, không lệ thuộc thứ tự chạy ca khác.
 */
async function taoMay(nhan: string): Promise<{ id: number; code: string; apiKey: string }> {
  const code = `BG39G2-${nhan}-${STAMP}`;
  const apiKey = `BG39G2-KEY-${nhan}-${STAMP}`;
  const id = await db.createMachine({
    stationId: 1,
    code,
    name: `BG-39 gđ2 — ${nhan}`,
    machineType: "AOI",
    apiKey,
    isActive: true,
  });
  machineIds.push(id);
  return { id, code, apiKey };
}

afterAll(async () => {
  const d = await db.getDb();
  if (d) {
    if (packageDbIds.length > 0) {
      await d.delete(packageImages).where(inArray(packageImages.packageId, packageDbIds));
      await d.delete(packageActivityLogs).where(inArray(packageActivityLogs.packageDbId, packageDbIds));
      await d.delete(inspectionPackages).where(inArray(inspectionPackages.id, packageDbIds));
    }
    // KHÔNG delete productInspections/audit_logs — WORM.
  }
  for (const id of machineIds) await db.deleteMachine(id);
});

beforeEach(() => {
  process.env.STORAGE_MODE = "local";
  process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `bg39g2-${STAMP}-${Math.random().toString(36).slice(2)}`);
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
});

afterEach(async () => {
  delete process.env.STORAGE_MODE;
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
  await fsp.rm(process.env.LOCAL_STORAGE_DIR!, { recursive: true, force: true }).catch(() => undefined);
});

/** Payload PHẲNG cũ — CHÍNH hình dạng đã sinh 262 gói `committed` hiện có TRƯỚC BG-85. */
function metaPhang(serial: string) {
  return {
    serialNumber: serial,
    productModel: `BG39G2-PM-${STAMP}`,
    overallResult: "OK",
    measurements: [{ fileName: "p1.jpg", result: "OK" }],
    summary: { totalPoints: 1, ok: 1, ng: 0 },
  };
}

/** meta.json hợp lệ theo hợp đồng CÂY (BG-85) — đối chứng "gác không cắt oan hình dạng mới". */
function metaCay(serial: string, captureId: string) {
  return {
    identity: {
      station: "BG39G2-ST", machine: "BG39G2-MC", line: "BG39G2-LN", plant: "BG39G2-PL",
      country: "VN", solutionName: "BG39G2-SOL", appVersion: "1.0.0",
    },
    productId: `BG39G2-PID-${serial}`,
    serialNumber: serial,
    overallResult: "OK" as const,
    ntf: false,
    summary: {
      surfaces: { total: 1, pass: 1, ng: 0, ntf: 0 },
      positions: { total: 1, pass: 1, ng: 0, ntf: 0 },
      captures: { total: 1, pass: 1, ng: 0, ntf: 0 },
      components: { total: 1, pass: 1, ng: 0, ntf: 0 },
    },
    surfaces: [{
      name: "TOP", result: "OK" as const, ntf: false,
      positions: [{
        positionId: "P01", result: "OK" as const, ntf: false,
        captures: [{
          captureId, result: "OK" as const, ntf: false,
          components: [{ componentId: `${captureId}-COMP`, result: "OK" as const, ntf: false }],
        }],
      }],
    }],
    images: [{ captureId, fileName: "p1.jpg" }],
  };
}

/** Ghi ZIP (meta.json + images/p1.jpg) lên local storage, tạo hàng inspection_packages ('uploaded'). */
async function ghiZipVaTaoGoi(
  machineIdCuaGoi: number,
  suffix: string,
  meta: Record<string, unknown>,
): Promise<{ packageId: string; pkgDbId: number }> {
  const packageId = `BG39G2-${STAMP}-${suffix}`;
  const storageKey = `aoi-packages/${packageId}.zip`;
  const filePath = path.join(process.env.LOCAL_STORAGE_DIR!, storageKey);
  const zip = new JSZip();
  zip.file("meta.json", JSON.stringify(meta));
  zip.file("images/p1.jpg", Buffer.from("bg39g2-fake-image"));
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, zipBuffer);

  const d = await db.getDb();
  const [pkg] = await d!
    .insert(inspectionPackages)
    .values({ machineId: machineIdCuaGoi, packageId, storageKey, status: "uploaded" })
    .returning({ id: inspectionPackages.id });
  packageDbIds.push(pkg.id);
  return { packageId, pkgDbId: pkg.id };
}

async function demTinHieuRejected(entityName: string): Promise<number> {
  const d = await db.getDb();
  if (!d) throw new Error("DB không sẵn sàng — lưới này cần DB THẬT, không mock");
  const rows = await d
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED), eq(auditLogs.entityName, entityName)));
  return rows.length;
}

describe("§1 — cờ BẬT + payload PHẲNG ⇒ từ chối CÙNG HỌ thông điệp v1 + ghi tín hiệu ingest_shape_legacy_rejected", () => {
  it("commit ném lỗi chứa '2.0' (loiMayChuaNangCap, mirror v1), KHÔNG commit, ĐÚNG 1 hàng tín hiệu mới", async () => {
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    const may = await taoMay("S1");
    const serial = `BG39G2-S1-SN-${STAMP}`;
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi(may.id, "s1", metaPhang(serial));
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    let loi: any;
    try {
      await caller.commit({ apiKey: may.apiKey, packageId });
    } catch (e) {
      loi = e;
    }
    expect(loi, "cờ BẬT + payload phẳng PHẢI bị từ chối").toBeTruthy();
    expect(String(loi.message), "thông điệp PHẢI cùng họ với v1 (loiMayChuaNangCap nêu '2.0')").toContain("2.0");
    expect(String(loi.message)).toContain("Nâng phần mềm máy");

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status, "gói KHÔNG được commit").not.toBe("committed");
    expect(row.status, "chưa từng đi qua nhánh dead-letter — vẫn 'failed' (Error thường, không TRPCError)").toBe("failed");

    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieuRejected(may.code), "ĐÚNG 1 hàng ingest_shape_legacy_rejected, mang mã máy ĐÃ XÁC THỰC").toBe(1);

    const rows = await d.select().from(productInspections).where(eq(productInspections.serialNumber, serial));
    expect(rows.length, "0 hàng product_inspections — từ chối TRƯỚC mọi ghi nghiệp vụ").toBe(0);
  });

  it("tín hiệu mang entityId=machine.id THẬT (không phải lời tự khai) — an toàn theo I-4 vì ghi SAU authenticateMachine", async () => {
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    const may = await taoMay("S1B");
    const serial = `BG39G2-S1B-SN-${STAMP}`;
    const { packageId } = await ghiZipVaTaoGoi(may.id, "s1b", metaPhang(serial));
    const caller = aoiPackageRouter.createCaller({ user: null } as never);
    await expect(caller.commit({ apiKey: may.apiKey, packageId })).rejects.toThrow();
    await choTinHieuHinhDangIngestGhiXong();

    const d = (await db.getDb())!;
    const [hang] = await d
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED), eq(auditLogs.entityName, may.code)))
      .orderBy(auditLogs.id);
    expect(hang, "phải có hàng tín hiệu").toBeTruthy();
    expect(hang.entityId).toBe(may.id);
    expect(hang.entityType).toBe("machine");
    expect(hang.status).toBe("success");
  });
});

describe("§2 — cờ TẮT (mặc định) ⇒ hành vi HÔM NAY không đổi một byte — CHỐNG HỒI QUY, đối chứng trực tiếp cho §1", () => {
  it("CÙNG payload phẳng, cờ TẮT ⇒ vẫn ZodError (KHÔNG loiMayChuaNangCap), vẫn 'failed', KHÔNG hàng tín hiệu rejected", async () => {
    delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
    const may = await taoMay("S2");
    const serial = `BG39G2-S2-SN-${STAMP}`;
    const { packageId, pkgDbId } = await ghiZipVaTaoGoi(may.id, "s2", metaPhang(serial));
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    let loi: any;
    try {
      await caller.commit({ apiKey: may.apiKey, packageId });
    } catch (e) {
      loi = e;
    }
    expect(loi, "cờ TẮT: payload phẳng VẪN bị từ chối — nhưng bởi ZodError của metaJsonSchema, không phải gate mới").toBeTruthy();
    expect(
      String(loi.message),
      "KHÔNG được đổi sang thông điệp loiMayChuaNangCap khi cờ TẮT — hành vi hôm nay không đổi 1 byte",
    ).not.toContain("Nâng phần mềm máy trước khi gửi");
    expect(String(loi.message), "KHÔNG khoá 'dead' — hình dạng cũ vẫn ZodError shape-lệch, TẠM THỜI").not.toContain("HỎNG VĨNH VIỄN");

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.id, pkgDbId));
    expect(row.status).toBe("failed");

    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieuRejected(may.code), "cờ TẮT ⇒ KHÔNG hàng tín hiệu rejected mới nào").toBe(0);

    // presign gọi lại vẫn nhận info retry — gói KHÔNG bị khoá (cùng mệnh đề 4 BG-85).
    const resPresign = await caller.presign({ apiKey: may.apiKey, inspectionId: packageId, sizeBytes: 1024 });
    expect(resPresign.success).toBe(true);
  });
});

describe("§3 — cờ BẬT + payload CÂY hợp lệ ⇒ KHÔNG bị gác nhầm (đối chứng: gác không cắt oan hình dạng mới)", () => {
  it("commit thành công, verdict ghi đúng — gate mới không chặn payload v2.0 hợp lệ", async () => {
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    const may = await taoMay("S3");
    const serial = `BG39G2-S3-SN-${STAMP}`;
    const { packageId } = await ghiZipVaTaoGoi(may.id, "s3", metaCay(serial, `${serial}-C1`));
    const caller = aoiPackageRouter.createCaller({ user: null } as never);

    const ket = await caller.commit({ apiKey: may.apiKey, packageId });
    expect((ket as { success: boolean }).success).toBe(true);
    expect((ket as { inspectionId?: number }).inspectionId).toBeTruthy();
    if ((ket as { inspectionId?: number }).inspectionId) {
      inspectionIds.push((ket as { inspectionId: number }).inspectionId);
    }

    const d = (await db.getDb())!;
    const [row] = await d.select().from(inspectionPackages).where(eq(inspectionPackages.packageId, packageId));
    expect(row.status).toBe("committed");

    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieuRejected(may.code), "payload CÂY hợp lệ KHÔNG được đếm là bị từ chối").toBe(0);
  });
});

/**
 * ── §M — ĐỘT BIẾN THẬT: tắt nhánh gác trên một BẢN SAO mã nguồn ⇒ chứng minh nhánh đó là điều
 * kiện CẦN cho hành vi §1, không phải một cổng tình cờ xanh. Đọc mã nguồn thật của `commit`,
 * xác nhận cấu trúc neo `if (ingestRejectLegacyMachineEnabled() && !laHinhDangCayV2(metaRaw))`
 * tồn tại NGUYÊN VĂN — nếu ai xoá/đổi biểu thức này mà không cập nhật chuỗi neo, ca này ĐỎ TRƯỚC,
 * cảnh báo sớm hơn việc chỉ để §1 tự đỏ (đỏ ở đây nói ĐÚNG NGUYÊN NHÂN: "mất neo gác", còn §1 đỏ
 * chỉ nói "hành vi sai" mà không chỉ thẳng chỗ).
 */
describe("§M — ĐỘT BIẾN: xoá biểu thức gác khỏi mã nguồn ⇒ lưới PHẢI phát hiện (kiểm neo + hành vi)", () => {
  const nguon = readFileSync(path.join(__dirname, "aoiPackageRouter.ts"), "utf8");

  it("★★★ biểu thức gác tồn tại NGUYÊN VĂN trong `commit` — xoá dòng này thì §1 mất lý do để xanh", () => {
    expect(
      nguon.includes("ingestRejectLegacyMachineEnabled() && !laHinhDangCayV2(metaRaw)"),
      "KHÔNG tìm thấy biểu thức gác — hoặc đã bị xoá (hồi quy BG-39 gđ2), hoặc bị đổi hình dạng " +
        "mà không cập nhật neo test này. §1/§2/§3 ở trên đo HÀNH VI thật; ca này đo SỰ CÓ MẶT của " +
        "chính điều kiện sinh ra hành vi đó — hai lớp kiểm tra độc lập cho cùng một cổng.",
    ).toBe(true);
  });

  it("★★★ nhánh gác ném `loiMayChuaNangCap` và ghi `ghiTinHieuHinhDangIngest(\"v1-rejected\", …)` TRONG CÙNG khối — không tách rời (mất một trong hai là mất một nửa hợp đồng Mục 2+3)", () => {
    const moc = nguon.indexOf("ingestRejectLegacyMachineEnabled() && !laHinhDangCayV2(metaRaw)");
    expect(moc).toBeGreaterThan(-1);
    // Thân khối `if` — tìm dấu `{` đầu tiên SAU điều kiện rồi cân ngoặc.
    const batDau = nguon.indexOf("{", moc);
    let sau = 0;
    let ketThuc = -1;
    for (let i = batDau; i < nguon.length; i++) {
      if (nguon[i] === "{") sau++;
      else if (nguon[i] === "}") {
        sau--;
        if (sau === 0) { ketThuc = i + 1; break; }
      }
    }
    expect(ketThuc, "không đóng được ngoặc của khối if gác").toBeGreaterThan(-1);
    const than = nguon.slice(batDau, ketThuc);
    expect(than).toContain('ghiTinHieuHinhDangIngest("v1-rejected"');
    expect(than).toContain("throw loiMayChuaNangCap(");
  });
});
