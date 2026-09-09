/**
 * ════════════════════════════════════════════════════════════════════════════
 * `naiveTimestampQuaExecute.db.test.ts` — ĐỢT 35, G104: `db.execute` THÔ ĐỌC `timestamp` NAIVE LỆCH THEO GIỜ MÁY
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ĐO ĐƯỢC (Đợt 34 đối chứng máy sống, Đợt 35 `.qa-dot35/truoc/e9-*`): chèn một hàng `machine_status_logs`
 * `timestamp = now()` cho máy 14 rồi hỏi `twinCanh.anhLichSu` ⇒ `capNhatLuc` = **13:00Z** trong khi DB nói
 * **20:00Z** — tuổi hiện **420 phút** cho một hàng vừa ghi. Robot `ROB-SIM-01` (telemetry sống) cũng khai 420′.
 *
 * GỐC: cột `timestamp` (không múi giờ) lưu UTC (DB `TimeZone=Etc/UTC`). Drizzle **typed** (`db.select`) đọc là
 * UTC. Nhưng `db.execute(sql\`…\`)` thô đi qua postgres.js: chuỗi naive `"2026-09-10 20:00:08"` được
 * `new Date(...)` hiểu theo **giờ máy Node** (+07 ⇒ lệch −7 h). Hai đường đọc CÙNG cột ra HAI giờ — đúng lớp
 * "bốn hợp đồng trạng thái" của Đợt 34, chỉ khác ở tầng thấp hơn.
 *
 * LƯỚI NÀY ĐO GÌ — trên CÙNG MỘT HÀNG, ba cách đọc:
 *   (1) typed  `db.select()`                              ⇒ mốc chuẩn (UTC)
 *   (2) thô    `SELECT "timestamp" AS ts`                  ⇒ lệch = `getTimezoneOffset()·60 000` ms — ĐỐI CHỨNG:
 *              trên máy không-UTC lệch ≠ 0 (ở đây −420′), tức lưới BIẾT KÊU khi bỏ `AT TIME ZONE`
 *   (3) thô    `SELECT "timestamp" AT TIME ZONE 'UTC' AS ts` ⇒ lệch = 0 BẤT KỂ giờ máy — bản vá
 *   (4) `traAnhLichSu` THẬT (twinCanh.ts) ⇒ `capNhatLuc` cách bây giờ vài giây, không 7 h
 *   (5) `traAnToanRobot` THẬT ⇒ `capNhatLuc` của telemetry vừa ghi cách bây giờ vài giây
 *
 * ⚠ Chạy trên DB TEST (vitest.setup ép `DATABASE_URL` → `<db>_test`, một bản clone). Hàng tạm do file này tạo,
 *   xoá trong `afterAll` (đếm trước = sau). Máy/robot lấy từ chuỗi phân cấp CÓ THẬT trong DB test
 *   (workshop → line → station → machine); không có chuỗi ⇒ ĐỎ, không skip (đó là môi trường hỏng, không phải
 *   "không có gì để đo").
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";

import { getDb } from "./connection";
import { machineStatusLogs, robotTelemetry } from "../../drizzle/schema";
import { traAnhLichSu, traAnToanRobot } from "./twinCanh";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const hang = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;

let db: Db;
let factoryId = 0;
let machineId = 0;
let robotId: number | null = null;
let mslId = 0;
let teleId: number | null = null;
/** Mốc ghi — làm tròn tới giây để so sánh không dính mili-giây của `now()` phía DB. */
const T0 = new Date(Math.floor(Date.now() / 1000) * 1000);
let mslTruoc = 0;
let teleTruoc = 0;

beforeAll(async () => {
  const d = await getDb();
  expect(d, "DB test phải kết nối được").toBeTruthy();
  db = d as Db;
  // Một chuỗi phân cấp CÓ THẬT: máy đang hoạt động treo vào workshop có factoryId.
  const chuoi = hang(
    await db.execute(sql`
      SELECT m.id AS machine_id, w."factoryId" AS factory_id, l.id AS line_id
      FROM machines m
      JOIN stations s ON s.id = m."stationId"
      JOIN production_lines l ON l.id = s."lineId"
      JOIN workshops w ON w.id = l."workshopId"
      WHERE m."isActive" = true
      ORDER BY m.id
      LIMIT 1
    `),
  )[0];
  expect(chuoi, "DB test phải có ít nhất một chuỗi workshop→line→station→machine").toBeTruthy();
  machineId = Number(chuoi.machine_id);
  factoryId = Number(chuoi.factory_id);
  const lineId = Number(chuoi.line_id);
  const rb = hang(await db.execute(sql`SELECT id FROM robots WHERE "lineId" = ${lineId} AND "isEnabled" = true ORDER BY id LIMIT 1`))[0];
  robotId = rb ? Number(rb.id) : null;

  mslTruoc = Number(hang(await db.execute(sql`SELECT count(*)::int AS n FROM machine_status_logs`))[0].n);
  const [msl] = await db
    .insert(machineStatusLogs)
    .values({ machineId, status: "online", timestamp: T0 })
    .returning({ id: machineStatusLogs.id });
  mslId = msl.id;
  if (robotId !== null) {
    teleTruoc = Number(hang(await db.execute(sql`SELECT count(*)::int AS n FROM robot_telemetry`))[0].n);
    const [tele] = await db
      .insert(robotTelemetry)
      .values({ robotId, estop: false, timestamp: T0 })
      .returning({ id: robotTelemetry.id });
    teleId = tele.id;
  }
});

