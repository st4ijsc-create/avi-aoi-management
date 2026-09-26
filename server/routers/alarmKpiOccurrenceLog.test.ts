/**
 * Sprint 5 §3 — bảng KPI hiện "0 cảnh báo AI" mà không nói vì sao. Sổ nhật ký
 * lần-tái-diễn rỗng lúc bắt đầu (cấm nạp ngược quá khứ — quyết định đúng), nên
 * người dùng sẽ kết luận "AI hỏng rồi". Server phải trả mốc đầu tiên của sổ để
 * giao diện phân biệt được "0 vì yên tĩnh" với "0 vì chưa có dữ liệu".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initTRPC } from "@trpc/server";
import { andonEvents, predictiveAlertOccurrences } from "../../drizzle/schema";

let firstOccurredRow: any[] = [];
let throwOnOccurrenceQuery: (() => never) | null = null;

vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: (_cols?: any) => ({
      from: (table: any) => {
        if (table === andonEvents) return { where: async () => [] };
        if (table === predictiveAlertOccurrences) {
          // Cùng một .from() phục vụ HAI truy vấn khác nhau:
          //  • có .innerJoin(...) → danh sách lần-tái-diễn trong cửa sổ
          //  • await thẳng        → MIN(occurredAt) toàn bảng (Sprint 5 §3.1)
          const node: any = {
            innerJoin: (_t: any, _on: any) => ({
              where: (_c: any) => {
                if (throwOnOccurrenceQuery) throwOnOccurrenceQuery();
                return Promise.resolve([]);
              },
            }),
            then: (resolve: any, reject: any) => {
              if (throwOnOccurrenceQuery) {
                try { throwOnOccurrenceQuery(); } catch (e) { return Promise.reject(e).catch(reject); }
              }
              return Promise.resolve(firstOccurredRow).then(resolve, reject);
            },
          };
          return node;
        }
        return { where: async () => [] };
      },
    }),
  }),
}));

import { alarmKpiRouter } from "./alarmKpiRouter";
const t = initTRPC.context<any>().create();
const caller = t.createCallerFactory(alarmKpiRouter)({ user: { id: 1, role: "admin" } });

beforeEach(() => {
  firstOccurredRow = [];
  throwOnOccurrenceQuery = null;
});

describe("alarmKpi.summary — occurrenceLog", () => {
  it("sổ RỖNG ⇒ available=true, firstOccurredAt=null (số 0 là 'chưa có dữ liệu')", async () => {
    firstOccurredRow = [{ first: null }];
    const res = await caller.summary({ windowHours: 8 });
    expect(res.occurrenceLog).toEqual({ available: true, firstOccurredAt: null });
  });

  it("sổ CÓ dòng ⇒ trả mốc đầu tiên dạng ISO", async () => {
    const d = new Date("2026-07-20T03:00:00.000Z");
    firstOccurredRow = [{ first: d }];
    const res = await caller.summary({ windowHours: 8 });
    expect(res.occurrenceLog.available).toBe(true);
    expect(res.occurrenceLog.firstOccurredAt).toBe(d.toISOString());
  });

  it("bảng CHƯA tồn tại (42P01) ⇒ available=false, không ném", async () => {
    throwOnOccurrenceQuery = () => {
      const err: any = new Error('relation "predictive_alert_occurrences" does not exist');
      err.code = "42P01";
      throw err;
    };
    const res = await caller.summary({ windowHours: 8 });
    expect(res.occurrenceLog).toEqual({ available: false, firstOccurredAt: null });
  });
});
