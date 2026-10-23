/**
 * SCADA R0 Task 9 (D2) — cột `interlock_rules."khiThieuDuLieu"` (migration 0430) trên DB test thật.
 * Áp trước: `node scripts/apply-migration-0430.mjs --test-only`.
 *
 * Số tổng hợp (machineId/adapterId) — `ot_telemetry.machineId` và `interlock_rules.targetMachineId/targetAdapterId` không có FK.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { evaluateInterlockGate } from "./interlockGate";
import { datThongTinAdapter, xoaAdapter } from "../scada/boDemHienTai";

const DB_URL = process.env.DATABASE_URL;
const MACHINE_ID = 990_430_001;
const ADAPTER_ID = 990_430_002;
const DAU = `T9-${Date.now()}`;

let sql: ReturnType<typeof postgres>;
const ruleIds: number[] = [];

async function chenLuat(
  extra: string | null,
  o: { machine?: number | null; target?: number; tag?: string; consecutive?: number | null; windowSize?: number } = {},
): Promise<number> {
  const cols = extra ? `, "khiThieuDuLieu"` : "";
  const vals = extra ? `, '${extra}'` : "";
  const may = o.machine === undefined ? MACHINE_ID : o.machine;
  const rows = await sql.unsafe(
    `INSERT INTO interlock_rules
       (name, scope, "machineId", "sourceType", "sourceKey", "comparisonOperator", threshold, "windowSize", "consecutiveCount", "windowSeconds",
        action, "targetMachineId", "targetAdapterId", enabled, "approvedBy"${cols})
     VALUES ('${DAU}-${extra ?? "mac-dinh"}', 'machine', ${may === null ? "NULL" : may}, 'telemetry_tag', '${o.tag ?? DAU + "-tag"}', 'gt', 80, ${o.windowSize ?? 50},
        ${o.consecutive ?? "NULL"}, 300, 'block_downstream', ${o.target ?? MACHINE_ID}, ${ADAPTER_ID}, true, 1${vals}) RETURNING id`,
  );
  ruleIds.push(rows[0].id as number);
  return rows[0].id as number;
}

/** Chèn hàng telemetry (agoSec = số giây trước now). */
async function chenTele(machine: number, tag: string, hang: Array<{ agoSec: number; v: number; quality?: string; deviceId?: string; ingestedAgoSec?: number }>): Promise<void> {
  const now = Date.now();
  for (const h of hang) {
    await sql`INSERT INTO ot_telemetry (ts, "ingestedAt", "machineId", "deviceId", protocol, metric, "numValue", quality)
      VALUES (${new Date(now - h.agoSec * 1000)}, ${new Date(now - (h.ingestedAgoSec ?? 0) * 1000)}, ${machine}, ${h.deviceId ?? null}, 'mqtt', ${tag}, ${h.v}, ${h.quality ?? "good"})`;
  }
}

/** Gọi cổng cho máy `machine` và trả violation của luật `id` (hoặc undefined). */
async function viPham(machine: number, id: number) {
  const kq = await evaluateInterlockGate({ adapterId: ADAPTER_ID, machineId: machine, tagKeys: [] });
  return kq.violations.find((v) => v.ruleId === id);
}

