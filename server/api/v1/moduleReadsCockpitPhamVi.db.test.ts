/**
 * CỔNG CSDL THẬT — ĐỢT 42 (QA Đợt 41 D-4 lỗ #2, G116): **LỐI VÀO HTTP v1 CỦA COCKPIT THEO PHẠM VI KHOÁ API.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖ ĐƯỢC ĐO, KHÔNG ĐƯỢC SUY
 * ══════════════════════════════════════════════════════════════════════════════
 * `.qa-dot41/api-vai/http-v1.json` (dist, HTTP thật): API key TẠM `dataScopeMode=factory,
 * factoryCode=SIM-FAC, [equipment:read]` gọi `/api/v1/machines/257/detail` (máy của nhà máy 18) ⇒
 * **200** + `identity.code T12-SHOT-MC-…`; `/robots/1/detail` ⇒ 200. Không khoá ⇒ 401; máy không
 * tồn tại ⇒ 404. Tức khoá đại diện MỘT nhà máy (quyết định chủ dự án 2026-08-17, mig 0325) đọc được
 * cockpit của nhà máy khác: `moduleReads.ts` gọi `machineDetail(machineId)` / `robotDetail(robotId)`
 * **bỏ trống `scope`** dù chữ ký `assetCockpitService.machineDetail(id, scope?)` (Đợt 40) đã có và
 * `req.apiPrincipal.tenantScope` có sẵn ngay trên (`/ecosystem/kpi` đã dùng).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ MỘT BỘ PHÂN GIẢI, HAI TRỤC (G12)
 * ══════════════════════════════════════════════════════════════════════════════
 * Một khoá API KHÔNG phải một người dùng, nên không đi qua `phamViCua(ctx)` (trục ①). Đợt 42 thêm
 * `PhamViMaTenant = { tenantScope }` (trục ②, `db/hierarchy.ts`) — bản sao NGUYÊN VĂN nhánh ② của
 * `TenantFactoryScopeArgs`, để `idsTrongPhamVi`/`trongPhamVi` chuyển thẳng vào `resolveTenantFactoryScope`.
 * Không có bộ luật thứ hai: cùng hàm mà `assetCockpitRouter` (trục ①) và `/ecosystem/kpi` (trục ②) đi qua.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ BA HÌNH DẠNG KHOÁ — mỗi hình một ô, vì "không lọc" và "chặn tất" cùng trả về một kiểu
 * ══════════════════════════════════════════════════════════════════════════════
 *   (+) khoá gán nhà máy A ⇒ máy/robot của A: 200; máy/robot của B: **404**, CÙNG hình dạng với
 *       không tồn tại (G82 — `/machines/999999999` cũng 404 `not_found`);
 *   (∞) khoá TOÀN CỤC tường minh (`mode: "global"`, cả master key) ⇒ thấy cả hai — KHÔNG thêm mệnh đề
 *       nào (chiều dương chống "vá quá tay thành chặn tất cả");
 *   (∅) khoá CHƯA KHAI (`mode: null`) ⇒ 404 cho cả máy của A — fail-closed, cùng chiều `tenantCodeScopeOf`
 *       (*"quên gọi `requireDeclaredTenantScope` vẫn ra 0 hàng"*). ⚠ Đây là ĐỔI HÀNH VI có chủ ý: trước
 *       Đợt 42 khoá chưa khai đọc được mọi cockpit.
 *
 * ★ Chỉ thay **`requireScope`** (đặt `req.apiPrincipal` theo ô đang đo) — envelope, `wrap`, service,
 *   CSDL đều là THẬT. Mock cả `resolvePrincipal` thì lưới đo bản sao (G20); mock service thì lưới đo
 *   một đối số được truyền chứ không đo một máy bị chặn.
 * ★ G22 — không dựa vào seed: tự tạo 2 nhà máy · 2 xưởng · 2 chuyền · 2 trạm · 2 máy · 3 robot (một
 *   mồ côi), rồi xoá đúng chừng ấy từ trong ra ngoài.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import postgres from "postgres";
import type { ApiPrincipal } from "./auth";
import { GLOBAL_TENANT_SCOPE, UNDECLARED_TENANT_SCOPE, type ApiKeyTenantScope } from "./apiKeyScope";

/** Principal của ô đang đo — `null` = không khoá (⇒ 401, đối chứng lối vào vẫn đóng). */
let principalHienTai: ApiPrincipal | null = null;

vi.mock("./auth", async (importOriginal) => {
  const goc = await importOriginal<typeof import("./auth")>();
  return {
    ...goc,
    requireScope: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!principalHienTai) {
        res.status(401).json({ ok: false, error: { code: "unauthorized", message: "no key (probe)" } });
        return;
      }
      req.apiPrincipal = principalHienTai;
      next();
    },
  };
});

import { registerModuleReadRoutes } from "./moduleReads";
import { machineDetail, robotDetail } from "../../services/ecosystem/assetCockpitService";

const DB_URL = process.env.DATABASE_URL;
const DAU = `D42-HTTP-${Date.now()}`;

let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";

