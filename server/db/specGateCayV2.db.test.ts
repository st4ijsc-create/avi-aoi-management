/**
 * server/db/specGateCayV2.db.test.ts
 *
 * Khối B — **Task 4 (B-5)**: nối lại **spec-gate** cho đường v2 (**BG-92**). Ghi THẬT,
 * DB test, vai **`avi_app`** (KHÔNG phải `aoi`: superuser + BYPASSRLS làm mọi phép đo
 * quyền XANH GIẢ), đi qua **CẢ HAI CỬA THẬT** — `machineApiRouter.submitInspection`
 * (v2.0 trực tiếp) và `aoiPackageRouter.commit` (ZIP). Gọi thẳng `taoCongSpecCayV2`
 * chỉ chứng minh HÀM chạy; nó KHÔNG chứng minh cửa gắn máy đã xác thực + bản dạy
 * đúng sản phẩm vào phép chấm, và cửa ZIP CHÍNH LÀ nơi `evaluatePointResult` bị
 * đánh rơi ở `df20b31c` (BG-85).
 *
 * ── LỖ ĐANG VÁ (đo được, không phải giả thuyết) ─────────────────────────────
 * Trước bản vá, trên MỌI đường v2: linh kiện có `value` NGOÀI giới hạn đã dạy mà máy
 * khai `OK` ⇒ hệ ghi `OK`. Bo XẤU đi lọt. Vì đó là năng lực **VẮNG MẶT** (0 lời gọi)
 * chứ không phải lỗi logic, KHÔNG lưới nào đỏ. Mệnh đề 1B đo lại chính hành vi đó
 * (ABLATION bằng `POINT_LIMIT_EVAL_ENABLED=false` — cùng mã, cổng tắt = hành vi
 * TRƯỚC bản vá) để "trước đó nó lọt" là một CON SỐ, không phải một câu kể.
 *
 * ── ⛔ CÁI BẪY: "TRA KHÔNG RA" KHÔNG PHẢI "ĐẠT" ─────────────────────────────
 * Đo 2026-09-03, vai `avi_app`, cả hai DB:
 *   `machine_template_versions` = 0 · `product_captures` = 0
 *   `measurement_point_defs` hàng CÂY còn sống = 0
 * ⇒ ngày bật, phần lớn linh kiện TRA KHÔNG RA. Một cổng coi đó là "đạt" là **giấy
 * vô can giả** — xanh trong khi không kiểm gì. Mệnh đề 2 ghim ba trạng thái tách rời
 * và ghim bất biến phân hoạch `tong = dat + truot + chuaDay + khongGioiHan + tatCong`.
 *
 * ── ⚠⚠ NỀN ĐO ĐƯỢC LÀM THAY ĐỔI CÁCH DỰNG LƯỚI NÀY ─────────────────────────
 * Hợp đồng cây dạy (`machineTemplateContract.componentTemplate`) KHÔNG mang trường
 * giới hạn nào, nên `ghiComponent` (`server/db/cayDay.ts`) tạo point-def với MỌI cột
 * giới hạn NULL. Lưới này vì thế phải **SOẠN giới hạn bằng `UPDATE`** sau lượt đẩy cây
 * — đúng bằng cách kỹ sư soạn ở UI điểm đo, và đúng bằng cách đường v1.x vận hành hôm
 * nay. Đây KHÔNG phải mẹo dựng lưới: nó là hình dạng thật của quy trình.
 *
 * ── SÁU MỆNH ĐỀ ────────────────────────────────────────────────────────────
 *  1.  Linh kiện `value` NGOÀI giới hạn ĐÃ DẠY mà máy khai `OK` ⇒ **BỊ BẮT**: hàng
 *      `measurement_results` thành `NG` + `remark LIKE 'Spec gate%'`, capture cha cuộn
 *      `NG`, và `product_inspections.overallResult='NG'` trong khi `originalResult='OK'`.
 *  1B. **ABLATION** — CÙNG payload, cổng TẮT ⇒ bo lưu `OK`, 0 hàng `Spec gate%`.
 *      Đây là bằng chứng "trước bản vá nó LỌT", đo trên cùng một lượt chạy.
 *  2.  **BA TRẠNG THÁI** phân biệt được và đếm được — `chuaDay` và `khongGioiHan`
 *      KHÔNG được cộng vào `dat`; đếm lại bằng `SELECT` trên `remark`, không chỉ tin
 *      giá trị cửa trả về.
 *  3.  **CHỐNG HỒI QUY** — đường **v1.x** (điểm gọi DUY NHẤT trước bản vá) không đổi
 *      hành vi: cùng máy, cùng sản phẩm, điểm PHẲNG có limit ⇒ vẫn hạ `OK`→`NG`.
 *  4.  **CHỐNG HỒI QUY** — verdict của MỌI bo đã có (gồm mọi gói `committed`) không
 *      đổi một byte: `md5(id:overallResult)` trước/sau bằng nhau, nền > 100 bo.
 *  5.  **CỬA ZIP** (`aoiPackageRouter.commit`) chấm y hệt — "chung mã" là LỜI KHAI.
 *  6.  **MONOTONIC** — cổng KHÔNG BAO GIỜ nâng `NG` lên `OK`: máy khai `NG` mà trị đo
 *      NẰM TRONG giới hạn ⇒ vẫn `NG`.
 *
 * ── WORM và dấu chân để lại (ĐỌC TRƯỚC KHI SỬA) ────────────────────────────
 * `product_inspections` và `audit_logs` là WORM: `avi_app` chỉ có INSERT/SELECT. Lưới
 * này **KHÔNG** viết `DELETE ... .catch(() => {})` ở đâu cả (32 file test khác làm thế;
 * tất cả là no-op câm). Dọn THẬT 100% bảng có DELETE; CỐ Ý để lại các hàng
 * `product_inspections`, `product_models`, và cây thiết bị (factory→machine) bị khoá
 * bởi FK RESTRICT từ chúng.
 * ⚠ Lưới dựng MÁY RIÊNG thay vì `SELECT id FROM machines ORDER BY id LIMIT 2` — mối lo
 * #7 báo cáo Task 3: khuôn "hai tệp cùng giành hai máy đầu bảng" làm lưới đỏ vì hàng xóm.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import JSZip from "jszip";
import postgres from "postgres";
import { machineApiRouter } from "../routers/machineApiRouters";
import { aoiPackageRouter } from "../routers/aoiPackageRouter";
import { issueMachineKey } from "../services/machineAuthService";
import {
  NHAN_CONG_DAT, NHAN_CONG_KHONG_KET_LUAN, TIEN_TO_CONG_CHUNG, TIEN_TO_CONG_TRUOT,
} from "../services/specGateCayV2";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";
const CO_MAU = existsSync(MAU_MAY_THAT);
const RUN = `T4${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const MA_SP = `T4-${RUN}`;
/**
 * ⚠ SẢN PHẨM THỨ HAI, BẮT BUỘC: `submitMachineTemplate` cưỡng chế bất biến "một sản
 * phẩm HOẶC đã chuyển sang cây, HOẶC còn phẳng" (`demDiemDoTheoNeo`, PRECONDITION_FAILED
 * — đo được khi lưới này dựng lần đầu). Nên điểm đo PHẲNG của mệnh đề 3 (đường v1.x)
 * KHÔNG thể sống chung sản phẩm với cây dạy. Đây là hình dạng THẬT của hệ, không phải
 * mẹo dựng lưới — và nó cũng nói rằng hai đường v1.x/v2 hôm nay phục vụ HAI TẬP SẢN PHẨM.
 */
