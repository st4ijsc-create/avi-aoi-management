/**
 * server/db/cayDayChieuMay.db.test.ts
 *
 * Khối B — **Task 5 (B-6)**: chiều **MÁY** + chiều **PHIÊN BẢN** cho cây dạy
 * (migration 0347, `server/db/cayDay.ts`, cửa `submitMachineTemplate`).
 *
 * Chạy trên DB test cô lập bằng vai **`avi_app`** (KHÔNG phải `aoi`: superuser +
 * BYPASSRLS làm mọi phép đo quyền XANH GIẢ). Đi qua **CỬA THẬT**
 * (`machineApiRouter.createCaller`), không gọi thẳng `ghiCayDay` — gọi thẳng hàm
 * chứng minh HÀM chạy, không chứng minh CỬA gắn máy ĐÃ XÁC THỰC vào hàm.
 *
 * ── BỐN MỆNH ĐỀ của brief (mỗi con số kèm `current_database()`, luật Đ-28) ────
 *  1. Máy **M1** đẩy cây ⇒ 2/4/8/16. Máy **M2** đẩy cây **KHÁC** cho **CÙNG**
 *     product model ⇒ **CẢ HAI bộ cùng tồn tại**, không bộ nào mất.
 *  2. `measurement_point_defs."machineId"` **khác NULL** trên MỌI hàng do cửa ghi
 *     — và cả ba cấp trên cũng vậy.
 *  3. Đẩy **LẠI cùng cây, cùng máy** ⇒ số hàng **KHÔNG ĐỔI** (bất biến hội tụ của
 *     Task 2 còn nguyên) **và** KHÔNG sinh phiên bản mới.
 *  4. Hai bản dạy khác nhau **cùng một máy** ⇒ phân biệt được, và **kết quả CŨ vẫn
 *     tra ra BẢN DẠY CŨ** (`traBanDayTaiThoiDiem`, snapshot BẤT BIẾN).
 *
 * ── BỐN mệnh đề THÊM: chiều máy phải KHÔNG THỂ lệch, không chỉ "được ghi đúng" ─
 *  5. Ghi tay một `product_positions` mang `machineId` KHÁC surface cha ⇒ `23503`
 *     (FK GHÉP `fk_positions_surface_may`). Không có ca này thì mệnh đề 2 chỉ
 *     chứng minh *đường ghi của tôi* đúng, không chứng minh *chiều máy* đúng.
 *  6. Ghi tay một point-def CÂY (`captureRowId` có) mà `machineId` NULL ⇒ `23514`
 *     (CHECK `ck_point_defs_cay_phai_co_may`) — chính là "chiều nửa vời" bị cấm.
 *  7. `uq_mtv_hien_hanh` — không bao giờ hai bản dạy "hiện hành" cùng `(máy, model)`.
 *  8. Index CŨ `uq_product_surfaces_model_name` KHÔNG được phục sinh. ⚠ Ca này
 *     KHÔNG phải phòng thủ giả định: chạy lại migration 0338 (re-runnable) sau 0347
 *     ĐÃ dựng lại nó ở cả hai DB, đo được 2026-09-03.
 *
 * ── ⚠ CA KHÓ NHẤT ĐƯỢC CHỌN CÓ CHỦ ĐÍCH ────────────────────────────────────
 * Cây của M2 dùng **Y HỆT** bộ `surfaceId`/`surfaceName`/`positionId`/`capture.id`/
 * `component.id` của M1, chỉ đổi ROI. Đó là ca CLONE bản dạy từ máy A sang máy B
 * rồi chỉnh — ca thường gặp nhất ở phân xưởng, và là ca DUY NHẤT phơi được cả ba
 * chỗ đụng: `uq_product_surfaces_model_may_name`, SELECT-theo-`surfaceExtId` ở
 * tầng ứng dụng, và `uq_point_defs_cay_may_code`. Một cây M2 với UUID mới toanh sẽ
 * XANH ngay cả khi chiều máy hoàn toàn không tồn tại.
 *
 * ── DẤU CHÂN ĐỂ LẠI: KHÔNG ─────────────────────────────────────────────────
 * Năm bảng chạm tới đều KHÔNG WORM (`avi_app` có DELETE — đo `role_table_grants`),
 * nên `afterAll` dọn 100% bằng DELETE THẬT và **KHÔNG** `.catch(() => {})` (một
 * `catch` rỗng ở đây là dọn dẹp NO-OP CÂM). Lưới KHÔNG ghi `product_inspections`
 * / `audit_logs` (WORM). Hai máy dùng là máy **ĐÃ CÓ SẴN**; credential là `api_keys`
 * lưới tự phát và tự xoá.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { machineApiRouter } from "../routers/machineApiRouters";
import { issueMachineKey } from "../services/machineAuthService";
import { traBanDayTaiThoiDiem, traBanDayHienHanh, bamCayDay } from "./cayDay";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";
const CO_MAU = existsSync(MAU_MAY_THAT);
const RUN = `T5${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = { may1: 0, may2: 0, product: 0, key1: 0, key2: 0 };
let apiKey1 = "";
let apiKey2 = "";

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const caller = () => machineApiRouter.createCaller(ctx());

/** Mẫu máy THẬT, bản sao sâu mới mỗi lần gọi. */
function mauThat(): any {
  return JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));
}

