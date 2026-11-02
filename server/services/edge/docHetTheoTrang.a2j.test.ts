/**
 * SCADA R1b-2b-2a A2(j) — docHetTheoTrang (read a STOP / abort list to the end on an ascending keyset cursor) and chonTrongGioiHanGiaoThuc (fit a v2
 * pull list into the protocol limit without a silent drop). Pure: the reader is fed by an in-memory "table" that honours `id > cursor ORDER BY id
 * LIMIT n` exactly. The SQL of each real list is measured on the `_test` DB (edgeListDocHet.a2j.db.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../robot/criticalStopAlert", () => ({ raiseCriticalStopAlert: vi.fn(async () => undefined) }));
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => ({ execute: async () => [{ id: 7 }, { id: 8 }] })) }));

import {
  docHetTheoTrang,
  baoDocCatBot,
  chonTrongGioiHanGiaoThuc,
  chonClaimsChoTraLoi,
  chonStopsChoTraLoi,
  giuTrongGioiHanTraLoi,
  CO_TRANG_DOC_HET,
  SO_TRANG_DOC_HET_TOI_DA,
  _quenBaoDocCatBotChoTest,
  __resetStopsUnconfirmedRotationForTests,
} from "./docHetTheoTrang";
import { raiseCriticalStopAlert } from "../robot/criticalStopAlert";
import { EDGE_PULL_CLAIMS_MAX, EDGE_PULL_STOPS_UNCONFIRMED_MAX, edgePullAnswerSchema } from "./edgeProtocol";

const alertMock = raiseCriticalStopAlert as unknown as ReturnType<typeof vi.fn>;

/** an in-memory table with a keyset page reader; `onPage` may mutate the table between pages */
function bang(ids: number[], onPage?: (trang: number, t: number[]) => void) {
  const t = [...ids];
  let trang = 0;
  const calls: Array<{ sau: number | null; n: number }> = [];
  const docTrang = async (sau: number | null, n: number) => {
    calls.push({ sau, n });
    onPage?.(trang++, t);
    return t
      .filter((x) => sau === null || x > sau)
      .sort((a, b) => a - b)
      .slice(0, n)
      .map((id) => ({ id }));
  };
  return { docTrang, calls, t };
}

beforeEach(() => {
  alertMock.mockClear();
  _quenBaoDocCatBotChoTest();
  __resetStopsUnconfirmedRotationForTests();
});

describe("A2(j) docHetTheoTrang — every row, keyset cursor, bounded", () => {
  it("defaults: 200 rows per page, 1000 pages", () => {
    expect(CO_TRANG_DOC_HET).toBe(200);
    expect(SO_TRANG_DOC_HET_TOI_DA).toBe(1000);
  });

  it("201 rows (one more than the old LIMIT 200) ⇒ all 201, the newest included; pages ask id > last id", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => 1000 + i * 3);
    const b = bang(ids);
    const r = await docHetTheoTrang(b.docTrang, (x) => x.id);
    expect(r.catBot).toBe(false);
    expect(r.hang.map((x) => x.id)).toEqual(ids);
    expect(b.calls).toEqual([
      { sau: null, n: 200 },
      { sau: ids[199], n: 200 },
    ]);
  });

  it("exactly a full page (200) ⇒ one more (empty) page is read, nothing cut", async () => {
    const b = bang(Array.from({ length: 200 }, (_, i) => i + 1));
    const r = await docHetTheoTrang(b.docTrang, (x) => x.id);
    expect(r).toMatchObject({ catBot: false });
    expect(r.hang).toHaveLength(200);
    expect(b.calls).toHaveLength(2);
  });

  it("rows inserted WHILE reading: a higher id is picked up, a lower one is left to the next pass; nothing is read twice", async () => {
    const b = bang([1, 2, 3, 4, 5], (trang, t) => {
      if (trang === 1) t.push(0, 99); // inserted between pages
    });
    const r = await docHetTheoTrang(b.docTrang, (x) => x.id, { coTrang: 2 });
    expect(r.hang.map((x) => x.id)).toEqual([1, 2, 3, 4, 5, 99]);
    expect(new Set(r.hang.map((x) => x.id)).size).toBe(r.hang.length);
  });

  it("page budget spent with rows left ⇒ catBot true AND every row read is returned; budget spent exactly at the end ⇒ catBot false", async () => {
    const b = bang(Array.from({ length: 7 }, (_, i) => i + 1));
    const r = await docHetTheoTrang(b.docTrang, (x) => x.id, { coTrang: 2, soTrangToiDa: 3 });
    expect(r.catBot).toBe(true);
    expect(r.hang.map((x) => x.id)).toEqual([1, 2, 3, 4, 5, 6]);
    const b2 = bang(Array.from({ length: 6 }, (_, i) => i + 1));
    const r2 = await docHetTheoTrang(b2.docTrang, (x) => x.id, { coTrang: 2, soTrangToiDa: 3 });
    expect(r2).toMatchObject({ catBot: false });
    expect(r2.hang).toHaveLength(6);
  });

  it("a page whose key does not increase (a broken query) ⇒ throws instead of looping forever; an over-long page ⇒ throws", async () => {
    await expect(docHetTheoTrang(async () => [{ id: 1 }, { id: 1 }], (x) => x.id, { coTrang: 2 })).rejects.toThrow(/did not increase/);
    await expect(docHetTheoTrang(async () => [{ id: 1 }, { id: 2 }, { id: 3 }], (x) => x.id, { coTrang: 2 })).rejects.toThrow(/> 2/);
  });
});

