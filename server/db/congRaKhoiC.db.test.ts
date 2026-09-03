/**
 * server/db/congRaKhoiC.db.test.ts
 *
 * Khối C — **Cổng ra, mệnh đề 3** (kế hoạch
 * `docs/superpowers/plans/2026-09-03-aoi-khoi-c-gioi-han.md` §Cổng ra):
 *
 *   > Dạy giới hạn qua UI thật (hoặc caller tRPC) → đẩy lại mẫu kết quả thật ⇒
 *   > `specGate.dat + truot > 0` lần đầu trên đường v2 (trước đó `khongGioiHan`
 *   > 100%) — dán số trước/sau kèm `current_database()`.
 *
 * Đây là bằng chứng **END-TO-END** rằng cả chuỗi Khối B + Khối C nối được:
 * cây dạy (`submitMachineTemplate`) → giới hạn (`measurementPoint.setLimitsBatch`)
 * → kết quả (`submitInspection`, đường v2) → cổng chấm (`specGateCayV2`). Trước
 * Khối C, spec-gate kết luận trên **0 linh kiện** vì bản dạy không mang giới hạn
 * (Khối B đo: `template-sync-sample.json` component chỉ có
 * `id/componentName/description/roi/templateImagePath` — **0** trường giới hạn).
 * Lưới này chứng minh giờ nó **chấm được**, bằng dữ liệu thật:
 *   - Cây dạy: `D:\SOURCES\AOIData\template-sync-sample.json` (2/4/8/16 — TOP+BOTTOM).
 *   - Kết quả: `D:\SOURCES\AOIData\dashboard-sample.json` (6/12/24/48 — cùng bộ
 *     UUID capture/component với 16 linh kiện đầu của cây dạy, Khối B đã đo trùng
 *     khít; 32 linh kiện còn lại — LEFT/RIGHT/FRONT/BACK — KHÔNG có trong cây dạy
 *     ⇒ rơi vào `chuaDay`, đúng hình dạng "máy gửi nhiều hơn cây đã dạy").
 *
 * ── SẢN PHẨM MÃ RIÊNG ────────────────────────────────────────────────────────
 * `KC-EXIT-<RUN>` — KHÔNG dùng model có sẵn (Task 12 Khối C đo readiness trên dữ
 * liệu riêng của nó; dùng chung model sẽ làm con số của họ lẫn với lưới này).
 * `lifecycleStatus='development'` (không phải mặc định `'active'`) — mệnh đề 3
 * đo CƠ CHẾ spec-gate/dạy-giới-hạn, không đo hàng đợi duyệt ngưỡng (đã có lưới
 * riêng: `server/routers/measurementPointLimits.db.test.ts` §1). Sản phẩm
 * `development` ⇒ `assertThresholdEditAllowed` quyết định `direct` — dạy giới
 * hạn đi thẳng, đúng phạm vi mệnh đề này.
 *
 * ── CỜ SNAPSHOT v2 (`SPEC_GATE_SNAPSHOT_ENABLED`) — BƯỚC 1-3: KHÔNG ĐỘNG, VẪN TẮT ──
 * Ràng buộc an toàn TUYỆT ĐỐI của brief: không đổi MẶC ĐỊNH cờ nào (`.env`/
 * `.env.example` không đổi ở đây). BƯỚC 1-3 (mệnh đề 3 GỐC) chạy với cờ TẮT
 * (mặc định), MỌI linh kiện tra ra được (`banDo`) chấm theo giới hạn ĐANG SỐNG
 * tại lúc bo "tới" server, KHÔNG tái dựng theo lịch sử — `theoSnapshot` phải là
 * 0 ở cả hai lượt đẩy, lưới đo, không giả định.
 *
 * ── ★★★ C-1 (review Khối C lượt 9) — MỆNH ĐỀ 3 THAM SỐ HOÁ CẢ HAI TRẠNG THÁI ──
 * BƯỚC 1-3 CHỈ chứng minh "cổng chấm" — KHÔNG chứng minh "chấm ĐÚNG THEO GIỚI
 * HẠN LÚC BO ĐƯỢC ĐO" (điều BG-97 tồn tại để bảo đảm). BƯỚC 4 + hai mệnh đề
 * "MỆNH ĐỀ 3 · cờ BẬT/TẮT" bên dưới đo lại CHÍNH chuỗi thật này (cùng sản
 * phẩm, cùng 3 điểm đã dạy) với cờ **OVERRIDE TRONG TEST** (`process.env.
 * SPEC_GATE_SNAPSHOT_ENABLED = "true"`, khôi phục trong `finally`) — KHÔNG
 * đổi `.env`/`.env.example`, KHÔNG đổi mặc định thật của tiến trình server.
 * Bằng chứng C-1: một bo THẬT SỰ tốt lúc nó được đo, nếu SIẾT giới hạn xảy ra
 * TRƯỚC lúc nó được GHI, bị **hạ oan** khi cờ TẮT (mặc định) và **không** bị
 * hạ oan khi cờ BẬT — trên đúng đường "cổng ra" mà Task 12 tuyên bố nghiệm thu.
 *
 * ── DEDUP — TẠI SAO "ĐẨY LẠI CÙNG FILE" KHÔNG PHẢI "ĐẨY LẠI CÙNG BO" ─────────
 * `dungKhoaKhuTrungV2` băm (identity + productId + startedAt). Đẩy NGUYÊN VĂN
 * cùng payload hai lần sẽ hội tụ về CÙNG MỘT inspection (đúng thiết kế khử
 * trùng — xem `capComponentGhiThat.db.test.ts` mệnh đề 6), và lượt hai sẽ KHÔNG
 * chấm lại gì cả. Lưới này đẩy file THẬT nhiều lần với `productId`/`serialNumber`
 * đổi hậu tố (TRUOC/SAU/MDE3B_BAT/MDE3B_TAT) — mọi trường CÒN LẠI (surfaces/
 * value/lowerLimit/upperLimit/result…) giữ NGUYÊN VĂN từ đĩa, đọc bằng
 * `JSON.parse`, không gõ tay một con số nào.
 *
 * ── WORM và dấu chân để lại (ĐỌC TRƯỚC KHI SỬA) ─────────────────────────────
 * `product_inspections`/`audit_logs` là WORM — `avi_app` KHÔNG có DELETE. Lưới
 * này KHÔNG viết `DELETE ... .catch(() => {})` ở đâu cả. Dọn THẬT các bảng có
 * DELETE (measurement_results, inspection_captures/positions/surfaces,
 * measurement_point_versions, measurement_point_defs, product_surfaces,
 * machine_template_versions, api_keys);
 * CỐ Ý để lại: hàng `product_inspections` (2 hàng — TRƯỚC/SAU), `audit_logs`,
 * `product_models` (bo WORM trỏ vào), và cây thiết bị factory→machine (FK
 * RESTRICT từ bo WORM) — số hàng để lại được khai trong log `beforeAll`/`afterAll`.
 *
 * Chạy trên `aoi_management_test` qua `vitest.setup.ts` guard, vai `avi_app`.
 * Mọi con số kèm `current_database()` (luật Đ-28).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import postgres from "postgres";
import { machineApiRouter, submitInspectionTreeV2 } from "../routers/machineApiRouters";
import { measurementPointRouter } from "../routers/productRouters";
import { issueMachineKey } from "../services/machineAuthService";
import { canhBaoCongSnapshotTat } from "../services/gioiHanLucDoCayV2";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";
const MAU_KET_QUA_THAT = "D:\\SOURCES\\AOIData\\dashboard-sample.json";
const CO_MAU = existsSync(MAU_MAY_THAT) && existsSync(MAU_KET_QUA_THAT);
const RUN = `KC${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const MA_SP = `KC-EXIT-${RUN}`;

/** Giới hạn SOẠN TAY cho hai linh kiện "đạt"/"trượt" — số đo được từ dashboard-sample.json, xem beforeAll. */
const CAN_DUOI_RONG = "9";
const CAN_TREN_RONG = "11";
const CAN_DUOI_HEP = "0";
const CAN_TREN_HEP = "2";
/**
 * ★★★ C-1 — cận SIẾT của BƯỚC 4: dat2 (trị THẬT 10.0) đang ở [9;11] (BƯỚC 2).
 * Siết upper xuống 9.8 ⇒ 10.0 RA NGOÀI [9;9.8] theo luật MỚI, vẫn TRONG [9;11]
 * theo luật LÚC BO ĐƯỢC ĐO — đúng cận cần để phân biệt hai trạng thái cờ.
 */
