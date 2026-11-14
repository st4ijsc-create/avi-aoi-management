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
 *
 * ★ TỆP NÀY CHẠM `_test` (đuôi `.db.test.ts`): `audit_logs` và `product_inspections` là bảng WORM (mig 0224: avi_app KHÔNG có DELETE) ⇒
 *   toàn bộ fixture (máy) + hàng do ingest tạo (hàng audit đếm hình dạng, bản ghi kiểm, …) nằm trong MỘT giao dịch drizzle mở suốt tệp
 *   kết thúc bằng ROLLBACK. Router ingest, `ghiTinHieuHinhDangIngest` → `logCrudOperation` → `createAuditLog`, `authenticateMachine`, `wipIngest`
 *   đều lấy kết nối qua `getDb` của `../db/connection` (mock trả `tx`) — không giao dịch riêng, không kết nối riêng, không hàng đợi ghi nền
 *   ngoài tx ⇒ không tự COMMIT. Phần thuần (§D, §E hằng số) nằm ở `dangKyTinHieuHinhDangIngestBg89.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { auditLogs, machines, productInspections } from "../../drizzle/schema";
import {
  machineApiRouter,
  choTinHieuHinhDangIngestGhiXong,
  ghiTinHieuHinhDangIngest,
} from "./machineApiRouters";
import { AUDIT_ACTIONS } from "../services/auditTrailService";
import type { TrpcContext } from "../_core/context";


// ═════════════════════════════════════════════════════════════════
// GIAO DỊCH HOÀN TÁC — mẫu server/db/statisticsScope.test.ts + aiAnalyticsMachineType.db.test.ts
// ═════════════════════════════════════════════════════════════════
// `getDb` (mock) trả về `tx` của MỘT giao dịch drizzle mở suốt tệp; hàm `db.create*` / `createProductInspection` tự mở `transaction(...)`:
// trên `tx` việc đó thành SAVEPOINT (không COMMIT giao dịch ngoài) nên ROLLBACK cuối cùng hoàn tác TẤT CẢ hàng đã chèn.
// Không DELETE, không TRUNCATE, không owner `aoi`. Không có DATABASE_URL ⇒ cả nhóm bị bỏ qua (skipIf).
const DB_URL = process.env.DATABASE_URL;
class HoanTacCuoiTep extends Error {}
const holder: { db: unknown } = { db: null };
vi.mock("../db/connection", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDb: async () => holder.db,
}));
/** id các hàng đã chèn — để chứng minh (a) ca THẬT SỰ ghi trong giao dịch, (b) sau ROLLBACK không còn hàng nào. */
const daChen: Record<string, number[]> = {};
const ghiNho = (khoa: string, id: number): number => {
  (daChen[khoa] ??= []).push(id);
  return id;
};
let phienGiaoDich: ReturnType<typeof postgres> | null = null;
let moKhoaHoanTac: () => void = () => undefined;
let giaoDichXong: Promise<void> = Promise.resolve();

async function moGiaoDichHoanTac(): Promise<void> {
  phienGiaoDich = postgres(DB_URL!, { max: 1, onnotice: () => undefined });
  const choHoanTac = new Promise<void>((xong) => {
    moKhoaHoanTac = xong;
  });
  await new Promise<void>((sanSang, thatBai) => {
    giaoDichXong = drizzle(phienGiaoDich!)
      .transaction(async (tx) => {
        holder.db = tx;
        sanSang();
        await choHoanTac;
        throw new HoanTacCuoiTep();
      })
      .then(
        () => undefined,
        (e: unknown) => {
          if (!(e instanceof HoanTacCuoiTep)) thatBai(e);
        },
      );
  });
}

beforeAll(async () => {
  if (!DB_URL) return;
  await moGiaoDichHoanTac();
}, 120_000);

afterAll(async () => {
  holder.db = null;
  moKhoaHoanTac();
  await giaoDichXong;
  if (phienGiaoDich) await phienGiaoDich.end({ timeout: 5 });
  // (b) NGOÀI giao dịch, bằng kết nối RIÊNG sau ROLLBACK: mọi hàng của chính lượt này KHÔNG còn. Đếm theo id đã chèn
  // (id từ sequence không tái dùng) nên không nhiễu bởi tệp khác chạy song song.
  if (DB_URL) {
    const ngoai = postgres(DB_URL, { max: 1, onnotice: () => undefined });
    try {
      for (const [bang, cot, ids] of [
        ["machines", "id", daChen.machineIds],
      ] as Array<[string, string, number[] | undefined]>) {
        if (!ids || ids.length === 0) continue;
        const n = Number((await ngoai.unsafe(`SELECT count(*)::int AS n FROM ${bang} WHERE "${cot}" = ANY($1::bigint[])`, [ids as never]))[0].n);
        expect(n, `${bang} sau ROLLBACK`).toBe(0);
      }

      for (const [bang, cot] of [
        ["audit_logs", "entityId"],
        ["product_inspections", "machineId"],
      ] as const) {
        const ids = daChen.machineIds ?? [];
        if (ids.length === 0) continue;
        const n = Number((await ngoai.unsafe(`SELECT count(*)::int AS n FROM ${bang} WHERE "${cot}" = ANY($1::bigint[])`, [ids as never]))[0].n);
        expect(n, `${bang} sau ROLLBACK`).toBe(0);
      }
    } finally {
      await ngoai.end({ timeout: 5 });
    }
  }
}, 60_000);

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
  ghiNho("machineIds", id);
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
  // `audit_logs` / `product_inspections` WORM cho vai `avi_app` ⇒ KHÔNG dọn bằng DELETE; giao dịch ROLLBACK của khung phía trên hoàn tác mọi hàng.
});

beforeEach(() => {
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
});
afterEach(() => {
  delete process.env.INGEST_REJECT_LEGACY_MACHINE_ENABLED;
});

describe.skipIf(!DB_URL)("§A — XÁC THỰC THÀNH CÔNG ⇒ ĐÚNG MỘT hàng, mang mã máy ĐÃ XÁC THỰC", () => {
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

describe.skipIf(!DB_URL)("§B — CHƯA XÁC THỰC ⇒ KHÔNG hàng nào (I-4: đường ghi WORM không xác thực đã ĐÓNG)", () => {
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

describe.skipIf(!DB_URL)("§C — ĐÁNH ĐỔI khai rõ: cờ CẮT máy cũ BẬT ⇒ từ chối TRƯỚC xác thực ⇒ KHÔNG đếm", () => {
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

describe.skipIf(!DB_URL)("§E — BG-57b (phần ghi thật): `ingest_shape_legacy_rejected` ghi ĐÚNG MỘT hàng", () => {
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

describe.skipIf(!DB_URL)("(a) các ca THẬT SỰ ghi trong giao dịch (đếm qua tx, trước ROLLBACK)", () => {
  it("8 máy đã chèn, 6 hàng audit_logs đếm hình dạng mang entityId = các máy ấy, 7 bản ghi kiểm do ingest tạo", async () => {
    // Máy: ACCEPT-V1, ACCEPT-V2, BATCH-OK, ANTI-FORGE, REJ-V1, FLAG-ON, FLAG-OFF, REJECTED-SIGNAL = 8.
    // Hàng audit (mỗi ca xác thực thành công đúng 1 hàng, ca bị từ chối 0): V1, V2, BATCH, FORGE, FLAG-OFF, REJECTED-SIGNAL = 6.
    // Bản ghi kiểm: V1 1 + V2 1 + BATCH 3 + FORGE 1 + FLAG-OFF 1 = 7.
    const d = (await db.getDb())!;
    const ids = daChen.machineIds;
    expect(ids).toHaveLength(8);
    expect((await d.select({ id: machines.id }).from(machines).where(inArray(machines.id, ids))).length).toBe(8);
    expect((await d.select({ id: auditLogs.id }).from(auditLogs).where(inArray(auditLogs.entityId, ids))).length).toBe(6);
    expect((await d.select({ id: productInspections.id }).from(productInspections).where(inArray(productInspections.machineId, ids))).length).toBe(7);
  });
});
