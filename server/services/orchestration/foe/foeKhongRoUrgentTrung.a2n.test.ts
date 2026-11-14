// T9 lượt sửa 3e (A1-31, HST (Y)) — the inbox dedup of an A2(n) URGENT (criticalStopAlert.ts:53: the key, OR the same kind + the same words) must never swallow the URGENT of ANOTHER STOP.
// No DB: getDb is a fake whose where() evaluates drizzle's and / or / eq / gt / inArray / sql as predicates over the rows sendNotification (a fake) wrote. No clock, no network.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kho: Array<Record<string, any>> = [];

vi.mock("drizzle-orm", async (orig) => {
  const a = await orig<typeof import("drizzle-orm")>();
  const ten = (c: any) => String(c?.name);
  const lap = (p: any) => (typeof p === "function" ? p : () => true);
  return {
    ...a,
    and: (...p: any[]) => (r: any) => p.filter((x) => x !== undefined).every((x) => lap(x)(r)),
    or: (...p: any[]) => (r: any) => p.filter((x) => x !== undefined).some((x) => lap(x)(r)),
    eq: (c: any, v: any) => (r: any) => r[ten(c)] === v,
    gt: (c: any, v: any) => (r: any) => r[ten(c)] > v,
    inArray: (c: any, vs: any[]) => (r: any) => vs.includes(r[ten(c)]),
    sql: Object.assign(
      (s: TemplateStringsArray, ...v: any[]) => {
        const m = /->>'(\w+)' = $/.exec(s[1] ?? "");
        return m ? (r: any) => (r[ten(v[0])] ?? {})[m[1]!] === v[1] : () => true;
      },
      { raw: a.sql.raw, join: a.sql.join, empty: a.sql.empty },
    ),
  };
});
vi.mock("../../../db/connection", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: async () => [] }) }), // the recipients: the owner only
    selectDistinct: () => ({ from: () => ({ where: async (p: (r: any) => boolean) => kho.filter(p).map((r) => ({ userId: r.userId })) }) }),
    insert: () => ({ values: async () => undefined }),
  }),
}));
vi.mock("../../notificationService", () => ({
  sendNotification: async (userId: number, n: { message: string; metadata: Record<string, unknown> }) => {
    kho.push({ userId, message: n.message, metadata: n.metadata, createdAt: new Date() });
    return { id: kho.length };
  },
}));
vi.mock("../../ecosystem/ecosystemEvents", () => ({ publishAnomalyDetected: () => undefined }));

import { CANH_BAO_KHONG_RO_KIND, KHONG_CO_BU_TRU, canhBaoKetCucKhongRo, noiDungCanhBaoKhongRo } from "./foeKetCucKhongRo";
import { __quenBoNhoKhuTrungChoTest } from "../../robot/criticalStopAlert";

const A = "nt_dung_khan_A_bang_tai_01";
const B = "nt_dung_khan_B_bang_tai_01";
const suKien = (loai: string, o: "stepId" | "compId", id: string) =>
  ({ loai, runId: 77, [o]: id, [o === "stepId" ? "compId" : "stepId"]: o === "stepId" ? KHONG_CO_BU_TRU : "buoc_chinh", error: "FOE_OUTCOME_UNKNOWN", lan: "claim1", owner: 10, vi: { nguon: "tuChoi", ma: "ADAPTER_OFFLINE" } }) as never;
/** the 10 cells where the words of two different STOPs are the same by design (ac78abafa, before 3b): the run-level kinds, and the kinds whose compId is always KHONG_CO_BU_TRU */
const TRUNG_CO_Y = ["abortDefUnread/stepId", "abortDefUnread/compId", "abortSweepUnfinished/stepId", "abortSweepUnfinished/compId", "noCompensation/compId", "forwardNotSent/compId", "runEnd/compId", "stopUntakenBranch/compId", "stopEndedUnswept/compId", "edgeStreamStuck/compId"];
const KIND_KHONG_CO_BU_TRU = ["noCompensation", "forwardNotSent", "runEnd", "stopUntakenBranch", "stopEndedUnswept", "edgeStreamStuck"];

beforeEach(() => {
  kho.length = 0;
  __quenBoNhoKhuTrungChoTest();
});

