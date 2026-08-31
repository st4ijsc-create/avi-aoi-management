/**
 * server/routers/dangKyTinHieuHinhDangIngestBg89.test.ts
 *
 * Task 3 (BG-89, docs/superpowers/specs/2026-09-01-aoi-chuan-goi-anh.md §7.2 + task-3-brief.md)
 * — canh tín hiệu ĐẾM ĐƯỢC hai hình dạng ingest (v1.x/v1.1 phẳng ↔ v2.0 cây) mà
 * `quyetDinhPhienBanIngest` (`server/routers/machineApiRouters.ts`) phát ra qua
 * `ghiTinHieuHinhDangIngest` → bảng `audit_logs` CÓ SẴN (KHÔNG thêm bảng/migration).
 *
 * ── VẤN ĐỀ ĐANG ĐÓNG ────────────────────────────────────────────────────────────────────
 * Trước bản vá: `quyetDinhPhienBanIngest`/`loiMayChuaNangCap` không log/counter/audit ở CẢ
 * HAI trạng thái cờ ⇒ câu hỏi vận hành "còn bao nhiêu máy gửi hình dạng cũ?" không trả lời
 * được từ mã. File này canh rằng câu trả lời NAY đọc được bằng một SELECT thật trên
 * `audit_logs` (action IN ('ingest_shape_legacy','ingest_shape_v2')).
 *
 * ── BỐN MỆNH ĐỀ (task-3-brief.md) ──────────────────────────────────────────────────────
 *  1. Gửi một gói hình dạng CŨ ⇒ tín hiệu đếm được tăng đúng 1 ở nhóm "cũ".
 *  2. Gửi một gói hình dạng MỚI ⇒ tăng đúng 1 ở nhóm "mới".
 *  3. ★ CHỐNG TỰ THOẢ — lưới khẳng định nó ĐỌC ĐƯỢC tín hiệu THẬT (SELECT/đếm ra số), không
 *     phải chỉ khẳng định "hàm log được gọi". MỌI ca dưới đây gọi ĐÚNG router thật
 *     (`machineApiRouter.createCaller(...)`, KHÔNG gọi thẳng hàm nội bộ không export) rồi
 *     SELECT lại `audit_logs` bằng `db.getDb()` (vai `avi_app`, DB `aoi_management_test`) —
 *     không spy/mock hàm ghi log ở đâu trong file này.
 *  4. (BG-88, tài liệu chuẩn nén) — canh ở lưới RIÊNG, xem
 *     `server/routers/taiLieuMetaJsonKhopHopDong.test.ts` (đã dùng lại, không viết bộ canh
 *     thứ hai).
 *
 * ── ★ GHI Ở CẢ HAI TRẠNG THÁI CỜ ────────────────────────────────────────────────────────
 * Hai ca "cờ TẮT"/"cờ BẬT" dùng CÙNG một payload v1.x hợp lệ hình dạng (chỉ khác cờ
 * `INGEST_REJECT_LEGACY_MACHINE_ENABLED`) để chứng minh: cờ TẮT ⇒ request thất bại vì
 * credential giả (KHÔNG liên quan gì tới điều đang canh) nhưng tín hiệu vẫn tăng; cờ BẬT ⇒
 * request thất bại RÕ RÀNG vì `loiMayChuaNangCap` (thông điệp nêu "2.0") và tín hiệu VẪN
 * tăng — nếu chỉ đếm nhánh "được nhận", câu hỏi sẽ CÂM đúng lúc cờ bật.
 *
 * ── ★ CÔ LẬP, KHÔNG CHẠM WORM (đa số ca) ───────────────────────────────────────────────
 * `ghiTinHieuHinhDangIngest` chạy TRONG `.transform()` của `.input()`, TRƯỚC
 * `authenticateMachine` (nằm trong thân `.mutation()`). Đa số ca ở đây dùng credential GIẢ
 * (apiKey/machineCode chưa đăng ký) — request luôn thất bại ở xác thực/parse SAU KHI tín
 * hiệu đã ghi, nên KHÔNG BAO GIỜ chạm `product_inspections` (WORM, migration 0279). Hai ca
 * "CHẤP NHẬN TOÀN VẸN" (mệnh đề 1b/2b) dùng MỘT máy THẬT đăng ký ở `beforeAll` và để lại
 * ĐÚNG HAI hàng `product_inspections` vĩnh viễn — cùng quy ước các file test AOI khác trong
 * thư mục này (`aoiPackageBaLoToanVenBg87.test.ts`, `ingestV2XuyenSuot.db.test.ts`).
 * ★ ĐO LIVE (không phải suy đoán): `audit_logs` CŨNG WORM cho vai `avi_app` —
 * `REVOKE UPDATE, DELETE ON audit_logs FROM avi_app` (drizzle/0224_avi_app_least_privilege_
 * worm.sql:64). Mọi hàng file này tạo ra ở lại VĨNH VIỄN — xem `afterAll`.
 *
 * ── Đột biến bắt buộc (xem task-3-report.md) ────────────────────────────────────────────
 * Gỡ dòng `ghiTinHieuHinhDangIngest(laCay ? "v2" : "v1", raw);` khỏi `quyetDinhPhienBanIngest`
 * ⇒ mệnh đề 1 VÀ 2 phải ĐỎ. Đã tự tay xác nhận thủ công (không phải test tự động trong file
 * này — hàm không export, không thể mutate trong bộ nhớ như `cuaIngestScan.ts` §5), chép
 * nguyên văn trong báo cáo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { auditLogs } from "../../drizzle/schema";
import { machineApiRouter, choTinHieuHinhDangIngestGhiXong } from "./machineApiRouters";
import { AUDIT_ACTIONS } from "../services/auditTrailService";
import type { TrpcContext } from "../_core/context";

const STAMP = `${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const API_KEY = `BG89-KEY-${STAMP}`;
const MACHINE_CODE = `BG89-MC-${STAMP}`;

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

/** Đọc lại NGUYÊN VẸN một hàng — dùng cho mệnh đề 3 (đọc field thật, không chỉ đếm). */
async function docHangDauTien(action: string, entityName: string) {
  const d = await db.getDb();
  if (!d) throw new Error("DB không sẵn sàng — lưới này cần DB THẬT, không mock");
  const rows = await d
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityName, entityName)));
  return rows[0];
}

