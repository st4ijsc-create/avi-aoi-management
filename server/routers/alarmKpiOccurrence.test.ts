/**
 * Wave 4 §4 (task-4-brief.md) — alarmKpiRouter.summary() phải đếm theo LẦN
 * TÁI DIỄN (predictive_alert_occurrences), không theo DÒNG cảnh báo cha
 * (predictive_alerts). Wave 3 gộp cảnh báo trùng thành MỘT dòng (occurrenceCount
 * lũy kế trong dòng cha), nhưng đếm KPI theo dòng làm lộ ba lỗi cùng lúc:
 *   1. Đếm thiếu — 22 lần tái diễn chỉ báo 1.
 *   2. "Biến mất" khỏi cửa sổ — dòng cha createdAt cũ (Wave 3 cố ý giữ nguyên),
 *      dù tình trạng tái diễn ngay hôm nay.
 *   3. Ngập báo động (>10/10 phút, ISA-18.2) không bao giờ kích hoạt vì
 *      một dòng cảnh báo = một sự kiện, bất kể tái diễn bao nhiêu lần.
 *
 * Mock db.select() phân theo BẢNG truyền vào .from(...) và mô phỏng INNER JOIN
 * predictive_alert_occurrences ⋈ predictive_alerts THẬT (lọc theo cây điều
 * kiện SQL thật truyền vào .where(), không trả cố định) — để ca "KHÔNG BIẾN
 * MẤT" thật sự ĐỎ nếu ai lọc nhầm về createdAt. Ca thứ ba duyệt cây điều kiện
 * SQL thật (đúng kỹ thuật columnNamesInCondition() của alertExpirySweeper.test.ts,
 * Wave 3) để khẳng định WHERE tham chiếu cột occurredAt. Bài học Wave 3: mock
 * trả cố định "bất kể lọc gì" là lý do lỗi "biến mất" lọt qua — không lặp lại.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initTRPC } from "@trpc/server";
import { andonEvents, predictiveAlerts, predictiveAlertOccurrences, machines, users } from "../../drizzle/schema";

// ── "Fake DB" state, reset mỗi test ────────────────────────────────────────
let seedAndonRows: any[] = [];
let seedAlertRows: any[] = [];       // predictive_alerts (dòng cha)
let seedOccurrenceRows: any[] = [];  // predictive_alert_occurrences (nhật ký lần-tái-diễn)
let seedMachineRows: any[] = [];
let lastPredWhereCond: any = null;
// Vòng sửa 1 (review coordinator) — mock .innerJoin() ban đầu nhận (_joinTable, _on)
// nhưng KHÔNG DÙNG chúng: joinedOccurrenceRows() tự áp cứng logic join đúng
// (occ.alertId === parent.id) BẤT KỂ router truyền điều kiện JOIN gì. Reviewer
// chứng minh: đổi router thành `eq(predictiveAlertOccurrences.id, predictiveAlerts.id)`
// (join PK-với-PK, vô nghĩa) thì test vẫn XANH 3/3 vì mock không hề đọc `_on`.
// Capture lastJoinTable/lastJoinCond để một test riêng duyệt cây điều kiện JOIN
// thật — cùng kỹ thuật đã dùng cho lastPredWhereCond.
let lastJoinTable: any = null;
let lastJoinCond: any = null;
let sinceForTest: Date = new Date();

/** Duyệt cây SQL THẬT của drizzle-orm (queryChunks lồng nhau), gom tên cột
 *  Column thật được tham chiếu. Y hệt kỹ thuật alertExpirySweeper.test.ts
 *  (Wave 3) — Column thật có .name (string) + .columnType (string);
 *  StringChunk/Param không có .columnType nên không lẫn vào. */
function columnNamesInCondition(cond: any): string[] {
  const names: string[] = [];
  function walk(node: any, depth: number) {
    if (node == null || depth > 12) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth); return; }
    if (typeof node !== "object") return;
    if (typeof node.name === "string" && typeof node.columnType === "string") names.push(node.name);
    if (Array.isArray(node.queryChunks)) walk(node.queryChunks, depth + 1);
  }
  walk(cond, 0);
  return names;
}