const CAN_TREN_SIET = "9.8";

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = {
  factory: 0, workshop: 0, line: 0, station: 0, machine: 0, product: 0, key: 0,
};
let apiKey = "";
/** 16 componentExtId của cây dạy (TOP+BOTTOM), ĐÚNG thứ tự duyệt cây. */
let maTheoThuTu: string[] = [];
/** `measurement_point_defs.id` (PK số) của 3 linh kiện được dạy — điền ở bước "DẠY". */
const idDaDay = { truot: 0, dat1: 0, dat2: 0 };
const boDaGhi: number[] = [];
/** Đường tệp WAL TẠM — GOTCHA brief: `data/inspection-store-forward*.jsonl` là tệp THẬT. */
const WAL_TAM = path.join(os.tmpdir(), `khoic-cong-ra-${RUN}.jsonl`);

function ctxMay(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const callerMay = () => machineApiRouter.createCaller(ctxMay());

// ctx admin — bỏ qua checkPermission (role==='admin' short-circuit) VÀ bỏ qua
// lọc tenant (phamViCua → không lọc) — mẫu ĐÚNG của
// `server/routers/measurementPointLimits.db.test.ts` (Task 8 Khối C, đã review
// ĐẠT). Lưới này canh mệnh đề 3 (chuỗi dạy→chấm), KHÔNG canh permission/tenant
// riêng — đã có lưới đó.
const adminCtx = {
  user: { id: 999999999, role: "admin", name: "Khoi C cong ra menh de 3" },
  req: { ip: null, headers: {} },
} as unknown as TrpcContext;
const callerAdmin = () => measurementPointRouter.createCaller(adminCtx);

/** Cây DẠY thật (2 surface / 4 position / 8 capture / 16 component) — bản sao mới mỗi lần gọi. */
function mauDay(): any {
  return JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));
}

/** Payload KẾT QUẢ thật (6 surface / 12 position / 24 capture / 48 component) — NGUYÊN VĂN từ đĩa. */
function mauKetQua(): any {
  return JSON.parse(readFileSync(MAU_KET_QUA_THAT, "utf8"));
}

