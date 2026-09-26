/**
 * server/services/productReadinessCayDay.db.test.ts
 *
 * Khối C — Task 12, Phần 1 (QĐ-7 · spec §5.5): `computeProductReadiness` hạng mục
 * `limits` phải THẤY hàng cây (`captureRowId IS NOT NULL`), không chỉ điểm phẳng
 * DIMENSION. Trước bản vá: cây dạy mặc định `measurementType='VISUAL'`
 * (`LOAI_DO_MAC_DINH_CAY_DAY`, `cayDay.ts:142`) ⇒ bị LOẠI khỏi `numericPoints`
 * hoàn toàn ⇒ `numeric===0 && pointCount>0` ⇒ hạng mục khai "na"/100% dù 0/16
 * component có giới hạn thật — đúng lỗ mà spec khai ("màn hình khai 100% có giới
 * hạn trong khi cổng trả khongGioiHan 100%").
 *
 * ── Seed bằng ĐƯỜNG THẬT (khuôn `cayDayRouter.db.test.ts` Task 9 / `congRaKhoiC.db.test.ts`) ──
 * `machineApiRouter.submitMachineTemplate` với `template-sync-sample.json` (2/4/8/16
 * — TOP+BOTTOM) tạo ĐÚNG 16 hàng cây, 0 giới hạn (hợp đồng máy không mang trường
 * giới hạn). Dạy 8/16 qua `measurementPoint.setLimitsBatch` (đường ghi THẬT, QĐ-5).
 *
 * ── SẢN PHẨM MÃ RIÊNG ────────────────────────────────────────────────────────
 * `KC-T12-<RUN>` — KHÔNG dùng model có sẵn hay `KC-EXIT-*` (cổng ra mệnh đề 3) vì
 * DB test có dư từ các test trước; đếm readiness trên model RIÊNG để không lẫn.
 *
 * ── Định nghĩa "có giới hạn" khớp Task 9 BẰNG CẤU TẠO ──────────────────────────
 * `productReadinessService.ts` gọi LẠI `tinhGioiHan`/`chieuGioiHan` export từ
 * `cayDay.ts` (Task 9) — cùng hàm phân loại `coGioiHan` mà `cayDayRouter.listComponents`/
 * `thongKeGioiHan` dùng, không viết lại logic 18-cột lần hai (census §3 sẽ bắt).
 *
 * ── Dấu chân để lại: KHÔNG (sáu bảng chạm tới không WORM, đã đo ở Task 9) ─────
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { machineApiRouter } from "../routers/machineApiRouters";
import { measurementPointRouter } from "../routers/productRouters";
import { issueMachineKey } from "../services/machineAuthService";
import { computeProductReadiness } from "./productReadinessService";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\template-sync-sample.json";
const CO_MAU = existsSync(MAU_MAY_THAT);
const RUN = `T12${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const MA_SP = `KC-T12-${RUN}`;

let sql: ReturnType<typeof postgres>;
let tenDb = "(chưa đo)";
const ids = { fac: 0, ws: 0, ln: 0, st: 0, may: 0, product: 0, key: 0 };
let apiKey = "";
/** 16 componentExtId của cây dạy (TOP+BOTTOM), ĐÚNG thứ tự duyệt cây. */
let maTheoThuTu: string[] = [];

function ctxMay(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}
const callerMay = () => machineApiRouter.createCaller(ctxMay());

// admin — bỏ qua lọc tenant (mẫu ĐÚNG của `congRaKhoiC.db.test.ts`/`measurementPointLimits.db.test.ts`,
// Task 8 Khối C đã review ĐẠT). Lưới này canh readiness đếm hàng cây, KHÔNG canh
// permission/tenant riêng — đã có lưới đó ở Task 9.
const adminCtx = {
  user: { id: 999999998, role: "admin", name: "Khoi C Task 12 readiness" },
  req: { ip: null, headers: {} },
} as unknown as TrpcContext;
const callerAdmin = () => measurementPointRouter.createCaller(adminCtx);

function mauThat(): any {
  return JSON.parse(readFileSync(MAU_MAY_THAT, "utf8"));
}

