/**
 * server/routers/machineApiV1CuonNg.db.test.ts
 *
 * Pha 1D Task 6 (món nợ CUỐI trước Khối B) — NGHIỆM THU THẬT trên DB thật cho đường v1.x
 * (`submitInspection`, kind:"v1" — đường MẶC ĐỊNH hôm nay vì INGEST_REJECT_LEGACY_MACHINE_ENABLED
 * tắt). Gọi ĐÚNG `machineApiRouter.createCaller(...).submitInspection(payload)` (tRPC caller thật,
 * KHÔNG mock `../db`) rồi SELECT lại — cùng khuôn `server/db/ingestV2XuyenSuot.db.test.ts` đã dùng
 * cho đường v2.0.
 *
 * ── LỖ ĐÃ ĐO (trước bản vá) ──────────────────────────────────────────────────────────────────
 * `promoteOverallToNg` (machineApiRouters.ts) chỉ bắn khi SPEC-GATE MÁY CHỦ hạ ≥1 điểm
 * (`serverDowngradeCount > 0`) — bỏ sót trường hợp CHÍNH MÁY gửi `overallResult:"OK"` kèm điểm ĐÃ
 * mang `result:"NG"` (không qua spec-gate). Đo trên `aoi_management_test` (vai avi_app) TRƯỚC bản
 * vá: 3 bo id 97438/97442/97444 khai OK với 5/5, 2/2, 1/1 điểm NG — lưu thành "OK" ⇒
 * `FINAL_YIELD_PASS_RESULTS` (shared/kpiYield.ts) tính PASS, xuất xưởng.
 *
 * ── NĂM MỆNH ĐỀ canh (task-6-report.md) ─────────────────────────────────────────────────────
 *   1. Máy khai OK, ≥1 điểm NG ⇒ lưu "NG".
 *   2. CHỐNG HỒI QUY: máy khai OK, 0 điểm NG (mọi điểm OK) ⇒ vẫn "OK".
 *   3. CHỐNG HỒI QUY: máy khai NG ⇒ vẫn "NG" (không bao giờ hạ cấp), kể cả khi MỌI điểm đo là OK.
 *   4. CHỐNG HỒI QUY: spec-gate máy chủ hạ điểm (máy khai OK, giá trị đo NGOÀI limit) ⇒ vẫn nâng
 *      "NG" như hành vi CŨ (`promoteOverallToNg` gốc, `serverDowngradeCount > 0`).
 *   5. `originalResult` (lời khai gốc của máy) giữ NGUYÊN — không bị bản vá này chạm tới.
 *
 * ── WORM và dấu chân để lại (đọc TRƯỚC khi sửa file này) ───────────────────────────────────
 * `product_inspections` bị REVOKE DELETE khỏi `avi_app` (migration 0279) — vai chạy lưới này
 * KHÔNG xoá được hàng đã ghi. File này vì vậy KHÔNG viết
 * `DELETE FROM product_inspections … .catch(() => {})` (đã đo: 32 file test khác làm đúng thế và
 * tất cả là NO-OP CÂM). Mỗi lượt chạy để lại ĐÚNG BỐN hàng `product_inspections` vĩnh viễn (bốn
 * mệnh đề 1-4 — mệnh đề 5 canh chung trong hai ca 1 và 4). Factory/workshop/line/station/machine/
 * product_models dựng ở `beforeAll` cũng để lại vĩnh viễn (khoá bởi FK RESTRICT từ bốn hàng trên).
 * `measurement_results` KHÔNG WORM — `avi_app` CÓ quyền DELETE — dọn sạch trong `afterAll`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { machineApiRouter } from "./machineApiRouters";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const RUN = `V1CN${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const API_KEY = `plain-${RUN}`;
const PT_PLAIN = `${RUN}-PT-PLAIN`; // không limit — máy tự khai OK/NG nguyên văn
const PT_GATE = `${RUN}-PT-GATE`; // lowerLimit=1 / upperLimit=10 — dùng cho mệnh đề 4

process.env.MACHINE_SHARED_KEY_ALLOWED = "true"; // đường plaintext machines.apiKey — mặc định "deny" từ mig 0334

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, machine: 0, product: 0, ptPlain: 0, ptGate: 0 };
const inspectionIds: number[] = [];

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

type KetQuaSubmit = { success: true; inspectionId: number; duplicate?: boolean };

function payload(
  serial: string,
  overallResult: "OK" | "NG" | "NTF",
  measurements: Array<{ pointCode: string; result: "OK" | "NG" | "NTF"; measuredValue?: number }>,
) {
  return {
    apiKey: API_KEY,
    serialNumber: serial,
    productModel: `${RUN}-PM`,
    overallResult,
    inspectionTime: new Date("2026-08-30T03:00:00.000Z").toISOString(),
    measurements: measurements.map((m) => ({
      pointCode: m.pointCode,
      result: m.result,
      measuredValue: m.measuredValue,
    })),
  };
}

describe.skipIf(!DB_URL)("submitInspection v1.x — cuộn verdict lưu trữ = XẤU HƠN (khai, điểm đo) (Pha 1D Task 6)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'V1CN factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'V1CN ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'V1CN line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'V1CN station') RETURNING id`);
    ids.machine = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "apiKey")
      VALUES (${ids.station}, ${"M-" + RUN}, 'V1CN machine', 'AOI', true, ${API_KEY}) RETURNING id`);
    ids.product = await one(sql`INSERT INTO product_models (code, name) VALUES (${`${RUN}-PM`}, 'V1CN product') RETURNING id`);
    ids.ptPlain = await one(sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${ids.product}, ${PT_PLAIN}, 'V1CN point plain', 'DIMENSION', 10, 20) RETURNING id`);
    // mệnh đề 4 — điểm CÓ limit để spec-gate hạ cấp được (evaluatePointResult, POINT_LIMIT_EVAL_ENABLED mặc định ON).
    ids.ptGate = await one(sql`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY", "lowerLimit", "upperLimit")
      VALUES (${ids.product}, ${PT_GATE}, 'V1CN point gate', 'DIMENSION', 30, 40, '1', '10') RETURNING id`);
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    if (inspectionIds.length > 0) {
      await sql`DELETE FROM measurement_results WHERE "inspectionId" = ANY(${inspectionIds})`;
    }
    // ⚠ product_inspections LÀ WORM (migration 0279) — CỐ Ý ĐỂ LẠI bốn hàng board (xem docblock
    // đầu file). KHÔNG viết DELETE FROM product_inspections rồi .catch(() => {}) ở đây.
    // Factory/workshop/line/station/machine/product_models bị khoá bởi FK RESTRICT từ các hàng
    // đó — cũng để lại vĩnh viễn, không dọn.
    await sql.end({ timeout: 5 });
  });

  it("cầu chì — nghiệm thu chạy bằng vai avi_app, KHÔNG phải superuser/bypass RLS", async () => {
    const [role] = await sql<{ who: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS who, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.who).toBe("avi_app");
    expect(role.rolsuper, "chạy bằng superuser ⇒ WORM không có ý nghĩa gì").toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  it("mệnh đề 1 — máy khai OK, ≥1 điểm NG (máy tự khai, KHÔNG qua spec-gate) ⇒ SELECT overallResult = 'NG'", async () => {
    const r = (await caller().submitInspection(
      payload(`${RUN}-M1`, "OK", [
        { pointCode: PT_PLAIN, result: "OK" },
        { pointCode: PT_PLAIN, result: "NG" },
      ]),
    )) as KetQuaSubmit;
    expect(r.success).toBe(true);
    inspectionIds.push(r.inspectionId);

    const [row] = await sql<{ overallResult: string; originalResult: string }[]>`
      SELECT "overallResult", "originalResult" FROM product_inspections WHERE id = ${r.inspectionId}`;
    expect(row, "không tìm thấy hàng — submitInspection không ghi tới DB thật").toBeTruthy();
    expect(row.overallResult, "LỖ đã đo: bo khai OK có điểm NG phải lưu NG, không phải OK").toBe("NG");
    // mệnh đề 5 — originalResult (lời khai gốc của máy) giữ nguyên, không bị bản vá này chạm.
    expect(row.originalResult).toBe("OK");
  });

  it("mệnh đề 2 (CHỐNG HỒI QUY) — máy khai OK, 0 điểm NG (mọi điểm OK) ⇒ vẫn SELECT overallResult = 'OK'", async () => {
    const r = (await caller().submitInspection(
      payload(`${RUN}-M2`, "OK", [
        { pointCode: PT_PLAIN, result: "OK" },
        { pointCode: PT_PLAIN, result: "OK" },
      ]),
    )) as KetQuaSubmit;
    inspectionIds.push(r.inspectionId);

    const [row] = await sql<{ overallResult: string }[]>`
      SELECT "overallResult" FROM product_inspections WHERE id = ${r.inspectionId}`;
    expect(row.overallResult, "bo sạch (0 điểm NG) KHÔNG được bị nâng cấp").toBe("OK");
  });

  it("mệnh đề 3 (CHỐNG HỒI QUY) — máy khai NG ⇒ vẫn 'NG' dù MỌI điểm đo là OK (không bao giờ hạ cấp)", async () => {
    const r = (await caller().submitInspection(
      payload(`${RUN}-M3`, "NG", [{ pointCode: PT_PLAIN, result: "OK" }]),
    )) as KetQuaSubmit;
    inspectionIds.push(r.inspectionId);

    const [row] = await sql<{ overallResult: string }[]>`
      SELECT "overallResult" FROM product_inspections WHERE id = ${r.inspectionId}`;
    expect(row.overallResult, "verdictXauHon KHÔNG được để cuộn-OK làm nhẹ lời khai NG của máy").toBe("NG");
  });

  it("mệnh đề 4 (CHỐNG HỒI QUY) — spec-gate máy chủ hạ điểm (máy khai OK, giá trị NGOÀI limit) ⇒ vẫn nâng 'NG' như hành vi CŨ", async () => {
    const r = (await caller().submitInspection(
      payload(`${RUN}-M4`, "OK", [{ pointCode: PT_GATE, result: "OK", measuredValue: 999 }]),
    )) as KetQuaSubmit;
    inspectionIds.push(r.inspectionId);

    const [row] = await sql<{ overallResult: string; originalResult: string }[]>`
      SELECT "overallResult", "originalResult" FROM product_inspections WHERE id = ${r.inspectionId}`;
    expect(row.overallResult, "hành vi CŨ (serverDowngradeCount > 0) không được bị bản vá làm hỏng").toBe("NG");
    expect(row.originalResult).toBe("OK");

    const [mr] = await sql<{ result: string; remark: string | null }[]>`
      SELECT result, remark FROM measurement_results WHERE "inspectionId" = ${r.inspectionId}`;
    expect(mr.result, "điểm phải bị spec-gate hạ xuống NG").toBe("NG");
    expect(mr.remark ?? "").toMatch(/Spec gate/);
  });

  it("dấu chân WORM — đúng BỐN hàng product_inspections để lại vĩnh viễn cho máy này", async () => {
    const [cnt] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM product_inspections WHERE "machineId" = ${ids.machine}`;
    expect(cnt.c).toBe(4);
  });
});
