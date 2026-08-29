/**
 * server/db/ingestV2KhuTrung.db.test.ts
 *
 * Pha 1C Task 2 (BG-23 ⛔, §QĐ-1C-B trong
 * `docs/superpowers/plans/2026-08-29-aoi-pha1c-va-lo-du-lieu.md`) — lưới DB THẬT
 * (KHÔNG mock `../db`) cho khoá khử trùng v2.0 (`dungKhoaKhuTrungV2`,
 * `server/routers/machineApiRouters.ts`), đi qua ĐÚNG mutation `submitInspection`
 * (tRPC caller), KHÔNG gọi thẳng hàm nội bộ `submitInspectionTreeV2` (không export).
 *
 * ── Gốc rễ đóng ở đây (xem task-2-brief.md) ─────────────────────────────────────────
 * `uq_inspections_machine_serial_time` (migration 0272) là chỉ mục RIÊNG PHẦN
 * (`WHERE "serialNumber" <> ''`). Hợp đồng v2.0 CHO PHÉP serial rỗng ("rỗng nếu máy
 * chưa gửi" — `machineDataContractV2.ts`), và trước bản vá này đường v2.0 KHÔNG đặt
 * `idempotencyKey` — cả hai cơ chế khử trùng cùng vắng mặt cho serial rỗng. Đo được
 * (transaction+rollback, vai `avi_app`): 3 lượt gửi giống hệt nhau, serial rỗng → 3
 * hàng (đúng ra phải 1).
 *
 * BA mệnh đề canh (task-2-brief.md):
 *   1. Cùng payload serial RỖNG gửi HAI lượt ⇒ CHỈ MỘT bo — mệnh đề TRUNG TÂM.
 *   2. Hai payload KHÁC NHAU (khác `productId`/`startedAt` — phần khoá) cùng serial
 *      rỗng ⇒ HAI bo — chống siết quá tay (khử trùng không được gộp nhầm hai board
 *      khác nhau vì cùng mang serial rỗng).
 *   3. Payload serial CÓ giá trị vẫn khử trùng như trước ⇒ chống hồi quy (0272 +
 *      idempotencyKey mới chồng lên nhau, vô hại).
 *
 * ── WORM — đọc TRƯỚC khi sửa file này ───────────────────────────────────────────────
 * `product_inspections` bị REVOKE DELETE khỏi `avi_app` (migration 0279) — vai chạy
 * lưới này KHÔNG xoá được hàng đã ghi. File này vì vậy KHÔNG viết
 * `DELETE FROM product_inspections … .catch(() => {})` (đã đo 32 file test khác làm
 * đúng thế và tất cả là NO-OP CÂM — xem MEMORY/ingestCayKetQua.db.test.ts). Mỗi board
 * dựng ở đây gắn `machineProductIndex` DUY NHẤT làm khoá đếm (KHÔNG dùng
 * `serialNumber` — mệnh đề canh chính là serial RỖNG, nhiều board sẽ cùng rỗng trong
 * một lượt chạy file này). Mọi hàng `product_inspections` file này tạo ra bị để lại
 * VĨNH VIỄN — đúng 4 hàng (mệnh đề 1: 1, mệnh đề 2: 2, mệnh đề 3: 1). Các bảng phụ trợ
 * (factory/workshop/line/station/machine) KHÔNG WORM nhưng bị khoá bởi FK RESTRICT từ
 * `product_inspections` nên CŨNG để lại vĩnh viễn — không dọn trong `afterAll`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";
import { mauHopLe } from "../contracts/machineDataContractV2.test-helpers";
import { dungKhoaKhuTrungV2 } from "../routers/machineApiRouters";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const RUN = `IVK${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const API_KEY = `plain-${RUN}`;

process.env.MACHINE_SHARED_KEY_ALLOWED = "true"; // đường plaintext machines.apiKey — mặc định "deny" từ mig 0334

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, machine: 0 };

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}

async function caller() {
  const { machineApiRouter } = await import("../routers/machineApiRouters");
  return machineApiRouter.createCaller(ctx());
}

/** Đếm hàng `product_inspections` gắn ĐÚNG `machineProductIndex` — khoá đếm duy nhất
 * của file này (KHÔNG đếm theo `serialNumber`: nhiều board trong file đều mang serial
 * RỖNG, đúng cái đang bị canh). */