const MA_SP_V1 = `T4V1-${RUN}`;
const MA_LINH_KIEN_LA = `${RUN}-CHUA-DAY`;
/** Điểm đo PHẲNG (`captureRowId IS NULL`) cho đường v1.x — mệnh đề 3. */
const PT_PHANG_GATE = `${RUN}-PT-GATE`;
const THU_MUC_ZIP = path.join(os.tmpdir(), `khoib-t4-${RUN}`);

/** Giới hạn SOẠN TAY (kỹ sư soạn ở UI) — hợp đồng cây dạy không mang trường này. */
const CAN_DUOI = "1";
const CAN_TREN = "10";
/** Trị đo NGOÀI giới hạn — linh kiện này là cả lý do task tồn tại. */
const TRI_NGOAI = "12.5";
/** Trị đo TRONG giới hạn. */
const TRI_TRONG = "3.25";

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
let bamVerdictTruoc = "";
let moc = 0;
const ids = {
  factory: 0, workshop: 0, line: 0, station: 0, machine: 0,
  product: 0, productV1: 0, key: 0, ptPhang: 0,
};
let apiKey = "";
/** GUID linh kiện theo THỨ TỰ DUYỆT cây dạy — 0 = TRƯỢT, 1 = ĐẠT, 2 = ĐẠT(máy khai NG). */
let maTheoThuTu: string[] = [];
/** captureExtId của linh kiện #0 — dùng để kiểm `remark` nêu đích danh chỗ nào. */
let capCuaTruot = "";
const boDaGhi: number[] = [];
const goiDaGhi: number[] = [];

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const caller = () => machineApiRouter.createCaller(ctx());

/** Mẫu cây DẠY thật (2 surface / 4 position / 8 capture / 16 component). */
function mauDay(): any {
  return JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));
}

