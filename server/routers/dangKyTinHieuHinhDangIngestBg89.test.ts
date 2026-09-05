/**
 * server/routers/dangKyTinHieuHinhDangIngestBg89.test.ts
 *
 * Task 3 (BG-89, docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md §7.2) — canh tín hiệu
 * ĐẾM ĐƯỢC hai hình dạng ingest (v1.x/v1.1 phẳng ↔ v2.0 cây) mà hai cửa ingest phát ra qua
 * `ghiTinHieuHinhDangIngest` → bảng `audit_logs` CÓ SẴN (KHÔNG thêm bảng/migration).
 *
 * ── ★★★ VIẾT LẠI cho I-4 (review lượt 8) — ĐIỂM GHI DỜI RA SAU XÁC THỰC ────────────────
 * Bản ĐẦU của lô BG-89 ghi tín hiệu bên trong `quyetDinhPhienBanIngest`, tức trong
 * `.transform()` của `.input()`, tức **TRƯỚC** `authenticateMachine` (xác thực nằm trong thân
 * `.mutation()`). Cả hai cửa là `publicProcedure`. Hệ quả ĐO ĐƯỢC (review lượt 8, I-4):
 *   (a) `entityName` là LỜI MÁY TỰ KHAI chưa xác thực ⇒ con số đếm GIẢ MẠO ĐƯỢC ⇒ nó không
 *       trả lời được đúng câu nó sinh ra để trả lời ("còn bao nhiêu MÁY THẬT gửi hình dạng cũ?");
 *   (b) một người gọi KHÔNG CÓ credential nào ghi được số hàng KHÔNG GIỚI HẠN vào `audit_logs`
 *       — bảng WORM cho vai `avi_app` (`REVOKE UPDATE, DELETE`, mig 0224) ⇒ **không ai dọn được**;
 *   (c) trần tốc độ khoá theo credential ĐỌC TỪ BODY và chỉ kiểm CÓ MẶT, không kiểm HỢP LỆ ⇒
 *       xoay vòng credential giả là bỏ qua trần.
 * Chính file này TỪNG khoá hành vi đó lại: 4/9 ca dùng "credential GIẢ" mà vẫn ĐÒI có hàng.
 * Một lưới xanh trên một hành vi sai là thứ giữ hành vi sai sống lâu nhất — nên bốn ca ấy nay
 * đòi ĐIỀU NGƯỢC LẠI, và chúng ĐỎ được trên mã trước bản vá (xem fix8b-report.md, chép nguyên văn).
 *
 * ── BA MỆNH ĐỀ BẮT BUỘC (brief I-4) ────────────────────────────────────────────────────
 *  1. Lượt ingest XÁC THỰC THÀNH CÔNG ⇒ có ĐÚNG MỘT hàng `ingest_shape_legacy`/`ingest_shape_v2`.
 *  2. Lượt ingest SAI apiKey ⇒ KHÔNG hàng nào.
 *  3. Hình dạng ghi ra KHỚP hình dạng `quyetDinhPhienBanIngest` đã quyết định — KHÔNG suy lại
 *     lần hai (không có nguồn sự thật thứ hai). Canh bằng §D: điểm quyết định phải THUẦN.
 *
 * ── ĐÁNH ĐỔI KHAI RÕ (§C) ──────────────────────────────────────────────────────────────
 * Sau bản vá, lượt HỎNG XÁC THỰC và lượt HỎNG ZOD **không** được đếm; và khi cờ
 * `INGEST_REJECT_LEGACY_MACHINE_ENABLED` BẬT, payload v1.x bị `loiMayChuaNangCap` ném NGAY
 * trong `.input()` (trước xác thực) nên cũng **không** được đếm. Đây là đánh đổi CÓ CHỦ Ý:
 * câu hỏi cần trả lời là "còn bao nhiêu MÁY THẬT gửi hình dạng cũ" — máy chưa xác thực không
 * phải máy thật; và câu hỏi ấy được hỏi để QUYẾT ĐỊNH có bật cờ hay không, tức khi cờ còn TẮT
 * (mặc định hôm nay). §C ghim cả hai chiều bằng SELECT thật để không ai khai ngược lại mà
 * không làm lưới đỏ.
 *
 * ── ★ CÔ LẬP ───────────────────────────────────────────────────────────────────────────
 * Mỗi ca tạo MÁY RIÊNG (mã duy nhất theo STAMP) và đếm theo `entityName` = mã máy ĐÃ XÁC THỰC
 * ⇒ số đếm là số TUYỆT ĐỐI, không phải delta, không lệ thuộc các tệp test chạy song song.
 * Mọi ca gọi ĐÚNG router thật (`machineApiRouter.createCaller`) rồi SELECT lại `audit_logs`
 * bằng `db.getDb()` (vai `avi_app`, DB `aoi_management_test`) — không spy/mock hàm ghi log.
 * `audit_logs` + `product_inspections` đều WORM ⇒ hàng do file này tạo ở lại VĨNH VIỄN (afterAll).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { auditLogs } from "../../drizzle/schema";
import {
  machineApiRouter,
  choTinHieuHinhDangIngestGhiXong,
  ghiTinHieuHinhDangIngest,
  ingestRejectLegacyMachineEnabled,
} from "./machineApiRouters";
import { AUDIT_ACTIONS } from "../services/auditTrailService";
import type { TrpcContext } from "../_core/context";

const STAMP = `${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
function caller() {
  return machineApiRouter.createCaller(ctx());
}

/** Một MÁY THẬT riêng cho từng ca — mã máy là nhãn đếm, nên phải duy nhất. */
async function taoMay(nhan: string): Promise<{ id: number; code: string; apiKey: string }> {
  const code = `BG89-${nhan}-${STAMP}`;
  const apiKey = `BG89-KEY-${nhan}-${STAMP}`;
  const id = await db.createMachine({
    stationId: 1,
    code,
    name: `BG-89/I-4 — ${nhan}`,
    machineType: "AOI",
    apiKey,
    isActive: true,
  });
  return { id, code, apiKey };
}