describe("A2(j) baoDocCatBot — one alert per key to the active admins", () => {
  it("same key twice ⇒ ONE alert (durable 24 h dedup flag set); another key ⇒ its own", async () => {
    // warm the lazy imports first (the first dynamic import of drizzle-orm can take > 0.5 s — a second, un-deduped alert would land after the check)
    baoDocCatBot({ kind: "k", title: "t", message: "m", dedupKey: "warm-up" });
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    alertMock.mockClear();
    baoDocCatBot({ kind: "k", title: "t", message: "m", dedupKey: "edge_claims_list_cut:5" });
    baoDocCatBot({ kind: "k", title: "t", message: "m", dedupKey: "edge_claims_list_cut:5" });
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 300)); // let a second (deduped) alert land if it was going to
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0]![0]).toMatchObject({ recipients: [7, 8], dedupKey: "edge_claims_list_cut:5", khuTrungBenVung: {} });
    baoDocCatBot({ kind: "k", title: "t", message: "m", dedupKey: "edge_claims_list_cut:6" });
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalledTimes(2));
  });
});

describe("A2(j) chonTrongGioiHanGiaoThuc — never a silent drop of an abort / a STOP", () => {
  it("within the limit ⇒ unchanged, vuot false", () => {
    expect(chonTrongGioiHanGiaoThuc([1, 2, 3], 3)).toEqual({ chon: [1, 2, 3], vuot: false });
  });

  it("claims over the limit ⇒ every abort-carrying claim first (even the last ones), vuot true", () => {
    const list = Array.from({ length: 250 }, (_, i) => ({ runId: i + 1, abortRequested: i >= 240 }));
    const r = chonTrongGioiHanGiaoThuc(list, 200, { uuTien: (c) => c.abortRequested });
    expect(r.vuot).toBe(true);
    expect(r.chon).toHaveLength(200);
    expect(r.chon.slice(0, 10).map((c) => c.runId)).toEqual([241, 242, 243, 244, 245, 246, 247, 248, 249, 250]);
  });

  it("unconfirmed STOPs over the limit ⇒ a rotating window per node: 51 runs, limit 50 ⇒ two pulls cover all 51; another node rotates on its own", () => {
    const list = Array.from({ length: 51 }, (_, i) => i + 1);
    const a = chonTrongGioiHanGiaoThuc(list, 50, { xoay: 9 });
    const b = chonTrongGioiHanGiaoThuc(list, 50, { xoay: 9 });
    expect(a.vuot && b.vuot).toBe(true);
    expect(a.chon).toHaveLength(50);
    expect(new Set([...a.chon, ...b.chon]).size).toBe(51);
    expect(a.chon).not.toContain(51);
    expect(b.chon).toContain(51);
    expect(chonTrongGioiHanGiaoThuc(list, 50, { xoay: 10 }).chon).toEqual(a.chon);
  });
});

