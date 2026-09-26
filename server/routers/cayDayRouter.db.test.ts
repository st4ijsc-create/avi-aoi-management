/**
 * server/routers/cayDayRouter.db.test.ts
 *
 * ★★★ Khối C — Task 9 (QĐ-6): lưới ĐỎ→XANH cho `cayDayRouter` — bốn procedure đọc
 * cây dạy TRƯỚC bản vá này KHÔNG tồn tại (spec, mục "Đường đọc").
 *
 * ── Seed bằng ĐƯỜNG THẬT, không dựng dữ liệu tay ──────────────────────────────
 * Gọi `machineApiRouter.submitMachineTemplate` (như `cayDayChieuMay.db.test.ts`,
 * Khối B Task 5) với mẫu máy THẬT (`template-sync-sample.json`: 2 surface / 4
 * position / 8 capture / 16 component, ĐÚNG 2 component mỗi capture — đo trực
 * tiếp trên file, không suy đoán). Bốn procedure của router này CHỈ ĐỌC — không
 * hàm nào ở đây ghi tắt qua `db.ts`.
 *
 * ── PHẠM VI TENANT — âm ĐỐI XỨNG, đi qua createCaller (không gọi thẳng db) ────
 * Ba người: `uIn` (gán đúng nhà máy đã dạy), `uOut` (gán nhà máy KHÁC), `uNone`
 * (0 gán nhà máy nào). Mọi procedure phải: uIn thấy đủ, uOut/uNone thấy RỖNG —
 * đúng khuôn `getMeasurementPointDefsByMachine`/`getReadiness`
 * (`server/db/product.ts`), KHÔNG lọc theo cột client tự khai (bài học
 * `pham-vi-tenant-dot-lon`).
 *
 * ── Dạy 1 giới hạn qua ĐƯỜNG THẬT ──────────────────────────────────────────
 * `measurementPointRouter.update` (không viết SQL UPDATE tay) — sản phẩm dựng
 * `lifecycleStatus='development'` để cửa duyệt ngưỡng (`assertThresholdEditAllowed`)
 * cho sửa trực tiếp (không đụng cờ `THRESHOLD_GATE_ENFORCED` nào).
 *
 * ── DẤU CHÂN ĐỂ LẠI: KHÔNG ─────────────────────────────────────────────────
 * Sáu bảng chạm tới đều KHÔNG WORM (`avi_app` có DELETE — đo `role_table_grants`,
 * cùng phép đo `cayDayChieuMay.db.test.ts`), `afterAll` dọn THẬT, KHÔNG
 * `.catch(() => {})`. KHÔNG ghi `product_inspections`/`audit_logs` (WORM).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { machineApiRouter } from "./machineApiRouters";
import { measurementPointRouter } from "./productRouters";
import { cayDayRouter } from "./cayDayRouter";
import { issueMachineKey } from "../services/machineAuthService";
import { bamCayDay } from "../db/cayDay";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";
const CO_MAU = existsSync(MAU_MAY_THAT);
const RUN = `T9${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = {
  facA: 0, wsA: 0, lnA: 0, stA: 0, may: 0,
  facB: 0,
  product: 0,
  key: 0,
  uIn: 0, uOut: 0, uNone: 0, uAdmin: 0,
  captureRowId: 0,
  pointDefId: 0,
};
let apiKey = "";

/** Ctx của MÁY ĐÃ XÁC THỰC bằng apiKey (cửa `machineApiRouter`) — cùng khuôn `cayDayChieuMay.db.test.ts`. */
function ctxMay(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const callerMay = () => machineApiRouter.createCaller(ctxMay());

/** Ctx của NGƯỜI DÙNG đã đăng nhập — cùng khuôn `phamViDoc11File.db.test.ts`. */
const ctxNguoi = (id: number, role: string) => ({ user: { id, role, name: `u${id}` } }) as never;
const callerCay = (id: number, role: string) => cayDayRouter.createCaller(ctxNguoi(id, role));
const callerPoint = (id: number, role: string) => measurementPointRouter.createCaller(ctxNguoi(id, role));

/** Mẫu máy THẬT, bản sao sâu mới mỗi lần gọi (như `cayDayChieuMay.db.test.ts`). */
function mauThat(): any {
  return JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));
}