/** SELECT THẬT trên `audit_logs` — đếm đúng hàng khớp `action` + `entityName`. */
async function demTinHieu(action: string, entityName: string): Promise<number> {
  const d = await db.getDb();
  if (!d) throw new Error("DB không sẵn sàng — lưới này cần DB THẬT, không mock");
  const rows = await d
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityName, entityName)));
  return rows.length;
}

/** Đọc lại NGUYÊN VẸN một hàng — đọc field thật, không chỉ đếm. */
async function docHangDauTien(action: string, entityName: string) {
  const d = await db.getDb();
  if (!d) throw new Error("DB không sẵn sàng — lưới này cần DB THẬT, không mock");
  const rows = await d
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityName, entityName)));
  return rows[0];
}

/** Payload v2.0 cây HỢP LỆ TOÀN VẸN — `identity.machine` cố tình KHÁC mã máy đã xác thực. */
function payloadCayV2(apiKey: string, tenTuKhai: string, serial: string) {
  return {
    schemaVersion: "2.0",
    apiKey,
    identity: {
      station: "BG89-ST", machine: tenTuKhai, line: "BG89-LN", plant: "BG89-PL",
      country: "VN", solutionName: "BG89-SOL", appVersion: "1.0.0",
    },
    productId: `BG89-PROD-${STAMP}`,
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
        positionId: "P1", result: "OK" as const, ntf: false,
        captures: [{
          captureId: `${serial}-C1`, result: "OK" as const, ntf: false,
          components: [{ componentId: `${serial}-COMP1`, result: "OK" as const, ntf: false }],
        }],
      }],
    }],
  };
}