/**
 * Payload KẾT QUẢ v2.0 dựng TỪ CHÍNH cây dạy ⇒ mọi `captureId`/`componentId` khớp
 * bản dạy theo cấu tạo. `triTheoIdx`/`ketQuaTheoIdx` cho phép đặt ĐÍCH DANH trị đo và
 * lời khai của từng linh kiện theo thứ tự duyệt — đó là thứ làm từng mệnh đề có nghĩa.
 */
function ketQua(
  serial: string,
  opts: {
    triTheoIdx?: Record<number, string | number>;
    ketQuaTheoIdx?: Record<number, "OK" | "NG">;
    khaiCapBo?: "OK" | "NG";
    themLinhKienLa?: boolean;
  } = {},
): any {
  const t = mauDay();
  let idx = 0;
  const surfaces = t.surfaces.map((s: any) => ({
    name: s.surfaceName,
    result: "OK" as const,
    ntf: false,
    positions: s.positions.map((p: any) => ({
      positionId: p.positionId,
      positionNumber: p.positionIndex ?? 0,
      result: "OK" as const,
      ntf: false,
      captures: p.captures.map((c: any, ci: number) => ({
        captureId: c.id,
        captureName: c.name,
        index: ci,
        result: "OK" as const,
        ntf: false,
        components: c.components.map((k: any) => {
          const i = idx++;
          return {
            componentId: k.id,
            componentName: k.componentName,
            result: opts.ketQuaTheoIdx?.[i] ?? ("OK" as const),
            ntf: false,
            // ⚠ Trị mặc định CỐ Ý là TRONG giới hạn: một mặc định "ngoài giới hạn"
            // sẽ làm mọi mệnh đề đỏ vì lý do khác lý do nó canh.
            value: opts.triTheoIdx?.[i] ?? TRI_TRONG,
            // ⚠ MÁY CŨNG GỬI `lowerLimit`/`upperLimit` ở lá (đo mẫu thật
            // `dashboard-sample.json`: 48/48 linh kiện có). Lưới CỐ Ý gửi chúng kèm
            // trị NGOÀI giới hạn để chứng minh cổng KHÔNG đọc lời khai của máy —
            // nó chỉ đọc bản dạy. Bỏ hai dòng này thì mệnh đề 2 mất nghĩa.
            lowerLimit: CAN_DUOI,
            upperLimit: CAN_TREN,
            errorCode: null,
            errorDesc: null,
          };
        }),
      })),
    })),
  }));

  if (opts.themLinhKienLa) {
    surfaces[0].positions[0].captures[0].components.push({
      componentId: MA_LINH_KIEN_LA,
      componentName: "Linh kien chua bao gio duoc day",
      result: "OK" as const,
      ntf: false,
      value: TRI_NGOAI, // ⚠ NGOÀI giới hạn — nhưng CHƯA DẠY ⇒ KHÔNG KẾT LUẬN, KHÔNG bắt.
      lowerLimit: CAN_DUOI,
      upperLimit: CAN_TREN,
      errorCode: null,
      errorDesc: null,
    });
  }

  const dem = (n: number) => ({ total: n, pass: n, ng: 0, ntf: 0 });
  let soCap = 0, soComp = 0, soPos = 0;
  for (const s of surfaces) {
    soPos += s.positions.length;
    for (const p of s.positions) {
      soCap += p.captures.length;
      for (const c of p.captures) soComp += c.components.length;
    }
  }
  return {
    schemaVersion: "2.0",
    apiKey,
    identity: {
      station: "AIC-MA3", machine: "ASSY 04", line: "JUNIPER", plant: "FAC-HN",
      country: "VN", solutionName: "MODEL-X-SOLUTION", appVersion: "1.0.0",
    },
    // `dungKhoaKhuTrungV2` băm (identity + productId + startedAt) — KHÔNG có serial.
    // Mỗi bo phải khác `productId`, nếu không bo sau bị khử trùng về bo trước.
    productId: `${RUN}-${serial}`,
    serialNumber: serial,
    productModel: MA_SP,
    overallResult: opts.khaiCapBo ?? ("OK" as const),
    ntf: false,
    startedAt: "2026-09-03T10:00:00.000",
    completedAt: "2026-09-03T10:00:14.400",
    summary: {
      surfaces: dem(surfaces.length), positions: dem(soPos),
      captures: dem(soCap), components: dem(soComp),
    },
    surfaces,
  };
}

/** Hàng cấp component của MỘT bo + `rolledResult` của capture cha. */
async function hangCua(inspectionId: number) {
  return sql<{
    componentExtId: string; result: string; remark: string | null;
    measuredValue: string | null; captureExtId: string; capCuon: string;
  }[]>`
    SELECT mr."componentExtId", mr.result::text AS result, mr.remark, mr."measuredValue",
           ic."captureExtId", ic."rolledResult"::text AS "capCuon"
      FROM measurement_results mr
      JOIN inspection_captures ic ON ic.id = mr."inspectionCaptureRowId"
     WHERE mr."inspectionId" = ${inspectionId}
     ORDER BY mr.id`;
}