/**
 * Cây của M2: **cùng mọi khoá** với M1, chỉ ROI dịch đi `+1000`. Xem docblock —
 * đây là ca clone-bản-dạy, ca khó nhất, không phải một cây "khác" tầm thường.
 */
function mauCuaMay2(): any {
  const m = mauThat();
  for (const s of m.surfaces)
    for (const p of s.positions)
      for (const c of p.captures)
        for (const k of c.components) {
          k.roi.x += 1000;
          k.roi.y += 1000;
        }
  return m;
}

/** Đếm bốn cấp CHO ĐÚNG một `(productModelId, machineId)`. */
async function demCayCuaMay(productModelId: number, machineId: number) {
  const [r] = await sql<
    { surfaces: number; positions: number; captures: number; comp_song: number; comp_xoa_mem: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM product_surfaces
        WHERE "productModelId" = ${productModelId} AND "machineId" = ${machineId}) AS surfaces,
      (SELECT count(*)::int FROM product_positions pp
         JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
        WHERE ps."productModelId" = ${productModelId} AND pp."machineId" = ${machineId}) AS positions,
      (SELECT count(*)::int FROM product_captures pc
         JOIN product_positions pp ON pp.id = pc."positionRowId"
         JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
        WHERE ps."productModelId" = ${productModelId} AND pc."machineId" = ${machineId}) AS captures,
      (SELECT count(*)::int FROM measurement_point_defs
        WHERE "productModelId" = ${productModelId} AND "machineId" = ${machineId}
          AND "componentExtId" IS NOT NULL AND "deletedAt" IS NULL) AS comp_song,
      (SELECT count(*)::int FROM measurement_point_defs
        WHERE "productModelId" = ${productModelId} AND "machineId" = ${machineId}
          AND "componentExtId" IS NOT NULL AND "deletedAt" IS NOT NULL) AS comp_xoa_mem`;
  return r;
}

/** ROI của MỘT linh kiện, đọc theo `(máy, componentExtId)`. */
async function roiCua(machineId: number, componentExtId: string) {
  const [r] = await sql<{ x: number; y: number }[]>`
    SELECT "roiX" AS x, "roiY" AS y FROM measurement_point_defs
     WHERE "productModelId" = ${ids.product} AND "machineId" = ${machineId}
       AND "componentExtId" = ${componentExtId} AND "deletedAt" IS NULL`;
  return r ? { x: r.x, y: r.y } : null;
}

describe.skipIf(!DB_URL || !CO_MAU)(
  "Khối B Task 5 — chiều MÁY + chiều PHIÊN BẢN cho cây dạy (ghi THẬT, vai avi_app)",
  () => {
    beforeAll(async () => {
      sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
      const [d] = await sql<{ db: string; usr: string }[]>`
        SELECT current_database() AS db, current_user AS usr`;
      tenDb = d.db;
      // ⚠ Cầu chì: vai không phải `avi_app` thì mọi phép đo quyền bên dưới vô nghĩa.
      expect(d.usr, "phải đo bằng vai avi_app — vai aoi (superuser+BYPASSRLS) làm mọi phép đo xanh giả").toBe("avi_app");
      // eslint-disable-next-line no-console
      console.log(`[cayDayChieuMay] current_database()=${d.db} current_user=${d.usr}`);

      // HAI máy CÓ SẴN, KHÁC NHAU — không dựng máy mới (không đụng station/line).
      const may = await sql<{ id: number }[]>`SELECT id FROM machines ORDER BY id LIMIT 2`;
      if (may.length < 2) {
        throw new Error(
          "cayDayChieuMay.db.test: DB test cần ÍT NHẤT HAI máy — cả mệnh đề 1 lẫn 4 vô nghĩa với một máy. " +
            "Chạy node scripts/setup-test-db.mjs trước.",
        );
      }
      ids.may1 = may[0].id;
      ids.may2 = may[1].id;
      expect(ids.may1, "hai máy phải THỰC SỰ khác nhau").not.toBe(ids.may2);

      const [p] = await sql<{ id: number }[]>`
        INSERT INTO product_models (code, name) VALUES (${"T5-" + RUN}, 'Khoi B Task 5 chieu may') RETURNING id`;
      ids.product = p.id;

      const c1 = await issueMachineKey({
        machineId: ids.may1, name: `khoib-task5-m1-${RUN}`, scopes: ["ingest:write", "equipment:read"],
      });
      apiKey1 = c1.plaintextKey;
      ids.key1 = c1.id;
      const c2 = await issueMachineKey({
        machineId: ids.may2, name: `khoib-task5-m2-${RUN}`, scopes: ["ingest:write", "equipment:read"],
      });
      apiKey2 = c2.plaintextKey;
      ids.key2 = c2.id;
    }, 60_000);

    afterAll(async () => {
      if (!sql) return;
      // Năm bảng KHÔNG WORM — dọn THẬT, không `.catch(() => {})`.
      await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_surfaces WHERE "productModelId" = ${ids.product}`; // CASCADE positions/captures
      await sql`DELETE FROM machine_template_versions WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
      if (ids.key1) await sql`DELETE FROM api_keys WHERE id = ${ids.key1}`;
      if (ids.key2) await sql`DELETE FROM api_keys WHERE id = ${ids.key2}`;
      await sql.end();
    }, 60_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 1 — M1 đẩy 2/4/8/16; M2 đẩy cây KHÁC cho CÙNG model ⇒ CẢ HAI bộ cùng sống", async () => {
      const nen1 = await demCayCuaMay(ids.product, ids.may1);
      const nen2 = await demCayCuaMay(ids.product, ids.may2);
      expect({ nen1, nen2 }, `[${tenDb}] nền phải rỗng cho cả hai máy`).toEqual({
        nen1: { surfaces: 0, positions: 0, captures: 0, comp_song: 0, comp_xoa_mem: 0 },
        nen2: { surfaces: 0, positions: 0, captures: 0, comp_song: 0, comp_xoa_mem: 0 },
      });

      const k1 = await caller().submitMachineTemplate({
        apiKey: apiKey1, productModelCode: `T5-${RUN}`, template: mauThat(),
      });
      expect({ s: k1.surfaces, p: k1.positions, c: k1.captures, k: k1.components }).toEqual({
        s: 2, p: 4, c: 8, k: 16,
      });

      // ★★★ ĐÂY LÀ CHỖ TASK 5 TỒN TẠI ĐỂ BỊT: máy THỨ HAI, CÙNG product model,
      // cây mang Y HỆT mọi khoá của máy thứ nhất.
      const k2 = await caller().submitMachineTemplate({
        apiKey: apiKey2, productModelCode: `T5-${RUN}`, template: mauCuaMay2(),
      });
      expect({ s: k2.surfaces, p: k2.positions, c: k2.captures, k: k2.components }).toEqual({
        s: 2, p: 4, c: 8, k: 16,
      });
      expect(k2.componentsXoaMem, "lượt đẩy của M2 KHÔNG được xoá mềm một linh kiện nào của M1").toBe(0);

      const sau1 = await demCayCuaMay(ids.product, ids.may1);
      const sau2 = await demCayCuaMay(ids.product, ids.may2);
      expect({ sau1, sau2 }, `[current_database()=${tenDb}] hai bộ 2/4/8/16 SONG SONG, không bộ nào mất`).toEqual({
        sau1: { surfaces: 2, positions: 4, captures: 8, comp_song: 16, comp_xoa_mem: 0 },
        sau2: { surfaces: 2, positions: 4, captures: 8, comp_song: 16, comp_xoa_mem: 0 },
      });

      // Tổng theo sản phẩm = 4 / 8 / 16 / 32 — đếm KHÔNG lọc máy, để một lỗi
      // "đếm hai lần cùng một hàng" không lọt.
      const [tong] = await sql<{ s: number; p: number; c: number; k: number }[]>`
        SELECT
          (SELECT count(*)::int FROM product_surfaces WHERE "productModelId" = ${ids.product}) AS s,
          (SELECT count(*)::int FROM product_positions pp JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
            WHERE ps."productModelId" = ${ids.product}) AS p,
          (SELECT count(*)::int FROM product_captures pc JOIN product_positions pp ON pp.id = pc."positionRowId"
             JOIN product_surfaces ps ON ps.id = pp."surfaceRowId" WHERE ps."productModelId" = ${ids.product}) AS c,
          (SELECT count(*)::int FROM measurement_point_defs
            WHERE "productModelId" = ${ids.product} AND "componentExtId" IS NOT NULL AND "deletedAt" IS NULL) AS k`;
      expect(tong, `[${tenDb}] tổng bốn cấp của sản phẩm = ĐÚNG hai lần một cây`).toEqual({
        s: 4, p: 8, c: 16, k: 32,
      });

      // ★ NỘI DUNG cũng phải riêng: ROI của M1 KHÔNG bị M2 ghi đè.
      const mot = mauThat().surfaces[0].positions[0].captures[0].components[0];
      const r1 = await roiCua(ids.may1, mot.id);
      const r2 = await roiCua(ids.may2, mot.id);
      expect(r1, `[${tenDb}] ROI của M1 phải Y NGUYÊN mẫu gốc (đếm hàng đúng vẫn có thể ghi đè NỘI DUNG)`).toEqual({
        x: mot.roi.x, y: mot.roi.y,
      });
      expect(r2, `[${tenDb}] ROI của M2 phải là cây CỦA NÓ`).toEqual({
        x: mot.roi.x + 1000, y: mot.roi.y + 1000,
      });
    }, 90_000);

    it("MỆNH ĐỀ 2 — machineId KHÁC NULL trên MỌI hàng cửa ghi, ở CẢ BỐN cấp", async () => {
      const [n] = await sql<{ s: number; p: number; c: number; k: number }[]>`
        SELECT
          (SELECT count(*)::int FROM product_surfaces
            WHERE "productModelId" = ${ids.product} AND "machineId" IS NULL) AS s,
          (SELECT count(*)::int FROM product_positions pp JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
            WHERE ps."productModelId" = ${ids.product} AND pp."machineId" IS NULL) AS p,
          (SELECT count(*)::int FROM product_captures pc JOIN product_positions pp ON pp.id = pc."positionRowId"
             JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
            WHERE ps."productModelId" = ${ids.product} AND pc."machineId" IS NULL) AS c,
          (SELECT count(*)::int FROM measurement_point_defs
            WHERE "productModelId" = ${ids.product} AND "captureRowId" IS NOT NULL AND "machineId" IS NULL) AS k`;
      expect(n, `[current_database()=${tenDb}] KHÔNG hàng nào của cây dạy được thiếu machineId`).toEqual({
        s: 0, p: 0, c: 0, k: 0,
      });

      // ⚠ "khác NULL" chưa đủ — nó phải khác NULL VÀ khớp cha. JOIN bốn cấp và đếm
      // hàng LỆCH: một `machineId` đúng-kiểu nhưng sai-giá-trị vẫn qua được ca trên.
      const lech = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM measurement_point_defs mpd
          JOIN product_captures  pc ON pc.id = mpd."captureRowId"
          JOIN product_positions pp ON pp.id = pc."positionRowId"
          JOIN product_surfaces  ps ON ps.id = pp."surfaceRowId"
         WHERE ps."productModelId" = ${ids.product}
           AND (mpd."machineId" <> ps."machineId" OR pp."machineId" <> ps."machineId"
                OR pc."machineId" <> ps."machineId")`;
      expect(lech[0].n, `[${tenDb}] KHÔNG hàng nào được mang machineId khác cha nó`).toBe(0);

      // Và `templateVersionId` phải trỏ ĐÚNG bản dạy của chính máy đó.
      const sai = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM measurement_point_defs mpd
          LEFT JOIN machine_template_versions v ON v.id = mpd."templateVersionId"
         WHERE mpd."productModelId" = ${ids.product} AND mpd."captureRowId" IS NOT NULL
           AND (v.id IS NULL OR v."machineId" <> mpd."machineId" OR v."productModelId" <> mpd."productModelId")`;
      expect(sai[0].n, `[${tenDb}] mọi hàng cây phải trỏ vào bản dạy CỦA CHÍNH MÁY ĐÓ`).toBe(0);
    }, 60_000);

    it("MỆNH ĐỀ 3 — đẩy LẠI cùng cây cùng máy ⇒ số hàng KHÔNG ĐỔI và KHÔNG sinh phiên bản mới", async () => {
      const truoc = await demCayCuaMay(ids.product, ids.may1);
      const banTruoc = await traBanDayHienHanh({ machineId: ids.may1, productModelId: ids.product });
      expect(banTruoc?.version, "M1 đang ở bản dạy 1").toBe(1);

      const lai = await caller().submitMachineTemplate({
        apiKey: apiKey1, productModelCode: `T5-${RUN}`, template: mauThat(),
      });
      expect(lai.phienBanMoi, "cây Y HỆT ⇒ KHÔNG được sinh phiên bản mới").toBe(false);
      expect(lai.templateVersion).toBe(1);
      expect(lai.componentsXoaMem).toBe(0);

      const sau = await demCayCuaMay(ids.product, ids.may1);
      expect(sau, `[current_database()=${tenDb}] hội tụ (bất biến Task 2) vẫn còn nguyên`).toEqual(truoc);

      // Sổ bản dạy của M1 vẫn ĐÚNG MỘT hàng — không đẻ phiên bản mỗi lượt đẩy.
      const [so] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM machine_template_versions
         WHERE "machineId" = ${ids.may1} AND "productModelId" = ${ids.product}`;
      expect(so.n, `[${tenDb}] sổ bản dạy của M1 phải còn ĐÚNG 1 hàng`).toBe(1);

      // `lastSeenAt` PHẢI nhích lên — nếu không thì "máy còn sống" không đo được.
      const banSau = await traBanDayHienHanh({ machineId: ids.may1, productModelId: ids.product });
      expect(banSau!.lastSeenAt.getTime()).toBeGreaterThanOrEqual(banTruoc!.lastSeenAt.getTime());
      expect(banSau!.checksum, "checksum phải là hàm THUẦN của cây").toBe(bamCayDay(mauThat()));
    }, 60_000);

    it("MỆNH ĐỀ 4 — hai bản dạy cùng MỘT máy: phân biệt được, và kết quả CŨ vẫn tra ra bản dạy CŨ", async () => {
      const v1 = await traBanDayHienHanh({ machineId: ids.may1, productModelId: ids.product });
      expect(v1!.version).toBe(1);
      const mot = mauThat().surfaces[0].positions[0].captures[0].components[0];

      // Thời điểm "một bo đã được chấm" — mọi kết quả ghi TRƯỚC lượt đẩy thứ hai.
      await new Promise((r) => setTimeout(r, 25));
      const lucChamBoCu = new Date();
      await new Promise((r) => setTimeout(r, 25));

      // Bản dạy MỚI của CÙNG máy M1: dời ROI đi 7 pixel.
      const mauV2 = mauThat();
      mauV2.surfaces[0].positions[0].captures[0].components[0].roi.x += 7;
      const k = await caller().submitMachineTemplate({
        apiKey: apiKey1, productModelCode: `T5-${RUN}`, template: mauV2,
      });
      expect(k.phienBanMoi, "cây ĐỔI ⇒ PHẢI sinh phiên bản mới").toBe(true);
      expect(k.templateVersion).toBe(2);

      // (a) PHÂN BIỆT ĐƯỢC: hai hàng, bản 1 đã đóng khoảng, bản 2 hiện hành.
      const so = await sql<{ version: number; superseded: string | null; prev: number | null }[]>`
        SELECT version, "supersededAt" AS superseded, "previousVersionId" AS prev
          FROM machine_template_versions
         WHERE "machineId" = ${ids.may1} AND "productModelId" = ${ids.product}
         ORDER BY version`;
      expect(so.length, `[current_database()=${tenDb}] M1 phải có ĐÚNG hai bản dạy`).toBe(2);
      expect(so[0].version).toBe(1);
      expect(so[0].superseded, "bản 1 phải ĐƯỢC ĐÓNG KHOẢNG, không bị xoá").not.toBeNull();
      expect(so[1].version).toBe(2);
      expect(so[1].superseded, "bản 2 là bản hiện hành").toBeNull();
      expect(so[1].prev, "phả hệ: bản 2 kế thừa bản 1").toBe(v1!.id);

      // (b) ★★★ KẾT QUẢ CŨ VẪN TRA RA BẢN DẠY CŨ.
      const banLucDo = await traBanDayTaiThoiDiem({
        machineId: ids.may1, productModelId: ids.product, luc: lucChamBoCu,
      });
      expect(banLucDo?.version, `[${tenDb}] một bo chấm lúc ${lucChamBoCu.toISOString()} thuộc BẢN 1`).toBe(1);
      expect(banLucDo!.id).toBe(v1!.id);

      // (c) ★★★ VÀ NỘI DUNG BẢN CŨ KHÔNG ĐỔI NGHĨA. Hàng `measurement_point_defs`
      //     ĐÃ bị lượt đẩy 2 ghi đè tại chỗ (đó là giá của bất biến hội tụ) — nên
      //     nếu `snapshot` cũng đổi theo thì lời hứa "đẩy bản mới KHÔNG đổi nghĩa
      //     dữ liệu đã ghi" là rỗng. Đo CẢ HAI phía:
      const roiBangHienTai = await roiCua(ids.may1, mot.id);
      expect(roiBangHienTai!.x, "bảng phản ánh bản MỚI (đúng thiết kế hội tụ)").toBe(mot.roi.x + 7);

      const snap: any = banLucDo!.snapshot;
      const roiTrongSnapshot = snap.surfaces[0].positions[0].captures[0].components[0].roi;
      expect(roiTrongSnapshot.x, `[${tenDb}] snapshot bản 1 phải BẤT BIẾN — đây là thứ chấm lại bo cũ`).toBe(mot.roi.x);
      expect(banLucDo!.componentCount).toBe(16);

      // (d) Bản HIỆN HÀNH tra ở thời điểm BÂY GIỜ là bản 2 — hai câu hỏi khác nhau,
      //     hai câu trả lời khác nhau, cùng một hàm.
      const banBayGio = await traBanDayTaiThoiDiem({
        machineId: ids.may1, productModelId: ids.product, luc: new Date(),
      });
      expect(banBayGio?.version).toBe(2);

      // (e) Bản dạy của M2 KHÔNG bị hai lượt đẩy của M1 chạm tới.
      const banM2 = await traBanDayHienHanh({ machineId: ids.may2, productModelId: ids.product });
      expect(banM2?.version, "M2 vẫn ở bản 1 của CHÍNH NÓ").toBe(1);
    }, 90_000);

    // ══════════════════════════════════════════════════════════════════════════
    // Ba mệnh đề THÊM — chiều máy phải KHÔNG THỂ lệch, không chỉ "được ghi đúng".
    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 5 — position mang machineId KHÁC surface cha ⇒ 23503 (FK GHÉP, không phải lời hứa)", async () => {
      const [ps] = await sql<{ id: number }[]>`
        SELECT id FROM product_surfaces
         WHERE "productModelId" = ${ids.product} AND "machineId" = ${ids.may1} LIMIT 1`;
      let ma = "(không lỗi)";
      try {
        await sql`
          INSERT INTO product_positions ("surfaceRowId", "machineId", "positionId")
          VALUES (${ps.id}, ${ids.may2}, ${"LECH-" + RUN})`;
      } catch (e: any) {
        ma = e?.code ?? String(e);
      }
      expect(ma, `[${tenDb}] gắn con của M1 vào máy M2 phải vỡ FK GHÉP fk_positions_surface_may`).toBe("23503");

      const [con] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM product_positions WHERE "positionId" = ${"LECH-" + RUN}`;
      expect(con.n, "và KHÔNG hàng lệch nào được để lại").toBe(0);
    }, 60_000);

    it("MỆNH ĐỀ 6 — point-def CÂY mà machineId NULL ⇒ 23514 (CHECK 'chiều nửa vời' bị cấm)", async () => {
      const [pc] = await sql<{ id: number }[]>`
        SELECT pc.id FROM product_captures pc
          JOIN product_positions pp ON pp.id = pc."positionRowId"
          JOIN product_surfaces  ps ON ps.id = pp."surfaceRowId"
         WHERE ps."productModelId" = ${ids.product} AND pc."machineId" = ${ids.may1} LIMIT 1`;
      let ma = "(không lỗi)";
      try {
        await sql`
          INSERT INTO measurement_point_defs
            ("productModelId", code, name, "measurementType", "positionX", "positionY", "captureRowId", "machineId")
          VALUES (${ids.product}, ${"NUAVOI-" + RUN}, 'nua voi', 'VISUAL', 0, 0, ${pc.id}, NULL)`;
      } catch (e: any) {
        ma = e?.code ?? String(e);
      }
      expect(ma, `[${tenDb}] hàng CÂY không máy chính là 'chiều nửa vời' — phải bị CHECK chặn`).toBe("23514");

      const [con] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM measurement_point_defs WHERE code = ${"NUAVOI-" + RUN}`;
      expect(con.n).toBe(0);
    }, 60_000);

    it("MỆNH ĐỀ 7 — uq_mtv_hien_hanh: KHÔNG BAO GIỜ hai bản dạy hiện hành cùng (máy, model)", async () => {
      // Đo trên DỮ LIỆU thật trước…
      const trung = await sql<{ machineId: number; productModelId: number; n: number }[]>`
        SELECT "machineId", "productModelId", count(*)::int AS n
          FROM machine_template_versions WHERE "supersededAt" IS NULL
         GROUP BY 1, 2 HAVING count(*) > 1`;
      expect(trung, `[${tenDb}] không (máy, model) nào có hai bản hiện hành`).toEqual([]);

      // …rồi CƯỠNG CHẾ: cố ghi bản hiện hành thứ hai ⇒ 23505.
      let ma = "(không lỗi)";
      try {
        await sql`
          INSERT INTO machine_template_versions
            ("machineId", "productModelId", version, checksum, snapshot)
          VALUES (${ids.may1}, ${ids.product}, 999, ${"f".repeat(64)}, ${sql.json({ x: 1 })})`;
      } catch (e: any) {
        ma = e?.code ?? String(e);
      }
      expect(ma, `[${tenDb}] index partial uq_mtv_hien_hanh phải chặn bản hiện hành thứ hai`).toBe("23505");
    }, 60_000);

    /**
     * ★★★ MỆNH ĐỀ 8 — CANH MỘT LỚP LỖI ĐÃ XẢY RA THẬT, không phải phòng thủ giả định.
     *
     * `drizzle/0338_product_config_tree.sql` là RE-RUNNABLE và runner của nó
     * (`scripts/apply-migration-0338.mjs`) vẫn được dùng. Nó có
     * `CREATE UNIQUE INDEX IF NOT EXISTS uq_product_surfaces_model_name`. Đo được
     * 2026-09-03: chạy lại 0338 SAU 0347 đã **PHỤC SINH** index cũ ở CẢ HAI DB —
     * tức là khôi phục đúng lỗ "hai máy ghi đè nhau", IM LẶNG, và mọi lưới khác vẫn
     * XANH vì hàng vẫn ghi được (chỉ là ghi ĐÈ). 0338 nay có guard nhường 0347; ca
     * này là thứ canh cho guard đó, và cho mọi lượt phục sinh khác trong tương lai.
     */
    it("MỆNH ĐỀ 8 — index CŨ không được PHỤC SINH: chỉ tồn tại bản CÓ chiều máy", async () => {
      const ix = await sql<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes
         WHERE indexname IN ('uq_product_surfaces_model_name', 'uq_product_surfaces_model_may_name',
                             'uq_point_defs_cay_may_code', 'uq_point_defs_product_variant_code')
         ORDER BY indexname`;
      const ten = ix.map((r) => r.indexname);
      expect(
        ten,
        `[current_database()=${tenDb}] 'uq_product_surfaces_model_name' SỐNG LẠI = hai máy lại ghi đè nhau ` +
          `(chạy lại migration 0338 sau 0347 từng làm đúng điều này)`,
      ).not.toContain("uq_product_surfaces_model_name");
      expect(ten).toContain("uq_product_surfaces_model_may_name");
      expect(ten).toContain("uq_point_defs_cay_may_code");

      // Bản thay PHẢI thật sự mang cột máy — có đúng TÊN chưa chứng minh gì.
      const thay = ix.find((r) => r.indexname === "uq_product_surfaces_model_may_name")!;
      expect(thay.indexdef, "index thay phải THỰC SỰ khoá theo machineId").toMatch(/"machineId"/);

      // Và nhánh PHẲNG phải giữ đúng nghĩa cũ (chỉ phủ hàng captureRowId IS NULL).
      const phang = ix.find((r) => r.indexname === "uq_point_defs_product_variant_code")!;
      expect(
        phang.indexdef,
        "uq_point_defs_product_variant_code phải THU về hàng PHẲNG — nếu nó phủ cả hàng cây thì " +
          "hai máy dạy cùng bộ UUID linh kiện sẽ vỡ 23505",
      ).toMatch(/"captureRowId" IS NULL/);
    }, 60_000);
  },
);