// ── AMENDMENT 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const NODE = { nodeId: 77, nodeCode: "N77" };
const claim = (runId: number, abortRequested: boolean) => ({ runId, claimSeq: 1, status: "running" as const, abortRequested, stale: false });
/** pull until every item of `all` was delivered at least once; returns the number of pulls (bounded) */
function pullsToDeliverAll<T>(all: T[], pull: () => T[], key: (x: T) => unknown, maxPulls = 50): { pulls: number; seen: Set<unknown>; maxPerPull: number } {
  const seen = new Set<unknown>();
  let pulls = 0;
  let maxPerPull = 0;
  while (seen.size < all.length && pulls < maxPulls) {
    const got = pull();
    maxPerPull = Math.max(maxPerPull, got.length);
    for (const x of got) seen.add(key(x));
    pulls++;
  }
  return { pulls, seen, maxPerPull };
}

describe("A2(j) AMENDMENT 1 — rotation delivers EVERYTHING across pulls, never over the limit", () => {
  it("the schema limits are 200 claims / 50 unconfirmed STOPs (named constants = the schema)", () => {
    expect(EDGE_PULL_CLAIMS_MAX).toBe(200);
    expect(EDGE_PULL_STOPS_UNCONFIRMED_MAX).toBe(50);
    expect(edgePullAnswerSchema.shape.claims.safeParse(Array.from({ length: 201 }, (_, i) => claim(i + 1, false))).success).toBe(false);
    expect(edgePullAnswerSchema.shape.claims.safeParse(Array.from({ length: 200 }, (_, i) => claim(i + 1, false))).success).toBe(true);
  });

  it("★ 51 unconfirmed STOPs ⇒ every STOP reaches the node within 2 pulls; 120 ⇒ within 3; never more than 50 per answer", () => {
    for (const [n, k] of [[51, 2], [120, 3]] as const) {
      __resetStopsUnconfirmedRotationForTests();
      const stops = Array.from({ length: n }, (_, i) => ({ runId: 1000 + i }));
      const r = pullsToDeliverAll(stops, () => chonStopsChoTraLoi(NODE, stops).chon, (s) => s.runId);
      expect(r.seen.size, `n=${n}`).toBe(n);
      expect(r.pulls, `n=${n}`).toBe(k);
      expect(r.maxPerPull).toBe(50);
    }
  });

  it("★ 230 abort-carrying claims (+30 plain) ⇒ every abort signal reaches the node within 2 pulls; each answer is 200 aborts, aborts only", () => {
    const list = [...Array.from({ length: 30 }, (_, i) => claim(i + 1, false)), ...Array.from({ length: 230 }, (_, i) => claim(500 + i, true))];
    const aborts = list.filter((c) => c.abortRequested);
    const r = pullsToDeliverAll(
      aborts,
      () => {
        const got = chonClaimsChoTraLoi(NODE, list).chon;
        expect(got.length).toBe(200);
        expect(got.every((c) => c.abortRequested)).toBe(true);
        return got;
      },
      (c) => c.runId,
    );
    expect(r.seen.size).toBe(230);
    expect(r.pulls).toBe(2);
  });

  it("★ 150 abort claims + 100 plain ⇒ EVERY answer carries all 150 aborts FIRST, then a rotating 50 of the rest (all plain ones within 2 pulls)", () => {
    const list = [...Array.from({ length: 100 }, (_, i) => claim(i + 1, false)), ...Array.from({ length: 150 }, (_, i) => claim(500 + i, true))];
    const plain = new Set<number>();
    for (let p = 0; p < 2; p++) {
      const got = chonClaimsChoTraLoi(NODE, list).chon;
      expect(got.length).toBe(200);
      expect(got.slice(0, 150).every((c) => c.abortRequested)).toBe(true);
      expect(got.slice(150).every((c) => !c.abortRequested)).toBe(true);
      for (const c of got.slice(150)) plain.add(c.runId);
    }
    expect(plain.size).toBe(100);
  });

  it("★ overflow ⇒ ONE URGENT alert per (node, list) with dedup across pulls; within the limit ⇒ none", async () => {
    // warm the lazy imports of the alert path (see the baoDocCatBot test)
    // (and let the alerts of the earlier rotation tests — fire-and-forget — land before counting)
    chonStopsChoTraLoi({ nodeId: 1, nodeCode: "warm" }, Array.from({ length: 51 }, (_, i) => i));
    await vi.waitFor(() => expect(alertMock.mock.calls.some((c) => (c[0] as { dedupKey: string }).dedupKey === "edge_pull_overflow:stops:1")).toBe(true), { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 500));
    alertMock.mockClear();
    _quenBaoDocCatBotChoTest();
    chonClaimsChoTraLoi(NODE, Array.from({ length: 10 }, (_, i) => claim(i + 1, true)));
    chonStopsChoTraLoi(NODE, Array.from({ length: 50 }, (_, i) => i));
    await new Promise((r) => setTimeout(r, 300));
    expect(alertMock).not.toHaveBeenCalled();
    const big = Array.from({ length: 201 }, (_, i) => claim(i + 1, true));
    chonClaimsChoTraLoi(NODE, big);
    chonClaimsChoTraLoi(NODE, big);
    chonStopsChoTraLoi(NODE, Array.from({ length: 51 }, (_, i) => i));
    await vi.waitFor(() => expect(alertMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 300));
    expect(alertMock).toHaveBeenCalledTimes(2);
    const calls = alertMock.mock.calls.map((c) => c[0] as { dedupKey: string; kind: string; khuTrungBenVung?: unknown });
    expect(calls.map((a) => a.dedupKey).sort()).toEqual(["edge_pull_overflow:claims:77", "edge_pull_overflow:stops:77"]);
    expect(calls.every((a) => a.kind === "edge_pull_overflow" && a.khuTrungBenVung !== undefined)).toBe(true);
  });
});