afterAll(async () => {
  if (!db) return;
  if (mslId) await db.delete(machineStatusLogs).where(eq(machineStatusLogs.id, mslId));
  if (teleId !== null) await db.delete(robotTelemetry).where(eq(robotTelemetry.id, teleId));
  const mslSau = Number(hang(await db.execute(sql`SELECT count(*)::int AS n FROM machine_status_logs`))[0].n);
  expect(mslSau, "đếm machine_status_logs trước = sau").toBe(mslTruoc);
  if (teleId !== null) {
    const teleSau = Number(hang(await db.execute(sql`SELECT count(*)::int AS n FROM robot_telemetry`))[0].n);
    expect(teleSau, "đếm robot_telemetry trước = sau").toBe(teleTruoc);
  }
});

describe("★★★ G104 — cùng một hàng, ba cách đọc `timestamp` naive", () => {
  it("(1) typed `db.select()` đọc đúng mốc đã ghi (UTC)", async () => {
    const [r] = await db.select({ ts: machineStatusLogs.timestamp }).from(machineStatusLogs).where(eq(machineStatusLogs.id, mslId));
    expect(r.ts.getTime()).toBe(T0.getTime());
  });

  it("★★★ (2) ĐỐI CHỨNG — thô KHÔNG `AT TIME ZONE` lệch đúng `getTimezoneOffset()` của máy Node (lưới BIẾT KÊU)", async () => {
    const r = hang(await db.execute(sql`SELECT "timestamp" AS ts FROM machine_status_logs WHERE id = ${mslId}`))[0];
    const tho = new Date(r.ts as string | Date).getTime();
    const lechMs = tho - T0.getTime();
    const offsetMayMs = new Date().getTimezoneOffset() * 60_000; // +07 ⇒ −420′ ⇒ −25 200 000
    expect(lechMs).toBe(offsetMayMs);
    // Trên máy này (+07) phải lệch THẬT — nếu chạy trên máy UTC, ca này chỉ chứng minh "không lệch ở UTC".
    if (offsetMayMs !== 0) expect(lechMs).not.toBe(0);
  });

  it("★★★ (3) thô CÓ `AT TIME ZONE 'UTC'` ⇒ lệch = 0, bất kể giờ máy", async () => {
    const r = hang(await db.execute(sql`SELECT "timestamp" AT TIME ZONE 'UTC' AS ts FROM machine_status_logs WHERE id = ${mslId}`))[0];
    expect(new Date(r.ts as string | Date).getTime()).toBe(T0.getTime());
  });
});

describe("★★★ G104 — hai câu rời SQL của twinCanh.ts đi qua bản vá", () => {
  it("(4) `traAnhLichSu(factoryId, T0 + 1 s)` ⇒ `capNhatLuc` của máy = T0 (tuổi GIÂY, không 7 h)", async () => {
    const may = await traAnhLichSu(factoryId, T0.getTime() + 1000);
    const m = may.find((x) => x.machineId === machineId);
    expect(m, `máy ${machineId} phải có trong ảnh lịch sử của nhà máy ${factoryId}`).toBeTruthy();
    expect(m!.capNhatLuc).toBe(T0.getTime());
    expect(Math.abs(Date.now() - (m!.capNhatLuc ?? 0))).toBeLessThan(60_000);
  });

  it("(5) `traAnToanRobot(factoryId)` ⇒ `capNhatLuc` của robot vừa nhận telemetry = T0", async () => {
    if (robotId === null) {
      // Không có robot trên chuyền này trong DB test — nói ra, không giả vờ đo.
      console.warn(`[G104] DB test: chuyền của máy ${machineId} không có robot ⇒ ca (5) không đo được ở đây`);
      return;
    }
    const robot = await traAnToanRobot(factoryId);
    const r = robot.find((x) => x.id === robotId);
    expect(r, `robot ${robotId} phải có trong nhà máy ${factoryId}`).toBeTruthy();
    expect(r!.capNhatLuc).toBe(T0.getTime());
  });
});

describe("★ G104 — hai câu rời SQL ngoài twin (brief bỏ sót) mang `AT TIME ZONE 'UTC'` (hạng B, chưa có dữ liệu để đo)", () => {
  it("energy.ts `peakAt` và aiRcaCopilot.ts `createdAt AS at`", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const energy = readFileSync(resolve(__dirname, "energy.ts"), "utf8");
    const rca = readFileSync(resolve(__dirname, "../services/aiRcaCopilot.ts"), "utf8");
    expect(energy).toMatch(/"timestamp" AT TIME ZONE 'UTC' AS "peakAt"/);
    expect(rca).toMatch(/mc\."createdAt" AT TIME ZONE 'UTC' AS at/);
  });
});