/**
 * Đẩy `dashboard-sample.json` NGUYÊN VĂN, chỉ đổi bốn trường bắt buộc để (a) máy
 * xác thực được (`apiKey`), (b) trỏ đúng sản phẩm riêng của lưới này
 * (`productModel`), (c) tránh khử trùng nhiều lượt về CÙNG một bo (`productId`/
 * `serialNumber` đổi hậu tố theo `nhan`). `surfaces`/`value`/`lowerLimit`/
 * `upperLimit`/`result`/thời gian… giữ NGUYÊN — đây CHÍNH LÀ file thật.
 * `nhan` nhận chuỗi bất kỳ (không còn khoá cứng `"TRUOC"|"SAU"`) — C-1 dùng
 * thêm `MDE3B_BAT`/`MDE3B_TAT` cho hai nhánh cờ của mệnh đề 3 tham số hoá.
 */
function payloadKetQuaThat(nhan: string): any {
  const raw = mauKetQua();
  raw.apiKey = apiKey;
  raw.productModel = MA_SP;
  raw.productId = `${raw.productId}-${RUN}-${nhan}`;
  raw.serialNumber = `${raw.serialNumber}-${nhan}`;
  return raw;
}

/** componentId → {value, lowerLimit, upperLimit, result} MÁY TỰ KHAI, đọc từ payload kết quả thật. */
function triTheoComponentId(payload: any): Map<string, { value: unknown; lowerLimit: unknown; upperLimit: unknown; result: string }> {
  const m = new Map<string, { value: unknown; lowerLimit: unknown; upperLimit: unknown; result: string }>();
  for (const s of payload.surfaces)
    for (const p of s.positions)
      for (const c of p.captures)
        for (const k of c.components)
          m.set(k.componentId, { value: k.value, lowerLimit: k.lowerLimit, upperLimit: k.upperLimit, result: k.result });
  return m;
}

/** Hàng cấp component của MỘT bo — dùng để đếm lại trên đĩa, không tin riêng giá trị cửa trả về. */
async function hangCua(inspectionId: number) {
  return sql<{ componentExtId: string; result: string; remark: string | null }[]>`
    SELECT mr."componentExtId", mr.result::text AS result, mr.remark
      FROM measurement_results mr
     WHERE mr."inspectionId" = ${inspectionId}
     ORDER BY mr.id`;
}