beforeAll(() => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterAll(() => {
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  // ★ ĐO LIVE (không suy đoán): `audit_logs` WORM cho vai `avi_app` —
  // `REVOKE UPDATE, DELETE ON audit_logs FROM avi_app` (drizzle/0224_avi_app_least_privilege_
  // worm.sql:64) ⇒ DELETE ở đây ném `42501 permission denied`. Mọi hàng file này tạo ra ở lại
  // VĨNH VIỄN — ĐÚNG tính chất của một sổ đếm không ai xoá được, và cũng chính là lý do I-4
  // đòi hỏi chỉ NGƯỜI GỌI ĐÃ XÁC THỰC mới được viết vào đó.
});

beforeEach(() => {
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
});
afterEach(() => {
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
});

describe("§A — XÁC THỰC THÀNH CÔNG ⇒ ĐÚNG MỘT hàng, mang mã máy ĐÃ XÁC THỰC", () => {
  it("mệnh đề 1 — v1.x phẳng qua máy THẬT ⇒ đúng 1 hàng `ingest_shape_legacy` với entityName = mã máy ĐÃ XÁC THỰC", async () => {
    const may = await taoMay("ACCEPT-V1");
    const res = await caller().submitInspection({
      apiKey: may.apiKey,
      serialNumber: `${may.code}-SN`,
      overallResult: "OK",
      measurements: [],
    });
    expect((res as { success: boolean }).success).toBe(true);
    await choTinHieuHinhDangIngestGhiXong();
    expect(
      await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, may.code),
      "lượt ingest ĐÃ XÁC THỰC phải để lại ĐÚNG MỘT hàng đếm mang mã máy THẬT",
    ).toBe(1);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, may.code)).toBe(0);
  });

  it("mệnh đề 2 — v2.0 cây qua máy THẬT ⇒ đúng 1 hàng `ingest_shape_v2` với entityName = mã máy ĐÃ XÁC THỰC (KHÔNG phải `identity.machine` tự khai)", async () => {
    const may = await taoMay("ACCEPT-V2");
    const tenTuKhai = `${may.code}-TU-KHAI`;
    const res = await caller().submitInspection(payloadCayV2(may.apiKey, tenTuKhai, `${may.code}-SN`));
    expect((res as { success: boolean }).success).toBe(true);
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, may.code)).toBe(1);
    expect(
      await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, tenTuKhai),
      "`identity.machine` là LỜI TỰ KHAI — nó KHÔNG được là nhãn của số đếm",
    ).toBe(0);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, may.code)).toBe(0);
  });

  it("batch (3 item) qua máy THẬT ⇒ ĐÚNG 1 hàng 'cũ' — cả batch tính MỘT lần, không phải 3", async () => {
    const may = await taoMay("BATCH-OK");
    const res = await caller().submitInspectionBatch({
      apiKey: may.apiKey,
      inspections: [
        { serialNumber: `${may.code}-SN1`, overallResult: "OK", measurements: [] },
        { serialNumber: `${may.code}-SN2`, overallResult: "OK", measurements: [] },
        { serialNumber: `${may.code}-SN3`, overallResult: "OK", measurements: [] },
      ],
    });
    expect(res.results.filter((r) => r.success)).toHaveLength(3);
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, may.code)).toBe(1);
  });

  it("★★★ entityName KHÔNG còn giả mạo được — apiKey THẬT + `machineCode` bịa ⇒ hàng mang mã THẬT, 0 hàng mang nhãn bịa, `entityId` = machine.id", async () => {
    const may = await taoMay("ANTI-FORGE");
    const nhanBia = `BG89-BIA-DANH-${STAMP}`;
    await caller().submitInspection({
      apiKey: may.apiKey,
      machineCode: nhanBia, // lời tự khai — auth ưu tiên apiKey (machineAuthService.ts)
      serialNumber: `${may.code}-SN-FORGE`,
      overallResult: "OK",
      measurements: [],
    });
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, may.code)).toBe(1);
    expect(
      await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, nhanBia),
      "một máy tự khai tên KHÁC vẫn phải bị đếm dưới danh tính ĐÃ XÁC THỰC của nó",
    ).toBe(0);
    const hang = await docHangDauTien(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, may.code);
    expect(hang.entityId, "entityId phải là FK máy ĐÃ XÁC THỰC, không phải NULL").toBe(may.id);
    expect(hang.entityType).toBe("machine");
    expect(hang.status).toBe("success");
    const parsed = JSON.parse(hang.details as string) as {
      metadata?: { hinhDang?: string; coCoCheCatMayCuDangBat?: boolean };
    };
    expect(parsed.metadata?.hinhDang).toBe("v1");
    expect(typeof parsed.metadata?.coCoCheCatMayCuDangBat).toBe("boolean");
  });
});

