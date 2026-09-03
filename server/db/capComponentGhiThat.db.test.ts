/**
 * server/db/capComponentGhiThat.db.test.ts
 *
 * Khối B — **Task 3 (B-4)**: mở khoá ghi **cấp component** (**Đ-19** — món nợ mở lâu
 * nhất của dự án). Ghi THẬT, DB test cô lập, vai **`avi_app`** (KHÔNG phải `aoi`:
 * superuser + BYPASSRLS làm mọi phép đo quyền XANH GIẢ), đi qua **CỬA THẬT**
 * (`machineApiRouter.createCaller().submitInspection`) — gọi thẳng `ghiCayKetQua`
 * chỉ chứng minh HÀM chạy, không chứng minh CỬA gắn **máy ĐÃ XÁC THỰC** vào phép tra.
 *
 * ── NỀN ĐO ĐƯỢC TRƯỚC BẢN VÁ (2026-09-03, vai `avi_app`) ─────────────────────
 *   `measurement_results` NOT NULL: `inspectionId`, `pointDefId`, `result`
 *   (+ `id`/`createdAt` có default) — `pointDefId :: integer NOT NULL KHÔNG DEFAULT`.
 *   `current_database()=aoi_management`      → `inspectionCaptureRowId IS NOT NULL`: **0**
 *   `current_database()=aoi_management_test` → `inspectionCaptureRowId IS NOT NULL`: **0**
 *   `machine_template_versions`: **0 / 0** · `product_captures`: **0 / 0**
 *   ⇒ **100% máy hôm nay CHƯA có bản dạy** — con số này là LÝ DO ĐO ĐƯỢC của
 *   quyết định "KHÔNG từ chối gói" (xem `ghiSoLechCayDay`, `server/db/inspection.ts`).
 *
 * ── TÁM MỆNH ĐỀ ─────────────────────────────────────────────────────────────
 *  1. Gói cây có **16 component đã dạy** ⇒ **16 hàng** `measurement_results` mang
 *     **CẢ HAI** cột `inspectionCaptureRowId` + `componentExtId`, và `pointDefId`
 *     trỏ đúng point-def **của CHÍNH MÁY ĐÓ** (JOIN ngược bốn cấp để chứng minh).
 *  2. **CHỐNG HỒI QUY** — verdict của mọi bo đã có (gồm mọi gói `committed`)
 *     **không đổi một byte**: băm `md5(id:overallResult)` trước/sau bằng nhau.
 *  3. Component `ntf = true` ⇒ hàng mang `ntf = true` **và** `result='NTF'` —
 *     không bị san phẳng ở BẤT KỲ cột nào trong hai cột đó.
 *  4. Component **CHƯA có bản dạy** ⇒ **0 hàng cho nó**, `chuaDay` đếm được, và —
 *     khi máy ĐÃ dạy — một hàng `audit_logs` `ingest.cay.component_chua_day`.
 *  5. **CHIỀU MÁY** — máy M2 (chưa dạy) gửi CÙNG payload ⇒ **0 hàng**, và tuyệt đối
 *     KHÔNG hàng nào trỏ vào point-def của M1. Không có ca này thì mệnh đề 1 chỉ
 *     chứng minh "tra ra một cái gì đó", không chứng minh "tra đúng máy".
 *  6. Gửi **LẠI** cùng bo ⇒ số hàng **KHÔNG TĂNG** (`measurement_results` không có
 *     ràng buộc duy nhất nào ở cặp `(inspectionCaptureRowId, componentExtId)` —
 *     hypertable ĐÃ NÉN — nên khử trùng phải đi theo capture cha).
 *  7. **CỬA ZIP** (`aoiPackageRouter.commit`) ghi y hệt — hai cửa v2.0 dùng chung
 *     mã, nhưng "chung mã" là LỜI KHAI; ca này ĐO trên đường ZIP → meta.json thật.
 *  8. **CÙNG MÁY dạy HAI sản phẩm bằng cây CLONE** (cùng bộ GUID capture/component)
 *     ⇒ mỗi bo tra đúng bản dạy của SẢN PHẨM NÓ KHAI. Ca này do một lượt chạy SONG
 *     SONG phát hiện, không có trong brief — xem chú thích trong thân ca.
 *
 * ── WORM và dấu chân để lại (ĐỌC TRƯỚC KHI SỬA) ─────────────────────────────
 * `product_inspections` và `audit_logs` là WORM: `avi_app` chỉ có INSERT/SELECT
 * (đo `information_schema.role_table_grants`, cả hai DB). Vì vậy lưới này **KHÔNG**
 * viết `DELETE ... .catch(() => {})` ở đâu cả (32 file test khác đang làm thế; tất
 * cả là no-op câm). Chiến lược giống `ingestCayKetQua.db.test.ts` đã chốt:
 *   · Dọn THẬT 100% những bảng `avi_app` CÓ DELETE: `measurement_results`,
 *     `inspection_captures/positions/surfaces`, `measurement_point_defs`,
 *     `product_surfaces` (CASCADE positions/captures), `machine_template_versions`,
 *     `api_keys`.
 *   · Cửa ZIP (mệnh đề 7) dọn thêm `inspection_packages`/`package_images`/
 *     `package_activity_logs` — cả ba đều có DELETE cho `avi_app`.
 *   · **CỐ Ý để lại**: 5 hàng `product_inspections`, các hàng `audit_logs` do chính
 *     bản vá ghi ra, và 1 hàng `product_models` (không xoá được vì bo trỏ vào).
 *     Máy dùng là máy **ĐÃ CÓ SẴN** — dựng máy mới sẽ khoá luôn `machines.id` đó
 *     bằng FK RESTRICT `fk_product_inspections_machine`.
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
import { HANH_DONG_LECH_CAY_DAY, tachTriDo } from "./inspection";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";
const CO_MAU = existsSync(MAU_MAY_THAT);
const RUN = `T3${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const MA_LINH_KIEN_LA = `${RUN}-CHUA-DAY`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
let bamVerdictTruoc = "";
let moc = 0;
const ids = { may1: 0, may2: 0, product: 0, product2: 0, key1: 0, key2: 0 };
let apiKey1 = "";
let apiKey2 = "";
/** inspectionId của từng bo lưới ghi — dùng để đếm và để dọn phần dọn được. */
const boDaGhi: number[] = [];
/** `inspection_packages.id` của cửa ZIP (mệnh đề 7) — dọn được, không WORM. */
const goiDaGhi: number[] = [];
const THU_MUC_ZIP = path.join(os.tmpdir(), `khoib-t3-${RUN}`);

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const caller = () => machineApiRouter.createCaller(ctx());