describe("T9 lượt sửa 3e (A1-31) — two different STOPs never print alike, so the inbox dedup never swallows one", () => {
  it("T9F3E-A131-VA-CHAM two STOP ids alike at both ends (the old cut: 'nt_dun…ai_01'): two different words, each naming its own id's hash", () => {
    const a = noiDungCanhBaoKhongRo(suKien("stopNotSent", "stepId", A));
    const b = noiDungCanhBaoKhongRo(suKien("stopNotSent", "stepId", B));
    expect(a.message).not.toBe(b.message);
    const bam = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 6);
    expect(a.message).toContain(`nt_dun…ai_01#${bam(A)}`);
    expect(b.message).toContain(`nt_dun…ai_01#${bam(B)}`);
    // the same id prints the same in every kind that prints it
    for (const loai of Object.keys(CANH_BAO_KHONG_RO_KIND)) {
      const m = noiDungCanhBaoKhongRo(suKien(loai, "stepId", A));
      for (const x of `${m.title} ${m.message}`.matchAll(/nt_dun…ai_01#([0-9a-f]+)/g)) expect(x[1], loai).toBe(bam(A));
    }
    // an id within the ceiling is printed whole, with no hash
    expect(noiDungCanhBaoKhongRo(suKien("stopNotSent", "stepId", "nt_14_ky_tu_ab")).message).toContain('"nt_14_ky_tu_ab"');
  });
  it("T9F3E-A131-46-O every kind × (the id in stepId, then in compId): the words of the two STOPs are the same in exactly the 10 cells by design; elsewhere two URGENT rows, each told stored", async () => {
    const trung: string[] = [];
    for (const loai of Object.keys(CANH_BAO_KHONG_RO_KIND)) {
      for (const o of ["stepId", "compId"] as const) {
        kho.length = 0;
        __quenBoNhoKhuTrungChoTest();
        const ben: boolean[] = [];
        if (noiDungCanhBaoKhongRo(suKien(loai, o, A)).message === noiDungCanhBaoKhongRo(suKien(loai, o, B)).message) trung.push(`${loai}/${o}`);
        for (const id of [A, B]) ben.push(await canhBaoKetCucKhongRo(suKien(loai, o, id) as never));
        expect(ben, `${loai}/${o}`).toEqual([true, true]);
        if (!trung.includes(`${loai}/${o}`)) expect(kho, `${loai}/${o}: two STOPs, two rows`).toHaveLength(2);
      }
    }
    expect(Object.keys(CANH_BAO_KHONG_RO_KIND).length * 2, "the cells").toBe(46);
    expect(trung.sort()).toEqual([...TRUNG_CO_Y].sort());
  });
  it("T9F3E-A131-CUNG-STOP the same STOP told twice: still ONE URGENT row (its key), both told stored", async () => {
    const ben = [await canhBaoKetCucKhongRo(suKien("stopNotSent", "stepId", A) as never), await canhBaoKetCucKhongRo(suKien("stopNotSent", "stepId", A) as never)];
    expect(ben).toEqual([true, true]);
    expect(kho).toHaveLength(1);
  });
  it("T9F3E-A131-KHONG-CO-BU-TRU the 6 kinds whose words do not name the compensation: every writer gives them compId KHONG_CO_BU_TRU (so two of them never differ only by it)", () => {
    const goc = path.resolve(__dirname, "../../..");
    const tep: string[] = [];
    const di = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) di(p);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) tep.push(p);
      }
    };
    di(goc);
    const dem: Record<string, number> = {};
    for (const p of tep) {
      const s = fs.readFileSync(p, "utf8");
      for (const k of KIND_KHONG_CO_BU_TRU) {
        for (const m of s.matchAll(new RegExp(`loai: "${k}"`, "g"))) {
          dem[k] = (dem[k] ?? 0) + 1;
          const vat = s.slice(m.index!, s.indexOf("}", m.index!));
          expect(vat, `${path.relative(goc, p)}: ${k}`).toMatch(/compId: KHONG_CO_BU_TRU\b/);
        }
      }
    }
    for (const k of KIND_KHONG_CO_BU_TRU) expect(dem[k] ?? 0, `${k}: a writer exists`).toBeGreaterThan(0);
  });
});