/**
 * Mô phỏng WHERE THẬT: lọc `rows` theo BẤT KỲ cột thời gian nào `cond` thật
 * sự tham chiếu (occurredAt HOẶC createdAt) — KHÔNG trả cố định bất kể lọc
 * gì. Đây chính là điều khiến ca "KHÔNG BIẾN MẤT" và ca "mệnh đề lọc" thật sự
 * ĐỎ khi code lọc nhầm cột: nếu ai đổi truy vấn về `gte(createdAt, since)`,
 * hàm này sẽ lọc theo `createdAt` của các dòng — đúng như Postgres thật sẽ làm.
 */
function applyWindowFilter(rows: any[], cond: any, since: Date): any[] {
  const names = columnNamesInCondition(cond);
  const field = names.includes("occurredAt") ? "occurredAt" : names.includes("createdAt") ? "createdAt" : null;
  if (!field) return rows;
  return rows.filter((r) => r[field] != null && new Date(r[field]).getTime() >= since.getTime());
}

/** Mô phỏng INNER JOIN predictive_alert_occurrences ⋈ predictive_alerts thật:
 *  mỗi dòng nhật ký ghép với dòng cha của nó, giữ CẢ occurredAt (nhật ký) LẪN
 *  createdAt (dòng cha) trên cùng object để applyWindowFilter() lọc đúng theo
 *  bất kỳ cột nào cond thật sự tham chiếu. */
function joinedOccurrenceRows(): any[] {
  return seedOccurrenceRows
    .map((occ) => {
      const parent = seedAlertRows.find((a) => a.id === occ.alertId);
      if (!parent) return null;
      return {
        occurrenceId: occ.id,
        occurredAt: occ.occurredAt,
        occurrenceSeverity: occ.severity,
        id: parent.id,
        severity: parent.severity,
        createdAt: parent.createdAt,
        acknowledgedAt: parent.acknowledgedAt,
        resolvedAt: parent.resolvedAt,
        status: parent.status,
        machineId: parent.machineId,
        machineCode: parent.machineCode,
        title: parent.title,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: (_cols?: any) => ({
      from: (table: any) => {
        if (table === andonEvents) {
          return { where: async () => seedAndonRows };
        }
        if (table === predictiveAlertOccurrences) {
          // Truy vấn MỚI (sau Step 3/4): .from(occurrences).innerJoin(predictiveAlerts, ...).where(...)
          return {
            innerJoin: (joinTable: any, on: any) => {
              // Vòng sửa 1 — GHI LẠI bảng + điều kiện JOIN thật (không bỏ qua như trước).
              // joinedOccurrenceRows() dưới đây vẫn tự áp logic join đúng cứng (đơn
              // giản hoá mock), nhưng giờ có một test riêng duyệt lastJoinCond để
              // khẳng định router THẬT SỰ truyền đúng điều kiện — bắt được nếu ai
              // đổi sang join sai cột (vd PK-với-PK).
              lastJoinTable = joinTable;
              lastJoinCond = on;
              return {
                where: (cond: any) => {
                  lastPredWhereCond = cond;
                  return Promise.resolve(applyWindowFilter(joinedOccurrenceRows(), cond, sinceForTest));
                },
              };
            },
          };
        }
        if (table === predictiveAlerts) {
          // Truy vấn CŨ (trước sửa): .from(predictiveAlerts).where(...) — giữ nhánh
          // này để test vẫn diễn giải ĐÚNG hành vi khi chạy trước khi Step 3/4 áp dụng.
          return {
            where: (cond: any) => {
              lastPredWhereCond = cond;
              return Promise.resolve(applyWindowFilter(seedAlertRows, cond, sinceForTest));
            },
          };
        }
        if (table === machines) {
          return { where: async () => seedMachineRows };
        }
        if (table === users) {
          return { where: async () => [] };
        }
        return { where: async () => [] };
      },
    }),
  }),
}));