beforeAll(async () => {
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
  await db.createMachine({
    stationId: 1,
    code: MACHINE_CODE,
    name: "Task 3 (BG-89) — tín hiệu đếm hình dạng ingest",
    machineType: "AOI",
    apiKey: API_KEY,
    isActive: true,
  });
});

afterAll(() => {
  delete process.env.MACHINE_SHARED_KEY_ALLOWED;
  // ★ SỬA LẠI SO VỚI DỰ TÍNH BAN ĐẦU (đo LIVE, không phải suy đoán): `audit_logs` CŨNG WORM
  // — `REVOKE UPDATE, DELETE ON audit_logs FROM avi_app` (drizzle/0224_avi_app_least_privilege_
  // worm.sql:64) — chạy DELETE ở đây ném `PostgresError 42501 permission denied for table
  // audit_logs`, ĐO ĐƯỢC bằng cách chạy file này (không phải đọc migration rồi đoán). Mọi hàng
  // `ingest_shape_legacy`/`ingest_shape_v2` do file này tạo ở lại VĨNH VIỄN — ĐÚNG tính chất
  // mong muốn của một sổ đếm không ai xoá được. KHÔNG xoá machine/product_inspections cũng vì
  // lý do tương tự (WORM, xem docblock đầu file).
});

beforeEach(() => {
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
});
afterEach(() => {
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
});