describe.skipIf(!DB_URL || !CO_MAU)(
  "Khối C Task 9 — cayDayRouter (bốn procedure đọc, ghi THẬT vai avi_app)",
  () => {
    beforeAll(async () => {
      sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
      await sql`SET TIME ZONE 'UTC'`;
      const [d] = await sql<{ db: string; usr: string }[]>`
        SELECT current_database() AS db, current_user AS usr`;
      tenDb = d.db;
      // ⚠ Cầu chì Đ-28: vai không phải avi_app thì mọi phép đo quyền/phạm vi bên dưới vô nghĩa.
      expect(d.usr, "phải đo bằng vai avi_app — vai aoi (superuser+BYPASSRLS) làm mọi phép đo phạm vi xanh giả").toBe("avi_app");
      // eslint-disable-next-line no-console
      console.log(`[cayDayRouter] current_database()=${d.db} current_user=${d.usr}`);

      // ── Hai nhà máy: A sở hữu máy đã dạy cây; B RỖNG (chỉ để gán uOut) ──────
      const [fa] = await sql`INSERT INTO factories (code, name) VALUES (${"T9-FA-" + RUN}, 'T9 FA') RETURNING id`;
      ids.facA = fa!.id as number;
      const [wa] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facA}, ${"T9-WA-" + RUN}, 'T9 WA') RETURNING id`;
      ids.wsA = wa!.id as number;
      const [la] = await sql`INSERT INTO production_lines ("workshopId", code, name, "capacityPerHour") VALUES (${ids.wsA}, ${"T9-LA-" + RUN}, 'T9 LA', 100) RETURNING id`;
      ids.lnA = la!.id as number;
      const [sa] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.lnA}, ${"T9-SA-" + RUN}, 'T9 SA') RETURNING id`;
      ids.stA = sa!.id as number;
      const [ma] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.stA}, ${"T9-MC-" + RUN}, 'T9 MC', 'AOI') RETURNING id`;
      ids.may = ma!.id as number;

      const [fb] = await sql`INSERT INTO factories (code, name) VALUES (${"T9-FB-" + RUN}, 'T9 FB') RETURNING id`;
      ids.facB = fb!.id as number;

      // Sản phẩm — `lifecycleStatus='development'` để MỆNH ĐỀ 4 (dạy giới hạn qua
      // `measurementPoint.update`) không vấp cửa duyệt ngưỡng (`assertThresholdEditAllowed`)
      // mà không phải đụng cờ `THRESHOLD_GATE_ENFORCED` nào.
      const [p] = await sql`
        INSERT INTO product_models (code, name, "lifecycleStatus")
        VALUES (${"T9-" + RUN}, 'Khoi C Task 9 cayDayRouter', 'development') RETURNING id`;
      ids.product = p!.id as number;

      const cred = await issueMachineKey({
        machineId: ids.may, name: `khoic-task9-${RUN}`, scopes: ["ingest:write", "equipment:read"],
      });
      apiKey = cred.plaintextKey;
      ids.key = cred.id;

      // ── Bốn người xem: uIn (gán FAC A) · uOut (gán FAC B) · uNone (0 gán) · uAdmin ──
      const mkUser = async (username: string, role: string): Promise<number> => {
        const [r] = await sql`
          INSERT INTO users ("openId", username, name, role, "isActive")
          VALUES (${`t9-${username}`}, ${username}, ${username}, ${role}, true) RETURNING id`;
        return r!.id as number;
      };
      ids.uIn = await mkUser(`t9-in-${RUN}`, "engineer");
      ids.uOut = await mkUser(`t9-out-${RUN}`, "engineer");
      ids.uNone = await mkUser(`t9-none-${RUN}`, "supervisor");
      ids.uAdmin = await mkUser(`t9-admin-${RUN}`, "admin");
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uIn}, ${"T9-FA-" + RUN})`;
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uOut}, ${"T9-FB-" + RUN})`;
    }, 60_000);

    afterAll(async () => {
      if (!sql) return;
      // Sáu bảng KHÔNG WORM — dọn THẬT, không `.catch(() => {})` (bài học docblock
      // `cayDayChieuMay.db.test.ts`: một catch rỗng ở đây là dọn dẹp NO-OP CÂM).
      await sql`DELETE FROM measurement_point_versions WHERE "pointDefId" IN (
        SELECT id FROM measurement_point_defs WHERE "productModelId" = ${ids.product})`;
      await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_surfaces WHERE "productModelId" = ${ids.product}`; // CASCADE positions/captures
      await sql`DELETE FROM machine_template_versions WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
      if (ids.key) await sql`DELETE FROM api_keys WHERE id = ${ids.key}`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" IN (${ids.uIn}, ${ids.uOut})`;
      await sql`DELETE FROM users WHERE id IN (${ids.uIn}, ${ids.uOut}, ${ids.uNone}, ${ids.uAdmin})`;
      if (ids.may) await sql`DELETE FROM machines WHERE id = ${ids.may}`;
      if (ids.stA) await sql`DELETE FROM stations WHERE id = ${ids.stA}`;
      if (ids.lnA) await sql`DELETE FROM production_lines WHERE id = ${ids.lnA}`;
      if (ids.wsA) await sql`DELETE FROM workshops WHERE id = ${ids.wsA}`;
      if (ids.facA) await sql`DELETE FROM factories WHERE id = ${ids.facA}`;
      if (ids.facB) await sql`DELETE FROM factories WHERE id = ${ids.facB}`;
      await sql.end();
    }, 60_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("SEED — submitMachineTemplate cho ĐÚNG cây 2/4/8/16 (đường thật, không dựng tay)", async () => {
      const k = await callerMay().submitMachineTemplate({
        apiKey, productModelCode: `T9-${RUN}`, template: mauThat(),
      });
      expect(
        { s: k.surfaces, p: k.positions, c: k.captures, k: k.components },
        `[current_database()=${tenDb}] seed phải đúng 2/4/8/16 (mẫu máy thật)`,
      ).toEqual({ s: 2, p: 4, c: 8, k: 16 });

      const [cap] = await sql<{ id: number }[]>`
        SELECT pc.id FROM product_captures pc
          JOIN product_positions pp ON pp.id = pc."positionRowId"
          JOIN product_surfaces  ps ON ps.id = pp."surfaceRowId"
         WHERE ps."productModelId" = ${ids.product} AND pc."machineId" = ${ids.may}
         ORDER BY pc.id LIMIT 1`;
      expect(cap, `[${tenDb}] phải tra được ít nhất một capture vừa seed`).toBeTruthy();
      ids.captureRowId = cap!.id;
    }, 90_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 1 — listMachinesForProduct: 1 máy + bản dạy hiện hành, phạm vi tenant", async () => {
      const trongPv = await callerCay(ids.uIn, "engineer").listMachinesForProduct({ productModelId: ids.product });
      expect(trongPv, `[${tenDb}] uIn (gán đúng nhà máy) phải thấy ĐÚNG MỘT máy`).toHaveLength(1);
      expect(trongPv[0].machineId).toBe(ids.may);
      expect(trongPv[0].banDayHienHanh, "bản dạy hiện hành không được null sau khi đã seed").not.toBeNull();
      expect(trongPv[0].banDayHienHanh!.version).toBe(1);
      expect(trongPv[0].banDayHienHanh!.checksum, "checksum trả về phải KHỚP hàm thuần bamCayDay").toBe(bamCayDay(mauThat()));

      const ngoaiPv = await callerCay(ids.uOut, "engineer").listMachinesForProduct({ productModelId: ids.product });
      expect(ngoaiPv, `[${tenDb}] uOut (gán nhà máy KHÁC) phải thấy RỖNG — không phải lỗi, không phải 1 máy`).toEqual([]);

      const khongGan = await callerCay(ids.uNone, "supervisor").listMachinesForProduct({ productModelId: ids.product });
      expect(khongGan, `[${tenDb}] uNone (0 gán nhà máy) phải thấy RỖNG`).toEqual([]);
    }, 30_000);

    it("MỆNH ĐỀ 1b — getTree: 2 surface / 4 position / 8 capture, mỗi capture soComponent=2, phạm vi tenant", async () => {
      const cay = await callerCay(ids.uIn, "engineer").getTree({ productModelId: ids.product, machineId: ids.may });
      expect(cay.surfaces, `[${tenDb}] phải đúng 2 surface`).toHaveLength(2);
      const soPosition = cay.surfaces.reduce((n, s) => n + s.positions.length, 0);
      const captures = cay.surfaces.flatMap((s) => s.positions.flatMap((p) => p.captures));
      expect({ soPosition, soCapture: captures.length }, `[${tenDb}] tổng position/capture phải khớp seed`).toEqual({
        soPosition: 4, soCapture: 8,
      });
      expect(
        captures.every((c) => c.soComponent === 2),
        `[${tenDb}] MỖI capture phải đúng soComponent=2 (đo trực tiếp trên mẫu máy thật)`,
      ).toBe(true);

      const rong = await callerCay(ids.uOut, "engineer").getTree({ productModelId: ids.product, machineId: ids.may });
      expect(rong, `[${tenDb}] uOut ngoài phạm vi ⇒ cây RỖNG, không phải lỗi`).toEqual({ surfaces: [] });
    }, 30_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 2 — listComponents: 2 component/capture, coGioiHan=false TRƯỚC khi dạy, phạm vi tenant", async () => {
      const cp = await callerCay(ids.uIn, "engineer").listComponents({ captureRowId: ids.captureRowId });
      expect(cp, `[${tenDb}] một capture của mẫu chuẩn phải đúng 2 component`).toHaveLength(2);
      for (const c of cp) {
        expect(c.coGioiHan, `[${tenDb}] cây dạy KHÔNG mang giới hạn nào (hợp đồng máy) ⇒ coGioiHan=false`).toBe(false);
        expect(c.gioiHan.lowerLimit, "gioiHan.lowerLimit phải NULL trước khi dạy").toBeNull();
        expect(c.gioiHan.unit, "gioiHan.unit phải NULL trước khi dạy").toBeNull();
        expect(c.componentExtId).toBeTruthy();
        expect(typeof c.name).toBe("string");
        expect(c.roiWidth).not.toBeNull();
      }
      ids.pointDefId = cp[0].id;

      const rong = await callerCay(ids.uOut, "engineer").listComponents({ captureRowId: ids.captureRowId });
      expect(rong, `[${tenDb}] uOut ngoài phạm vi ⇒ RỖNG (không phân biệt "không tồn tại" khỏi "của tenant khác")`).toEqual([]);
    }, 30_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 3 — thongKeGioiHan TRƯỚC khi dạy = {16,0,16}, phạm vi tenant", async () => {
      const tk = await callerCay(ids.uIn, "engineer").thongKeGioiHan({ productModelId: ids.product, machineId: ids.may });
      expect(tk, `[${tenDb}] 16 component, 0 đã dạy, 16 chưa có giới hạn`).toEqual({
        tongComponent: 16, daDay: 0, chuaCoGioiHan: 16,
      });

      const rong = await callerCay(ids.uOut, "engineer").thongKeGioiHan({ productModelId: ids.product, machineId: ids.may });
      expect(rong, `[${tenDb}] uOut ngoài phạm vi ⇒ đếm 0 cả ba, không phải lỗi`).toEqual({
        tongComponent: 0, daDay: 0, chuaCoGioiHan: 0,
      });
    }, 30_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("MỆNH ĐỀ 4 — dạy 1 giới hạn qua measurementPoint.update ⇒ thongKeGioiHan {16,1,15} + listComponents phản ánh đúng", async () => {
      await callerPoint(ids.uAdmin, "admin").update({
        id: ids.pointDefId,
        lowerLimit: "1.0",
        upperLimit: "9.0",
        changeReason: "T9 seed — dạy 1 giới hạn qua đường thật",
      });

      const tk = await callerCay(ids.uIn, "engineer").thongKeGioiHan({ productModelId: ids.product, machineId: ids.may });
      expect(tk, `[${tenDb}] đúng 1 điểm vừa dạy chuyển từ chuaCoGioiHan sang daDay`).toEqual({
        tongComponent: 16, daDay: 1, chuaCoGioiHan: 15,
      });

      const cp = await callerCay(ids.uIn, "engineer").listComponents({ captureRowId: ids.captureRowId });
      const daDay = cp.find((c) => c.id === ids.pointDefId);
      expect(daDay, "component vừa dạy phải còn trong danh sách").toBeTruthy();
      expect(daDay!.coGioiHan, "component vừa dạy phải coGioiHan=true").toBe(true);
      // ⚠ decimal(15,6) đọc lại qua postgres-js là CHUỖI mang đủ 6 số thập phân
      // (`"1.000000"`, không phải `"1"`) — so bằng `Number(...)` như
      // `server/db/productClone.db.test.ts:203` đã làm cho CÙNG cột này, không so
      // chuỗi trần (đo được, không phải suy đoán từ mock).
      expect(Number(daDay!.gioiHan.lowerLimit), "gioiHan.lowerLimit phải phản ánh giá trị vừa dạy").toBe(1);
      expect(Number(daDay!.gioiHan.upperLimit)).toBe(9);

      const conLai = cp.filter((c) => c.id !== ids.pointDefId);
      expect(conLai.every((c) => c.coGioiHan === false), "component KHÔNG được dạy phải vẫn coGioiHan=false").toBe(true);
    }, 30_000);
  },
);