async function demTheoIndex(idx: number): Promise<number> {
  const r = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM product_inspections
    WHERE "machineId" = ${ids.machine} AND "machineProductIndex" = ${idx}`;
  return r[0].c;
}

/** Payload v2.0 hợp lệ, RIÊNG cho một ca — `idx` gắn vào `machineProductIndex` để đếm,
 * `productId`/`startedAt` mặc định DUY NHẤT theo `idx` (một phần của khoá khử trùng —
 * hai board "khác nhau" phải khác Ở ĐÂY, không phải ở machineProductIndex). */
function payloadRong(idx: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  const p = mauHopLe();
  delete p.productModel; // tránh lượt tra `getProductModelByCode` không cần thiết cho lưới này
  p.apiKey = API_KEY;
  p.serialNumber = ""; // ← mệnh đề trung tâm: RỖNG có chủ đích, KHÔNG phải thiếu sót
  p.machineProductIndex = idx;
  p.identity = { ...p.identity, station: `${RUN}-ST`, machine: `${RUN}-MC`, line: `${RUN}-LN` };
  p.productId = `${RUN}-PROD-${idx}`;
  p.startedAt = `2026-08-29T${String((idx % 20) + 1).padStart(2, "0")}:00:00.000`;
  p.completedAt = `2026-08-29T${String((idx % 20) + 1).padStart(2, "0")}:00:05.000`;
  return { ...p, ...over };
}

describe.skipIf(!DB_URL)("submitInspection v2.0 — khử trùng serial RỖNG bằng idempotencyKey (Pha 1C Task 2, BG-23)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'IVK factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'IVK ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'IVK line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'IVK station') RETURNING id`);
    ids.machine = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "apiKey")
      VALUES (${ids.station}, ${"M-" + RUN}, 'IVK machine', 'AOI', true, ${API_KEY}) RETURNING id`);
  });

  // Không có `afterAll` dọn dẹp có chủ đích — xem docblock §WORM ở đầu file: mọi hàng
  // `product_inspections` do file này tạo ra KHÔNG xoá được và bị để lại vĩnh viễn;
  // factory/workshop/line/station/machine bị khoá theo (FK RESTRICT), cũng để lại.

  it("cầu chì — nghiệm thu chạy bằng vai avi_app, KHÔNG phải superuser/bypass RLS", async () => {
    const [role] = await sql<{ who: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS who, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.who).toBe("avi_app");
    expect(role.rolsuper, "chạy bằng superuser ⇒ WORM không có ý nghĩa gì").toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  // ── Đối chứng thuần (không DB) — SOH làm dấu phân cách chặn đụng độ ranh giới ──────
  it("dungKhoaKhuTrungV2 — đụng độ ranh giới trường KHÔNG gộp hai identity khác nhau thành một khoá", () => {
    const a = { ...mauHopLe(), identity: { station: "AB", machine: "C", line: "L", plant: "P", country: "VN", solutionName: "S", appVersion: "1" }, productId: "X" };
    const b = { ...mauHopLe(), identity: { station: "A", machine: "BC", line: "L", plant: "P", country: "VN", solutionName: "S", appVersion: "1" }, productId: "X" };
    expect(dungKhoaKhuTrungV2(a as never)).not.toBe(dungKhoaKhuTrungV2(b as never));
  });

  it("dungKhoaKhuTrungV2 — CÙNG payload (deep clone) → CÙNG khoá (tất định, không random/Date.now)", () => {
    const p = payloadRong(999999);
    const k1 = dungKhoaKhuTrungV2(structuredClone(p) as never);
    const k2 = dungKhoaKhuTrungV2(structuredClone(p) as never);
    expect(k1).toBe(k2);
    expect(k1.length).toBeGreaterThanOrEqual(8); // ràng buộc .min(8) của cột idempotencyKey
    expect(k1.length).toBeLessThanOrEqual(200); // ràng buộc .max(200)
  });

  // ══ Mệnh đề 1 (TRUNG TÂM) ═══════════════════════════════════════════════════════════
  it("★★★ mệnh đề 1 — CÙNG payload serial RỖNG gửi HAI lượt ⇒ CHỈ MỘT bo", async () => {
    const IDX = 100001;
    const payload = payloadRong(IDX);

    expect(await demTheoIndex(IDX)).toBe(0); // TRƯỚC: 0 hàng

    const c = await caller();
    const r1 = await c.submitInspection(structuredClone(payload));
    expect((r1 as { success: true }).success).toBe(true);
    expect((r1 as { duplicate?: boolean }).duplicate).toBe(false);
    expect(await demTheoIndex(IDX)).toBe(1); // SAU LƯỢT 1: 1 hàng

    // Lượt 2 — CÙNG payload y hệt (mô phỏng retry mạng/ACK timeout của máy).
    const r2 = await c.submitInspection(structuredClone(payload));
    expect((r2 as { success: true }).success).toBe(true);
    expect((r2 as { duplicate?: boolean }).duplicate, "lượt 2 phải được nhận diện là TRÙNG").toBe(true);
    expect((r2 as { inspectionId: number }).inspectionId).toBe((r1 as { inspectionId: number }).inspectionId);

    expect(await demTheoIndex(IDX), "SAU LƯỢT 2 — số hàng KHÔNG được tăng").toBe(1); // SAU LƯỢT 2: VẪN 1 hàng
  });

  // ══ Mệnh đề 2 (chống siết quá tay) ══════════════════════════════════════════════════
  it("★★ mệnh đề 2 — HAI payload KHÁC NHAU (productId/startedAt khác) cùng serial RỖNG ⇒ HAI bo", async () => {
    const IDX_A = 100002;
    const IDX_B = 100003;
    const payloadA = payloadRong(IDX_A);
    const payloadB = payloadRong(IDX_B); // productId + startedAt/completedAt khác A — khoá PHẢI khác

    expect(await demTheoIndex(IDX_A)).toBe(0);
    expect(await demTheoIndex(IDX_B)).toBe(0);

    const c = await caller();
    const rA = await c.submitInspection(payloadA);
    const rB = await c.submitInspection(payloadB);

    expect((rA as { duplicate?: boolean }).duplicate).toBe(false);
    expect((rB as { duplicate?: boolean }).duplicate, "hai board KHÁC NHAU không được gộp nhầm thành trùng").toBe(false);
    expect((rA as { inspectionId: number }).inspectionId).not.toBe((rB as { inspectionId: number }).inspectionId);

    expect(await demTheoIndex(IDX_A)).toBe(1);
    expect(await demTheoIndex(IDX_B)).toBe(1);
  });

  // ══ Mệnh đề 3 (chống hồi quy) ═══════════════════════════════════════════════════════
  it("★ mệnh đề 3 — payload serial CÓ giá trị vẫn khử trùng như trước (0272 + idempotencyKey chồng nhau, vô hại)", async () => {
    const IDX = 100004;
    const payload = payloadRong(IDX, { serialNumber: `${RUN}-SN3` });

    expect(await demTheoIndex(IDX)).toBe(0);

    const c = await caller();
    const r1 = await c.submitInspection(structuredClone(payload));
    expect((r1 as { duplicate?: boolean }).duplicate).toBe(false);
    expect(await demTheoIndex(IDX)).toBe(1);

    const r2 = await c.submitInspection(structuredClone(payload));
    expect((r2 as { duplicate?: boolean }).duplicate).toBe(true);
    expect((r2 as { inspectionId: number }).inspectionId).toBe((r1 as { inspectionId: number }).inspectionId);
    expect(await demTheoIndex(IDX), "serial CÓ giá trị: hành vi khử trùng KHÔNG được hồi quy").toBe(1);
  });
});