describe.skipIf(!DB_URL || !CO_MAU)(
  "Khối C — Cổng ra mệnh đề 3: cây dạy → giới hạn → kết quả → cổng chấm (vai avi_app, cửa thật)",
  () => {
    beforeAll(async () => {
      sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
      const [d] = await sql<{ db: string; usr: string; sup: boolean }[]>`
        SELECT current_database() AS db, current_user AS usr,
               (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS sup`;
      tenDb = d.db;
      expect(d.usr, "phải đo bằng vai avi_app — vai aoi (superuser+BYPASSRLS) làm mọi phép đo quyền XANH GIẢ").toBe("avi_app");
      expect(d.sup, "chạy bằng superuser ⇒ WORM không còn ý nghĩa gì").toBe(false);
      // eslint-disable-next-line no-console
      console.log(`[congRaKhoiC] current_database()=${d.db} current_user=${d.usr}`);

      // GOTCHA brief — không để WAL chạm tệp thật, kể cả khi không dự kiến dùng tới.
      process.env.INSPECTION_STORE_FORWARD_FILE = WAL_TAM;

      const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
      ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'KC cong ra factory', true) RETURNING id`);
      ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'KC cong ra ws') RETURNING id`);
      ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'KC cong ra line') RETURNING id`);
      ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'KC cong ra station') RETURNING id`);
      ids.machine = await one(sql`
        INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
        VALUES (${ids.station}, ${"M-" + RUN}, 'KC cong ra machine', 'AOI', true) RETURNING id`);

      // Sản phẩm MÃ RIÊNG, 'development' (KHÔNG mặc định 'active') — xem docblock đầu file.
      ids.product = await one(sql`
        INSERT INTO product_models (code, name, "lifecycleStatus")
        VALUES (${MA_SP}, 'Khoi C cong ra menh de 3', 'development') RETURNING id`);

      const key = await issueMachineKey({
        machineId: ids.machine, name: `khoic-cong-ra-${RUN}`, scopes: ["ingest:write", "equipment:read"],
      });
      apiKey = key.plaintextKey;
      ids.key = key.id;

      // ── Cây DẠY: submitMachineTemplate — 2/4/8/16, hợp đồng KHÔNG mang giới hạn ──
      const day = await callerMay().submitMachineTemplate({
        apiKey, productModelCode: MA_SP, template: mauDay(),
      });
      expect({ s: day.surfaces, p: day.positions, c: day.captures, k: day.components })
        .toEqual({ s: 2, p: 4, c: 8, k: 16 });

      for (const s of mauDay().surfaces)
        for (const p of s.positions)
          for (const cc of p.captures)
            for (const k of cc.components) maTheoThuTu.push(k.id);
      expect(maTheoThuTu.length).toBe(16);

      // ★★★ NỀN ĐO ĐƯỢC — bản dạy vừa đẩy KHÔNG mang một trường giới hạn nào
      // (hợp đồng `machineTemplateContract` không có trường đó). Đây LÀ lý do
      // mệnh đề 3 tồn tại: spec-gate hôm nay kết luận trên 0 linh kiện.
      const [nen] = await sql<{ tong: number; coLimit: number }[]>`
        SELECT count(*)::int AS tong,
               count(*) FILTER (WHERE mpd."lowerLimit" IS NOT NULL OR mpd."upperLimit" IS NOT NULL)::int AS "coLimit"
          FROM measurement_point_defs mpd
          JOIN product_captures pc ON pc.id = mpd."captureRowId"
         WHERE pc."machineId" = ${ids.machine} AND mpd."deletedAt" IS NULL`;
      expect(nen.tong, `[current_database()=${tenDb}] 16 point-def cây (TOP+BOTTOM)`).toBe(16);
      expect(nen.coLimit, `[${tenDb}] ★ bản dạy CẤU HÌNH không mang giới hạn ⇒ 0/16 có limit ngay sau khi đẩy cây`).toBe(0);
      // eslint-disable-next-line no-console
      console.log(`[congRaKhoiC] [${tenDb}] SAU khi đẩy cây dạy: point-def=${nen.tong} có-limit=${nen.coLimit}`);

      // Sanity — chỉ số dùng để chọn linh kiện dạy PHẢI khớp giá trị THẬT đọc từ
      // dashboard-sample.json (không đoán): idx0=TOP-P01-cap0-0 (12.5, NGOÀI [9;11]
      // sau khi dạy), idx1=TOP-P01-cap0-1 (1, TRONG [0;2]), idx2=TOP-P01-cap1-0
      // (10.0, TRONG [9;11]).
      const triThat = triTheoComponentId(mauKetQua());
      expect(String(triThat.get(maTheoThuTu[0])!.value)).toBe("12.5");
      expect(String(triThat.get(maTheoThuTu[1])!.value)).toBe("1");
      expect(String(triThat.get(maTheoThuTu[2])!.value)).toBe("10.0");
    }, 120_000);

    afterAll(async () => {
      if (!sql) return;
      if (boDaGhi.length > 0) {
        await sql`DELETE FROM measurement_results WHERE "inspectionId" = ANY(${boDaGhi})`;
        await sql`DELETE FROM inspection_captures WHERE "inspectionId" = ANY(${boDaGhi})`;
        await sql`DELETE FROM inspection_positions WHERE "inspectionId" = ANY(${boDaGhi})`;
        await sql`DELETE FROM inspection_surfaces WHERE "inspectionId" = ANY(${boDaGhi})`;
      }
      const diemDaDay = [idDaDay.truot, idDaDay.dat1, idDaDay.dat2].filter((x) => x > 0);
      if (diemDaDay.length > 0) {
        await sql`DELETE FROM measurement_point_versions WHERE "pointDefId" = ANY(${diemDaDay})`;
      }
      if (ids.product > 0) {
        await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
        await sql`DELETE FROM product_surfaces WHERE "productModelId" = ${ids.product}`;
        await sql`DELETE FROM machine_template_versions WHERE "productModelId" = ${ids.product}`;
      }
      if (ids.key) await sql`DELETE FROM api_keys WHERE id = ${ids.key}`;
      // ⚠ KHÔNG xoá `product_inspections`/`audit_logs` (WORM), `product_models`,
      // và cây thiết bị factory→machine (FK RESTRICT từ bo WORM). KHÔNG `.catch(() => {})`.
      // eslint-disable-next-line no-console
      console.log(
        `[congRaKhoiC] [${tenDb}] ĐỂ LẠI: product_inspections=${boDaGhi.length} hàng (id: ${boDaGhi.join(",")}), ` +
          `product_models id=${ids.product} (${MA_SP}), machine id=${ids.machine} + cây thiết bị của nó.`,
      );
      await sql.end({ timeout: 5 });
      delete process.env.INSPECTION_STORE_FORWARD_FILE;
      await fsp.rm(WAL_TAM, { force: true });
    }, 120_000);

    // ══════════════════════════════════════════════════════════════════════════
    let ketQuaTruoc: any;

    it("BƯỚC 1 (TRƯỚC) — 0 giới hạn ⇒ dat+truot=0, toàn bộ khongGioiHan/chuaDay", async () => {
      const payload = payloadKetQuaThat("TRUOC");
      const kq: any = await callerMay().submitInspection(payload);
      expect(kq.success).toBe(true);
      boDaGhi.push(kq.inspectionId);
      ketQuaTruoc = kq;

      // eslint-disable-next-line no-console
      console.log(`[congRaKhoiC] [${tenDb}] TRƯỚC dạy — specGate=${JSON.stringify(kq.specGate)} mayTuMauThuan=${JSON.stringify(kq.mayTuMauThuan)}`);

      // Bất biến phân hoạch — phải KÍN trước khi kiểm từng số.
      expect(kq.specGate.dat + kq.specGate.truot + kq.specGate.chuaDay + kq.specGate.khongGioiHan + kq.specGate.tatCong)
        .toBe(kq.specGate.tong);

      expect(kq.specGate, `[current_database()=${tenDb}] TRƯỚC khi dạy: 48 linh kiện, 16 tra ra (0 giới hạn) + 32 chưa dạy`).toEqual({
        batCong: true, tong: 48, dat: 0, truot: 0, haCap: 0,
        chuaDay: 32, khongGioiHan: 16, tatCong: 0,
        theoSnapshot: 0, theoSong: 16,
      });

      // ĐẾM LẠI TRÊN ĐĨA — 16 hàng measurement_results (32 linh kiện chưa dạy
      // không có hàng nào, đúng hành vi Khối B Task 3).
      const hang = await hangCua(kq.inspectionId);
      expect(hang.length, `[${tenDb}] 16 linh kiện đã tra ra ⇒ 16 hàng`).toBe(16);
    }, 180_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("ĐỘT BIẾN BẮT BUỘC — bỏ bước dạy ⇒ SAU vẫn dat+truot=0 (mệnh đề 3 ĐỎ), rồi hoàn tác", () => {
      // Dùng CHÍNH bo TRƯỚC-khi-dạy (bước 1) làm dữ liệu "nếu bỏ bước dạy" — đây
      // ĐÚNG LÀ trạng thái "chưa dạy" mà mệnh đề 3 phải phân biệt được với "đã dạy".
      // Không cần dựng lại state: bước dạy (setLimitsBatch, bài dưới) CHƯA chạy tại
      // thời điểm `it()` này thực thi — vitest chạy các `it` trong MỘT `describe`
      // theo đúng thứ tự khai báo (không xáo trộn), nên đây thật sự là ảnh chụp
      // "trước khi dạy".
      let dongDo = "";
      try {
        expect(
          ketQuaTruoc.specGate.dat + ketQuaTruoc.specGate.truot,
          "Khối C mệnh đề 3 — dat+truot phải > 0 khi đã dạy giới hạn",
        ).toBeGreaterThan(0);
      } catch (e: any) {
        dongDo = String(e?.message ?? e);
      }
      // eslint-disable-next-line no-console
      console.log(`[congRaKhoiC] DÒNG ĐỎ ĐỘT BIẾN (bỏ bước dạy):\n${dongDo}`);
      expect(dongDo, "đột biến PHẢI đỏ — nếu dòng này không đỏ thì mệnh đề 3 không đo được gì").not.toBe("");
      expect(dongDo).toContain("dat+truot phải > 0");
      // Hoàn tác: KHÔNG có state nào bị đổi ở test này (chỉ đọc `ketQuaTruoc` đã
      // ghi từ trước) — bước DẠY thật (setLimitsBatch) chạy Ở BÀI DƯỚI, tách bạch.
    });

    // ══════════════════════════════════════════════════════════════════════════
    it("BƯỚC 2 (DẠY) — setLimitsBatch cho 3 component, measurement_point_versions +3", async () => {
      const found = await sql<{ id: number; componentExtId: string }[]>`
        SELECT id, "componentExtId" FROM measurement_point_defs
         WHERE "productModelId" = ${ids.product}
           AND "componentExtId" = ANY(${[maTheoThuTu[0], maTheoThuTu[1], maTheoThuTu[2]]})
           AND "deletedAt" IS NULL`;
      expect(found.length, `[current_database()=${tenDb}] phải tìm đúng 3 point-def cần dạy`).toBe(3);
      const byExt = new Map(found.map((r) => [r.componentExtId, r.id]));
      idDaDay.truot = byExt.get(maTheoThuTu[0])!;
      idDaDay.dat1 = byExt.get(maTheoThuTu[1])!;
      idDaDay.dat2 = byExt.get(maTheoThuTu[2])!;

      const [{ c: mpvTruoc }] = await sql<{ c: number }[]>`
        SELECT count(*)::int AS c FROM measurement_point_versions
         WHERE "pointDefId" IN (${idDaDay.truot}, ${idDaDay.dat1}, ${idDaDay.dat2})`;
      expect(mpvTruoc, `[${tenDb}] chưa sửa lần nào ⇒ 0 hàng lịch sử`).toBe(0);

      // idx0 (12.5) dạy [9;11] ⇒ NGOÀI ⇒ sẽ TRƯỢT. idx1 (1) dạy [0;2] ⇒ TRONG ⇒
      // sẽ ĐẠT. idx2 (10.0) dạy [9;11] ⇒ TRONG ⇒ sẽ ĐẠT.
      const res = await callerAdmin().setLimitsBatch({
        items: [
          { id: idDaDay.truot, lowerLimit: CAN_DUOI_RONG, upperLimit: CAN_TREN_RONG },
          { id: idDaDay.dat1, lowerLimit: CAN_DUOI_HEP, upperLimit: CAN_TREN_HEP },
          { id: idDaDay.dat2, lowerLimit: CAN_DUOI_RONG, upperLimit: CAN_TREN_RONG },
        ],
        changeReason: "Khoi C menh de 3 cong ra - day gioi han ky su cho luoi",
      });
      expect(res.updated, `[${tenDb}] phải ghi được đúng 3 điểm`).toBe(3);

      // MỆNH ĐỀ 5 (Lịch sử) — measurement_point_versions phải +3, ĐÚNG các
      // point-def vừa dạy (BG-97: mỗi lần sửa giới hạn để lại MỘT hàng).
      const [{ c: mpvSau }] = await sql<{ c: number }[]>`
        SELECT count(*)::int AS c FROM measurement_point_versions
         WHERE "pointDefId" IN (${idDaDay.truot}, ${idDaDay.dat1}, ${idDaDay.dat2})`;
      // eslint-disable-next-line no-console
      console.log(`[congRaKhoiC] [${tenDb}] measurement_point_versions cho 3 điểm đã dạy: ${mpvTruoc} → ${mpvSau}`);
      expect(mpvSau - mpvTruoc, `[${tenDb}] mỗi điểm dạy để lại ĐÚNG một hàng lịch sử`).toBe(3);

      const rows = await sql<{ id: number; lowerLimit: string | null; upperLimit: string | null }[]>`
        SELECT id, "lowerLimit", "upperLimit" FROM measurement_point_defs
         WHERE id IN (${idDaDay.truot}, ${idDaDay.dat1}, ${idDaDay.dat2}) ORDER BY id`;
      expect(rows.every((r) => r.lowerLimit !== null && r.upperLimit !== null), `[${tenDb}] giới hạn phải GHI ĐƯỢC lên đĩa`).toBe(true);
    }, 60_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("BƯỚC 3 (SAU) — dat+truot>0, đúng số component đã dạy; mayTuMauThuan bất biến bắc cầu (BG-98)", async () => {
      const payload = payloadKetQuaThat("SAU");
      const kq: any = await callerMay().submitInspection(payload);
      expect(kq.success).toBe(true);
      boDaGhi.push(kq.inspectionId);

      // eslint-disable-next-line no-console
      console.log(`[congRaKhoiC] [${tenDb}] SAU dạy — specGate=${JSON.stringify(kq.specGate)} mayTuMauThuan=${JSON.stringify(kq.mayTuMauThuan)}`);

      expect(kq.specGate.dat + kq.specGate.truot + kq.specGate.chuaDay + kq.specGate.khongGioiHan + kq.specGate.tatCong)
        .toBe(kq.specGate.tong);

      // ★★★ MỆNH ĐỀ 3 — lần đầu specGate.dat + truot > 0 trên đường v2, cho
      // ĐÚNG sản phẩm này. 13 linh kiện còn lại (16 - 3 đã dạy) vẫn khongGioiHan;
      // 32 linh kiện ngoài cây (LEFT/RIGHT/FRONT/BACK) vẫn chuaDay — KHÔNG đổi
      // so với TRƯỚC (dạy KHÔNG ảnh hưởng phần chưa tra ra được).
      expect(kq.specGate, `[current_database()=${tenDb}] SAU khi dạy 3 điểm (1 trượt, 2 đạt)`).toEqual({
        batCong: true, tong: 48, dat: 2, truot: 1, haCap: 0,
        chuaDay: 32, khongGioiHan: 13, tatCong: 0,
        // Cờ SPEC_GATE_SNAPSHOT_ENABLED KHÔNG được bật ở lưới này (ràng buộc an
        // toàn) ⇒ 16 linh kiện tra ra đều chấm theo giới hạn ĐANG SỐNG, 0 tái dựng.
        theoSnapshot: 0, theoSong: 16,
      });
      expect(kq.specGate.dat + kq.specGate.truot, `[${tenDb}] ★ MỆNH ĐỀ 3 — phải > 0 (trước đó là 0)`).toBeGreaterThan(0);

      // ĐẾM LẠI TRÊN ĐĨA — ĐÚNG 3 componentExtId đã dạy phải là dat/truot, phần
      // còn lại (13 khongGioiHan) vẫn KHÔNG kết luận.
      const hang = await hangCua(kq.inspectionId);
      expect(hang.length, `[${tenDb}] 16 linh kiện tra ra ⇒ 16 hàng`).toBe(16);
      const theoExt = new Map(hang.map((h) => [h.componentExtId, h]));

      const hTruot = theoExt.get(maTheoThuTu[0])!;
      expect(hTruot.result, `[${tenDb}] 12.5 ngoài [9;11] ⇒ NG`).toBe("NG");
      expect(hTruot.remark ?? "", `[${tenDb}] remark phải nêu ĐÍCH DANH vi phạm`).toContain("Spec gate");

      // I-4 (review Khối C lượt 9) — BƯỚC 3 chạy với cờ SNAPSHOT TẮT (docblock đầu
      // file) ⇒ mọi nhãn ĐẠT phải mang basis `;v=LIVE` (chấm theo giới hạn đang
      // sống, không tái dựng) — KHÔNG còn "[SG:DAT]" trơn.
      const hDat1 = theoExt.get(maTheoThuTu[1])!;
      expect(hDat1.remark, `[${tenDb}] 1 trong [0;2] ⇒ ĐẠT (cờ TẮT ⇒ LIVE)`).toBe("[SG:DAT;v=LIVE]");

      const hDat2 = theoExt.get(maTheoThuTu[2])!;
      expect(hDat2.remark, `[${tenDb}] 10.0 trong [9;11] ⇒ ĐẠT (cờ TẮT ⇒ LIVE)`).toBe("[SG:DAT;v=LIVE]");

      // 13 linh kiện KHÔNG được dạy vẫn phải "KHÔNG KẾT LUẬN", KHÔNG bị bắt oan.
      const khongKl = hang.filter((h) => (h.remark ?? "") === "[SG:KHONG_KL]");
      expect(khongKl.length, `[${tenDb}] 16 - 3 đã dạy = 13 vẫn khongGioiHan`).toBe(13);

      // ── MỆNH ĐỀ 4 (bất biến bắc cầu, BG-98/QĐ-8) ──────────────────────────
      // mayTuMauThuan đọc LỜI KHAI CỦA MÁY (value/result/lowerLimit/upperLimit
      // MÁY TỰ GỬI kèm lá), KHÔNG đọc bản dạy — payload TRƯỚC/SAU có CÙNG nội
      // dung máy khai (chỉ đổi productId/serialNumber) ⇒ con số này KHÔNG ĐƯỢC
      // ĐỔI. Nếu đổi ⇒ hai cổng lẫn nhau (vi phạm QĐ-8).
      expect(
        kq.mayTuMauThuan,
        `[${tenDb}] mayTuMauThuan SAU phải giữ NGUYÊN so với TRƯỚC — nó không đọc bản dạy`,
      ).toEqual(ketQuaTruoc.mayTuMauThuan);
      // Đo THÊM (chống tự-thoả: hai vế bằng nhau vì cả hai đều SAI theo cùng một
      // cách không phải điều test này muốn chứng minh) — dán số cụ thể.
      expect(kq.mayTuMauThuan.tong, `[${tenDb}] mayTuMauThuan.tong = tổng lá máy khai (48), không phụ thuộc cây dạy`).toBe(48);
    }, 180_000);

    // ══════════════════════════════════════════════════════════════════════════
    // ★★★ C-1 (review Khối C lượt 9) — MỆNH ĐỀ 3 THAM SỐ HOÁ CẢ HAI TRẠNG THÁI CỜ.
    // Xem docblock đầu file cho lý do BƯỚC 1-3 (cờ TẮT) KHÔNG đủ làm bằng chứng
    // "chấm theo giới hạn lúc đo" — chỉ chứng minh "cổng chấm". Ba bài dưới đây
    // dùng CHÍNH điểm `dat2` đã dạy ở BƯỚC 2 ([9;11], trị thật 10.0 ⇒ ĐẠT).
    // ══════════════════════════════════════════════════════════════════════════
    let lucDoTruocSiet: Date;

    it("BƯỚC 4 (SIẾT SAU KHI BO ĐÃ ĐO) — nền cho mệnh đề 3 hai trạng thái: siết dat2 [9;11] → [9;9.8]", async () => {
      // Mốc "bo được đo" — ĐẶT TRƯỚC lượt siết dưới đây. Hai mệnh đề kế tiếp
      // (BẬT/TẮT) dùng CHÍNH mốc này làm `opts.serverReceivedAt` của "bo cũ" —
      // chỉ CỜ khác nhau, mọi thứ khác giữ nguyên (cùng nguyên lý mệnh đề 7/7B
      // của `server/db/specGateCayV2.db.test.ts`, áp lại trên dữ liệu THẬT của
      // cổng ra thay vì payload tổng hợp).
      lucDoTruocSiet = new Date();

      const [truocSiet] = await sql<{ upperLimit: string | null }[]>`
        SELECT "upperLimit"::text AS "upperLimit" FROM measurement_point_defs WHERE id = ${idDaDay.dat2}`;
      expect(Number(truocSiet.upperLimit), `[${tenDb}] dat2 phải đang ở upper=${CAN_TREN_RONG} (BƯỚC 2)`).toBe(Number(CAN_TREN_RONG));

      const res = await callerAdmin().setLimitsBatch({
        items: [{ id: idDaDay.dat2, lowerLimit: CAN_DUOI_RONG, upperLimit: CAN_TREN_SIET }],
        changeReason: "Khoi C menh de 3 hai trang thai (C-1) - siet SAU khi bo da duoc do",
      });
      expect(res.updated, `[${tenDb}] phải siết được đúng 1 điểm`).toBe(1);

      const [{ tren }] = await sql<{ tren: string }[]>`
        SELECT "upperLimit"::text AS tren FROM measurement_point_defs WHERE id = ${idDaDay.dat2}`;
      expect(Number(tren), `[${tenDb}] giới hạn ĐANG SỐNG nay siết còn ${CAN_TREN_SIET}`).toBe(Number(CAN_TREN_SIET));
    }, 60_000);

    it("MỆNH ĐỀ 3 · cờ BẬT (override trong test) — bo cũ (nhận TRƯỚC lượt siết) phát lại vẫn ĐẠT: chấm theo giới hạn LÚC ĐO, không hạ oan", async () => {
      const truocCo = process.env.SPEC_GATE_SNAPSHOT_ENABLED;
      process.env.SPEC_GATE_SNAPSHOT_ENABLED = "true";
      try {
        // Cửa TRỰC TIẾP gọi thẳng `submitInspectionTreeV2` (exported, cùng con
        // đường sản xuất duy nhất có thể đặt `serverReceivedAt` khác "bây giờ" —
        // xem docblock hàm đó / `ensureInspectionWalWired`) với mốc TRƯỚC lượt
        // siết ở BƯỚC 4 — mô phỏng "bo tồn kho/WAL phát lại muộn" mà C-1 mô tả.
        const payload = payloadKetQuaThat("MDE3B_BAT");
        const kq: any = await submitInspectionTreeV2(payload, { serverReceivedAt: lucDoTruocSiet });
        expect(kq.success).toBe(true);
        boDaGhi.push(kq.inspectionId);
        // eslint-disable-next-line no-console
        console.log(`[congRaKhoiC] [${tenDb}] MỆNH ĐỀ 3 · BẬT — specGate=${JSON.stringify(kq.specGate)}`);

        const hang = await hangCua(kq.inspectionId);
        const hDat2 = hang.find((h) => h.componentExtId === maTheoThuTu[2])!;
        expect(
          hDat2.result,
          `[${tenDb}] ★ MỆNH ĐỀ 3 (cờ BẬT) — 10.0 trong [9;11] LÚC BO ĐƯỢC ĐO ⇒ vẫn OK dù giới hạn ĐANG SỐNG đã bị siết xuống [9;${CAN_TREN_SIET}]`,
        ).toBe("OK");
        expect(hDat2.remark ?? "", `[${tenDb}] đã chấm THẬT (không phải bỏ cổng) ⇒ dấu ĐẠT`).toContain("[SG:DAT");
      } finally {
        if (truocCo === undefined) delete process.env.SPEC_GATE_SNAPSHOT_ENABLED;
        else process.env.SPEC_GATE_SNAPSHOT_ENABLED = truocCo;
      }
    }, 120_000);

    it("★★★ MỆNH ĐỀ 3 · cờ TẮT (mặc định, KHÔNG bị brief này đổi — bằng chứng C-1) — CÙNG bo cũ phát lại bị TRƯỢT: chấm theo giới hạn ĐANG SỐNG, hạ oan một bo TỐT", async () => {
      expect(
        process.env.SPEC_GATE_SNAPSHOT_ENABLED,
        "nhánh này PHẢI chạy với cờ TẮT (mặc định thật của tiến trình, không bị mệnh đề trên làm rò rỉ)",
      ).toBeFalsy();

      // Y HỆT mệnh đề BẬT ở trên — CÙNG mốc `serverReceivedAt` (TRƯỚC lượt siết ở
      // BƯỚC 4), chỉ khác CỜ. Bo này THẬT SỰ tốt lúc nó được đo (10.0 ∈ [9;11]).
      const payload = payloadKetQuaThat("MDE3B_TAT");
      const kq: any = await submitInspectionTreeV2(payload, { serverReceivedAt: lucDoTruocSiet });
      expect(kq.success).toBe(true);
      boDaGhi.push(kq.inspectionId);
      // eslint-disable-next-line no-console
      console.log(`[congRaKhoiC] [${tenDb}] ★★★ MỆNH ĐỀ 3 · TẮT (C-1) — specGate=${JSON.stringify(kq.specGate)}`);

      const hang = await hangCua(kq.inspectionId);
      const hDat2 = hang.find((h) => h.componentExtId === maTheoThuTu[2])!;
      expect(
        hDat2.result,
        `[${tenDb}] ★★★ C-1 — cờ TẮT chấm theo giới hạn ĐANG SỐNG [9;${CAN_TREN_SIET}] dù bo được đo LÚC [9;11] còn hiệu lực ⇒ 10.0 bị hạ NG OAN (hạ oan một bo TỐT)`,
      ).toBe("NG");
      expect(hDat2.remark ?? "", `[${tenDb}] phải nêu ĐÍCH DANH vi phạm`).toContain("Spec gate");
    }, 120_000);

    // ══════════════════════════════════════════════════════════════════════════
    // ★★★ C-1 — `canhBaoCongSnapshotTat()` (startup warning) đo bằng DB THẬT.
    // Tới đây BƯỚC 2 + BƯỚC 4 đã tạo ≥4 hàng `measurement_point_versions` cho
    // điểm cây (captureRowId IS NOT NULL) của MÁY này — điều kiện tiền đề để
    // hàm cảnh báo. Không seed fixture riêng: dùng lại CHÍNH trạng thái DB mà
    // các bước trên vừa dựng, đúng tinh thần "đo trên dữ liệu thật" của file này.
    // ══════════════════════════════════════════════════════════════════════════
    it("C-1 — canhBaoCongSnapshotTat() CẢNH BÁO khi cờ TẮT và đã có điểm cây mang lịch sử giới hạn", async () => {
      expect(process.env.SPEC_GATE_SNAPSHOT_ENABLED, "nhánh này đo với cờ TẮT (mặc định, không bị mệnh đề trên làm rò rỉ)").toBeFalsy();
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await canhBaoCongSnapshotTat();
        const dongCanhBao = spy.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("[BG-97]"));
        expect(
          dongCanhBao.length,
          `[${tenDb}] cờ TẮT + BƯỚC 2/4 vừa tạo hàng measurement_point_versions cho điểm cây ⇒ PHẢI cảnh báo`,
        ).toBeGreaterThan(0);
        expect(dongCanhBao[0]).toMatch(/SPEC_GATE_SNAPSHOT_ENABLED TẮT/);
      } finally {
        spy.mockRestore();
      }
    }, 30_000);

    it("C-1 — canhBaoCongSnapshotTat() KHÔNG cảnh báo khi cờ BẬT (override trong test)", async () => {
      const truocCo = process.env.SPEC_GATE_SNAPSHOT_ENABLED;
      process.env.SPEC_GATE_SNAPSHOT_ENABLED = "true";
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await canhBaoCongSnapshotTat();
        const dongCanhBao = spy.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("[BG-97]"));
        expect(dongCanhBao.length, "cờ BẬT ⇒ không phải trạng thái C-1 cảnh báo, dù có bao nhiêu hàng lịch sử").toBe(0);
      } finally {
        spy.mockRestore();
        if (truocCo === undefined) delete process.env.SPEC_GATE_SNAPSHOT_ENABLED;
        else process.env.SPEC_GATE_SNAPSHOT_ENABLED = truocCo;
      }
    }, 30_000);
  },
);