async function boCua(inspectionId: number) {
  const [r] = await sql<{ overallResult: string; originalResult: string | null }[]>`
    SELECT "overallResult"::text AS "overallResult", "originalResult"::text AS "originalResult"
      FROM product_inspections WHERE id = ${inspectionId}`;
  return r;
}

describe.skipIf(!DB_URL || !CO_MAU)(
  "Khối B Task 4 — SPEC-GATE đường v2 (BG-92), vai avi_app, qua CẢ HAI cửa thật",
  () => {
    beforeAll(async () => {
      sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
      const [d] = await sql<{ db: string; usr: string; tz: string; sup: boolean }[]>`
        SELECT current_database() AS db, current_user AS usr, current_setting('TimeZone') AS tz,
               (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS sup`;
      tenDb = d.db;
      expect(d.usr, "phải đo bằng vai avi_app — vai aoi (superuser+BYPASSRLS) làm mọi phép đo xanh giả").toBe("avi_app");
      expect(d.sup, "chạy bằng superuser ⇒ WORM không còn ý nghĩa gì").toBe(false);
      // eslint-disable-next-line no-console
      console.log(`[specGateCayV2] current_database()=${d.db} current_user=${d.usr} TimeZone=${d.tz}`);

      // MỆNH ĐỀ 4 — chụp verdict MỌI bo đang có TRƯỚC khi lưới ghi hàng nào.
      const [truoc] = await sql<{ bam: string; moc: number }[]>`
        SELECT md5(coalesce(string_agg(id::text || ':' || "overallResult"::text, ',' ORDER BY id), '')) AS bam,
               coalesce(max(id), 0)::int AS moc
          FROM product_inspections`;
      bamVerdictTruoc = truoc.bam;
      moc = truoc.moc;

      const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
      // ⚠ MÁY RIÊNG — không giành máy đầu bảng với lưới hàng xóm (mối lo #7 Task 3).
      ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'T4 factory', true) RETURNING id`);
      ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'T4 ws') RETURNING id`);
      ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'T4 line') RETURNING id`);
      ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'T4 station') RETURNING id`);
      ids.machine = await one(sql`
        INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
        VALUES (${ids.station}, ${"M-" + RUN}, 'T4 machine', 'AOI', true) RETURNING id`);
      ids.product = await one(sql`INSERT INTO product_models (code, name) VALUES (${MA_SP}, 'Khoi B Task 4 spec-gate cay') RETURNING id`);
      ids.productV1 = await one(sql`INSERT INTO product_models (code, name) VALUES (${MA_SP_V1}, 'Khoi B Task 4 spec-gate phang v1.x') RETURNING id`);

      // Điểm đo PHẲNG có limit — nền của mệnh đề 3 (đường v1.x KHÔNG được đổi hành vi).
      // Ở SẢN PHẨM RIÊNG: xem chú thích `MA_SP_V1`.
      ids.ptPhang = await one(sql`
        INSERT INTO measurement_point_defs
          ("productModelId", code, name, "measurementType", "positionX", "positionY", "lowerLimit", "upperLimit")
        VALUES (${ids.productV1}, ${PT_PHANG_GATE}, 'T4 diem phang co limit', 'DIMENSION', 30, 40, ${CAN_DUOI}, ${CAN_TREN})
        RETURNING id`);

      const c = await issueMachineKey({
        machineId: ids.machine, name: `khoib-task4-${RUN}`, scopes: ["ingest:write", "equipment:read"],
      });
      apiKey = c.plaintextKey;
      ids.key = c.id;

      // Máy đẩy cây DẠY (Task 2 + Task 5) — 2/4/8/16, MỌI cột giới hạn NULL.
      const day = await caller().submitMachineTemplate({
        apiKey, productModelCode: MA_SP, template: mauDay(),
      });
      expect({ s: day.surfaces, p: day.positions, c: day.captures, k: day.components })
        .toEqual({ s: 2, p: 4, c: 8, k: 16 });

      // Thứ tự duyệt cây dạy = thứ tự `idx` của `ketQua()`.
      const t = mauDay();
      for (const s of t.surfaces)
        for (const p of s.positions)
          for (const cc of p.captures)
            for (const k of cc.components) {
              maTheoThuTu.push(k.id);
              if (maTheoThuTu.length === 1) capCuaTruot = cc.id;
            }
      expect(maTheoThuTu.length).toBe(16);

      // ★★★ NỀN ĐO ĐƯỢC: hợp đồng cây dạy KHÔNG mang giới hạn ⇒ 16/16 point-def vừa
      // sinh ra có `lowerLimit` NULL. Đây là lý do cổng trả `khongGioiHan` chứ không
      // trả "đạt", và là mối lo #1 của báo cáo Task 4.
      const [nen] = await sql<{ tong: number; coLimit: number }[]>`
        SELECT count(*)::int AS tong,
               count(*) FILTER (WHERE mpd."lowerLimit" IS NOT NULL OR mpd."upperLimit" IS NOT NULL)::int AS "coLimit"
          FROM measurement_point_defs mpd
          JOIN product_captures pc ON pc.id = mpd."captureRowId"
         WHERE pc."machineId" = ${ids.machine} AND mpd."deletedAt" IS NULL`;
      expect(nen.tong, `[current_database()=${tenDb}] 16 point-def cây`).toBe(16);
      expect(
        nen.coLimit,
        `[${tenDb}] hợp đồng cây dạy KHÔNG mang trường giới hạn ⇒ máy đẩy cây xong vẫn 0 point-def có limit`,
      ).toBe(0);

      // KỸ SƯ SOẠN GIỚI HẠN cho ĐÚNG BA linh kiện (mô phỏng UI điểm đo). 13 cái còn lại
      // để NULL — chúng là nhóm "KHÔNG KẾT LUẬN ĐƯỢC" của mệnh đề 2.
      const soan = await sql`
        UPDATE measurement_point_defs SET "lowerLimit" = ${CAN_DUOI}, "upperLimit" = ${CAN_TREN}
         WHERE "productModelId" = ${ids.product}
           AND "componentExtId" = ANY(${[maTheoThuTu[0], maTheoThuTu[1], maTheoThuTu[2]]})
         RETURNING id`;
      expect(soan.length, `[${tenDb}] phải soạn được đúng 3 bản dạy có giới hạn`).toBe(3);
    }, 120_000);

    afterAll(async () => {
      if (!sql) return;
      if (boDaGhi.length > 0) {
        await sql`DELETE FROM measurement_results WHERE "inspectionId" = ANY(${boDaGhi})`;
        await sql`DELETE FROM inspection_captures WHERE "inspectionId" = ANY(${boDaGhi})`;
        await sql`DELETE FROM inspection_positions WHERE "inspectionId" = ANY(${boDaGhi})`;
        await sql`DELETE FROM inspection_surfaces WHERE "inspectionId" = ANY(${boDaGhi})`;
      }
      if (goiDaGhi.length > 0) {
        await sql`DELETE FROM package_images WHERE "packageId" = ANY(${goiDaGhi})`;
        await sql`DELETE FROM package_activity_logs WHERE "packageDbId" = ANY(${goiDaGhi})`;
        await sql`DELETE FROM inspection_packages WHERE id = ANY(${goiDaGhi})`;
      }
      const sanPham = [ids.product, ids.productV1].filter((x) => x > 0);
      if (sanPham.length > 0) {
        await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ANY(${sanPham})`;
        await sql`DELETE FROM product_surfaces WHERE "productModelId" = ANY(${sanPham})`;
        await sql`DELETE FROM machine_template_versions WHERE "productModelId" = ANY(${sanPham})`;
      }
      if (ids.key) await sql`DELETE FROM api_keys WHERE id = ${ids.key}`;
      // ⚠ KHÔNG xoá `product_inspections`/`audit_logs` (WORM), `product_models`, và cây
      // thiết bị factory→machine (FK RESTRICT từ bo WORM). KHÔNG `.catch(() => {})`.
      await sql.end({ timeout: 5 });
      await fsp.rm(THU_MUC_ZIP, { recursive: true, force: true });
    }, 120_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 1 — linh kiện NGOÀI giới hạn ĐÃ DẠY mà máy khai OK ⇒ BỊ BẮT (bo XẤU không còn đi lọt)", async () => {
      const payload = ketQua("A", { triTheoIdx: { 0: TRI_NGOAI } });
      const kq: any = await caller().submitInspection(payload);
      expect(kq.success).toBe(true);
      boDaGhi.push(kq.inspectionId);

      // ── (a) CỔNG KẾT LUẬN GÌ — ba trạng thái tách rời, trả tận cửa.
      expect(kq.specGate, `[current_database()=${tenDb}] cổng phải NÓI RA nó chấm được gì`).toEqual({
        batCong: true, tong: 16, dat: 2, truot: 1, haCap: 1,
        chuaDay: 0, khongGioiHan: 13, tatCong: 0,
      });

      // ── (b) HÀNG trên đĩa — SELECT lại, không tin giá trị cửa trả về.
      const hang = await hangCua(kq.inspectionId);
      expect(hang.length, `[${tenDb}] 16 component đã dạy ⇒ 16 hàng`).toBe(16);
      const truot = hang.find((h) => h.componentExtId === maTheoThuTu[0])!;
      expect(truot, `[${tenDb}] không tìm thấy hàng của linh kiện TRƯỢT`).toBeTruthy();
      expect(
        truot.result,
        `[${tenDb}] máy khai OK, trị ${TRI_NGOAI} ngoài [${CAN_DUOI};${CAN_TREN}] ⇒ hàng PHẢI là NG`,
      ).toBe("NG");
      expect(truot.remark ?? "", `[${tenDb}] phải nêu ĐÍCH DANH vi phạm, không chỉ đổi verdict`)
        .toContain(TIEN_TO_CONG_TRUOT);
      expect(truot.remark ?? "").toContain(CAN_TREN);
      expect(truot.captureExtId).toBe(capCuaTruot);

      // ── (c) CUỘN LÊN — hạ ở lá phải đi hết bốn cấp, không dừng ở hàng lá.
      expect(truot.capCuon, `[${tenDb}] capture cha phải cuộn NG (chấm TRƯỚC cuộn)`).toBe("NG");
      const bo = await boCua(kq.inspectionId);
      expect(
        { luu: bo.overallResult, khai: bo.originalResult },
        `[${tenDb}] ★ ĐÂY LÀ LỖ ĐANG VÁ: bo máy khai OK phải LƯU NG, và lời khai gốc giữ nguyên`,
      ).toEqual({ luu: "NG", khai: "OK" });

      // ── (d) Linh kiện KHÔNG có giới hạn: KHÔNG bị bắt oan, và KHÔNG bị coi là "đạt".
      const khongKl = hang.filter((h) => (h.remark ?? "") === NHAN_CONG_KHONG_KET_LUAN);
      expect(khongKl.length, `[${tenDb}] 13 linh kiện bản dạy chưa soạn giới hạn ⇒ KHÔNG KẾT LUẬN`).toBe(13);
      expect(khongKl.every((h) => h.result === "OK"), `[${tenDb}] không kết luận ⇒ KHÔNG hạ oan`).toBe(true);
    }, 180_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 1B — ABLATION: CÙNG payload, cổng TẮT ⇒ bo XẤU LỌT (đây là hành vi TRƯỚC bản vá)", async () => {
      const truocDo = process.env.POINT_LIMIT_EVAL_ENABLED;
      process.env.POINT_LIMIT_EVAL_ENABLED = "false";
      try {
        const payload = ketQua("B", { triTheoIdx: { 0: TRI_NGOAI } });
        const kq: any = await caller().submitInspection(payload);
        boDaGhi.push(kq.inspectionId);

        expect(kq.specGate, `[${tenDb}] cổng tắt ⇒ 16 linh kiện KHÔNG được chấm — và điều đó phải ĐẾM ĐƯỢC`)
          .toEqual({
            batCong: false, tong: 16, dat: 0, truot: 0, haCap: 0,
            chuaDay: 0, khongGioiHan: 0, tatCong: 16,
          });

        const hang = await hangCua(kq.inspectionId);
        expect(hang.filter((h) => (h.remark ?? "").startsWith(TIEN_TO_CONG_TRUOT)).length,
          `[${tenDb}] cổng tắt ⇒ 0 hàng mang dấu spec-gate`).toBe(0);
        const truot = hang.find((h) => h.componentExtId === maTheoThuTu[0])!;
        expect(truot.result, `[${tenDb}] cổng tắt ⇒ lời khai OK của máy đi thẳng vào cột`).toBe("OK");

        const bo = await boCua(kq.inspectionId);
        expect(
          bo.overallResult,
          `[${tenDb}] ★ ĐÂY LÀ HÀNH VI CŨ ĐÃ ĐO: bo có linh kiện ngoài giới hạn LƯU 'OK' — bo XẤU đi lọt`,
        ).toBe("OK");
      } finally {
        if (truocDo === undefined) delete process.env.POINT_LIMIT_EVAL_ENABLED;
        else process.env.POINT_LIMIT_EVAL_ENABLED = truocDo;
      }
    }, 180_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 2 — BA TRẠNG THÁI: đạt · trượt · KHÔNG KẾT LUẬN — và trạng thái thứ ba KHÔNG phải thứ nhất", async () => {
      const payload = ketQua("C", { triTheoIdx: { 0: TRI_NGOAI }, themLinhKienLa: true });
      const kq: any = await caller().submitInspection(payload);
      boDaGhi.push(kq.inspectionId);

      const sg = kq.specGate;
      // ── Bất biến PHÂN HOẠCH — không linh kiện nào rơi vào hai rổ, không rổ nào bị nuốt.
      expect(
        sg.dat + sg.truot + sg.chuaDay + sg.khongGioiHan + sg.tatCong,
        `[current_database()=${tenDb}] phân hoạch phải KÍN: mọi linh kiện thuộc đúng MỘT trạng thái`,
      ).toBe(sg.tong);

      expect(sg, `[${tenDb}] 17 linh kiện: 2 đạt · 1 trượt · 1 chưa dạy · 13 chưa soạn giới hạn`).toEqual({
        batCong: true, tong: 17, dat: 2, truot: 1, haCap: 1,
        chuaDay: 1, khongGioiHan: 13, tatCong: 0,
      });

      // ★★★ ĐIỀU KHOẢN TRUNG TÂM CỦA TASK: linh kiện CHƯA DẠY mang trị NGOÀI giới hạn
      // MÁY TỰ KHAI — nếu cổng đọc lời khai của máy (hoặc coi "tra không ra" là "đạt")
      // thì `dat` sẽ là 3 và `chuaDay` là 0. Nó KHÔNG được là thế.
      expect(sg.dat, `[${tenDb}] "tra không ra" TUYỆT ĐỐI không được cộng vào "đạt"`).toBe(2);
      expect(sg.chuaDay, `[${tenDb}] linh kiện chưa dạy phải ĐẾM ĐƯỢC ở rổ RIÊNG`).toBe(1);

      // ── ĐẾM LẠI TRÊN ĐĨA — ba trạng thái phải phân biệt được bằng một câu SELECT.
      const hang = await hangCua(kq.inspectionId);
      expect(hang.length, `[${tenDb}] linh kiện chưa dạy KHÔNG có hàng nào (Task 3)`).toBe(16);
      expect(hang.some((h) => h.componentExtId === MA_LINH_KIEN_LA)).toBe(false);
      const dem = {
        dat: hang.filter((h) => (h.remark ?? "") === NHAN_CONG_DAT).length,
        truot: hang.filter((h) => (h.remark ?? "").startsWith(TIEN_TO_CONG_TRUOT)).length,
        khongKl: hang.filter((h) => (h.remark ?? "") === NHAN_CONG_KHONG_KET_LUAN).length,
      };
      expect(dem, `[${tenDb}] ba trạng thái phải ĐẾM ĐƯỢC từ đĩa, không chỉ từ giá trị cửa trả về`)
        .toEqual({ dat: 2, truot: 1, khongKl: 13 });

      // Nhánh WORM "chưa dạy" là SỔ CỦA TASK 3 — task này KHÔNG tạo tín hiệu thứ hai.
      const [a] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_logs
         WHERE action = 'ingest.cay.component_chua_day' AND "entityId" = ${kq.inspectionId}`;
      expect(a.n, `[${tenDb}] máy ĐÃ dạy mà khai linh kiện ngoài cây ⇒ ĐÚNG MỘT hàng audit (của Task 3)`).toBe(1);
    }, 180_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 6 — MONOTONIC: máy khai NG mà trị đo TRONG giới hạn ⇒ vẫn NG (cổng không bao giờ nâng)", async () => {
      const payload = ketQua("D", {
        triTheoIdx: { 2: TRI_TRONG },
        ketQuaTheoIdx: { 2: "NG" },
        khaiCapBo: "NG",
      });
      const kq: any = await caller().submitInspection(payload);
      boDaGhi.push(kq.inspectionId);

      expect(kq.specGate.truot, `[current_database()=${tenDb}] trị TRONG giới hạn ⇒ 0 vi phạm`).toBe(0);
      expect(kq.specGate.dat, `[${tenDb}] 3 linh kiện có giới hạn, tất cả trong ngưỡng`).toBe(3);

      const hang = await hangCua(kq.inspectionId);
      const h = hang.find((x) => x.componentExtId === maTheoThuTu[2])!;
      expect(h.result, `[${tenDb}] cổng KHÔNG được nâng NG của máy lên OK`).toBe("NG");
      expect(h.remark, `[${tenDb}] đã chấm và không vi phạm ⇒ dấu ĐẠT (verdict máy vẫn thắng)`).toBe(NHAN_CONG_DAT);
      const bo = await boCua(kq.inspectionId);
      expect(bo.overallResult, `[${tenDb}] bo máy khai NG vẫn NG`).toBe("NG");
    }, 180_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 5 — CỬA ZIP (aoiPackageRouter.commit) chấm y hệt — cửa mà BG-85 đã đánh rơi cổng", async () => {
      process.env.STORAGE_MODE = "local";
      process.env.LOCAL_STORAGE_DIR = THU_MUC_ZIP;
      try {
        const meta: any = ketQua("Z", { triTheoIdx: { 0: TRI_NGOAI } });
        delete meta.apiKey;
        delete meta.schemaVersion;

        const packageId = `T4-ZIP-${RUN}`;
        const storageKey = `aoi-packages/${packageId}.zip`;
        const filePath = path.join(THU_MUC_ZIP, storageKey);
        const zip = new JSZip();
        zip.file("meta.json", JSON.stringify(meta));
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, zipBuffer);

        const [pkg] = await sql<{ id: number }[]>`
          INSERT INTO inspection_packages ("machineId", "packageId", "storageKey", status)
          VALUES (${ids.machine}, ${packageId}, ${storageKey}, 'uploaded') RETURNING id`;
        goiDaGhi.push(pkg.id);

        const ket: any = await aoiPackageRouter
          .createCaller({ user: null } as never)
          .commit({ apiKey, packageId });
        expect(ket.success).toBe(true);
        boDaGhi.push(ket.inspectionId);

        expect(ket.specGate, `[current_database()=${tenDb}] cửa ZIP phải kết luận Y HỆT cửa trực tiếp`).toEqual({
          batCong: true, tong: 16, dat: 2, truot: 1, haCap: 1,
          chuaDay: 0, khongGioiHan: 13, tatCong: 0,
        });

        // ⚠ Bằng chứng cuối lấy bằng SELECT lại đĩa, KHÔNG lấy giá trị `commit()` trả về.
        const hang = await hangCua(ket.inspectionId);
        const truot = hang.find((h) => h.componentExtId === maTheoThuTu[0])!;
        expect(truot.result, `[${tenDb}] cửa ZIP: linh kiện ngoài giới hạn phải thành NG`).toBe("NG");
        const bo = await boCua(ket.inspectionId);
        expect(bo.overallResult, `[${tenDb}] cửa ZIP: bo XẤU không còn commit ra 'OK'`).toBe("NG");
      } finally {
        delete process.env.STORAGE_MODE;
        delete process.env.LOCAL_STORAGE_DIR;
      }
    }, 180_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 3 — CHỐNG HỒI QUY: đường v1.x (điểm gọi DUY NHẤT trước bản vá) KHÔNG đổi hành vi", async () => {
      // Cùng máy, điểm đo PHẲNG (`captureRowId IS NULL`) có limit, ở SẢN PHẨM RIÊNG —
      // đúng hình dạng mà `evaluatePointResult` đang phục vụ hôm nay. Bản vá Task 4
      // chỉ THÊM một điểm gọi ở đường CÂY; đường này phải nguyên vẹn từng byte hành vi.
      const kq: any = await caller().submitInspection({
        apiKey,
        serialNumber: `${RUN}-V1`,
        productModel: MA_SP_V1,
        overallResult: "OK",
        inspectionTime: new Date("2026-09-03T03:00:00.000Z").toISOString(),
        measurements: [{ pointCode: PT_PHANG_GATE, result: "OK", measuredValue: Number(TRI_NGOAI) }],
      });
      expect(kq.success).toBe(true);
      boDaGhi.push(kq.inspectionId);

      const [h] = await sql<{ result: string; remark: string | null; capRow: number | null }[]>`
        SELECT result::text AS result, remark, "inspectionCaptureRowId" AS "capRow"
          FROM measurement_results WHERE "inspectionId" = ${kq.inspectionId}`;
      expect(h, `[current_database()=${tenDb}] đường v1.x phải ghi hàng measurement_results`).toBeTruthy();
      expect(h.capRow, `[${tenDb}] đường v1.x là điểm PHẲNG — không neo vào cây kết quả`).toBeNull();
      expect(h.result, `[${tenDb}] spec-gate v1.x vẫn hạ OK→NG y như trước bản vá`).toBe("NG");
      // ⚠ ĐO ĐƯỢC, KHÔNG GIẢ ĐỊNH: v1.x ghi `Spec gate v1: value 12.5 > max 10` (kèm thẻ
      // phiên bản cấu hình), v2 ghi `Spec gate: …`. Tiền tố CHUNG là thứ làm một câu
      // `remark LIKE 'Spec gate%'` bắt được cả hai đường — lưới ghim đúng tiền tố đó.
      expect(h.remark ?? "", `[${tenDb}] và vẫn dùng ĐÚNG tiền tố remark cũ`).toContain(TIEN_TO_CONG_CHUNG);

      const bo = await boCua(kq.inspectionId);
      expect({ luu: bo.overallResult, khai: bo.originalResult }).toEqual({ luu: "NG", khai: "OK" });
    }, 180_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 4 — CHỐNG HỒI QUY: verdict của MỌI bo đã có (gồm mọi gói committed) KHÔNG ĐỔI", async () => {
      const [sau] = await sql<{ bam: string }[]>`
        SELECT md5(coalesce(string_agg(id::text || ':' || "overallResult"::text, ',' ORDER BY id), '')) AS bam
          FROM product_inspections WHERE id <= ${moc}`;
      expect(
        sau.bam,
        `[current_database()=${tenDb}] Task 4 CHỈ chấm bo MỚI — không bo cũ nào đổi verdict`,
      ).toBe(bamVerdictTruoc);

      // Băm trên tập rỗng tự thoả — kèm một phép đếm THÔ để nền so sánh là bo thật.
      const [n] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM product_inspections WHERE id <= ${moc}`;
      expect(n.n, `[${tenDb}] nền so sánh phải có bo thật, không phải tập rỗng`).toBeGreaterThan(100);
    }, 180_000);
  },
);