describe.skipIf(!DB_URL)("migration 0430 — khiThieuDuLieu", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    if (ruleIds.length) await sql`DELETE FROM interlock_rules WHERE id IN ${sql(ruleIds)}`;
    await sql`DELETE FROM ot_telemetry WHERE metric LIKE ${DAU + "%"}`;
    await sql.end();
  });

  it("luật chèn KHÔNG khai cột ⇒ đọc ra 'chan'", async () => {
    const id = await chenLuat(null);
    const [r] = await sql`SELECT "khiThieuDuLieu" AS k FROM interlock_rules WHERE id = ${id}`;
    expect(r.k).toBe("chan");
  });

  it("'cho_qua' được giữ; giá trị lạ bị CHECK từ chối", async () => {
    const id = await chenLuat("cho_qua");
    const [r] = await sql`SELECT "khiThieuDuLieu" AS k FROM interlock_rules WHERE id = ${id}`;
    expect(r.k).toBe("cho_qua");
    await expect(sql`UPDATE interlock_rules SET "khiThieuDuLieu" = 'la' WHERE id = ${id}`).rejects.toMatchObject({ code: "23514" });
  });

  it("cổng THẬT (bộ đệm tắt): không có hàng telemetry ⇒ luật mặc định CHẶN, luật cho_qua thì không", async () => {
    expect(process.env.SCADA_LIVE_CACHE_ENABLED).not.toBe("true");
    const macDinh = await chenLuat(null);
    const choQua = await chenLuat("cho_qua");
    const kq = await evaluateInterlockGate({ adapterId: ADAPTER_ID, machineId: MACHINE_ID, tagKeys: [] });
    const cuaToi = kq.violations.filter((v) => [macDinh, choQua].includes(v.ruleId));
    expect(cuaToi.map((v) => v.ruleId)).toEqual([macDinh]);
    expect(cuaToi[0].lyDo).toBe("thieu_du_lieu");
    expect(cuaToi.map((v) => v.ruleId)).not.toContain(choQua);
    expect(kq.blocked).toBe(true);
  });

  // ── Task 9 fix round 1 (đường DB, bộ đệm TẮT trừ khi nói khác) ──
  describe("chuỗi/chất lượng/máy trên đường DB thật", () => {
    const lech = (n: number) => MACHINE_ID + n;

    it("KHÔNG nối qua đoạn hỏng: good 10, 10, bad, good 90, 90 với N=3 ⇒ chỉ 2 hàng đủ điều kiện ⇒ thiếu dữ liệu ⇒ chặn (vòng 2: thay cho kỳ vọng 'lọc good ⇒ VI PHẠM' cũ, vốn nối mẫu qua hàng bad)", async () => {
      const m = lech(10), tag = DAU + "-loc";
      const id = await chenLuat(null, { machine: m, target: m, tag, consecutive: 3 });
      await chenTele(m, tag, [{ agoSec: 5, v: 10 }, { agoSec: 4, v: 10 }, { agoSec: 3, v: 10, quality: "bad" }, { agoSec: 2, v: 90 }, { agoSec: 1, v: 90 }]);
      expect((await viPham(m, id))?.lyDo).toBe("thieu_du_lieu");
    });

    it("đủ 3 hàng good SAU hàng bad gần nhất ⇒ đánh giá bình thường ⇒ VI PHẠM (không phải thiếu dữ liệu)", async () => {
      const m = lech(16), tag = DAU + "-sauhong";
      const id = await chenLuat(null, { machine: m, target: m, tag, consecutive: 3 });
      await chenTele(m, tag, [{ agoSec: 6, v: 10 }, { agoSec: 5, v: 10, quality: "bad" }, { agoSec: 3, v: 90 }, { agoSec: 2, v: 90 }, { agoSec: 1, v: 90 }]);
      const v = await viPham(m, id);
      expect(v).toBeDefined();
      expect(v!.lyDo).toBeUndefined();
    });

    it("60 hàng good nhưng hàng mới nhất cách 60 s, pollMs 1000 (adapter đăng ký) ⇒ cu ⇒ chặn", async () => {
      const m = lech(17), tag = DAU + "-cu";
      const id = await chenLuat(null, { machine: m, target: m, tag, consecutive: 60 });
      await chenTele(m, tag, Array.from({ length: 60 }, (_, i) => ({ agoSec: 60 + i * 0.1, ingestedAgoSec: 60 + i * 0.1, v: 90, deviceId: DAU + "-dev-cu" })));
      datThongTinAdapter(990_430_100, { pollMs: 1000, coDeadband: false, machineId: m, code: DAU + "-dev-cu" });
      try {
        expect((await viPham(m, id))?.lyDo).toBe("thieu_du_lieu");
      } finally {
        xoaAdapter(990_430_100);
      }
    });

    it("hai deviceId cùng máy + metric ⇒ mo_ho ⇒ chặn", async () => {
      const m = lech(18), tag = DAU + "-haidev";
      const id = await chenLuat(null, { machine: m, target: m, tag });
      await chenTele(m, tag, [{ agoSec: 3, v: 10, deviceId: DAU + "-A" }, { agoSec: 2, v: 10, deviceId: DAU + "-B" }, { agoSec: 1, v: 10, deviceId: DAU + "-A" }]);
      expect((await viPham(m, id))?.lyDo).toBe("thieu_du_lieu");
    });

    it("cùng một deviceId ⇒ không mơ hồ: đánh giá bình thường", async () => {
      const m = lech(19), tag = DAU + "-mot";
      const id = await chenLuat(null, { machine: m, target: m, tag });
      await chenTele(m, tag, [{ agoSec: 2, v: 90, deviceId: DAU + "-A" }, { agoSec: 1, v: 95, deviceId: DAU + "-A" }]);
      const v = await viPham(m, id);
      expect(v).toBeDefined();
      expect(v!.lyDo).toBeUndefined();
    });

    it("★ độ tươi đo từ ingestedAt (giờ máy chủ), KHÔNG từ ts thiết bị: ts = bây giờ nhưng ingestedAt cách 60 s (đồng hồ thiết bị chạy nhanh) ⇒ cu ⇒ chặn", async () => {
      const m = lech(21), tag = DAU + "-nhanh";
      const id = await chenLuat(null, { machine: m, target: m, tag });
      await chenTele(m, tag, [{ agoSec: 0, ingestedAgoSec: 60, v: 90 }]);
      expect((await viPham(m, id))?.lyDo).toBe("thieu_du_lieu");
    });

    it("đồng hồ thiết bị CHẬM: ts cách 60 s (vẫn trong cửa sổ 300 s) nhưng ingestedAt = bây giờ ⇒ KHÔNG cu, đánh giá bình thường ⇒ VI PHẠM", async () => {
      const m = lech(22), tag = DAU + "-cham";
      const id = await chenLuat(null, { machine: m, target: m, tag });
      await chenTele(m, tag, [{ agoSec: 60, ingestedAgoSec: 0, v: 90 }]);
      const v = await viPham(m, id);
      expect(v).toBeDefined();
      expect(v!.lyDo).toBeUndefined();
    });

    it("hai hàng CÙNG ts: hàng id lớn hơn (bad) là 'mới nhất' ⇒ chat_luong_xau xác định (ORDER BY ts DESC, id DESC)", async () => {
      const m = lech(20), tag = DAU + "-cungts";
      const id = await chenLuat(null, { machine: m, target: m, tag });
      const ts = new Date(Date.now() - 2000);
      await sql`INSERT INTO ot_telemetry (ts, "machineId", protocol, metric, "numValue", quality) VALUES (${ts}, ${m}, 'mqtt', ${tag}, 90, 'good')`;
      await sql`INSERT INTO ot_telemetry (ts, "machineId", protocol, metric, "numValue", quality) VALUES (${ts}, ${m}, 'mqtt', ${tag}, 90, 'bad')`;
      expect((await viPham(m, id))?.lyDo).toBe("thieu_du_lieu");
    });

    it("hàng MỚI NHẤT không good ⇒ thiếu dữ liệu (không lùi về mẫu good cũ)", async () => {
      const m = lech(11), tag = DAU + "-moinhat";
      const id = await chenLuat(null, { machine: m, target: m, tag });
      await chenTele(m, tag, [{ agoSec: 20, v: 10 }, { agoSec: 5, v: 10, quality: "uncertain" }]);
      const v = await viPham(m, id);
      expect(v?.lyDo).toBe("thieu_du_lieu");
    });

    it("luật không gắn máy (machineId NULL) ⇒ cau_hinh ⇒ chặn dù máy đích có dữ liệu tốt", async () => {
      const m = lech(12), tag = DAU + "-khongmay";
      const id = await chenLuat(null, { machine: null, target: m, tag });
      await chenTele(m, tag, [{ agoSec: 5, v: 10 }]);
      const v = await viPham(m, id);
      expect(v?.lyDo).toBe("cau_hinh");
    });

    it("consecutiveCount=60 (>50) + bộ đệm BẬT ⇒ đọc 60 hàng DB, đánh giá bình thường (vi phạm, không phải chặn vì thiếu dữ liệu)", async () => {
      const m = lech(13), tag = DAU + "-dai";
      const id = await chenLuat(null, { machine: m, target: m, tag, consecutive: 60 });
      await chenTele(m, tag, Array.from({ length: 60 }, (_, i) => ({ agoSec: 1 + i * 0.1, v: 90 })));
      const truoc = process.env.SCADA_LIVE_CACHE_ENABLED;
      process.env.SCADA_LIVE_CACHE_ENABLED = "true";
      try {
        const v = await viPham(m, id);
        expect(v).toBeDefined();
        expect(v!.lyDo).toBeUndefined();
      } finally {
        if (truoc === undefined) delete process.env.SCADA_LIVE_CACHE_ENABLED;
        else process.env.SCADA_LIVE_CACHE_ENABLED = truoc;
      }
    });

    it("windowSize=10, consecutiveCount=20 ⇒ đọc 20 hàng, đánh giá bình thường (trước vá: LIMIT 10 < 20 ⇒ chặn vĩnh viễn)", async () => {
      const m = lech(14), tag = DAU + "-cuaso";
      const id = await chenLuat(null, { machine: m, target: m, tag, consecutive: 20, windowSize: 10 });
      await chenTele(m, tag, Array.from({ length: 25 }, (_, i) => ({ agoSec: 1 + i * 0.1, v: 90 })));
      const v = await viPham(m, id);
      expect(v).toBeDefined();
      expect(v!.lyDo).toBeUndefined();
    });

    it("windowSize=10, consecutiveCount=20 nhưng chỉ có 15 hàng good ⇒ vẫn FAIL-CLOSED (thiếu dữ liệu)", async () => {
      const m = lech(15), tag = DAU + "-it";
      const id = await chenLuat(null, { machine: m, target: m, tag, consecutive: 20, windowSize: 10 });
      await chenTele(m, tag, Array.from({ length: 15 }, (_, i) => ({ agoSec: 1 + i * 0.1, v: 90 })));
      expect((await viPham(m, id))?.lyDo).toBe("thieu_du_lieu");
    });
  });
});