describe("§B — CHƯA XÁC THỰC ⇒ KHÔNG hàng nào (I-4: đường ghi WORM không xác thực đã ĐÓNG)", () => {
  it("★★★ mệnh đề 2 (I-4) — v1.x phẳng, SAI apiKey ⇒ KHÔNG hàng `audit_logs` nào", async () => {
    const may = await taoMay("REJ-V1");
    const nhanTuKhai = `BG89-REJ-V1-KHAI-${STAMP}`;
    await expect(
      caller().submitInspection({
        apiKey: `${may.apiKey}-SAI`,
        machineCode: nhanTuKhai,
        serialNumber: `${nhanTuKhai}-SN`,
        overallResult: "OK",
        measurements: [],
      }),
    ).rejects.toThrow();
    await choTinHieuHinhDangIngestGhiXong();
    expect(
      await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, nhanTuKhai),
      "người gọi CHƯA XÁC THỰC ghi được một hàng vào bảng WORM `audit_logs` — không ai dọn được hàng đó (I-4)",
    ).toBe(0);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, may.code)).toBe(0);
  });

  it("★★★ v2.0 cây, SAI apiKey ⇒ KHÔNG hàng nào (nhãn tự khai `identity.machine` cũng không)", async () => {
    const nhanTuKhai = `BG89-REJ-V2-KHAI-${STAMP}`;
    await expect(
      caller().submitInspection({
        identity: { machine: nhanTuKhai },
        apiKey: "khong-ton-tai",
        surfaces: [],
      }),
    ).rejects.toThrow();
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, nhanTuKhai)).toBe(0);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, nhanTuKhai)).toBe(0);
  });

  it("★★★ batch, credential GIẢ ⇒ KHÔNG hàng nào (cửa thứ HAI, cùng lớp lỗ)", async () => {
    const nhanTuKhai = `BG89-REJ-BATCH-${STAMP}`;
    await expect(
      caller().submitInspectionBatch({
        machineCode: nhanTuKhai,
        inspections: [
          { serialNumber: `${nhanTuKhai}-SN1`, overallResult: "OK", measurements: [] },
          { serialNumber: `${nhanTuKhai}-SN2`, overallResult: "OK", measurements: [] },
        ],
      }),
    ).rejects.toThrow();
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, nhanTuKhai)).toBe(0);
  });

  it("hỏng ZOD (payload rỗng, không credential) ⇒ KHÔNG hàng nào — không còn bề mặt ghi cho payload dị dạng", async () => {
    const nhanTuKhai = `BG89-ZOD-${STAMP}`;
    await expect(caller().submitInspection({ machineCode: nhanTuKhai })).rejects.toThrow();
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, nhanTuKhai)).toBe(0);
  });
});

describe("§C — ĐÁNH ĐỔI khai rõ: cờ CẮT máy cũ BẬT ⇒ từ chối TRƯỚC xác thực ⇒ KHÔNG đếm", () => {
  it("cờ BẬT + v1.x qua máy THẬT ⇒ `loiMayChuaNangCap` (BAD_REQUEST, nêu '2.0') và KHÔNG hàng đếm nào", async () => {
    const may = await taoMay("FLAG-ON");
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    let thrown: unknown;
    try {
      await caller().submitInspection({
        apiKey: may.apiKey,
        // Khai CHÍNH mã máy thật làm nhãn: trước bản vá I-4, nhãn tự khai này ĐƯỢC ghi thẳng
        // vào `audit_logs` ⇒ ca này ĐỎ; sau bản vá không có hàng nào. Ca phân biệt được HAI mã.
        machineCode: may.code,
        serialNumber: `${may.code}-SN`,
        overallResult: "OK",
        measurements: [],
      });
      throw new Error("lẽ ra phải bị từ chối vì cờ BẬT");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("BAD_REQUEST");
    expect((thrown as TRPCError).message).toContain("2.0");
    await choTinHieuHinhDangIngestGhiXong();
    // ĐÁNH ĐỔI ĐÃ CHỌN, ghim bằng số: từ chối xảy ra trong `.input()`, TRƯỚC xác thực ⇒ không
    // đếm. Câu hỏi "còn bao nhiêu máy gửi hình dạng cũ" được hỏi để QUYẾT ĐỊNH bật cờ, tức khi
    // cờ còn TẮT. Ai muốn đếm cả nhánh bị từ chối phải dời phép từ chối ra sau xác thực — và
    // phải đọc trước docblock `submitInspectionBatchRouterInputSchema` (lỗi ném ở `.input()`
    // mới được `isPermanentSubmitError` phân loại VĨNH VIỄN, không bị WAL thử lại mãi mãi).
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, may.code)).toBe(0);
  });

  it("cờ TẮT (mặc định) + CÙNG payload, CÙNG máy ⇒ CHẤP NHẬN và ĐẾM — đối chứng cho ca trên", async () => {
    const may = await taoMay("FLAG-OFF");
    delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
    const res = await caller().submitInspection({
      apiKey: may.apiKey,
      serialNumber: `${may.code}-SN`,
      overallResult: "OK",
      measurements: [],
    });
    expect((res as { success: boolean }).success).toBe(true);
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, may.code)).toBe(1);
  });
});

