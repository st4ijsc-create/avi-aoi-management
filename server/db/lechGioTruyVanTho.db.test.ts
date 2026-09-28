/**
 * doc 81 Đợt 1C Task 6 — "7 truy vấn −7 h" (bộ nhớ dự án `postgresjs-timestamp-naive-lech-7h`) đo trên
 * DB `_test` THẬT.
 *
 * ĐO LẠI TRƯỚC KHI VÁ (2026-09-28): hai câu `twinCanh.ts` (1333/1468 cũ) ĐÃ vá ở Đợt 35 (G104, nay
 * dòng 1660/1678, cả hai `AT TIME ZONE 'UTC'`). Năm câu còn lại — `db/machine.ts` (uptime 24 h của
 * `trangThaiTapMay`), `oeeService.ts` ×3 (`getAllMachinesOEELive`, `getLineOEE`,
 * `getLineTaktUtilization`), `warRoomService.ts` (`computeShiftCompare`) — đều KHÔNG trả `ts` về JS:
 * cơ chế "postgres.js đọc naive theo giờ máy" không chạm tới chúng. Lỗi THẬT của chúng là phép trừ
 * trong SQL `COALESCE(next_ts, NOW()) - ts`: `NOW()` là `timestamptz`, cột là `timestamp` naive ⇒
 * Postgres ép naive → timestamptz theo `TimeZone` CỦA PHIÊN. DB dev đặt `Etc/UTC` nên đúng tình cờ; một
 * Postgres cài theo múi giờ hệ điều hành (initdb chọn `Asia/Ho_Chi_Minh`/`Asia/Bangkok`) ⇒ đoạn mở
 * cuối cùng dài thêm 7 h. Ba câu cửa sổ đóng (`LEAST(COALESCE(next_ts, $to), $to) - ts`) trừ naive
 * với naive ⇒ không phụ thuộc phiên — vá cùng mẫu để đồng nhất, test ở đây canh chúng không đổi số.
 *
 * ORACLE ĐỘC LẬP: các mốc trạng thái do test CHÈN (online lúc t−2 h, offline lúc t−1 h) ⇒ số giây
 * online/offline tính tay. Chạy mỗi hàm dưới HAI phiên thật: `TimeZone=UTC` và
 * `TimeZone=Asia/Ho_Chi_Minh` (kết nối postgres riêng, `connection.TimeZone`). Kết quả phải KHỚP oracle
 * ở cả hai phiên.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const DB_URL = process.env.DATABASE_URL;
const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./connection")>();
  return {
    ...actual,
    getDb: async () => h.db,
    getReadDb: async () => h.db,
    getJobsDb: async () => h.db,
  };
});

import { trangThaiTapMay } from "./machine";
import { getAllMachinesOEELive, getLineOEE, getLineTaktUtilization } from "../services/oeeService";
import { getWarRoomBriefing } from "../services/warRoomService";

const RUN = `T6LG${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const H = 3_600_000;
let sql: ReturnType<typeof postgres>;
const phien: Record<"UTC" | "VN", ReturnType<typeof postgres>> = {} as never;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, machine: 0, shift: 0 };
/** Mốc neo: mọi dòng trạng thái đặt tương đối mốc này (instant tuyệt đối). */
let T0 = 0;
let nuaDemCucBo = 0;

/**
 * Chèn một dòng trạng thái tại INSTANT `at` — ghi giờ tường UTC vào cột naive (đúng như drizzle typed ghi).
 * ⚠ Truyền `Date`, KHÔNG truyền chuỗi naive: tham số kiểu `timestamp` được postgres.js chạy qua
 * `new Date(x).toISOString()`, nên một chuỗi "yyyy-mm-dd hh:mm:ss" bị đọc theo TZ của TIẾN TRÌNH (+07)
 * và lệch −7 h — chính lớp lỗi file này canh (lượt chạy DB đầu tiên 2026-09-28 đỏ vì đúng lỗi này
 * trong THIẾT BỊ ĐO, không phải trong mã sản phẩm).
 */
