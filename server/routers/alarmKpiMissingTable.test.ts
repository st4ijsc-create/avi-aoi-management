/**
 * Vòng sửa cuối (review toàn nhánh, mục 2) — alarmKpiRouter.summary() truy vấn
 * predictive_alert_occurrences (bảng nhật ký lần-tái-diễn, mig 0308/0309)
 * KHÔNG có guard `isMissingTable` (server/_core/dbErrors.ts). Nếu mã được
 * deploy trước khi migration 0309 chạy trên một môi trường nào đó, Postgres
 * trả 42P01 ("relation ... does not exist"), lọt thẳng qua tRPC thành 500 —
 * sập CẢ trang /alarm-kpi LẪN panel alarmHealth ở Control Tower, kể cả phần
 * Andon vốn không liên quan gì tới bảng này.
 *
 * Test này mô phỏng đúng lỗi 42P01 ở đúng câu truy vấn (predictiveAlertOccurrences
 * .innerJoin(predictiveAlerts).where(...)) và khẳng định summary() KHÔNG ném:
 * trả về predictive=0, Andon vẫn nguyên vẹn.
 *
 * Test thứ hai (đối chứng) — một lỗi DB KHÁC (không phải bảng thiếu) vẫn phải
 * NÉM ra ngoài, để khẳng định ta dùng đúng `isMissingTable` (cause-walker có
 * chọn lọc), không phải try/catch nuốt-mọi-lỗi.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initTRPC } from "@trpc/server";
import { andonEvents, predictiveAlertOccurrences } from "../../drizzle/schema";

let seedAndonRows: any[] = [];
let throwOnOccurrenceQuery: (() => never) | null = null;
// Sprint 5 debt E7(a) — trước đây throwOnOccurrenceQuery kích hoạt ở CẢ truy
// vấn JOIN (sự kiện) LẪN truy vấn MIN, nhưng truy vấn JOIN luôn chạy TRƯỚC
// (loadPredRows) nên occurrenceTableAvailable=false ngay từ đó và khối
// try/catch quanh MIN (:117-126 alarmKpiRouter.ts) bị SKIP hoàn toàn — không
// test nào ở file này từng thực sự chạm khối đó. Cờ RIÊNG này cho phép truy
// vấn JOIN thành công còn MIN ném lỗi, cô lập đúng khối try/catch cần kiểm.
let throwOnMinQuery: (() => never) | null = null;

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: (_cols?: any) => ({
      from: (table: any) => {
        if (table === andonEvents) {
          return { where: async () => seedAndonRows };
        }
        if (table === predictiveAlertOccurrences) {
          const node: any = {
            innerJoin: (_joinTable: any, _on: any) => ({
              where: (_cond: any) => {
                if (throwOnOccurrenceQuery) throwOnOccurrenceQuery();
                return Promise.resolve([]);
              },
            }),
            // Sprint 5 §3.1 — cùng .from() nay còn phục vụ MIN(occurredAt) khi
            // KHÔNG có input.machineId (await thẳng, không qua .innerJoin() —
            // debt E6 chỉ join khi cần lọc theo máy). Cờ ném RIÊNG (throwOnMinQuery,
            // debt E7a) — KHÔNG dùng chung throwOnOccurrenceQuery của truy vấn JOIN
            // nữa, để hai truy vấn có thể thành/bại độc lập trong cùng một test.
            then: (resolve: any, reject: any) => {
              if (throwOnMinQuery) {
                try { throwOnMinQuery(); } catch (e) { return Promise.reject(e).catch(reject); }
              }
              return Promise.resolve([{ first: null }]).then(resolve, reject);
            },
          };
          return node;
        }
        // machines / users / predictiveAlerts — không cần dữ liệu cho test này.
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
  throwOnOccurrenceQuery = null;
  throwOnMinQuery = null;
});

describe("alarmKpi.summary — bảng nhật ký lần-tái-diễn chưa tồn tại (migration 0309 chưa chạy)", () => {
  it("42P01 (relation does not exist) ⇒ summary() KHÔNG ném; predictive=0; Andon nguyên vẹn", async () => {
    seedAndonRows = [
      { id: 1, state: "red", raisedAt: new Date(), acknowledgedAt: null, resolvedAt: null, machineId: 1, stationId: null, lineId: null, title: "trạm lỗi" },
      { id: 2, state: "yellow", raisedAt: new Date(), acknowledgedAt: null, resolvedAt: null, machineId: 1, stationId: null, lineId: null, title: "cảnh báo" },
      { id: 3, state: "green", raisedAt: new Date(), acknowledgedAt: null, resolvedAt: null, machineId: 1, stationId: null, lineId: null, title: "bình thường" },
    ];
    throwOnOccurrenceQuery = () => {
      const err: any = new Error('relation "predictive_alert_occurrences" does not exist');
      err.code = "42P01";
      throw err;
    };

    const res = await caller.summary({ windowHours: 8 });

    expect(res.sourceCounts.predictive).toBe(0);
    expect(res.sourceCounts.andon).toBe(3); // Andon KHÔNG bị ảnh hưởng
    expect(res.totalAlarms).toBe(3);
  });

  it("42P01 nhưng bọc trong DrizzleQueryError (lỗi thật nằm ở .cause) ⇒ vẫn bắt được", async () => {
    seedAndonRows = [];
    throwOnOccurrenceQuery = () => {
      const cause: any = new Error('relation "predictive_alert_occurrences" does not exist');
      cause.code = "42P01";
      const wrapped: any = new Error("Failed query: SELECT ... FROM predictive_alert_occurrences ...");
      wrapped.cause = cause;
      throw wrapped;
    };

    await expect(caller.summary({ windowHours: 8 })).resolves.toBeTruthy();
    const res = await caller.summary({ windowHours: 8 });
    expect(res.sourceCounts.predictive).toBe(0);
  });

  it("lỗi DB KHÁC (không phải bảng thiếu) vẫn phải ném — không nuốt mọi lỗi", async () => {
    throwOnOccurrenceQuery = () => {
      throw new Error("connection terminated unexpectedly");
    };

    await expect(caller.summary({ windowHours: 8 })).rejects.toThrow("connection terminated unexpectedly");
  });

  // Sprint 5 debt E7(a) — trước bản sửa cờ RIÊNG này, throwOnOccurrenceQuery
  // kích hoạt ở CẢ hai truy vấn nên MIN không bao giờ được test cô lập (truy
  // vấn JOIN luôn ném trước, occurrenceTableAvailable=false, khối MIN bị
  // skip). Ở đây truy vấn JOIN THÀNH CÔNG (throwOnOccurrenceQuery=null), chỉ
  // MIN ném — khẳng định khối try/catch quanh MIN (:117-133 alarmKpiRouter.ts)
  // thật sự chạy và tự bắt lỗi độc lập với truy vấn JOIN.
  describe("debt E7(a) — cô lập try/catch quanh truy vấn MIN(occurredAt)", () => {
    it("truy vấn JOIN thành công, CHỈ truy vấn MIN ném 42P01 ⇒ available=false, sourceCounts.predictive vẫn đúng", async () => {
      seedAndonRows = [
        { id: 1, state: "red", raisedAt: new Date(), acknowledgedAt: null, resolvedAt: null, machineId: 1, stationId: null, lineId: null, title: "trạm lỗi" },
      ];
      throwOnMinQuery = () => {
        const err: any = new Error('relation "predictive_alert_occurrences" does not exist');
        err.code = "42P01";
        throw err;
      };

      const res = await caller.summary({ windowHours: 8 });

      expect(res.occurrenceLog).toEqual({ available: false, firstOccurredAt: null });
      expect(res.sourceCounts.andon).toBe(1); // Andon KHÔNG bị ảnh hưởng
      expect(res.sourceCounts.predictive).toBe(0); // truy vấn JOIN thật sự chạy được (trả rỗng theo mock), không bị MIN kéo theo
    });

    it("truy vấn JOIN thành công, CHỈ truy vấn MIN ném lỗi KHÁC (không phải bảng thiếu) ⇒ vẫn phải NÉM ra ngoài", async () => {
      throwOnMinQuery = () => {
        throw new Error("connection terminated unexpectedly (MIN query)");
      };

      await expect(caller.summary({ windowHours: 8 })).rejects.toThrow("connection terminated unexpectedly (MIN query)");
    });
  });
});
