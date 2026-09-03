/**
 * server/routers/thoiGianMotHeQuyChieu.db.test.ts
 *
 * Khối C Task 1 (BG-96, `.superpowers/sdd/2026-09-03-aoi-khoi-c-gioi-han/task-1-brief.md`) —
 * lưới bất biến DB THẬT: header (`product_inspections.inspectionTime`) và cây
 * (`inspection_captures.startedAt`) phải CÙNG một hệ quy chiếu (UTC thật), KHÔNG lệch nhau
 * bởi phép dịch "fake UTC" (`d.getTime() - d.getTimezoneOffset()*60000`) mà nhánh v1.x/v2.0
 * từng áp RIÊNG cho cột header (doc 51 P1 CASE #3) trong khi cấp cây luôn ghi thô
 * (`toDateOrUndefined` — `server/db/inspection.ts`).
 *
 * ── Hai mệnh đề canh ─────────────────────────────────────────────────────────────────────
 *   1. header.inspectionTime PHẢI là ĐÚNG instant máy khai (ISO khớp TỪNG KÝ TỰ) —
 *      "2026-09-03T02:00:00.000Z" (payload.completedAt), KHÔNG bị dịch múi giờ.
 *   2. header.inspectionTime − cap.startedAt PHẢI đúng 60_000ms (60s — khoảng cách máy khai
 *      giữa header.completedAt và capture.startedAt), KHÔNG 60s + offset múi giờ (25_260_000ms
 *      trên máy UTC+7) như mã fake-UTC cũ tạo ra (chỉ header bị dịch, cây luôn ghi thô).
 *
 * Payload gửi qua ĐÚNG thủ tục router thật (`machineApiRouter.createCaller(...).
 * submitInspection`), dispatch sang `submitInspectionTreeV2` theo hình dạng `surfaces`
 * (`laHinhDangCayV2`) — cùng khuôn `server/db/walCayV2PhatLai.db.test.ts`/
 * `server/db/ingestV2XuyenSuot.db.test.ts` (DB THẬT, KHÔNG mock `../db`).
 *
 * ── WORM (đọc TRƯỚC khi sửa file này) ───────────────────────────────────────────────────
 * `product_inspections` bị REVOKE DELETE khỏi `avi_app` (migration 0279) — file này KHÔNG
 * viết `DELETE FROM product_inspections … .catch(() => {})` (32 file test khác đã đo đây là
 * NO-OP CÂM — xem MEMORY). Một lượt chạy để lại ĐÚNG MỘT hàng `product_inspections` vĩnh
 * viễn (và factory/workshop/line/station/machine dựng ở `beforeAll`, khoá theo FK RESTRICT
 * từ hàng đó). Ba bảng cây (`inspection_surfaces/positions/captures`) KHÔNG WORM (`avi_app`
 * CÓ quyền DELETE, migration 0339) — dọn sạch trong `afterAll`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { machineApiRouter } from "./machineApiRouters";
import type { TrpcContext } from "../_core/context";
import { mauHopLe } from "../contracts/machineDataContractV2.test-helpers";

const DB_URL = process.env.DATABASE_URL;
const RUN = `TGQ${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
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

function caller() {
  return machineApiRouter.createCaller(ctx());
}

type KetQuaSubmit = { success: true; inspectionId: number; duplicate?: boolean };

/**
 * Payload cây v2.0 — header.completedAt = "...T02:00:00.000Z" (dùng làm `mocDo`, ưu tiên hơn
 * `startedAt` — xem `submitInspectionTreeV2`), capture.startedAt = "...T01:59:00.000Z" — ĐÚNG
 * lệch 60s máy khai giữa hai mốc (task-1-brief.md Bước 1). Cả hai mốc mang hậu tố "Z" tường
 * minh nên `new Date(...)` luôn parse ra ĐÚNG MỘT instant, bất kể múi giờ tiến trình chạy lưới.
 */
function payloadLech60s(): Record<string, unknown> {
  const p = mauHopLe();
  delete p.productModel; // tránh lượt tra getProductModelByCode không cần thiết cho lưới này
  p.apiKey = API_KEY;
  p.identity = { ...p.identity, station: `${RUN}-ST`, machine: `${RUN}-MC`, line: `${RUN}-LN` };
  p.productId = `${RUN}-PROD-1`;
  p.serialNumber = `${RUN}-SN-1`;
  p.overallResult = "OK";
  p.ntf = false;
  p.startedAt = "2026-09-03T01:59:00.000Z";
  p.completedAt = "2026-09-03T02:00:00.000Z";
  p.summary = {
    surfaces: { total: 1, pass: 1, ng: 0, ntf: 0 },
    positions: { total: 1, pass: 1, ng: 0, ntf: 0 },
    captures: { total: 1, pass: 1, ng: 0, ntf: 0 },
    components: { total: 1, pass: 1, ng: 0, ntf: 0 },
  };
  p.surfaces = [{
    name: "TOP", result: "OK", ntf: false,
    positions: [{
      positionId: "P01", positionNumber: 1, result: "OK", ntf: false,
      captures: [{
        captureId: `${RUN}-C1`, captureName: "Default", index: 0, result: "OK", ntf: false,
        startedAt: "2026-09-03T01:59:00.000Z",
        components: [{
          componentId: `${RUN}-COMP1`, componentName: "R12",
          result: "OK", ntf: false, value: "10", lowerLimit: "9", upperLimit: "11",
        }],
      }],
    }],
  }];
  return p;
}