interface Fixture {
  facTrongId: number;
  facTrongCode: string;
  facNgoaiId: number;
  workshopIds: number[];
  lineIds: number[];
  tramIds: number[];
  mayTrongId: number;
  mayNgoaiId: number;
  robotTrongId: number;
  robotNgoaiId: number;
  robotMoCoiId: number;
}
let fx: Fixture | null = null;

async function taoNhanh(code: string, ten: string) {
  const f = await sql`INSERT INTO factories (code, name) VALUES (${code}, ${ten}) RETURNING id`;
  const factoryId = (f[0] as unknown as { id: number }).id;
  const w = await sql`
    INSERT INTO workshops ("factoryId", code, name)
    VALUES (${factoryId}, ${`${code}-W`}, ${`${ten} xuong`}) RETURNING id`;
  const workshopId = (w[0] as unknown as { id: number }).id;
  const l = await sql`
    INSERT INTO production_lines ("workshopId", code, name)
    VALUES (${workshopId}, ${`${code}-L`}, ${`${ten} chuyen`}) RETURNING id`;
  const lineId = (l[0] as unknown as { id: number }).id;
  const s = await sql`
    INSERT INTO stations ("lineId", code, name)
    VALUES (${lineId}, ${`${code}-S`}, ${`${ten} tram`}) RETURNING id`;
  const stationId = (s[0] as unknown as { id: number }).id;
  const m = await sql`
    INSERT INTO machines ("stationId", code, name, "machineType")
    VALUES (${stationId}, ${`${code}-M`}, ${`${ten} may`}, 'AOI') RETURNING id`;
  const machineId = (m[0] as unknown as { id: number }).id;
  return { factoryId, workshopId, lineId, stationId, machineId };
}

async function taoRobot(nhan: string, lineId: number | null): Promise<number> {
  const r = await sql`
    INSERT INTO robots (code, name, vendor, kind, endpoint, "lineId", "stationId")
    VALUES (${`${DAU}-${nhan}`}, ${`${DAU} robot ${nhan}`}, 'sim', 'arm', 'tcp://127.0.0.1:1', ${lineId}, NULL)
    RETURNING id`;
  return (r[0] as unknown as { id: number }).id;
}

function khoa(tenantScope: ApiKeyTenantScope): ApiPrincipal {
  return { kind: "api-key", name: `${DAU}-khoa`, scopes: ["equipment:read"], apiKeyId: 0, tenantScope };
}

async function goi(path: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: await r.json() };
}