describe.skipIf(!DB_URL || !CO_MAU)(
  "Khối C Task 12 (QĐ-7) — productReadinessService thấy hàng cây",
  () => {
    beforeAll(async () => {
      sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
      const [d] = await sql<{ db: string; usr: string }[]>`
        SELECT current_database() AS db, current_user AS usr`;
      tenDb = d.db;
      expect(d.usr, "phải đo bằng vai avi_app — vai aoi (superuser+BYPASSRLS) làm phép đo phạm vi XANH GIẢ").toBe("avi_app");
      // eslint-disable-next-line no-console
      console.log(`[productReadinessCayDay] current_database()=${d.db} current_user=${d.usr}`);

      const [fa] = await sql`INSERT INTO factories (code, name) VALUES (${"T12-FA-" + RUN}, 'T12 FA') RETURNING id`;
      ids.fac = fa!.id as number;
      const [wa] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.fac}, ${"T12-WA-" + RUN}, 'T12 WA') RETURNING id`;
      ids.ws = wa!.id as number;
      const [la] = await sql`INSERT INTO production_lines ("workshopId", code, name, "capacityPerHour") VALUES (${ids.ws}, ${"T12-LA-" + RUN}, 'T12 LA', 100) RETURNING id`;
      ids.ln = la!.id as number;
      const [sa] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.ln}, ${"T12-SA-" + RUN}, 'T12 SA') RETURNING id`;
      ids.st = sa!.id as number;
      const [ma] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.st}, ${"T12-MC-" + RUN}, 'T12 MC', 'AOI') RETURNING id`;
      ids.may = ma!.id as number;

      // 'development' — cùng lý do Task 9/cổng-ra: `setLimitsBatch` đi thẳng
      // (assertThresholdEditAllowed) mà không đụng cờ THRESHOLD_GATE_ENFORCED.
      const [p] = await sql`
        INSERT INTO product_models (code, name, "lifecycleStatus")
        VALUES (${MA_SP}, 'Khoi C Task 12 readiness cay day', 'development') RETURNING id`;
      ids.product = p!.id as number;

      const cred = await issueMachineKey({
        machineId: ids.may, name: `khoic-task12-${RUN}`, scopes: ["ingest:write", "equipment:read"],
      });
      apiKey = cred.plaintextKey;
      ids.key = cred.id;

      const day = await callerMay().submitMachineTemplate({
        apiKey, productModelCode: MA_SP, template: mauThat(),
      });
      expect(
        { s: day.surfaces, p: day.positions, c: day.captures, k: day.components },
        `[current_database()=${tenDb}] seed phải đúng 2/4/8/16 (mẫu máy thật)`,
      ).toEqual({ s: 2, p: 4, c: 8, k: 16 });

      for (const s of mauThat().surfaces)
        for (const pos of s.positions)
          for (const cc of pos.captures)
            for (const k of cc.components) maTheoThuTu.push(k.id);
      expect(maTheoThuTu.length).toBe(16);
    }, 60_000);

    afterAll(async () => {
      if (!sql) return;
      await sql`DELETE FROM measurement_point_versions WHERE "pointDefId" IN (
        SELECT id FROM measurement_point_defs WHERE "productModelId" = ${ids.product})`;
      await sql`DELETE FROM measurement_point_defs WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_surfaces WHERE "productModelId" = ${ids.product}`; // CASCADE positions/captures
      await sql`DELETE FROM machine_template_versions WHERE "productModelId" = ${ids.product}`;
      await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
      if (ids.key) await sql`DELETE FROM api_keys WHERE id = ${ids.key}`;
      if (ids.may) await sql`DELETE FROM machines WHERE id = ${ids.may}`;
      if (ids.st) await sql`DELETE FROM stations WHERE id = ${ids.st}`;
      if (ids.ln) await sql`DELETE FROM production_lines WHERE id = ${ids.ln}`;
      if (ids.ws) await sql`DELETE FROM workshops WHERE id = ${ids.ws}`;
      if (ids.fac) await sql`DELETE FROM factories WHERE id = ${ids.fac}`;
      await sql.end();
    }, 60_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("BƯỚC 1 — 16 component cây, 0 giới hạn ⇒ hạng mục limits = missing/0%, KHÔNG na/100%", async () => {
      const r = await computeProductReadiness(ids.product);
      expect(r, `[current_database()=${tenDb}] sản phẩm ${MA_SP} phải tồn tại`).not.toBeNull();

      const limits = r!.items.find((i) => i.key === "limits")!;
      // eslint-disable-next-line no-console
      console.log(`[productReadinessCayDay] [${tenDb}] TRƯỚC khi dạy — limits=${JSON.stringify(limits)}`);

      expect(
        limits.status,
        `[${tenDb}] 16 component cây 0 giới hạn PHẢI missing — mã hiện tại (chỉ đếm điểm phẳng DIMENSION) sẽ trả "na" vì numericPoints=0 (cây dạy mặc định measurementType=VISUAL)`,
      ).toBe("missing");
      expect(limits.fraction, `[${tenDb}] 0/16 component có giới hạn ⇒ fraction phải 0`).toBe(0);
    }, 30_000);

    // ══════════════════════════════════════════════════════════════════════════
    it("BƯỚC 2 — dạy 8/16 qua setLimitsBatch ⇒ limits = partial, fraction 0.5", async () => {
      const found = await sql<{ id: number; componentExtId: string }[]>`
        SELECT id, "componentExtId" FROM measurement_point_defs
         WHERE "productModelId" = ${ids.product}
           AND "componentExtId" = ANY(${maTheoThuTu.slice(0, 8)})
           AND "deletedAt" IS NULL`;
      expect(found.length, `[current_database()=${tenDb}] phải tìm đúng 8 point-def cần dạy`).toBe(8);

      const res = await callerAdmin().setLimitsBatch({
        items: found.map((f) => ({ id: f.id, lowerLimit: "0", upperLimit: "100" })),
        changeReason: "Khoi C Task 12 — day 8/16 cho luoi readiness",
      });
      expect(res.updated, `[${tenDb}] phải ghi được đúng 8 điểm`).toBe(8);

      const r = await computeProductReadiness(ids.product);
      const limits = r!.items.find((i) => i.key === "limits")!;
      // eslint-disable-next-line no-console
      console.log(`[productReadinessCayDay] [${tenDb}] SAU khi dạy 8/16 — limits=${JSON.stringify(limits)}`);

      expect(limits.fraction, `[${tenDb}] 8/16 có giới hạn ⇒ fraction phải đúng 0.5`).toBe(0.5);
      expect(limits.status).toBe("partial");
      expect(limits.counts, `[${tenDb}] counts phải phản ánh 8 missing / 16 tổng`).toMatchObject({ missing: 8 });
    }, 30_000);
  },
);