import { alarmKpiRouter } from "./alarmKpiRouter";

const t = initTRPC.context<any>().create();
const createCaller = t.createCallerFactory(alarmKpiRouter);
const caller = createCaller({ user: { id: 1, role: "admin" } });

beforeEach(() => {
  seedAndonRows = [];
  seedAlertRows = [];
  seedOccurrenceRows = [];
  seedMachineRows = [];
  lastPredWhereCond = null;
  lastJoinTable = null;
  lastJoinCond = null;
  sinceForTest = new Date();
});

describe("alarmKpi — đọc từ nhật ký lần-tái-diễn", () => {
  it("ĐẾM ĐỦ: một cảnh báo tái diễn 22 lần ⇒ 22 sự kiện, không phải 1", async () => {
    const now = Date.now();
    sinceForTest = new Date(now - 8 * 3600_000);
    seedAlertRows = [{
      id: 501,
      severity: "LOW",
      createdAt: new Date(now - 3600_000),
      acknowledgedAt: null,
      resolvedAt: null,
      status: "ACTIVE",
      machineId: 11,
      machineCode: "M11",
      title: "rung bất thường",
    }];
    seedOccurrenceRows = Array.from({ length: 22 }, (_, i) => ({
      id: 9000 + i,
      alertId: 501,
      occurredAt: new Date(now - i * 60_000), // 22 lần trong ~22 phút gần đây
      severity: "LOW",
    }));

    const res = await caller.summary({ windowHours: 8 });
    expect(res.sourceCounts.predictive).toBe(22);
  });

  it("KHÔNG BIẾN MẤT: cảnh báo tạo 4 ngày trước, tái diễn HÔM NAY ⇒ vẫn trong cửa sổ 24h", async () => {
    const now = Date.now();
    sinceForTest = new Date(now - 24 * 3600_000);
    seedAlertRows = [{
      id: 502,
      severity: "MEDIUM",
      createdAt: new Date(now - 4 * 24 * 3600_000), // 4 ngày trước — NGOÀI cửa sổ 24h
      acknowledgedAt: null,
      resolvedAt: null,
      status: "ACTIVE",
      machineId: 12,
      machineCode: "M12",
      title: "nhiệt độ cao",
    }];
    seedOccurrenceRows = [{
      id: 9100,
      alertId: 502,
      occurredAt: new Date(now - 3600_000), // 1h trước — TRONG cửa sổ 24h
      severity: "MEDIUM",
    }];

    const res = await caller.summary({ windowHours: 24 });
    expect(res.sourceCounts.predictive).toBe(1);
    expect(res.totalAlarms).toBeGreaterThanOrEqual(1);
  });

  it("mệnh đề lọc cửa sổ phải theo occurredAt, KHÔNG theo createdAt", async () => {
    const now = Date.now();
    sinceForTest = new Date(now - 8 * 3600_000);
    seedAlertRows = [{
      id: 503,
      severity: "HIGH",
      createdAt: new Date(now - 3600_000),
      acknowledgedAt: null,
      resolvedAt: null,
      status: "ACTIVE",
      machineId: 13,
      machineCode: "M13",
      title: "kẹt băng tải",
    }];
    seedOccurrenceRows = [{ id: 9200, alertId: 503, occurredAt: new Date(now - 60_000), severity: "HIGH" }];

    await caller.summary({ windowHours: 8 });

    expect(lastPredWhereCond).toBeTruthy();
    const names = columnNamesInCondition(lastPredWhereCond);
    expect(names).toContain("occurredAt"); // ★ đây là cái đổi sang createdAt sẽ làm ĐỎ
    expect(names).not.toContain("createdAt");
  });

  /**
   * Vòng sửa 1 (review coordinator) — trước bản sửa này, mock .innerJoin() nhận
   * (_joinTable, _on) nhưng KHÔNG DÙNG: joinedOccurrenceRows() tự áp cứng đúng
   * logic join (alertId ↔ id) bất kể router truyền gì. Reviewer chứng minh: đổi
   * router thành join PK-với-PK (`eq(predictiveAlertOccurrences.id, predictiveAlerts.id)`
   * — vô nghĩa hoàn toàn) thì tsc không bắt được (kiểu `eq()` lỏng) và 3 test cũ
   * vẫn XANH. Ca này duyệt cây điều kiện JOIN THẬT (đúng kỹ thuật đã dùng cho
   * lastPredWhereCond) để khẳng định điều kiện tham chiếu ĐÚNG cột: "alertId"
   * (khoá ngoại bên nhật ký) và "id" (khoá chính bên dòng cha) — và bảng thứ
   * hai truyền vào .innerJoin() đúng là predictiveAlerts.
   */
  it("mệnh đề JOIN phải khớp alertId (nhật ký) với id (dòng cha) — không phải khoá khác", async () => {
    const now = Date.now();
    sinceForTest = new Date(now - 8 * 3600_000);
    seedAlertRows = [{
      id: 505,
      severity: "LOW",
      createdAt: new Date(now - 3600_000),
      acknowledgedAt: null,
      resolvedAt: null,
      status: "ACTIVE",
      machineId: 15,
      machineCode: "M15",
      title: "rò rỉ khí nén",
    }];
    seedOccurrenceRows = [{ id: 9400, alertId: 505, occurredAt: new Date(now - 60_000), severity: "LOW" }];

    await caller.summary({ windowHours: 8 });

    expect(lastJoinTable).toBe(predictiveAlerts); // bảng thứ hai của .innerJoin() phải là predictive_alerts
    expect(lastJoinCond).toBeTruthy();
    const names = columnNamesInCondition(lastJoinCond);
    // ★ join PK-với-PK (predictiveAlertOccurrences.id ↔ predictiveAlerts.id) sẽ
    // cho names = ["id","id"] — KHÔNG có "alertId" — nên assertion dưới sẽ ĐỎ.
    expect(names).toContain("alertId");
    expect(names).toContain("id");
  });

  /**
   * Vòng sửa 1 (review coordinator) — nhánh lùi cấp `r.occurrenceSeverity ?? r.severity`
   * (alarmKpiRouter.ts) chưa từng chạy: 3 ca trên đều seed occurrence.severity có
   * giá trị. Cột này NULLABLE thật trong schema (predictive_alert_occurrences.severity
   * varchar, không notNull) nên trường hợp thiếu là có thật. Ca này seed
   * occurrence.severity = null với dòng cha severity="CRITICAL" — nếu code LÙI
   * VỀ đúng mức cha, alarm rơi vào bucket "high" (gồm critical); nếu bỏ sót
   * `?? r.severity`, normalizePredictiveSeverity(null) mặc định về "low" sai.
   */
  it("thiếu occurrenceSeverity (nhật ký không ghi mức) ⇒ lùi về mức của dòng cha", async () => {
    const now = Date.now();
    sinceForTest = new Date(now - 8 * 3600_000);
    seedAlertRows = [{
      id: 506,
      severity: "CRITICAL",
      createdAt: new Date(now - 3600_000),
      acknowledgedAt: null,
      resolvedAt: null,
      status: "ACTIVE",
      machineId: 16,
      machineCode: "M16",
      title: "quá nhiệt động cơ",
    }];
    seedOccurrenceRows = [{ id: 9500, alertId: 506, occurredAt: new Date(now - 60_000), severity: null }];

    const res = await caller.summary({ windowHours: 8 });

    expect(res.distribution.counts.high).toBe(1); // lùi về CRITICAL của dòng cha ⇒ bucket "high"
    expect(res.distribution.counts.low).toBe(0);  // KHÔNG được rớt về mặc định "low" của severity=null
  });
});
