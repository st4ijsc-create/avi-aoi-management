/**
 * doc 80 Đợt 1 — Task 3 (STD-01, STD-04) — KPI Tiêu chuẩn thiết bị TRUNG THỰC, trên CSDL THẬT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Phụ lục E §4 + §6.4:
 *   STD-01 — `complianceMetrics` là một tautology: "máy đã ánh xạ" so `machines.machineType`
 *     với typeKey của HẰNG SỐ seed (buildSeedTypes) — mọi máy có machineType hợp lệ đều
 *     "đã ánh xạ" (1700/1700 quan sát live), dù `machines.device_type_key` NULL ở 1 113 máy.
 *     Conformance chạy trên chính hằng số seed (24/24 luôn xanh), không nhìn device_types.
 *   STD-04 — hai bộ tính KPI ISA-18.2: `equipmentStandards.alarmKpis` (chỉ andon, span
 *     first→last, operatorCount mặc định 1) khác `alarmKpi.summary` (/alarm-kpi + Control
 *     Tower) ⇒ hai con số khác nhau cho cùng một cửa sổ.
 *
 * ⚠ Bảng `machines`/`andon_events` của `_test` là DÙNG CHUNG với các tệp test chạy song song —
 *   mọi khẳng định ở đây đo trên thực thể CỦA RIÊNG lượt này (typeKey duy nhất theo RUN, một
 *   máy riêng để lọc KPI theo machineId) hoặc là phép kiểm "chứa", để tệp khác chèn thêm hàng
 *   không làm đỏ/xanh giả.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `t3s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FAC = `T3SF_${RUN}`.slice(0, 50);
// typeKey duy nhất theo lượt chạy — ĐÃ publish trong device_types, cố ý THIẾU telemetry
// 'state' ⇒ phải trượt conformance nếu conformance thật sự đọc device_types.
const TYPE_PUB = `T3PUB_${RUN}`.slice(0, 64);
// typeKey chỉ ở dạng draft ⇒ máy gắn key này KHÔNG được tính là "đã ánh xạ tới published".
const TYPE_DRAFT = `T3DRF_${RUN}`.slice(0, 64);

const U_ADMIN = 953301;
const ctxAdmin = { user: { id: U_ADMIN, role: "admin", name: `u${U_ADMIN}` } } as never;

let sql: ReturnType<typeof postgres>;
const ids = { fac: 0, ws: 0, line: 0, st: 0, mPub: 0, mNull: 0, mDraft: 0 };
const ANDON_TITLE = `T3S ANDON ${RUN}`;

describe.skipIf(!DB_URL)("equipmentStandards Đợt 1 Task 3 — KPI trung thực (CSDL THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    ids.fac = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC}, ${"T3S " + FAC}, true) RETURNING id`);
    ids.ws = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.fac}, ${FAC + "_WS"}, 'ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.ws}, ${FAC + "_L1"}, 'line') RETURNING id`);
    ids.st = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${FAC + "_S1"}, 'st') RETURNING id`);

    await sql`
      INSERT INTO device_types ("typeKey", version, status, origin, label, "attributesSchema", "supportedCommands", "supportedStates", "mappedMachineTypes")
      VALUES (${TYPE_PUB}, '1.0.0', 'published', 'manual', 'T3 published (thiếu state)',
              ${sql.json([{ name: "cycle_time", type: "number" }])}, ${sql.json([{ name: "stop" }])},
              ${sql.json(["Idle", "Stopped"])}, ${sql.json(["AOI"])})`;
    await sql`
      INSERT INTO device_types ("typeKey", version, status, origin, label, "mappedMachineTypes")
      VALUES (${TYPE_DRAFT}, '1.0.0', 'draft', 'manual', 'T3 draft', ${sql.json(["AOI"])})`;

    // Ba máy CÙNG machineType 'AOI' (một typeKey đã publish trong seed) — code cũ tính cả ba
    // là "đã ánh xạ". Thật ra chỉ mPub có device_type_key trỏ tới một kiểu ĐÃ publish.
    ids.mPub = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", device_type_key) VALUES (${ids.st}, ${FAC + "_MP"}, 'mPub', 'AOI', ${TYPE_PUB}) RETURNING id`);
    ids.mNull = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.st}, ${FAC + "_MN"}, 'mNull', 'AOI') RETURNING id`);
    ids.mDraft = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", device_type_key) VALUES (${ids.st}, ${FAC + "_MD"}, 'mDraft', 'AOI', ${TYPE_DRAFT}) RETURNING id`);

    // Andon trên máy riêng mPub (lọc KPI theo machineId ⇒ cô lập khỏi tệp chạy song song).
    for (const [h, state] of [[1, "red"], [2, "yellow"], [3, "red"], [30, "call"]] as const) {
      await sql`INSERT INTO andon_events (state, reason, status, "lineId", "stationId", "machineId", title, "raisedAt")
                VALUES (${state}, 'quality', 'raised', ${ids.line}, ${ids.st}, ${ids.mPub}, ${ANDON_TITLE}, NOW() - (${h} || ' hours')::interval)`;
    }
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM andon_events WHERE title = ${ANDON_TITLE}`;
    await sql`DELETE FROM machines WHERE id IN ${sql([ids.mPub, ids.mNull, ids.mDraft].filter(Boolean))}`;
    await sql`DELETE FROM device_types WHERE "typeKey" IN ${sql([TYPE_PUB, TYPE_DRAFT])}`;
    if (ids.st) await sql`DELETE FROM stations WHERE id = ${ids.st}`;
    if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
    if (ids.ws) await sql`DELETE FROM workshops WHERE id = ${ids.ws}`;
    if (ids.fac) await sql`DELETE FROM factories WHERE id = ${ids.fac}`;
    await sql.end();
  });

  const es = async () => (await import("./equipmentStandardsRouter")).equipmentStandardsRouter.createCaller(ctxAdmin);
  const ak = async () => (await import("./alarmKpiRouter")).alarmKpiRouter.createCaller(ctxAdmin);

  // ── STD-01 ──────────────────────────────────────────────────────────────────
  it("STD-01: máy CHƯA gắn kiểu (device_type_key NULL / trỏ kiểu draft) KHÔNG được tính 'đã ánh xạ' ⇒ < 100 %", async () => {
    const m = await (await es()).complianceMetrics();
    // 'AOI' là typeKey của seed: code cũ không bao giờ liệt kê AOI là "chưa ánh xạ".
    expect(m.unmappedMachineTypes).toContain("AOI");
    expect(m.machinesMappedToPublished).toBeLessThan(m.machineCount);
    expect(m.mappedRate).toBeLessThan(1);
    // Máy gắn key published của riêng lượt này: đúng 1 máy dùng TYPE_PUB.
    expect(m.usageByTypeKey[TYPE_PUB]).toBe(1);
    // Key draft KHÔNG phải published ⇒ không có trong bảng dùng-bởi.
    expect(m.usageByTypeKey[TYPE_DRAFT]).toBeUndefined();
    expect(m.basis.mapping).toBe("machines.device_type_key");
    expect(m.basis.publishedTypesFrom).toBe("device_types");
  });

  it("STD-01: conformance tính trên device_types trong DB — kiểu published thiếu 'state' phải TRƯỢT", async () => {
    const m = await (await es()).complianceMetrics();
    expect(m.failingTypes).toContain(TYPE_PUB);
    expect(m.conformancePassRate).toBeLessThan(1);
    expect(m.basis.conformanceFrom).toBe("device_types");
  });

  // ── STD-04 ──────────────────────────────────────────────────────────────────
  it("STD-04: equipmentStandards.alarmKpis và alarmKpi.summary cho CÙNG số trên cùng cửa sổ", async () => {
    const [a, b] = await Promise.all([
      (await es()).alarmKpis({ windowDays: 1, machineId: ids.mPub }),
      (await ak()).summary({ windowHours: 24, machineId: ids.mPub }),
    ]);
    const pick = (s: Record<string, unknown>) => ({
      totalAlarms: s.totalAlarms,
      operatorCount: s.operatorCount,
      windowMs: s.windowMs,
      rate: s.rate,
      flood: s.flood,
      standing: (s.standing as { count?: number } | undefined)?.count,
      badActors: s.badActors,
      distribution: s.distribution,
      breaches: s.breaches,
      sourceCounts: s.sourceCounts,
    });
    expect(pick(a as never)).toEqual(pick(b as never));
    // 3 andon trong 24 h (cái thứ 4 ở −30 h nằm NGOÀI cửa sổ).
    expect(b.totalAlarms).toBe(3);
  });

  it("STD-04: operatorCount lấy từ SERVER (users role=operator đang hoạt động, sàn 1) — không phải 1 cứng", async () => {
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE role = 'operator' AND "isActive" = true`;
    const a = await (await es()).alarmKpis({ windowDays: 1, machineId: ids.mPub });
    expect(a.operatorCount).toBe(Math.max(1, Number(n)));
  });
});