describe("§D — mệnh đề 3: hình dạng ghi ra là hình dạng ĐÃ QUYẾT ĐỊNH, không suy lại lần hai", () => {
  const nguon = readFileSync(path.join(__dirname, "machineApiRouters.ts"), "utf8");

  /** Thân hàm theo NGOẶC CÂN, không theo dòng — một `if` lồng không cắt nhầm phạm vi. */
  function thanHam(ten: string): string {
    const moc = nguon.indexOf(`function ${ten}(`);
    expect(moc, `không tìm thấy \`function ${ten}(\` trong machineApiRouters.ts`).toBeGreaterThan(-1);
    const batDau = nguon.indexOf("{", moc);
    let sau = 0;
    for (let i = batDau; i < nguon.length; i++) {
      if (nguon[i] === "{") sau++;
      else if (nguon[i] === "}") {
        sau--;
        if (sau === 0) return nguon.slice(batDau, i + 1);
      }
    }
    throw new Error(`không đóng được ngoặc của \`${ten}\``);
  }

  it("★★★ `quyetDinhPhienBanIngest` THUẦN — 0 lời gọi `ghiTinHieuHinhDangIngest` trong thân nó (điểm quyết định KHÔNG kèm ghi sổ)", () => {
    const than = thanHam("quyetDinhPhienBanIngest");
    expect(than).toContain("laHinhDangCayV2(raw)"); // bộ trích thân hàm thật sự trúng đích
    expect(
      than.includes("ghiTinHieuHinhDangIngest"),
      "điểm quyết định phiên bản chạy trong `.transform()` của `.input()` — TRƯỚC `authenticateMachine`. " +
        "Ghi sổ ở đây là ghi một hàng WORM cho một người gọi CHƯA XÁC THỰC (I-4).",
    ).toBe(false);
  });

  it("★ `ghiTinHieuHinhDangIngest` chỉ có ĐÚNG BA điểm gọi — đúng hai cửa ingest (submitInspection có hai nhánh v1/v2, submitInspectionBatch một)", () => {
    const soLanXuatHien = nguon.split("ghiTinHieuHinhDangIngest(").length - 1;
    // 1 định nghĩa + 3 điểm gọi. Thêm một điểm gọi thứ tư ⇒ lưới ĐỎ và người thêm phải khai
    // nó nằm SAU `authenticateMachine` nào.
    expect(soLanXuatHien).toBe(4);
  });

  it("★ hình dạng truyền vào điểm ghi là GIÁ TRỊ ĐÃ QUYẾT ĐỊNH (`parsedInput.kind` / `hinhDangIngest`), không phải một lượt `laHinhDangCayV2` thứ hai", () => {
    // `laHinhDangCayV2` được phép xuất hiện ĐÚNG ở nơi quyết định (và trong chú thích), KHÔNG
    // ở nơi ghi: một nguồn sự thật thứ hai là cách hai con số bắt đầu lệch nhau mà không ai biết.
    const than = thanHam("ghiTinHieuHinhDangIngest");
    expect(than.includes("laHinhDangCayV2")).toBe(false);
  });
});