describe.skipIf(!DB_URL)("Đợt 42 — HTTP v1 cockpit (`/machines/:id/detail`, `/robots/:id/detail`) theo phạm vi KHOÁ API", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const facTrongCode = `${DAU}-TRONG`;
    const trong = await taoNhanh(facTrongCode, `${DAU} TRONG`);
    const ngoai = await taoNhanh(`${DAU}-NGOAI`, `${DAU} NGOAI`);
    fx = {
      facTrongId: trong.factoryId,
      facTrongCode,
      facNgoaiId: ngoai.factoryId,
      workshopIds: [trong.workshopId, ngoai.workshopId],
      lineIds: [trong.lineId, ngoai.lineId],
      tramIds: [trong.stationId, ngoai.stationId],
      mayTrongId: trong.machineId,
      mayNgoaiId: ngoai.machineId,
      robotTrongId: await taoRobot("trong", trong.lineId),
      robotNgoaiId: await taoRobot("ngoai", ngoai.lineId),
      robotMoCoiId: await taoRobot("mocoi", null),
    };

    const app = express();
    const r = express.Router();
    registerModuleReadRoutes(r);
    app.use("/api/v1", r);
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (fx) {
      await sql`DELETE FROM robots WHERE id = ANY(${[fx.robotTrongId, fx.robotNgoaiId, fx.robotMoCoiId]})`;
      await sql`DELETE FROM machines WHERE id = ANY(${[fx.mayTrongId, fx.mayNgoaiId]})`;
      await sql`DELETE FROM stations WHERE id = ANY(${fx.tramIds})`;
      await sql`DELETE FROM production_lines WHERE id = ANY(${fx.lineIds})`;
      await sql`DELETE FROM workshops WHERE id = ANY(${fx.workshopIds})`;
      await sql`DELETE FROM factories WHERE id = ANY(${[fx.facTrongId, fx.facNgoaiId]})`;
    }
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("ca dương DỰNG ĐƯỢC THẬT — nếu không, mọi ô dưới đo trên tập rỗng", () => {
    expect(fx).not.toBeNull();
    expect(fx!.mayTrongId).not.toBe(fx!.mayNgoaiId);
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("tầng service — `PhamViMaTenant` (trục ②) đi qua CÙNG bộ phân giải với trục ①", () => {
    const pvTrong = () => ({ tenantScope: { corporateCode: null, factoryCode: fx!.facTrongCode } });

    it("★★★ CHIỀU (−) — khoá của A hỏi máy của B ⇒ `null` (cùng hình dạng với không tồn tại)", async () => {
      expect(await machineDetail(fx!.mayNgoaiId, pvTrong())).toBeNull();
      expect(await robotDetail(fx!.robotNgoaiId, pvTrong())).toBeNull();
    });
    it("CHIỀU (+) — khoá của A hỏi máy/robot của A ⇒ có, identity đúng nhà máy A", async () => {
      const m = await machineDetail(fx!.mayTrongId, pvTrong());
      expect(m?.identity.factoryId).toBe(fx!.facTrongId);
      expect((await robotDetail(fx!.robotTrongId, pvTrong()))?.identity.id).toBe(fx!.robotTrongId);
    });
    it("robot MỒ CÔI (lineId = stationId = NULL) ⇒ `null` cho khoá bị thu hẹp — fail-closed", async () => {
      expect(await robotDetail(fx!.robotMoCoiId, pvTrong())).toBeNull();
    });
    it("★ lời khai RỖNG `{ tenantScope: {} }` (khoá chưa khai) ⇒ `null` cho CẢ máy của A — fail-closed", async () => {
      expect(await machineDetail(fx!.mayTrongId, { tenantScope: {} })).toBeNull();
    });
    it("chiều DƯƠNG chống vá quá tay — bỏ trống `scope` (lối đi không danh tính) vẫn thấy máy của B", async () => {
      expect((await machineDetail(fx!.mayNgoaiId))?.identity.factoryId).toBe(fx!.facNgoaiId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("HTTP v1 — khoá MỘT NHÀ MÁY (mode factory, factoryCode = A)", () => {
    beforeAll(() => {
      principalHienTai = khoa({ mode: "factory", corporateCode: null, factoryCode: fx!.facTrongCode });
    });

    it("CHIỀU (+) — `/machines/<máy A>/detail` ⇒ 200, identity đúng máy A", async () => {
      const r = await goi(`/api/v1/machines/${fx!.mayTrongId}/detail`);
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.data.identity.id).toBe(fx!.mayTrongId);
      expect(r.body.data.identity.factoryId).toBe(fx!.facTrongId);
    });

    it("★★★ CHIỀU (−) — `/machines/<máy B>/detail` ⇒ 404 `not_found` (đo trước vá: 200 + identity máy 257 của NM18)", async () => {
      const r = await goi(`/api/v1/machines/${fx!.mayNgoaiId}/detail`);
      expect(r.status).toBe(404);
      expect(r.body.ok).toBe(false);
      expect(r.body.error.code).toBe("not_found");
      expect(JSON.stringify(r.body)).not.toContain(`${DAU}-NGOAI`);
    });

    it("đối chứng G82 — máy KHÔNG TỒN TẠI cũng 404 `not_found`: ngoài phạm vi và không tồn tại là MỘT hình dạng", async () => {
      const r = await goi(`/api/v1/machines/999999999/detail`);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe("not_found");
    });

    it("robot — của A ⇒ 200; của B ⇒ 404; MỒ CÔI ⇒ 404 (fail-closed, nối tenant chỉ qua `lineId`/`stationId`)", async () => {
      expect((await goi(`/api/v1/robots/${fx!.robotTrongId}/detail`)).status).toBe(200);
      const ngoai = await goi(`/api/v1/robots/${fx!.robotNgoaiId}/detail`);
      expect(ngoai.status).toBe(404);
      expect(JSON.stringify(ngoai.body)).not.toContain(`${DAU}-ngoai`);
      expect((await goi(`/api/v1/robots/${fx!.robotMoCoiId}/detail`)).status).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("HTTP v1 — khoá TOÀN CỤC tường minh: KHÔNG thêm mệnh đề nào (chiều dương chống vá quá tay)", () => {
    beforeAll(() => {
      principalHienTai = khoa(GLOBAL_TENANT_SCOPE);
    });
    it("thấy máy của B và robot mồ côi", async () => {
      expect((await goi(`/api/v1/machines/${fx!.mayNgoaiId}/detail`)).body.data?.identity?.factoryId).toBe(fx!.facNgoaiId);
      expect((await goi(`/api/v1/robots/${fx!.robotMoCoiId}/detail`)).status).toBe(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("HTTP v1 — khoá CHƯA KHAI phạm vi (mode null): fail-closed", () => {
    beforeAll(() => {
      principalHienTai = khoa(UNDECLARED_TENANT_SCOPE);
    });
    it("★ 404 cho cả máy của A — lời khai rỗng KHÔNG bao giờ đọc thành 'không lọc' (lớp lỗi `or()` rỗng)", async () => {
      expect((await goi(`/api/v1/machines/${fx!.mayTrongId}/detail`)).status).toBe(404);
      expect((await goi(`/api/v1/robots/${fx!.robotTrongId}/detail`)).status).toBe(404);
    });
  });

  describe("HTTP v1 — không khoá", () => {
    beforeAll(() => {
      principalHienTai = null;
    });
    it("401 — lối vào vẫn đóng trước cả hàng rào tenant", async () => {
      expect((await goi(`/api/v1/machines/${fx!.mayTrongId}/detail`)).status).toBe(401);
    });
  });
});