describe("A2(j) AMENDMENT 1 — the assertion where the v2 answer is built", () => {
  const base = { node: "N77", protocolVersion: 2, configVersion: 1, keysetVersion: 1, programCheckRequested: false, commands: [] as unknown[] };

  it("★ over the limits (250 claims, aborts LAST; 60 STOPs) ⇒ cut to 200 / 50, aborts first, runStateUnavailable, schema-valid lists, alert", async () => {
    const claims = [...Array.from({ length: 240 }, (_, i) => claim(i + 1, false)), ...Array.from({ length: 10 }, (_, i) => claim(900 + i, true))];
    const stopsUnconfirmed = Array.from({ length: 60 }, (_, i) => ({ runId: 2000 + i }));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = giuTrongGioiHanTraLoi(NODE, { ...base, claims, stopsUnconfirmed, runs: [] as unknown[] });
    err.mockRestore();
    expect(out.claims).toHaveLength(200);
    expect(out.stopsUnconfirmed).toHaveLength(50);
    expect(out.claims.slice(0, 10).every((c) => c.abortRequested)).toBe(true);
    expect(out.runStateUnavailable).toBe(true);
    expect(edgePullAnswerSchema.shape.claims.safeParse(out.claims).success).toBe(true);
    await vi.waitFor(() => expect(alertMock.mock.calls.some((c) => (c[0] as { dedupKey: string }).dedupKey === "edge_pull_overflow:assert:77")).toBe(true), { timeout: 10_000 });
  });

  it("★ order inside the answer: the signed commands (STOPs) first, then stopsUnconfirmed, then claims (aborts first), then runs", () => {
    const out = giuTrongGioiHanTraLoi(NODE, { ...base, runs: [{ runId: 1 }], claims: [claim(1, false), claim(2, true)], stopsUnconfirmed: [{ runId: 3 }] });
    const keys = Object.keys(out);
    expect(keys.indexOf("commands")).toBeLessThan(keys.indexOf("stopsUnconfirmed"));
    expect(keys.indexOf("stopsUnconfirmed")).toBeLessThan(keys.indexOf("claims"));
    expect(keys.indexOf("claims")).toBeLessThan(keys.indexOf("runs"));
    expect(out.claims.map((c) => c.runId)).toEqual([2, 1]);
  });

  it("within the limits ⇒ nothing cut, no runStateUnavailable added; an existing one kept", () => {
    const claims = [claim(1, true), claim(2, false), claim(3, true)];
    const out = giuTrongGioiHanTraLoi(NODE, { ...base, claims, stopsUnconfirmed: [], runs: [] });
    expect(out.claims.map((c) => c.runId)).toEqual([1, 3, 2]);
    expect("runStateUnavailable" in out).toBe(false);
    expect(giuTrongGioiHanTraLoi(NODE, { ...base, claims, stopsUnconfirmed: [], runs: [], runStateUnavailable: true as const }).runStateUnavailable).toBe(true);
  });
});

