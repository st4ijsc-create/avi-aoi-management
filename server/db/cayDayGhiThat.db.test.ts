/**
 * server/db/cayDayGhiThat.db.test.ts
 *
 * Khối B — Task 2 (B-2 + B-3) — lưới ghi **THẬT** cho cửa `submitMachineTemplate`
 * (`server/routers/machineApiRouters.ts`) + đường ghi `ghiCayDay`
 * (`server/db/cayDay.ts`), chạy trên DB test cô lập bằng vai **`avi_app`**
 * (KHÔNG phải `aoi`: superuser + BYPASSRLS làm mọi phép đo quyền XANH GIẢ).
 * `DATABASE_URL` của repo đã là `avi_app`; `vitest.setup` chỉ đổi TÊN DB sang
 * `<db>_test`, KHÔNG đổi vai.
 *
 * ⚠ ĐI QUA CỬA THẬT (`machineApiRouter.createCaller`), KHÔNG gọi thẳng `ghiCayDay`
 * — đây đúng bài học §13 Đ-11: gọi thẳng hàm rồi đọc kết quả chứng minh HÀM chạy,
 * KHÔNG chứng minh CỬA nối vào hàm, và mệnh đề 3 (chưa xác thực ⇒ 0 hàng) chỉ tồn
 * tại ở tầng cửa.
 *
 * ── BỐN MỆNH ĐỀ của brief (mỗi con số kèm `current_database()`, luật Đ-28) ────
 *  1. Đẩy mẫu máy THẬT ⇒ `product_surfaces`=2 · `product_positions`=4 ·
 *     `product_captures`=8 · `measurement_point_defs` **+16 hàng có `componentExtId`**.
 *  2. Đẩy **LẠI CÙNG CÂY** ⇒ số hàng **KHÔNG ĐỔI** (hội tụ, không nhân bản).
 *  3. **Chưa xác thực / sai apiKey ⇒ 0 hàng** — lưới ở TẦNG CỬA.
 *  4. `captureRowId` của 16 hàng point-def **trỏ đúng** `product_captures` tương
 *     ứng — kiểm bằng **JOIN THẬT** lên tận `product_surfaces`, so cặp
 *     `(captureExtId, componentExtId)` với chính mẫu máy, KHÔNG bằng đếm.
 *
 * ── Bốn quyết định của Task 2 cũng được canh ở đây ───────────────────────────
 *  5. Cây CO LẠI ⇒ **XOÁ MỀM** (`deletedAt`), hàng VẪN CÒN trên đĩa (kết quả cũ
 *     trỏ vào) — và phạm vi xoá mềm bị chặn ở capture CÓ TRONG payload.
 *  6. `surfaces: []` ⇒ **TỪ CHỐI** (cái bẫy Task 1 bàn giao), 0 hàng.
 *  7. `roi.x = 12.5` ⇒ **TỪ CHỐI** ở hợp đồng, 0 hàng (Postgres sẽ làm tròn im lặng).
 *  8. Sản phẩm còn điểm đo PHẲNG ⇒ **TỪ CHỐI** (bất biến `cayCauHinhBatBien.db.test.ts`).
 *
 * ── DẤU CHÂN ĐỂ LẠI: KHÔNG ─────────────────────────────────────────────────
 * Bốn bảng của cây dạy KHÔNG phải WORM (đo `information_schema.role_table_grants`,
 * vai `avi_app`, cả hai DB: SELECT/INSERT/UPDATE/**DELETE** trên cả bốn), khác hẳn
 * `product_inspections`/`audit_logs`. Vì vậy `afterAll` dọn 100% bằng DELETE THẬT
 * và **KHÔNG** `.catch(() => {})` — một `catch` rỗng ở đây là dọn dẹp NO-OP CÂM
 * (đo được 32 tệp test khác đang làm thế). Lưới KHÔNG ghi `product_inspections`
 * nên không có hàng WORM nào phát sinh.
 * Máy dùng là máy **ĐÃ CÓ SẴN** trên DB test (không dựng máy mới ⇒ không đụng
 * station/line/workshop); credential là một `api_keys` do lưới tự phát và tự xoá.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { machineApiRouter } from "../routers/machineApiRouters";
import { issueMachineKey } from "../services/machineAuthService";
import { updateMeasurementPointDef } from "./product";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";
const CO_MAU = existsSync(MAU_MAY_THAT);
const RUN = `CD${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = { machine: 0, product: 0, productPhang: 0, key: 0 };
let apiKey = "";

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const caller = () => machineApiRouter.createCaller(ctx());

/** Mẫu máy THẬT, bản sao sâu mới mỗi lần gọi (ca đột biến không lây sang ca khác). */
function mauThat(): any {
  return JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));
}