async function chenTrangThai(at: number, status: "online" | "offline"): Promise<void> {
  await sql`INSERT INTO machine_status_logs ("machineId", status, "timestamp") VALUES (${ids.machine}, ${status}, ${new Date(at)})`;
}

async function voiPhien<T>(p: "UTC" | "VN", fn: () => Promise<T>): Promise<T> {
  h.db = drizzle(phien[p]);
  return fn();
}

describe.skipIf(!DB_URL)("Task 6 — năm truy vấn thô trên machine_status_logs: đúng oracle ở MỌI TimeZone phiên (DB _test thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, onnotice: () => {} });
    phien.UTC = postgres(DB_URL!, { max: 2, onnotice: () => {}, connection: { TimeZone: "UTC" } });
    phien.VN = postgres(DB_URL!, { max: 2, onnotice: () => {}, connection: { TimeZone: "Asia/Ho_Chi_Minh" } });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'T6 factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'T6 ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'T6 line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'T6 station') RETURNING id`);
    ids.machine = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
      VALUES (${ids.station}, ${"M-" + RUN}, 'T6 machine', 'AOI', true) RETURNING id`);
    T0 = Date.now();
    await chenTrangThai(T0 - 2 * H, "online");
    await chenTrangThai(T0 - 1 * H, "offline");

    // warRoom — ca 00:00–23:59 GIỜ TIẾN TRÌNH của riêng nhà máy thử; hai mốc nằm TRONG ca hôm nay.
    const nd = new Date(T0);
    nd.setHours(0, 0, 0, 0);
    nuaDemCucBo = nd.getTime();
    ids.shift = await one(sql`
      INSERT INTO shift_configs ("factoryId", name, code, "startHour", "startMinute", "endHour", "endMinute", "isActive")
      VALUES (${ids.factory}, ${"CA-" + RUN}, ${"C" + RUN.slice(-8)}, 0, 0, 23, 59, true) RETURNING id`);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM machine_status_logs WHERE "machineId" = ${ids.machine}`;
    await sql`DELETE FROM fact_inspection_hourly WHERE "machineId" = ${ids.machine}`;
    await sql`DELETE FROM oee_metrics WHERE "machineId" = ${ids.machine}`;
    await sql`DELETE FROM shift_configs WHERE id = ${ids.shift}`;
    await sql`DELETE FROM machines WHERE id = ${ids.machine}`;
    await sql`DELETE FROM stations WHERE id = ${ids.station}`;
    await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
    await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
    await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
    await sql.end();
    await phien.UTC.end();
    await phien.VN.end();
  });

  it("cầu chì: hai phiên THẬT SỰ khác TimeZone (không thì phép so dưới đây vô nghĩa)", async () => {
    const [u] = await phien.UTC`SELECT current_setting('TimeZone') AS tz`;
    const [v] = await phien.VN`SELECT current_setting('TimeZone') AS tz`;
    expect(u.tz).toBe("UTC");
    expect(v.tz).toBe("Asia/Ho_Chi_Minh");
  });

  for (const p of ["UTC", "VN"] as const) {
    it(`★ db/machine.ts trangThaiTapMay — uptime 24 h: online 3600 s, offline ≈ 3600 s (phiên ${p})`, async () => {
      const r = await voiPhien(p, () => trangThaiTapMay([ids.machine]));
      const u = r.uptimeByMachine.get(ids.machine)!;
      const troi = (Date.now() - T0) / 1000;
      expect(u.online).toBeCloseTo(3600, 0);
      expect(u.offline).toBeGreaterThanOrEqual(3600 - 1);
      expect(u.offline).toBeLessThanOrEqual(3600 + troi + 1);
    });

    it(`★ oeeService getAllMachinesOEELive (cửa sổ 3 h): online 3600 s, offline ≈ 3600 s (phiên ${p})`, async () => {
      const rows = await voiPhien(p, () => getAllMachinesOEELive({ windowHours: 3 }));
      const m = rows.find((x) => x.machineId === ids.machine)!;
      const troi = (Date.now() - T0) / 1000;
      expect(m.details.onlineSeconds).toBe(3600);
      expect(m.details.offlineSeconds).toBeGreaterThanOrEqual(3600 - 1);
      expect(m.details.offlineSeconds).toBeLessThanOrEqual(3600 + troi + 1);
    });

    it(`oeeService getLineOEE [t−3h, t−10m]: online 3600 s, offline 3000 s ĐÚNG (phiên ${p})`, async () => {
      const rows = await voiPhien(p, () => getLineOEE({ lineId: ids.line, from: new Date(T0 - 3 * H), to: new Date(T0 - 600_000) }));
      const l = rows.find((x) => x.lineId === ids.line)!;
      expect(l.details.onlineSeconds).toBe(3600);
      expect(l.details.offlineSeconds).toBe(3000);
    });

    it(`oeeService getLineTaktUtilization [t−3h, t−10m]: timeUtilization = 3600/6600 (phiên ${p})`, async () => {
      const rows = await voiPhien(p, () => getLineTaktUtilization({ lineId: ids.line, from: new Date(T0 - 3 * H), to: new Date(T0 - 600_000) }));
      const l = rows.find((x) => x.lineId === ids.line)!;
      expect(l.timeUtilizationPct).toBeCloseTo((3600 / 6600) * 100, 1);
    });
  }

  it("warRoomService computeShiftCompare (qua getWarRoomBriefing): availability của ca = oracle ở CẢ HAI phiên", async () => {
    // Hai mốc riêng trong ca HÔM NAY (giờ tiến trình): online tại nửa đêm+¼E, offline tại nửa đêm+½E.
    const E = Date.now() - nuaDemCucBo;
    const tOn = nuaDemCucBo + Math.floor(E / 4);
    const tOff = nuaDemCucBo + Math.floor(E / 2);
    await sql`DELETE FROM machine_status_logs WHERE "machineId" = ${ids.machine}`;
    await chenTrangThai(tOn, "online");
    await chenTrangThai(tOff, "offline");
    // P = 1 (ideal·total ≫ online), Q = 1 ⇒ oee = A × 100, A = online/(online+offline).
    const bucket = new Date(nuaDemCucBo); // Date, không chuỗi naive — xem `chenTrangThai`
    const shiftCode = "C" + RUN.slice(-8);
    await sql`INSERT INTO fact_inspection_hourly ("bucketHour", "factoryId", "machineId", "shiftCode", "totalCount", "okCount")
              VALUES (${bucket}, ${ids.factory}, ${ids.machine}, ${shiftCode}, 1, 1)`;
    await sql`INSERT INTO oee_metrics ("machineId", "machineCode", "timestamp", availability, performance, quality, oee,
                "plannedTime", "runTime", "idealCycleTime", "totalCount", "goodCount", "rejectCount")
              VALUES (${ids.machine}, ${"M-" + RUN}, now() AT TIME ZONE 'UTC', 0, 0, 0, 0, 0, 0, 100000000, 0, 0, 0)`;
    for (const p of ["UTC", "VN"] as const) {
      const truoc = Date.now();
      const b = await voiPhien(p, () => getWarRoomBriefing({ factoryId: ids.factory }));
      const sau = Date.now();
      const ca = b.shiftCompare.find((x) => x.shiftLabel === "CA-" + RUN)!;
      expect(ca, `phiên ${p}: không thấy ca thử`).toBeTruthy();
      const on = tOff - tOn;
      const aThap = on / (on + (sau - tOff)); // offline kéo tới `now` của hàm ∈ [truoc, sau]
      const aCao = on / (on + (truoc - tOff));
      expect(ca.oee!, `phiên ${p}`).toBeGreaterThanOrEqual(Math.floor(aThap * 10000) / 100 - 0.01);
      expect(ca.oee!, `phiên ${p}`).toBeLessThanOrEqual(Math.ceil(aCao * 10000) / 100 + 0.01);
    }
  });
});