// ── Polish round: rotation under churn (key cursor) ──────────────────────────────────────────────────────────────────────────────────────
describe("A2(j) polish — rotation bound under churn (one confirmed + one new STOP per pull)", () => {
  it("★ 51 STOPs, limit 50, each pull the oldest delivered STOP is confirmed (leaves) and one new arrives ⇒ every STOP delivered within 3 pulls of appearing (60 pulls)", () => {
    __resetStopsUnconfirmedRotationForTests();
    const node = { nodeId: 4242, nodeCode: "N4242" };
    let list = Array.from({ length: 51 }, (_, i) => ({ runId: i + 1 }));
    const appeared = new Map<number, number>(list.map((s) => [s.runId, 0]));
    const firstSent = new Map<number, number>();
    let next = 1000;
    for (let pull = 0; pull < 60; pull++) {
      const got = chonStopsChoTraLoi(node, list).chon;
      expect(got.length).toBeLessThanOrEqual(50);
      for (const s of got) if (!firstSent.has(s.runId)) firstSent.set(s.runId, pull);
      // churn: the OLDEST STOP this pull sent (lowest run id) is confirmed by the node and leaves; a new one is aborted and arrives (highest id).
      // (This is the reviewer's case: with a position window the item just before the start shifts down exactly as fast as the start ⇒ starved.)
      const confirmed = Math.min(...got.map((s) => s.runId));
      list = list.filter((s) => s.runId !== confirmed);
      const fresh = next++;
      list.push({ runId: fresh });
      appeared.set(fresh, pull + 1);
    }
    const late: string[] = [];
    for (const [id, at] of appeared) {
      if (at > 57) continue; // not present for 3 pulls inside the run
      const sent = firstSent.get(id);
      if (sent === undefined || sent - at > 2) late.push(`#${id} appeared pull ${at}, first sent ${sent ?? "never"}`);
    }
    expect(late, late.slice(0, 5).join("; ")).toEqual([]);
  });

  it("the cursor follows the KEY: a window starts right after the last run id sent, wrapping past the highest", () => {
    __resetStopsUnconfirmedRotationForTests();
    const node = { nodeId: 4243, nodeCode: "N4243" };
    const list = [30, 10, 50, 20, 40].map((runId) => ({ runId })); // unordered on purpose
    const w = (l: Array<{ runId: number }>) => chonTrongGioiHanGiaoThuc(l, 2, { xoay: `${node.nodeId}:t` }).chon.map((s) => s.runId);
    expect(w(list)).toEqual([10, 20]);
    expect(w(list)).toEqual([30, 40]);
    expect(w(list.filter((s) => s.runId !== 30))).toEqual([50, 10]); // wraps; a removed item does not shift the others
    expect(w(list)).toEqual([20, 30]);
  });
});