describe.skipIf(!DB_URL)("BG-96 — header và cây CÙNG hệ quy chiếu (UTC thật, KHÔNG fake-UTC)", () => {
  let inspectionId: number;

  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'TGQ factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'TGQ ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'TGQ line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'TGQ station') RETURNING id`);
    ids.machine = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "apiKey")
      VALUES (${ids.station}, ${"M-" + RUN}, 'TGQ machine', 'AOI', true, ${API_KEY}) RETURNING id`);

    const r = (await caller().submitInspection(payloadLech60s())) as KetQuaSubmit;
    expect(r.success, `submitInspection thất bại — nguyên văn: ${JSON.stringify(r)}`).toBe(true);
    inspectionId = r.inspectionId;
  });

  afterAll(async () => {
    if (!sql) return;
    if (inspectionId) {
      await sql`DELETE FROM inspection_surfaces WHERE "inspectionId" = ${inspectionId}`;
    }
    // ⚠ product_inspections LÀ WORM (migration 0279) — CỐ Ý ĐỂ LẠI hàng board (xem docblock
    // đầu file). KHÔNG viết DELETE FROM product_inspections rồi .catch(() => {}) ở đây.
    await sql.end({ timeout: 5 });
  });

  // ⚠ Đọc bằng `to_char(...)`, KHÔNG để driver dựng `Date` từ "timestamp without time
  // zone" — thư viện `postgres` (driver drizzle DÙNG CHUNG, `drizzle-orm/postgres-js`)
  // coi chuỗi thô KHÔNG offset ("2026-09-03 02:00:00") là GIỜ ĐỊA PHƯƠNG của tiến trình
  // rồi quy đổi UTC (`new Date("2026-09-03 02:00:00")` trên tiến trình UTC+7 ⇒
  // 2026-09-02T19:00:00.000Z, ĐO ĐƯỢC trực tiếp — xem task-1-report.md). Đây là lớp lỗi
  // Ở PHÍA ĐỌC, ĐỘC LẬP với BG-96 (đang canh Ở ĐÂY là CÁI GHI xuống cột, không phải cái
  // đọc nó lên — ngoài phạm vi Task 1, xem concerns báo cáo). `to_char` trả đúng CHỮ SỐ
  // LỊCH đã lưu dưới dạng chuỗi, không đi qua bất kỳ Date-parser nào của client — phép đo
  // TZ-độc lập cho đúng cái Task 1 chịu trách nhiệm.
  const ISO_FMT = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

  it("header (inspectionTime) là ĐÚNG instant máy khai — ISO khớp từng ký tự, KHÔNG bị dịch múi giờ", async () => {
    const [header] = await sql<{ iso: string }[]>`
      SELECT to_char("inspectionTime", ${ISO_FMT}) AS iso
      FROM product_inspections WHERE id = ${inspectionId}`;
    expect(header, "không tìm thấy header — submitInspection không ghi tới DB thật").toBeTruthy();
    expect(header.iso).toBe("2026-09-03T02:00:00.000Z");
  });

  it("header − cây lệch ĐÚNG 60s như máy khai — KHÔNG lệch 60s + offset múi giờ (BG-96)", async () => {
    const [header] = await sql<{ iso: string }[]>`
      SELECT to_char("inspectionTime", ${ISO_FMT}) AS iso
      FROM product_inspections WHERE id = ${inspectionId}`;
    const [cap] = await sql<{ iso: string }[]>`
      SELECT to_char("startedAt", ${ISO_FMT}) AS iso
      FROM inspection_captures WHERE "inspectionId" = ${inspectionId} LIMIT 1`;
    expect(cap, "không tìm thấy hàng cây — cây không được ghi").toBeTruthy();
    const diffMs = new Date(header.iso).getTime() - new Date(cap.iso).getTime();
    expect(diffMs, `nguyên văn: header=${header.iso} cap=${cap.iso}`).toBe(60_000);
  });
});