/**
 * Đếm bốn cấp CHO ĐÚNG một `productModelId`, JOIN từ `product_surfaces` xuống —
 * KHÔNG đếm toàn bảng (DB test có 2.834 điểm đo có sẵn của sản phẩm khác).
 */
async function demCay(productModelId: number) {
  const [r] = await sql<
    { surfaces: number; positions: number; captures: number; comp_song: number; comp_xoa_mem: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM product_surfaces WHERE "productModelId" = ${productModelId}) AS surfaces,
      (SELECT count(*)::int FROM product_positions pp
         JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
        WHERE ps."productModelId" = ${productModelId}) AS positions,
      (SELECT count(*)::int FROM product_captures pc
         JOIN product_positions pp ON pp.id = pc."positionRowId"
         JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
        WHERE ps."productModelId" = ${productModelId}) AS captures,
      (SELECT count(*)::int FROM measurement_point_defs
        WHERE "productModelId" = ${productModelId}
          AND "componentExtId" IS NOT NULL AND "deletedAt" IS NULL) AS comp_song,
      (SELECT count(*)::int FROM measurement_point_defs
        WHERE "productModelId" = ${productModelId}
          AND "componentExtId" IS NOT NULL AND "deletedAt" IS NOT NULL) AS comp_xoa_mem`;
  return r;
}

describe.skipIf(!DB_URL || !CO_MAU)(
  "Khối B Task 2 — cửa submitMachineTemplate + ghiCayDay (ghi THẬT, vai avi_app)",
  () => {
    beforeAll(async () => {
      sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
      const [d] = await sql<{ db: string; usr: string }[]>`
        SELECT current_database() AS db, current_user AS usr`;
      tenDb = d.db;
      // ⚠ Cầu chì: nếu vai không phải avi_app thì MỌI phép đo quyền bên dưới vô nghĩa.
      expect(d.usr, "phải đo bằng vai avi_app — vai aoi (superuser+BYPASSRLS) làm mọi phép đo xanh giả").toBe("avi_app");
      // eslint-disable-next-line no-console
      console.log(`[cayDayGhiThat] current_database()=${d.db} current_user=${d.usr}`);

      const [may] = await sql<{ id: number }[]>`SELECT id FROM machines ORDER BY id LIMIT 1`;
      if (!may) {
        throw new Error(
          "cayDayGhiThat.db.test: DB test không có máy nào để tái dùng — chạy node scripts/setup-test-db.mjs trước.",
        );
      }
      ids.machine = may.id;

      const [p] = await sql<{ id: number }[]>`
        INSERT INTO product_models (code, name) VALUES (${"CD-" + RUN}, 'Khoi B cay day') RETURNING id`;
      ids.product = p.id;

      // Sản phẩm THỨ HAI, cố ý có MỘT điểm đo PHẲNG (captureRowId NULL) — mệnh đề 8.
      const [pp] = await sql<{ id: number }[]>`
        INSERT INTO product_models (code, name) VALUES (${"CDP-" + RUN}, 'Khoi B san pham PHANG') RETURNING id`;
      ids.productPhang = pp.id;
      await sql`
        INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
        VALUES (${ids.productPhang}, ${"PHANG-" + RUN}, 'diem do phang', 'DIMENSION', 10, 20)`;

      const cap = await issueMachineKey({
        machineId: ids.machine,
        name: `khoib-task2-${RUN}`,
        scopes: ["ingest:write", "equipment:read"],
      });
      apiKey = cap.plaintextKey;
      ids.key = cap.id;
    }, 60_000);

    afterAll(async () => {
      if (!sql) return;
      // Bốn bảng cây dạy KHÔNG WORM — dọn THẬT, không `.catch(() => {})`.
      await sql`DELETE FROM measurement_point_defs WHERE "productModelId" IN (${ids.product}, ${ids.productPhang})`;
      await sql`DELETE FROM product_surfaces WHERE "productModelId" = ${ids.product}`; // CASCADE positions/captures
      await sql`DELETE FROM product_models WHERE id IN (${ids.product}, ${ids.productPhang})`;
      if (ids.key) await sql`DELETE FROM api_keys WHERE id = ${ids.key}`;
      await sql.end();
    }, 60_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 1 — đẩy mẫu máy THẬT ⇒ 2 / 4 / 8 / 16, và 16 hàng CÓ componentExtId", async () => {
      const truoc = await demCay(ids.product);
      expect(truoc, `[${tenDb}] nền phải rỗng cho sản phẩm mới`).toEqual({
        surfaces: 0, positions: 0, captures: 0, comp_song: 0, comp_xoa_mem: 0,
      });

      const ket = await caller().submitMachineTemplate({
        apiKey,
        productModelCode: `CD-${RUN}`,
        template: mauThat(),
      });
      expect(ket.success).toBe(true);
      expect({ s: ket.surfaces, p: ket.positions, c: ket.captures, k: ket.components }).toEqual({
        s: 2, p: 4, c: 8, k: 16,
      });

      const sau = await demCay(ids.product);
      expect(sau, `[current_database()=${tenDb}] số hàng THẬT sau lượt đẩy đầu`).toEqual({
        surfaces: 2, positions: 4, captures: 8, comp_song: 16, comp_xoa_mem: 0,
      });

      // ★★★ ĐÂY LÀ THỨ CẢ KHỐI B TỒN TẠI ĐỂ ĐỔ ĐẦY: componentExtId 0 → 16.
      const [x] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM measurement_point_defs
         WHERE "productModelId" = ${ids.product} AND "componentExtId" IS NOT NULL AND "captureRowId" IS NOT NULL`;
      expect(x.n, `[${tenDb}] componentExtId + captureRowId phải cùng khác NULL trên cả 16 hàng`).toBe(16);
    }, 60_000);

    it("MỆNH ĐỀ 1b — bốn trường kế hoạch BỎ SÓT thật sự tới được cột đích (markerRadius + 3 templateImagePath)", async () => {
      const [pos] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM product_positions pp
          JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
         WHERE ps."productModelId" = ${ids.product} AND pp."markerRadius" IS NOT NULL`;
      expect(pos.n, "mẫu thật có ĐÚNG 2 position shape=Circle mang markerRadius").toBe(2);

      const [anh] = await sql<{ pos: number; cap: number; comp: number }[]>`
        SELECT
          (SELECT count(*)::int FROM product_positions pp
             JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
            WHERE ps."productModelId" = ${ids.product} AND pp."templateImageUrl" IS NOT NULL) AS pos,
          (SELECT count(*)::int FROM product_captures pc
             JOIN product_positions pp ON pp.id = pc."positionRowId"
             JOIN product_surfaces ps ON ps.id = pp."surfaceRowId"
            WHERE ps."productModelId" = ${ids.product} AND pc."templateImageUrl" IS NOT NULL) AS cap,
          (SELECT count(*)::int FROM measurement_point_defs
            WHERE "productModelId" = ${ids.product} AND "referenceImageUrl" IS NOT NULL) AS comp`;
      expect(anh, `[${tenDb}] 4/8/16 đường ảnh phải tới đúng ba cột text`).toEqual({ pos: 4, cap: 8, comp: 16 });
    }, 60_000);

    it("MỆNH ĐỀ 2 — đẩy LẠI CÙNG CÂY ⇒ số hàng KHÔNG ĐỔI (hội tụ, không nhân bản)", async () => {
      const truoc = await demCay(ids.product);
      const ket = await caller().submitMachineTemplate({
        apiKey,
        productModelCode: `CD-${RUN}`,
        template: mauThat(),
      });
      expect(ket.componentsXoaMem, "đẩy lại CÙNG cây không được xoá mềm gì").toBe(0);
      const sau = await demCay(ids.product);
      expect(sau, `[current_database()=${tenDb}] lượt hai phải cho ĐÚNG bộ số của lượt một`).toEqual(truoc);
      expect(sau).toEqual({ surfaces: 2, positions: 4, captures: 8, comp_song: 16, comp_xoa_mem: 0 });
    }, 60_000);

    it("MỆNH ĐỀ 4 — captureRowId của 16 hàng point-def trỏ ĐÚNG product_captures (JOIN THẬT, không đếm)", async () => {
      const mau = mauThat();
      // Cặp (captureExtId, componentExtId) kỳ vọng, lấy TRỰC TIẾP từ mẫu máy.
      const kyVong: string[] = [];
      for (const s of mau.surfaces)
        for (const p of s.positions)
          for (const c of p.captures)
            for (const k of c.components) kyVong.push(`${c.id}|${k.id}`);
      expect(kyVong.length).toBe(16);

      const hang = await sql<{ cap: string; comp: string; sname: string; pid: string }[]>`
        SELECT pc."captureExtId" AS cap, mpd."componentExtId" AS comp,
               ps."surfaceName" AS sname, pp."positionId" AS pid
          FROM measurement_point_defs mpd
          JOIN product_captures  pc ON pc.id = mpd."captureRowId"
          JOIN product_positions pp ON pp.id = pc."positionRowId"
          JOIN product_surfaces  ps ON ps.id = pp."surfaceRowId"
         WHERE ps."productModelId" = ${ids.product} AND mpd."deletedAt" IS NULL`;
      expect(hang.length, `[${tenDb}] JOIN 4 cấp phải trả ĐÚNG 16 hàng — thiếu hàng = neo đứt`).toBe(16);
      expect(hang.map((h) => `${h.cap}|${h.comp}`).sort()).toEqual(kyVong.sort());

      // Cây dựng lại từ DB phải khớp cấu trúc mẫu: 2 tên mặt, 2 mã vị trí.
      expect([...new Set(hang.map((h) => h.sname))].sort()).toEqual(["BOTTOM", "TOP"]);
      expect([...new Set(hang.map((h) => h.pid))].sort()).toEqual(["P01", "P02"]);

      // ROI đi tới cột `integer` NGUYÊN VẸN (không bị làm tròn/nuốt).
      const mot = mau.surfaces[0].positions[0].captures[0].components[0];
      const [r] = await sql<{ x: number; y: number; w: number; h: number; px: number; py: number }[]>`
        SELECT "roiX" AS x, "roiY" AS y, "roiWidth" AS w, "roiHeight" AS h,
               "positionX" AS px, "positionY" AS py
          FROM measurement_point_defs
         WHERE "productModelId" = ${ids.product} AND "componentExtId" = ${mot.id} AND "deletedAt" IS NULL`;
      expect({ x: r.x, y: r.y, w: r.w, h: r.h }).toEqual({
        x: mot.roi.x, y: mot.roi.y, w: mot.roi.width, h: mot.roi.height,
      });
      // positionX/positionY là hình học CŨ SUY RA = TÂM ROI (xem docblock cayDay.ts).
      expect({ px: r.px, py: r.py }).toEqual({
        px: Math.round(mot.roi.x + mot.roi.width / 2),
        py: Math.round(mot.roi.y + mot.roi.height / 2),
      });
    }, 60_000);

    it("MỆNH ĐỀ 5 — cây CO LẠI ⇒ XOÁ MỀM, hàng VẪN CÒN trên đĩa (kết quả cũ trỏ vào)", async () => {
      const mau = mauThat();
      const capture = mau.surfaces[0].positions[0].captures[0];
      const boDi = capture.components.pop(); // bỏ MỘT linh kiện khỏi MỘT capture
      expect(boDi, "mẫu phải có linh kiện để bỏ").toBeDefined();

      const ket = await caller().submitMachineTemplate({
        apiKey,
        productModelCode: `CD-${RUN}`,
        template: mau,
      });
      expect(ket.components, "cây mới còn 15 linh kiện").toBe(15);
      expect(ket.componentsXoaMem, "đúng MỘT linh kiện bị xoá mềm").toBe(1);

      const sau = await demCay(ids.product);
      expect(sau, `[current_database()=${tenDb}] 15 sống + 1 xoá mềm; ba cấp trên KHÔNG đổi`).toEqual({
        surfaces: 2, positions: 4, captures: 8, comp_song: 15, comp_xoa_mem: 1,
      });

      // ★ KHÔNG xoá cứng: hàng còn nguyên, chỉ mang `deletedAt` + `deletedAtVersion`.
      const [h] = await sql<{ n: number; ver: number | null }[]>`
        SELECT count(*)::int AS n, max("deletedAtVersion") AS ver
          FROM measurement_point_defs
         WHERE "productModelId" = ${ids.product} AND "componentExtId" = ${boDi.id}`;
      expect(h.n, "hàng bị bỏ phải CÒN trên đĩa (DELETE cứng làm mất thứ Task 3/4 sắp join)").toBe(1);
      expect(h.ver, "deletedAtVersion = pointsConfigVersion lúc xoá (mig 0274)").toBe(1);

      // Đẩy lại cây ĐẦY ĐỦ ⇒ linh kiện sống lại (hàng MỚI, hàng cũ vẫn là bia mộ).
      const lai = await caller().submitMachineTemplate({
        apiKey,
        productModelCode: `CD-${RUN}`,
        template: mauThat(),
      });
      expect(lai.components).toBe(16);
      const cuoi = await demCay(ids.product);
      expect(cuoi, `[${tenDb}] 16 sống trở lại, bia mộ vẫn còn`).toEqual({
        surfaces: 2, positions: 4, captures: 8, comp_song: 16, comp_xoa_mem: 1,
      });
    }, 60_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("★★★ M-6 (review Khối C lượt 9) — DẠY giới hạn RỒI cây co lại xoá mềm điểm đó ⇒ measurement_point_versions PHẢI có hàng cuối (chứa giới hạn đã dạy) TRƯỚC deletedAt, không mất im lặng", async () => {
      const mau = mauThat();
      const capture = mau.surfaces[0].positions[0].captures[0];
      const boDi = capture.components.pop(); // bỏ MỘT linh kiện khỏi MỘT capture — cây co lại ở BƯỚC 2
      expect(boDi, "mẫu phải có linh kiện để bỏ").toBeDefined();

      // BƯỚC 1 — đẩy cây ĐẦY ĐỦ (16 linh kiện), rồi DẠY giới hạn cho ĐÚNG linh
      // kiện sắp bị cây co lại xoá mềm.
      await caller().submitMachineTemplate({ apiKey, productModelCode: `CD-${RUN}`, template: mauThat() });
      const [truocKhiXoa] = await sql<{ id: number }[]>`
        SELECT id FROM measurement_point_defs
         WHERE "productModelId" = ${ids.product} AND "componentExtId" = ${boDi.id} AND "deletedAt" IS NULL`;
      expect(truocKhiXoa, `[${tenDb}] phải tìm được point-def của linh kiện sắp bị xoá mềm`).toBeDefined();
      const idDiemDay = truocKhiXoa.id;

      const CAN_DUOI_M6 = "1", CAN_TREN_M6 = "10";
      await updateMeasurementPointDef(idDiemDay, { lowerLimit: CAN_DUOI_M6, upperLimit: CAN_TREN_M6 } as never, {
        changeReason: "M-6 luoi: day gioi han TRUOC khi cay co lai xoa mem",
      });
      const [{ n: mpvTruocXoa }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM measurement_point_versions WHERE "pointDefId" = ${idDiemDay}`;
      expect(mpvTruocXoa, `[${tenDb}] lượt DẠY phải để lại đúng 1 hàng lịch sử (snapshot TRƯỚC khi dạy — null)`).toBe(1);

      // BƯỚC 2 — đẩy cây THIẾU đúng linh kiện đó ⇒ cây co lại, xoá mềm.
      const ket = await caller().submitMachineTemplate({ apiKey, productModelCode: `CD-${RUN}`, template: mau });
      expect(ket.componentsXoaMem, `[${tenDb}] đúng MỘT linh kiện bị xoá mềm (điểm vừa dạy giới hạn)`).toBe(1);

      // ★★★ BẰNG CHỨNG M-6 — measurement_point_versions PHẢI có hàng THỨ HAI
      // (snapshot NGAY TRƯỚC lúc xoá mềm), mang ĐÚNG giới hạn vừa dạy — không
      // phải null, không phải bị bỏ qua.
      const [{ n: mpvSauXoa }] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM measurement_point_versions WHERE "pointDefId" = ${idDiemDay}`;
      expect(mpvSauXoa, `[${tenDb}] xoá mềm PHẢI để lại thêm đúng 1 hàng lịch sử (2 tổng) — trước bản vá M-6 là 1 (mất im lặng)`).toBe(2);

      const [hangCuoi] = await sql<{ snapshotJson: any; changedAt: Date; changeReason: string | null }[]>`
        SELECT "snapshotJson", "changedAt", "changeReason" FROM measurement_point_versions
         WHERE "pointDefId" = ${idDiemDay} ORDER BY version DESC LIMIT 1`;
      expect(
        Number(hangCuoi.snapshotJson.lowerLimit),
        `[${tenDb}] snapshot NGAY TRƯỚC xoá mềm phải mang giới hạn ĐÃ DẠY (chứng minh chụp TRƯỚC deletedAt, không phải bản trơ)`,
      ).toBe(Number(CAN_DUOI_M6));
      expect(Number(hangCuoi.snapshotJson.upperLimit)).toBe(Number(CAN_TREN_M6));
      expect(hangCuoi.changeReason ?? "", `[${tenDb}] lý do phải khai rõ đây là xoá mềm cây co lại, không lẫn với một lượt dạy khác`).toContain("Xoa mem");

      // Đối chiếu THỜI ĐIỂM: version cuối phải KHÔNG SAU `deletedAt` của hàng đó
      // (snapshot TRƯỚC/CÙNG lúc UPDATE, đúng thứ tự SELECT-rồi-UPDATE trong 1 tx).
      const [hangXoa] = await sql<{ deletedAt: Date | null }[]>`
        SELECT "deletedAt" FROM measurement_point_defs WHERE id = ${idDiemDay}`;
      expect(hangXoa.deletedAt, `[${tenDb}] hàng phải THẬT SỰ đã bị xoá mềm`).not.toBeNull();
      expect(
        hangCuoi.changedAt.getTime(),
        `[${tenDb}] measurement_point_versions.changedAt (snapshot) phải KHÔNG SAU measurement_point_defs.deletedAt`,
      ).toBeLessThanOrEqual(hangXoa.deletedAt!.getTime());
    }, 60_000);

    // ══════════════════════════════════════════════════════════════════════════
    // MỆNH ĐỀ 3 + ba phép TỪ CHỐI — mỗi ca đo trên MỘT sản phẩm SẠCH và đòi 0 hàng.
    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 3 — sai apiKey / KHÔNG apiKey ⇒ TỪ CHỐI và 0 hàng (phép ghi nằm SAU xác thực — I-4)", async () => {
      const [p] = await sql<{ id: number }[]>`
        INSERT INTO product_models (code, name) VALUES (${"CDX-" + RUN}, 'Khoi B chua xac thuc') RETURNING id`;
      try {
        await expect(
          caller().submitMachineTemplate({
            apiKey: "mk_khong_bao_gio_ton_tai_" + RUN,
            productModelCode: `CDX-${RUN}`,
            template: mauThat(),
          }),
        ).rejects.toThrow();

        // KHÔNG credential nào: hợp đồng đòi apiKey HOẶC machineCode ⇒ chặn ở .input().
        await expect(
          caller().submitMachineTemplate({
            productModelCode: `CDX-${RUN}`,
            template: mauThat(),
          } as any),
        ).rejects.toThrow();

        // machineCode tự khai KHÔNG có credential ⇒ chính sách khoá yếu từ chối.
        await expect(
          caller().submitMachineTemplate({
            machineCode: "MAY-KHONG-TON-TAI-" + RUN,
            productModelCode: `CDX-${RUN}`,
            template: mauThat(),
          }),
        ).rejects.toThrow();

        expect(await demCay(p.id), `[current_database()=${tenDb}] chưa xác thực ⇒ KHÔNG một hàng nào`).toEqual({
          surfaces: 0, positions: 0, captures: 0, comp_song: 0, comp_xoa_mem: 0,
        });
      } finally {
        await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${p.id}`;
        await sql`DELETE FROM product_surfaces WHERE "productModelId" = ${p.id}`;
        await sql`DELETE FROM product_models WHERE id = ${p.id}`;
      }
    }, 60_000);

    it("MỆNH ĐỀ 6 — `surfaces: []` ⇒ TỪ CHỐI (bẫy Task 1 bàn giao: cây rỗng xoá mềm cả bản dạy), 0 hàng đổi", async () => {
      const truoc = await demCay(ids.product);
      await expect(
        caller().submitMachineTemplate({
          apiKey,
          productModelCode: `CD-${RUN}`,
          template: { surfaces: [] },
        }),
      ).rejects.toThrow(/RỖNG/);
      expect(await demCay(ids.product), `[${tenDb}] cây rỗng KHÔNG được đụng một hàng nào`).toEqual(truoc);
    }, 60_000);

    it("MỆNH ĐỀ 7 — `roi.x = 12.5` ⇒ TỪ CHỐI ở hợp đồng, 0 hàng (Postgres sẽ làm tròn IM LẶNG)", async () => {
      const truoc = await demCay(ids.product);
      const mau = mauThat();
      mau.surfaces[0].positions[0].captures[0].components[0].roi.x = 12.5;
      await expect(
        caller().submitMachineTemplate({ apiKey, productModelCode: `CD-${RUN}`, template: mau }),
      ).rejects.toThrow();
      expect(await demCay(ids.product), `[${tenDb}] payload bị từ chối ⇒ không hàng nào đổi`).toEqual(truoc);
    }, 60_000);

    it("MỆNH ĐỀ 8 — sản phẩm còn điểm đo PHẲNG ⇒ TỪ CHỐI (bất biến 'không trộn phẳng với cây'), 0 hàng", async () => {
      await expect(
        caller().submitMachineTemplate({
          apiKey,
          productModelCode: `CDP-${RUN}`,
          template: mauThat(),
        }),
      ).rejects.toThrow(/PHẲNG/);
      expect(await demCay(ids.productPhang), `[${tenDb}] bị từ chối ⇒ 0 hàng cây`).toEqual({
        surfaces: 0, positions: 0, captures: 0, comp_song: 0, comp_xoa_mem: 0,
      });

      // ⚠ CHỐNG HỒI QUY cho bất biến: sản phẩm phẳng vẫn phẳng, sản phẩm cây vẫn cây.
      const tron = await sql<{ productModelId: number }[]>`
        SELECT "productModelId" FROM measurement_point_defs
         WHERE "deletedAt" IS NULL AND "productModelId" IN (${ids.product}, ${ids.productPhang})
         GROUP BY "productModelId"
        HAVING count(*) FILTER (WHERE "captureRowId" IS NULL) > 0
           AND count(*) FILTER (WHERE "captureRowId" IS NOT NULL) > 0`;
      expect(tron, `[${tenDb}] KHÔNG sản phẩm nào được trộn điểm phẳng với điểm cây`).toEqual([]);
    }, 60_000);
  },
);