describe("Task 3 (BG-89) — tín hiệu ĐẾM ĐƯỢC hai hình dạng ingest, đọc bằng SELECT thật", () => {
  it("mệnh đề 1 — gửi payload v1.x (phẳng, credential GIẢ) qua submitInspection THẬT ⇒ audit_logs['ingest_shape_legacy'] tăng đúng 1", async () => {
    const ten = `BG89-REJ-V1-${STAMP}`;
    await expect(
      caller().submitInspection({ machineCode: ten, apiKey: "khong-ton-tai" }),
    ).rejects.toThrow();
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, ten)).toBe(1);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, ten)).toBe(0);
  });

  it("mệnh đề 2 — gửi payload v2.0 (cây, credential GIẢ) qua submitInspection THẬT ⇒ audit_logs['ingest_shape_v2'] tăng đúng 1", async () => {
    const ten = `BG89-REJ-V2-${STAMP}`;
    await expect(
      caller().submitInspection({
        identity: { machine: ten },
        apiKey: "khong-ton-tai",
        surfaces: [], // Array.isArray ⇒ laHinhDangCayV2=true, đủ để định tuyến "v2" — phần còn
        // lại của payload KHÔNG cần hợp lệ (machineDataContractV2.parse ném SAU khi tín hiệu
        // đã ghi — đúng thứ tự thật trong `quyetDinhPhienBanIngest`).
      }),
    ).rejects.toThrow();
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, ten)).toBe(1);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, ten)).toBe(0);
  });

  it("★ CẢ HAI trạng thái cờ — cờ TẮT (mặc định): v1.x HỢP LỆ HÌNH DẠNG, credential giả thất bại ở auth ⇒ vẫn đếm 'cũ'", async () => {
    const ten = `BG89-FLAG-OFF-${STAMP}`;
    delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
    let thrown: unknown;
    try {
      await caller().submitInspection({
        apiKey: `${ten}-FAKE-KEY`,
        machineCode: ten,
        serialNumber: `${ten}-SN`,
        overallResult: "OK",
        measurements: [],
      });
      throw new Error("lẽ ra phải bị từ chối vì credential giả");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    // Cờ TẮT ⇒ đây PHẢI là lỗi AUTH (credential giả), KHÔNG PHẢI loiMayChuaNangCap.
    expect((thrown as TRPCError).message).not.toContain("2.0");
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, ten)).toBe(1);
  });

  it("★ CẢ HAI trạng thái cờ — cờ BẬT: CÙNG payload v1.x bị TỪ CHỐI bằng `loiMayChuaNangCap` (KHÔNG phải lỗi auth) ⇒ vẫn đếm 'cũ'", async () => {
    const ten = `BG89-FLAG-ON-${STAMP}`;
    process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED = "true";
    let thrown: unknown;
    try {
      await caller().submitInspection({
        apiKey: `${ten}-FAKE-KEY`,
        machineCode: ten,
        serialNumber: `${ten}-SN`,
        overallResult: "OK",
        measurements: [],
      });
      throw new Error("lẽ ra phải bị từ chối vì cờ BẬT");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("BAD_REQUEST");
    // ĐÚNG là loiMayChuaNangCap (nêu rõ "2.0" cần) — KHÔNG phải request đơn giản bị auth chặn
    // (chứng minh gói bị từ chối TRƯỚC KHI kịp chạm authenticateMachine, xem docblock hàm).
    expect((thrown as TRPCError).message).toContain("2.0");
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, ten)).toBe(1);
  });

  it("submitInspectionBatch (3 item, credential GIẢ) ⇒ ĐÚNG 1 tín hiệu 'cũ' — cả batch tính MỘT lần, không phải 3", async () => {
    const ten = `BG89-BATCH-${STAMP}`;
    await expect(
      caller().submitInspectionBatch({
        machineCode: ten,
        inspections: [
          { serialNumber: `${ten}-SN1`, overallResult: "OK", measurements: [] },
          { serialNumber: `${ten}-SN2`, overallResult: "OK", measurements: [] },
          { serialNumber: `${ten}-SN3`, overallResult: "OK", measurements: [] },
        ],
      }),
    ).rejects.toThrow(); // machineCode chưa đăng ký ⇒ auth thất bại SAU khi tín hiệu đã ghi
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, ten)).toBe(1);
  });

  it("mệnh đề 1b — v1.x HỢP LỆ TOÀN VẸN qua máy THẬT (cờ TẮT) ⇒ CHẤP NHẬN (200) VÀ vẫn đếm 'cũ' đúng 1", async () => {
    const ten = `BG89-ACCEPT-V1-${STAMP}`;
    const res = await caller().submitInspection({
      apiKey: API_KEY, // máy THẬT, đã đăng ký ở beforeAll — auth THÀNH CÔNG
      machineCode: ten, // chỉ dùng làm nhãn đếm (auth ưu tiên apiKey — xem machineAuthService.ts)
      serialNumber: `${ten}-SN`,
      overallResult: "OK",
      measurements: [],
    });
    expect(res.success).toBe(true);
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, ten)).toBe(1);
  });

  it("mệnh đề 2b — v2.0 (cây) HỢP LỆ TOÀN VẸN qua máy THẬT (cờ TẮT) ⇒ CHẤP NHẬN VÀ vẫn đếm 'mới' đúng 1", async () => {
    const ten = `BG89-ACCEPT-V2-${STAMP}`;
    const res = await caller().submitInspection({
      schemaVersion: "2.0",
      apiKey: API_KEY,
      identity: {
        station: "BG89-ST", machine: ten, line: "BG89-LN", plant: "BG89-PL",
        country: "VN", solutionName: "BG89-SOL", appVersion: "1.0.0",
      },
      productId: `BG89-PROD-${STAMP}`,
      serialNumber: `${ten}-SN`,
      overallResult: "OK",
      ntf: false,
      summary: {
        surfaces: { total: 1, pass: 1, ng: 0, ntf: 0 },
        positions: { total: 1, pass: 1, ng: 0, ntf: 0 },
        captures: { total: 1, pass: 1, ng: 0, ntf: 0 },
        components: { total: 1, pass: 1, ng: 0, ntf: 0 },
      },
      surfaces: [{
        name: "TOP", result: "OK", ntf: false,
        positions: [{
          positionId: "P1", result: "OK", ntf: false,
          captures: [{
            captureId: `${ten}-C1`, result: "OK", ntf: false,
            components: [{ componentId: `${ten}-COMP1`, result: "OK", ntf: false }],
          }],
        }],
      }],
    });
    expect((res as { success: true; inspectionId: number }).success).toBe(true);
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, ten)).toBe(1);
  });

  it("★★★ mệnh đề 3 (CHỐNG TỰ THOẢ) — đọc lại NGUYÊN VẸN hàng thật, không chỉ đếm số hàng", async () => {
    const ten = `BG89-DETAIL-${STAMP}`;
    await expect(
      caller().submitInspection({ machineCode: ten, apiKey: "khong-ton-tai" }),
    ).rejects.toThrow();
    await choTinHieuHinhDangIngestGhiXong();

    const hang = await docHangDauTien(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, ten);
    expect(hang, "hàng audit_logs không tồn tại — SELECT thật trả rỗng").toBeDefined();
    expect(hang.action).toBe("ingest_shape_legacy");
    expect(hang.entityType).toBe("machine");
    expect(hang.entityName).toBe(ten);
    expect(hang.status).toBe("success");
    expect(typeof hang.details).toBe("string");
    const parsed = JSON.parse(hang.details as string) as {
      metadata?: { hinhDang?: string; coCoCheCatMayCuDangBat?: boolean };
    };
    expect(parsed.metadata?.hinhDang).toBe("v1");
    expect(typeof parsed.metadata?.coCoCheCatMayCuDangBat).toBe("boolean");
  });

  it("hai hình dạng KHÔNG lẫn vào nhau — cùng STAMP nhưng entityName khác nhau, action đúng nhóm của nó", async () => {
    const tenV1 = `BG89-NOMIX-V1-${STAMP}`;
    const tenV2 = `BG89-NOMIX-V2-${STAMP}`;
    await expect(caller().submitInspection({ machineCode: tenV1, apiKey: "khong-ton-tai" })).rejects.toThrow();
    await expect(
      caller().submitInspection({ identity: { machine: tenV2 }, apiKey: "khong-ton-tai", surfaces: [] }),
    ).rejects.toThrow();
    await choTinHieuHinhDangIngestGhiXong();
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, tenV1)).toBe(1);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, tenV1)).toBe(0);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_V2, tenV2)).toBe(1);
    expect(await demTinHieu(AUDIT_ACTIONS.INGEST_SHAPE_LEGACY, tenV2)).toBe(0);
  });
});