/**
 * ── §E — Lô 3 Mục 2 (BG-57b): tín hiệu MỚI cho lượt TỪ CHỐI ────────────────────────────────
 *
 * `ingest_shape_legacy_rejected` KHÁC hẳn `ingest_shape_legacy` (§A mệnh đề 1): hàng đó ghi khi
 * payload phẳng được **NHẬN** (cờ TẮT); hàng này ghi khi payload phẳng bị **TỪ CHỐI** (cờ BẬT).
 * Điểm gọi THẬT là `aoiPackageRouter.commit` (BG-39 gđ2, Mục 3 của lô này) — cửa ZIP xác thực
 * TRƯỚC KHI đọc `meta.json` nên gác + ghi sổ Ở ĐÓ không lặp lại lỗ I-4 (ghi WORM cho người gọi
 * CHƯA XÁC THỰC). File này chỉ canh phần DÙNG CHUNG (hằng số + hàm ghi) — hành vi ĐẦU CUỐI của
 * cửa ZIP có lưới riêng (`aoiPackageZipGacMayCu.test.ts`).
 *
 * "Đăng ký" ở đây nghĩa là: (1) hằng số tồn tại ĐÚNG chuỗi, (2) `ghiTinHieuHinhDangIngest` NHẬN
 * giá trị `"v1-rejected"` và ghi ĐÚNG action đó (không lặp lại `INGEST_SHAPE_LEGACY`), (3) hai hàm
 * dùng chung (`ghiTinHieuHinhDangIngest`/`ingestRejectLegacyMachineEnabled`) THẬT SỰ được export
 * — xoá `export` ở MỘT trong hai làm import phía trên (dòng 51-56) vỡ biên dịch NGAY, tức census
 * này đỏ TRƯỚC KHI kịp chạy assertion nào bên dưới.
 */
describe("§E — BG-57b: `ingest_shape_legacy_rejected` — hằng số + hàm ghi DÙNG CHUNG đã đăng ký", () => {
  it("AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED tồn tại, ĐÚNG chuỗi, KHÁC hai action anh em", () => {
    expect(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED).toBe("ingest_shape_legacy_rejected");
    expect(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED).not.toBe(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY);
    expect(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED).not.toBe(AUDIT_ACTIONS.INGEST_SHAPE_V2);
  });

  it("`ingestRejectLegacyMachineEnabled` được export từ machineApiRouters (Mục 3/BG-39 gđ2 cần dùng lại, không đọc process.env lần thứ hai)", () => {
    expect(typeof ingestRejectLegacyMachineEnabled).toBe("function");
    delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
    expect(ingestRejectLegacyMachineEnabled()).toBe(false);
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    expect(ingestRejectLegacyMachineEnabled()).toBe(true);
    delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
  });

  it("★★★ `ghiTinHieuHinhDangIngest(\"v1-rejected\", …)` ghi ĐÚNG MỘT hàng `ingest_shape_legacy_rejected` — SELECT thật, không đọc giá trị trả về (hàm trả `void`)", async () => {
    const may = await taoMay("REJECTED-SIGNAL");
    ghiTinHieuHinhDangIngest("v1-rejected", { id: may.id, code: may.code }, "1.1");
    await choTinHieuHinhDangIngestGhiXong();

    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED, may.code)).toBe(1);
    // KHÔNG lặp lại ghi vào hai action anh em — một hàng, một action.
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, may.code)).toBe(0);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, may.code)).toBe(0);

    const hang = await docHangDauTien(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY_REJECTED, may.code);
    expect(hang.entityId, "entityId phải là FK máy ĐÃ XÁC THỰC").toBe(may.id);
    expect(hang.entityType).toBe("machine");
    expect(hang.status).toBe("success");
    const parsed = JSON.parse(hang.details as string) as {
      metadata?: { hinhDang?: string; schemaVersionKhai?: string | null };
    };
    expect(parsed.metadata?.hinhDang).toBe("v1-rejected");
    expect(parsed.metadata?.schemaVersionKhai).toBe("1.1");
  });
});
