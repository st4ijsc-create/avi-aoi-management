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

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: (_cols?: any) => ({
      from: (table: any) => {
        if (table === andonEvents) {
          return { where: async () => seedAndonRows };
        }
        if (table === predictiveAlertOccurrences) {
          return {
            innerJoin: (_joinTable: any, _on: any) => ({
              where: (_cond: any) => {
                if (throwOnOccurrenceQuery) throwOnOccurrenceQuery();
                return Promise.resolve([]);
              },
            }),
          };
        }
        // machines / users — không cần dữ liệu cho test này.
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
});