/** Mẫu cây DẠY thật (2/4/8/16), bản sao sâu mới mỗi lần gọi. */
function mauDay(): any {
  return JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));
}

/**
 * ★ Payload **KẾT QUẢ v2.0** dựng TỪ CHÍNH cây dạy ⇒ mọi `captureId`/`componentId`
 * khớp bản dạy theo cấu tạo. Đây là điều làm mệnh đề 1 có nghĩa: một payload với
 * GUID mới toanh sẽ cho `chuaDay = 16` và không phân biệt nổi "tra sai" với "chưa dạy".
 *
 * Bốn linh kiện đầu mang bốn hình dạng KHÁC NHAU có chủ đích:
 *   #0 `value="12.5"` (chuỗi SỐ)     → phải vào `measuredValue`
 *   #1 `value="NO_READ"` (không số)  → phải vào `measuredValueText`
 *   #2 `ntf=true`, `result="OK"`     → mệnh đề 3
 *   #3 `result="NG"` + errorCode/Desc → cột lỗi VẬN HÀNH (khác defectCodeRaw)
 */
function ketQuaTuCayDay(
  serial: string,
  opts?: { themLinhKienLa?: boolean; maSanPham?: string },
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
        startedAt: "2026-09-03T10:00:00.000",
        completedAt: "2026-09-03T10:00:01.000",
        components: c.components.map((k: any) => {
          const i = idx++;
          return {
            componentId: k.id,
            componentName: k.componentName,
            result: i === 3 ? ("NG" as const) : ("OK" as const),
            ntf: i === 2,
            value: i === 0 ? "12.5" : i === 1 ? "NO_READ" : 3.25,
            errorCode: i === 3 ? "E-VAL-01" : null,
            errorDesc: i === 3 ? "vuot nguong tren" : null,
            startedAt: "2026-09-03T10:00:00.100",
            completedAt: "2026-09-03T10:00:00.900",
          };
        }),
      })),
    })),
  }));

  if (opts?.themLinhKienLa) {
    // MỘT linh kiện KHÔNG có trong cây dạy, nhét vào capture ĐẦU TIÊN (capture đó
    // TRA RA ĐƯỢC, nên ca này phơi đúng "capture dạy rồi mà linh kiện thì chưa").
    surfaces[0].positions[0].captures[0].components.push({
      componentId: MA_LINH_KIEN_LA,
      componentName: "Linh kien may khai ma chua bao gio duoc day",
      result: "OK" as const,
      ntf: false,
      value: 1,
      errorCode: null,
      errorDesc: null,
    });
  }

  const dem = (n: number) => ({ total: n, pass: n, ng: 0, ntf: 0 });
  let soCap = 0;
  let soComp = 0;
  let soPos = 0;
  for (const s of surfaces) {
    soPos += s.positions.length;
    for (const p of s.positions) {
      soCap += p.captures.length;
      for (const c of p.captures) soComp += c.components.length;
    }
  }
  return {
    schemaVersion: "2.0",
    apiKey: "(dat sau)",
    identity: {
      station: "AIC-MA3", machine: "ASSY 04", line: "JUNIPER", plant: "FAC-HN",
      country: "VN", solutionName: "MODEL-X-SOLUTION", appVersion: "1.0.0",
    },
    // ⚠ `dungKhoaKhuTrungV2` băm (identity + productId + startedAt) — KHÔNG có
    // serialNumber. Bốn bo của lưới này phải khác `productId`, nếu không bo thứ hai
    // trở đi bị khử trùng về bo thứ nhất (đo được: lượt chạy đầu tiên đã dính).
    productId: `${RUN}-${serial}`,
    serialNumber: serial,
    productModel: opts?.maSanPham ?? `T3-${RUN}`,
    overallResult: "OK" as const,
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

/** Hàng cấp component của MỘT bo, JOIN NGƯỢC bốn cấp về đúng máy đã dạy. */
async function hangCua(inspectionId: number) {
  return sql<{
    componentExtId: string; pointDefId: number; result: string; ntf: boolean | null;
    ntfSource: string | null; errorCode: string | null; errorDesc: string | null;
    measuredValue: string | null; measuredValueText: string | null;
    captureExtId: string; mayDay: number | null; startedAt: Date | null;
  }[]>`
    SELECT mr."componentExtId", mr."pointDefId", mr.result::text AS result, mr.ntf,
           mr."ntfSource", mr."errorCode", mr."errorDesc",
           mr."measuredValue", mr."measuredValueText", mr."startedAt",
           ic."captureExtId", pc."machineId" AS "mayDay"
      FROM measurement_results mr
      JOIN inspection_captures ic ON ic.id = mr."inspectionCaptureRowId"
      LEFT JOIN measurement_point_defs mpd ON mpd.id = mr."pointDefId"
      LEFT JOIN product_captures pc ON pc.id = mpd."captureRowId"
     WHERE mr."inspectionId" = ${inspectionId}
     ORDER BY mr.id`;
}

describe.skipIf(!DB_URL || !CO_MAU)(
  "Khối B Task 3 — cấp COMPONENT ghi THẬT (Đ-19), vai avi_app, qua CỬA thật",
  () => {
    beforeAll(async () => {
      sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
      const [d] = await sql<{ db: string; usr: string; tz: string }[]>`
        SELECT current_database() AS db, current_user AS usr, current_setting('TimeZone') AS tz`;
      tenDb = d.db;
      expect(d.usr, "phải đo bằng vai avi_app — vai aoi (superuser+BYPASSRLS) làm mọi phép đo xanh giả").toBe("avi_app");
      // eslint-disable-next-line no-console
      console.log(`[capComponentGhiThat] current_database()=${d.db} current_user=${d.usr} TimeZone=${d.tz}`);

      const may = await sql<{ id: number }[]>`SELECT id FROM machines ORDER BY id LIMIT 2`;
      if (may.length < 2) {
        throw new Error(
          "capComponentGhiThat.db.test: DB test cần ÍT NHẤT HAI máy — mệnh đề 5 (chiều máy) vô nghĩa với một máy.",
        );
      }
      ids.may1 = may[0].id;
      ids.may2 = may[1].id;
      expect(ids.may1).not.toBe(ids.may2);

      // MỆNH ĐỀ 2 — chụp verdict của MỌI bo đang có TRƯỚC khi lưới ghi hàng nào.
      const [truoc] = await sql<{ bam: string; moc: number }[]>`
        SELECT md5(coalesce(string_agg(id::text || ':' || "overallResult"::text, ',' ORDER BY id), '')) AS bam,
               coalesce(max(id), 0)::int AS moc
          FROM product_inspections`;
      bamVerdictTruoc = truoc.bam;
      moc = truoc.moc;

      const [p] = await sql<{ id: number }[]>`
        INSERT INTO product_models (code, name) VALUES (${"T3-" + RUN}, 'Khoi B Task 3 cap component') RETURNING id`;
      ids.product = p.id;

      const c1 = await issueMachineKey({
        machineId: ids.may1, name: `khoib-task3-m1-${RUN}`, scopes: ["ingest:write", "equipment:read"],
      });
      apiKey1 = c1.plaintextKey;
      ids.key1 = c1.id;
      const c2 = await issueMachineKey({
        machineId: ids.may2, name: `khoib-task3-m2-${RUN}`, scopes: ["ingest:write", "equipment:read"],
      });
      apiKey2 = c2.plaintextKey;
      ids.key2 = c2.id;

      // M1 đẩy cây DẠY (Task 2 + Task 5) — 2/4/8/16. M2 CỐ Ý KHÔNG đẩy gì.
      const day = await caller().submitMachineTemplate({
        apiKey: apiKey1, productModelCode: `T3-${RUN}`, template: mauDay(),
      });
      expect({ s: day.surfaces, p: day.positions, c: day.captures, k: day.components })
        .toEqual({ s: 2, p: 4, c: 8, k: 16 });
    }, 90_000);

    afterAll(async () => {
      if (!sql) return;
      // Chỉ những bảng `avi_app` THỰC SỰ có DELETE — không `.catch(() => {})` ở đâu cả.
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
      const sanPham = [ids.product, ids.product2].filter((x) => x > 0);
      await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ANY(${sanPham})`;
      await sql`DELETE FROM product_surfaces WHERE "productModelId" = ANY(${sanPham})`;
      await sql`DELETE FROM machine_template_versions WHERE "productModelId" = ANY(${sanPham})`;
      if (ids.key1) await sql`DELETE FROM api_keys WHERE id = ${ids.key1}`;
      if (ids.key2) await sql`DELETE FROM api_keys WHERE id = ${ids.key2}`;
      // ⚠ KHÔNG xoá `product_models` (bo WORM trỏ vào), `product_inspections`, `audit_logs`.
      await sql.end();
      await fsp.rm(THU_MUC_ZIP, { recursive: true, force: true });
    }, 90_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 1 + 3 — 16 component đã dạy ⇒ 16 hàng, cả hai cột Khối B, pointDefId ĐÚNG MÁY, NTF không bị san phẳng", async () => {
      const payload = ketQuaTuCayDay(`${RUN}-A`);
      payload.apiKey = apiKey1;
      const kq: any = await caller().submitInspection(payload);
      expect(kq.success).toBe(true);
      boDaGhi.push(kq.inspectionId);

      expect(kq.capComponent, `[current_database()=${tenDb}] cửa phải ĐẾM ĐƯỢC tận nơi trả về`).toEqual({
        tong: 16, daGhi: 16, chuaDay: 0, mayCoBanDay: true,
      });

      const hang = await hangCua(kq.inspectionId);
      expect(hang.length, `[${tenDb}] 16 component ⇒ 16 hàng measurement_results`).toBe(16);

      // CẢ HAI cột Khối B khác NULL trên MỌI hàng (JOIN ở `hangCua` đã ép
      // `inspectionCaptureRowId` khác NULL — hàng thiếu nó rơi khỏi kết quả).
      expect(hang.every((h) => !!h.componentExtId), `[${tenDb}] componentExtId phải khác NULL`).toBe(true);

      // ★ `pointDefId` trỏ point-def CỦA CHÍNH MÁY ĐÓ — chứng minh bằng JOIN NGƯỢC
      // qua `product_captures.machineId` (chiều máy Task 5), KHÔNG đọc
      // `measurement_point_defs.machineId` (cột mang HAI nghĩa, không cổng nào canh).
      expect(
        hang.map((h) => h.mayDay).filter((m) => m !== ids.may1).length,
        `[${tenDb}] mọi pointDefId phải thuộc cây dạy của MÁY ${ids.may1}`,
      ).toBe(0);
      expect(new Set(hang.map((h) => h.pointDefId)).size, `[${tenDb}] 16 point-def KHÁC NHAU`).toBe(16);

      // …và mỗi hàng phải neo vào ĐÚNG capture chứa linh kiện đó (không chỉ "một capture nào đó").
      const capTheoComp = new Map<string, string>();
      for (const s of mauDay().surfaces)
        for (const p of s.positions)
          for (const c of p.captures)
            for (const k of c.components) capTheoComp.set(k.id, c.id);
      const lechNeo = hang.filter((h) => capTheoComp.get(h.componentExtId) !== h.captureExtId);
      expect(lechNeo.length, `[${tenDb}] hàng phải neo vào ĐÚNG capture của linh kiện đó`).toBe(0);

      // Nhánh SỐ / nhánh CHUỖI (mẫu hành vi v1.x, dùng lại qua `tachTriDo`).
      const theoComp = new Map(hang.map((h) => [h.componentExtId, h]));
      const maTheoIdx: string[] = [];
      for (const s of mauDay().surfaces)
        for (const p of s.positions)
          for (const c of p.captures)
            for (const k of c.components) maTheoIdx.push(k.id);

      const h0 = theoComp.get(maTheoIdx[0])!;
      expect(Number(h0.measuredValue), `[${tenDb}] "12.5" là chuỗi SỐ ⇒ measuredValue`).toBe(12.5);
      expect(h0.measuredValueText).toBeNull();

      const h1 = theoComp.get(maTheoIdx[1])!;
      expect(h1.measuredValue, `[${tenDb}] "NO_READ" không parse được số ⇒ KHÔNG vào measuredValue`).toBeNull();
      expect(h1.measuredValueText).toBe("NO_READ");

      // ★ MỆNH ĐỀ 3 — NTF không bị san phẳng ở CẢ HAI cột.
      const h2 = theoComp.get(maTheoIdx[2])!;
      expect(
        { ntf: h2.ntf, result: h2.result, nguon: h2.ntfSource },
        `[${tenDb}] component ntf=true phải giữ CỜ THÔ và KHÔNG bị hạ verdict xuống OK`,
      ).toEqual({ ntf: true, result: "NTF", nguon: "machine" });

      // Lỗi VẬN HÀNH của phép đo (khác defectCodeRaw = mã lỗi SẢN PHẨM).
      const h3 = theoComp.get(maTheoIdx[3])!;
      expect({ result: h3.result, ma: h3.errorCode, mota: h3.errorDesc }).toEqual({
        result: "NG", ma: "E-VAL-01", mota: "vuot nguong tren",
      });

      // Mốc thời gian per-phép-đo đi theo quy ước của CẤP CHA (capture), không phải
      // phép dịch "fake UTC" của product_inspections.inspectionTime — xem báo cáo §múi giờ.
      expect(h3.startedAt, `[${tenDb}] startedAt của phép đo phải được ghi`).not.toBeNull();
    }, 120_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 5 — CHIỀU MÁY: M2 chưa dạy gửi CÙNG payload ⇒ 0 hàng, KHÔNG mượn point-def của M1", async () => {
      const payload = ketQuaTuCayDay(`${RUN}-B`);
      payload.apiKey = apiKey2;
      const kq: any = await caller().submitInspection(payload);
      expect(kq.success).toBe(true);
      boDaGhi.push(kq.inspectionId);

      expect(kq.capComponent, `[current_database()=${tenDb}] M2 chưa dạy ⇒ 0 hàng, và NÓI RA điều đó`).toEqual({
        tong: 16, daGhi: 0, chuaDay: 16, mayCoBanDay: false,
      });

      const hang = await hangCua(kq.inspectionId);
      expect(hang.length, `[${tenDb}] bo của M2 KHÔNG được mượn bản dạy của M1`).toBe(0);

      // …nhưng bo VẪN vào sổ và cây kết quả VẪN đủ — đây là điều tách ca này khỏi lớp C-1.
      const [c] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM inspection_captures WHERE "inspectionId" = ${kq.inspectionId}`;
      expect(c.n, `[${tenDb}] cây KẾT QUẢ vẫn ghi đủ 8 capture — bo không biến mất`).toBe(8);

      // Máy CHƯA dạy SẢN PHẨM NÀY ⇒ CỐ Ý không ghi audit mỗi bo (xem `ghiSoLechCayDay`).
      // ⚠ `mayCoBanDay` có phạm vi `(máy, sản phẩm)`, nên ca này KHÔNG phụ thuộc việc
      // một lưới chạy song song có dạy M2 cho một sản phẩm KHÁC hay không (đo được:
      // chạy cùng `cayDayChieuMay.db.test.ts` từng làm ca này đỏ khi phạm vi là máy).
      const [a] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_logs
         WHERE action = ${HANH_DONG_LECH_CAY_DAY} AND "entityId" = ${kq.inspectionId}`;
      expect(a.n, `[${tenDb}] nhánh "chưa mở cửa" KHÔNG ghi WORM mỗi bo — nó đếm ở chỗ khác`).toBe(0);
    }, 120_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 4 — linh kiện CHƯA DẠY của máy ĐÃ DẠY: không hàng, đếm được, và VÀO SỔ audit_logs", async () => {
      const payload = ketQuaTuCayDay(`${RUN}-C`, { themLinhKienLa: true });
      payload.apiKey = apiKey1;
      const kq: any = await caller().submitInspection(payload);
      expect(kq.success, "gói KHÔNG bị từ chối — xem báo cáo §quyết định").toBe(true);
      boDaGhi.push(kq.inspectionId);

      expect(kq.capComponent, `[current_database()=${tenDb}] 16 dạy rồi + 1 chưa dạy`).toEqual({
        tong: 17, daGhi: 16, chuaDay: 1, mayCoBanDay: true,
      });

      const hang = await hangCua(kq.inspectionId);
      expect(hang.length).toBe(16);
      expect(
        hang.some((h) => h.componentExtId === MA_LINH_KIEN_LA),
        `[${tenDb}] linh kiện chưa dạy KHÔNG được ghi bằng một pointDefId bịa ra`,
      ).toBe(false);

      // ★ CỜ LỆCH vào sổ WORM — đây là điều làm nhánh này KHÁC "bỏ qua im lặng".
      const so = await sql<{ details: string; status: string }[]>`
        SELECT details, status::text AS status FROM audit_logs
         WHERE action = ${HANH_DONG_LECH_CAY_DAY} AND "entityId" = ${kq.inspectionId}`;
      expect(so.length, `[${tenDb}] máy ĐÃ dạy mà khai linh kiện ngoài cây ⇒ ĐÚNG MỘT hàng audit`).toBe(1);
      const chiTiet = JSON.parse(so[0].details);
      expect(
        { may: chiTiet.machineId, tong: chiTiet.tong, daGhi: chiTiet.daGhi, chuaDay: chiTiet.chuaDay },
        `[${tenDb}] sổ phải mang đủ con số để truy được, không chỉ một dòng chữ`,
      ).toEqual({ may: ids.may1, tong: 17, daGhi: 16, chuaDay: 1 });
      expect(chiTiet.mauChuaDay, `[${tenDb}] sổ phải nêu ĐÍCH DANH linh kiện nào`).toContain(
        `${mauDay().surfaces[0].positions[0].captures[0].id}/${MA_LINH_KIEN_LA}`,
      );
    }, 120_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 6 — gửi LẠI cùng bo ⇒ số hàng cấp component KHÔNG TĂNG", async () => {
      const payload = ketQuaTuCayDay(`${RUN}-D`);
      payload.apiKey = apiKey1;
      const lan1: any = await caller().submitInspection(payload);
      boDaGhi.push(lan1.inspectionId);
      const sau1 = (await hangCua(lan1.inspectionId)).length;
      expect(sau1).toBe(16);

      const lan2: any = await caller().submitInspection(payload);
      expect(lan2.inspectionId, "khử trùng ở cấp bo phải hội tụ về CÙNG một inspection").toBe(lan1.inspectionId);
      const sau2 = (await hangCua(lan1.inspectionId)).length;
      expect(sau2, `[current_database()=${tenDb}] phát lại KHÔNG được nhân bản hàng cấp component`).toBe(sau1);
    }, 120_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 2 — CHỐNG HỒI QUY: verdict của MỌI bo đã có (gồm mọi gói committed) KHÔNG ĐỔI", async () => {
      const [sau] = await sql<{ bam: string }[]>`
        SELECT md5(coalesce(string_agg(id::text || ':' || "overallResult"::text, ',' ORDER BY id), '')) AS bam
          FROM product_inspections WHERE id <= ${moc}`;
      expect(sau.bam, `[current_database()=${tenDb}] Task 3 CHỈ THÊM HÀNG — không bo cũ nào đổi verdict`)
        .toBe(bamVerdictTruoc);

      // Phép đo trên là băm; kèm một phép đếm THÔ để một chuỗi rỗng không tự-thoả.
      const [n] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM product_inspections WHERE id <= ${moc}`;
      expect(n.n, `[${tenDb}] nền so sánh phải có bo thật, không phải tập rỗng`).toBeGreaterThan(100);
    }, 120_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 7 — CỬA ZIP (aoiPackageRouter.commit) cũng ghi cấp component, KHÔNG chỉ cửa trực tiếp", async () => {
      // Hai cửa v2.0 gọi CHUNG `db.traBanDayChoCay` + `persistInspectionAtomic({tra})`,
      // nhưng "chung mã" là lời khai; ca này ĐO. Cửa ZIP có đường đi riêng (ZIP → meta.json
      // → `metaJsonSchema` → `dichCayKetQua`), và nó là cửa mà lớp lỗi C-1 đã xảy ra.
      process.env.STORAGE_MODE = "local";
      process.env.LOCAL_STORAGE_DIR = THU_MUC_ZIP;
      try {
        const meta: any = ketQuaTuCayDay(`${RUN}-Z`);
        delete meta.apiKey;
        delete meta.schemaVersion;

        const packageId = `T3-ZIP-${RUN}`;
        const storageKey = `aoi-packages/${packageId}.zip`;
        const filePath = path.join(THU_MUC_ZIP, storageKey);
        const zip = new JSZip();
        zip.file("meta.json", JSON.stringify(meta));
        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, zipBuffer);

        const [pkg] = await sql<{ id: number }[]>`
          INSERT INTO inspection_packages ("machineId", "packageId", "storageKey", status)
          VALUES (${ids.may1}, ${packageId}, ${storageKey}, 'uploaded') RETURNING id`;
        goiDaGhi.push(pkg.id);

        const ket: any = await aoiPackageRouter
          .createCaller({ user: null } as never)
          .commit({ apiKey: apiKey1, packageId });
        expect(ket.success).toBe(true);
        expect(ket.capComponent, `[current_database()=${tenDb}] cửa ZIP cũng phải ĐẾM ĐƯỢC`).toEqual({
          tong: 16, daGhi: 16, chuaDay: 0, mayCoBanDay: true,
        });

        // ⚠ Bằng chứng cuối KHÔNG lấy từ giá trị `commit()` trả về — SELECT lại đĩa.
        boDaGhi.push(ket.inspectionId);
        const hang = await hangCua(ket.inspectionId);
        expect(hang.length, `[${tenDb}] cửa ZIP ⇒ 16 hàng measurement_results`).toBe(16);
        expect(hang.filter((h) => h.mayDay !== ids.may1).length, `[${tenDb}] đúng máy`).toBe(0);
      } finally {
        delete process.env.STORAGE_MODE;
        delete process.env.LOCAL_STORAGE_DIR;
      }
    }, 120_000);

    it("MỆNH ĐỀ 8 — CÙNG MÁY dạy HAI sản phẩm bằng cây CLONE (cùng bộ GUID) ⇒ mỗi bo tra ĐÚNG bản dạy của SẢN PHẨM NÓ KHAI", async () => {
      // ★★★ CA NÀY KHÔNG PHẢI PHÒNG THỦ GIẢ ĐỊNH. Đo được 2026-09-03: lượt
      // `vitest run server/` chạy SONG SONG với `cayDayChieuMay.db.test.ts` (cùng hai
      // máy, CÙNG mẫu máy thật, khác product model) đã làm mệnh đề 7 ĐỎ với
      // `{tong:16, daGhi:0, chuaDay:16}` — vì khoá `(máy, capture, component)` tra ra
      // HAI point-def và bộ tra CỐ Ý bỏ cặp nhập nhằng thay vì đoán bừa. Bản vá thêm
      // lọc `productModelId`; ca này là lưới giữ nó.
      const [p2] = await sql<{ id: number }[]>`
        INSERT INTO product_models (code, name) VALUES (${"T3B-" + RUN}, 'Khoi B Task 3 - san pham thu hai (cay clone)')
        RETURNING id`;
      ids.product2 = p2.id;
      const day2 = await caller().submitMachineTemplate({
        apiKey: apiKey1, productModelCode: `T3B-${RUN}`, template: mauDay(),
      });
      expect({ s: day2.surfaces, k: day2.components }).toEqual({ s: 2, k: 16 });

      // Hai bộ point-def CÙNG MÁY, CÙNG bộ GUID, KHÁC sản phẩm — nền của ca này.
      const [nen] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM measurement_point_defs mpd
          JOIN product_captures pc ON pc.id = mpd."captureRowId"
         WHERE pc."machineId" = ${ids.may1} AND mpd."deletedAt" IS NULL
           AND mpd."productModelId" = ANY(${[ids.product, ids.product2]})`;
      expect(nen.n, `[current_database()=${tenDb}] 16 + 16 point-def cây cùng máy`).toBe(32);

      const payload = ketQuaTuCayDay(`${RUN}-E`, { maSanPham: `T3B-${RUN}` });
      payload.apiKey = apiKey1;
      const kq: any = await caller().submitInspection(payload);
      boDaGhi.push(kq.inspectionId);
      expect(kq.capComponent, `[${tenDb}] bo khai T3B phải tra ĐÚNG bản dạy T3B, không nhập nhằng`).toEqual({
        tong: 16, daGhi: 16, chuaDay: 0, mayCoBanDay: true,
      });

      // …và point-def nó trỏ tới phải thuộc SẢN PHẨM T3B, không phải T3.
      const [lech] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM measurement_results mr
          JOIN measurement_point_defs mpd ON mpd.id = mr."pointDefId"
         WHERE mr."inspectionId" = ${kq.inspectionId} AND mpd."productModelId" <> ${ids.product2}`;
      expect(lech.n, `[${tenDb}] KHÔNG hàng nào được trỏ sang bản dạy của sản phẩm KIA`).toBe(0);
    }, 120_000);

    it("tachTriDo — MẪU HÀNH VI v1.x giữ nguyên từng nhánh (hàm nay dùng chung hai đường)", () => {
      expect(tachTriDo(12.5)).toEqual({ measuredValue: "12.5" });
      expect(tachTriDo("12.5")).toEqual({ measuredValue: "12.5" });
      expect(tachTriDo("NO_READ")).toEqual({ measuredValueText: "NO_READ" });
      // "" → Number("") === 0, KHÔNG NaN. Vế `rawValue !== ''` của v1.x giữ nó ở
      // nhánh TEXT; bỏ vế đó biến "máy không đo được" thành "đo được 0".
      expect(tachTriDo("")).toEqual({ measuredValueText: "" });
      expect(tachTriDo(null)).toEqual({});
      expect(tachTriDo(undefined)).toEqual({});
    });
  },
);
