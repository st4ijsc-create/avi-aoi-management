/**
 * X-EDGE-ABORT-TUOI — central's URGENT for an edge node that did NOT sweep central's abort (EDGE_ABORT_STOPS_WITHHELD; edgeConfigCentral.alertAbortStopsWithheld).
 * Pure: raiseCriticalStopAlert is stubbed (what is measured is what central ASKS it to raise: kind, entity, dedup key, message); the durable dedup against
 * real notification rows is edgeAbortTuoi.a2n.db.test (C c). Covers HST's cases: (d) stops = 0 ⇒ nothing; (e) a run not this node's ⇒ nothing; stops "?",
 * k > 0 or an unreadable detail ⇒ ALWAYS raised (H6: no shortcut); (f) two runs ⇒ two keys and two messages; (g) the same run and list ⇒ the same key;
 * (h) / (h') another list ⇒ another key, even when the lists differ only past the 1 000-character cut; the audit's own anomaly "abortStopWithheld" ⇒ never an URGENT.
 * HST 28/11 (K3 of bước 3, giấy MOCK-LOT v3 mục 4): NO vi.mock in this file. K3 measured the ORIGINAL raiseCriticalStopAlert running here (6 lines
 * "[StopAlert]"): alertAbortStopsWithheld raises from several async calls at once, each `await import("../robot/criticalStopAlert")` from the SAME module,
 * and a mocked module asked twice in one microtask turn hands the second asker the original (vitest 2.1.9, variant (a2), measured 5/5 by kiem-dinh).
 * So the stub is vi.spyOn on the ONE real module instance (every importer reads the property at call time; no mockPath, no leak), checked by a
 * positive control (CB-SPY): raiseEdgeConfigAlert, a SECOND function of edgeConfigCentral.ts (:158) with its own dynamic import of the sender (:191),
 * reaches the spy; and every console line is recorded: one "[StopAlert]" line is red (afterAll). The spy is NOT a barrier that holds without mocks:
 * that barrier is the run's environment (every outside channel on a dead port / off).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as canhBaoDung from "../robot/criticalStopAlert";

const raised: Array<Record<string, unknown>> = [];
const NHAT_KY = vi.hoisted(() => {
  const dong: string[] = [];
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    const goc = console[k].bind(console);
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => {
      dong.push(a.map((x) => (typeof x === "string" ? x : x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(" "));
      goc(...a);
    });
  }
  return dong;
});
const dongStopAlert = () => NHAT_KY.filter((l) => l.includes("[StopAlert]"));
beforeAll(() => {
  vi.spyOn(canhBaoDung, "raiseCriticalStopAlert").mockImplementation(async (a) => {
    raised.push(a as unknown as Record<string, unknown>);
  });
});

import { EDGE_ABORT_STOPS_WITHHELD_ANOMALY, alertForEdgeAnomaly, raiseEdgeConfigAlert } from "./edgeConfigCentral";
import { EDGE_ABORT_STOPS_WITHHELD_CODE, chiTietAbortCuKhongQuet } from "./edgeRunStore";
import { bam8DanhSachStop } from "./edgeProtocol";

const NODE = { nodeId: 7, nodeCode: "EDGE-A" };
const ban = async () => [11];
const lap = () => new Promise((r) => setTimeout(r, 50)); // the raise imports criticalStopAlert dynamically (edgeConfigCentral): a few ticks
const detail = (runId: number, stops: readonly string[] | "?", lyDo: "refusedTooOld" | "refusedNoTime" = "refusedTooOld") =>
  chiTietAbortCuKhongQuet({ runId, lyDo, abortAgeMs: lyDo === "refusedTooOld" ? 16 * 60_000 : null, stops });

beforeEach(() => {
  raised.length = 0;
});

describe("X-EDGE-ABORT-TUOI — the URGENT of a withheld sweep (alertForEdgeAnomaly)", () => {
  it("★ CB-MA — the node's code and central's branch are ONE string", () => {
    expect([EDGE_ABORT_STOPS_WITHHELD_ANOMALY, EDGE_ABORT_STOPS_WITHHELD_CODE], "CB-MA").toEqual(["EDGE_ABORT_STOPS_WITHHELD", "EDGE_ABORT_STOPS_WITHHELD"]);
  });

  it("★ CB-NANG — k > 0 ⇒ one raise: kind edge_abort_stops_withheld, entity orchestration_run <runId>, durable dedup, key = run + hash of the FULL list, message with run, node, k, hash and the STOPs", async () => {
    const ds = ["s2@adapter 4", "s1@adapter 3"];
    expect(alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: detail(41, ds), runId: 41 }, ban), "CB-NANG: started").toBe(true);
    await lap();
    expect(raised.length, "CB-NANG: one raise").toBe(1);
    const a = raised[0]!;
    expect([a.kind, a.entityType, a.entityId, a.dedupKey, a.khuTrungBenVung, a.recipients], "CB-NANG: the call").toEqual([
      "edge_abort_stops_withheld",
      "orchestration_run",
      41,
      `abort_stops_withheld:run:41:${bam8DanhSachStop(ds)}`,
      {},
      [11],
    ]);
    // HST 28/11 (bản 3 B, kiem-dinh's sentence, verbatim from "it did NOT run"): the walker's own sequence may still send some of the STOPs listed
    expect(String(a.message), "CB-NANG: the message").toBe(
      `Edge node EDGE-A learnt of central's abort of run 41 more than 15 minutes after central aborted it: it did NOT run the abort's STOP sweep. ` +
        `STOP(s) not sent at the time of this report: 2 (list ${bam8DanhSachStop(ds)}): s1@adapter 3, s2@adapter 4. ` +
        `The walker's own sequence may still send some of them; nothing in this alert confirms either way. Check the machines on site now and use their direct STOP / E-STOP.`,
    );
  });

  it("★ CB-KHONG — (d) stops = 0 ⇒ nothing raised; (e) a run not this node's (runId null) ⇒ nothing raised", async () => {
    expect(alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: detail(41, []), runId: 41 }, ban), "CB-KHONG: k = 0").toBe(false);
    expect(alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: detail(41, ["s1@adapter 3"]), runId: null }, ban), "CB-KHONG: not this node's").toBe(false);
    await lap();
    expect(raised.length, "CB-KHONG: raises").toBe(0);
  });

  it("★ CB-LUON — (j) stops '?' ⇒ raised; an unreadable detail ⇒ raised; refusedNoTime ⇒ raised: never a shortcut by status or window (H6)", async () => {
    expect(alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: detail(42, "?"), runId: 42 }, ban), "CB-LUON: ?").toBe(true);
    expect(alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: "garbage", runId: 43 }, ban), "CB-LUON: unreadable").toBe(true);
    expect(alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: detail(44, ["s1@adapter 3"], "refusedNoTime"), runId: 44 }, ban), "CB-LUON: no time").toBe(true);
    await lap();
    expect(raised.map((a) => a.dedupKey), "CB-LUON: keys").toEqual([`abort_stops_withheld:run:42:${bam8DanhSachStop("?")}`, "abort_stops_withheld:run:43:unread", `abort_stops_withheld:run:44:${bam8DanhSachStop(["s1@adapter 3"])}`]);
  });

  it("★ CB-KHOA — (f) two runs, same node, same list ⇒ two keys, two messages; (g) the same run and list ⇒ the same key; (h) a bigger list ⇒ another key", async () => {
    const ds = ["s1@adapter 3"];
    alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: detail(51, ds), runId: 51 }, ban);
    alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: detail(52, ds), runId: 52 }, ban);
    alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: detail(51, ds), runId: 51 }, ban);
    alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: detail(51, [...ds, "s9@adapter 8"]), runId: 51 }, ban);
    await lap();
    const k = raised.map((a) => String(a.dedupKey));
    expect(new Set([k[0], k[1]]).size, "CB-KHOA: (f) keys").toBe(2);
    expect(raised[0]!.message === raised[1]!.message, "CB-KHOA: (f) messages differ").toBe(false);
    expect(k[2], "CB-KHOA: (g)").toBe(k[0]);
    expect(k[3] === k[0], "CB-KHOA: (h) a bigger list").toBe(false);
  });

  it("★ CB-CAT — (h') two lists that differ only PAST the 1 000-character cut of the detail ⇒ two keys (the hash is over the FULL list, in the head that is never cut)", async () => {
    const chung = Array.from({ length: 80 }, (_, i) => `stop-${String(i).padStart(3, "0")}@adapter ${100 + i}`);
    const a1 = [...chung, "zz-last-a@adapter 1"];
    const a2 = [...chung, "zz-last-b@adapter 2"];
    const d1 = detail(61, a1);
    const d2 = detail(61, a2);
    expect([d1.length, d2.length], "CB-CAT: both cut").toEqual([1_000, 1_000]);
    expect(d1 === d2, "CB-CAT: the cut details differ only in their heads").toBe(false);
    alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: d1, runId: 61 }, ban);
    alertForEdgeAnomaly(NODE, { code: EDGE_ABORT_STOPS_WITHHELD_CODE, detail: d2, runId: 61 }, ban);
    await lap();
    expect(raised.map((a) => a.dedupKey), "CB-CAT: keys").toEqual([`abort_stops_withheld:run:61:${bam8DanhSachStop(a1)}`, `abort_stops_withheld:run:61:${bam8DanhSachStop(a2)}`]);
  });

  it("★ CB-AUDIT — the anomaly of the audit itself (code abortStopWithheld, edgeRunStore.auditAbort) is never an URGENT", async () => {
    expect(alertForEdgeAnomaly(NODE, { code: "abortStopWithheld", detail: '{"tomTat":"stops=2 hash=00000000"}', runId: 41 }, ban), "CB-AUDIT").toBe(false);
    await lap();
    expect(raised.length, "CB-AUDIT: raises").toBe(0);
  });

  it("★ CB-SPY — positive control on a product road (HST 28/11): raiseEdgeConfigAlert (a second function of edgeConfigCentral, its own dynamic import of robot/criticalStopAlert) reaches the SPY once; the spy is the property of the one real instance; no original line", async () => {
    const goi0 = vi.mocked(canhBaoDung.raiseCriticalStopAlert).mock.calls.length;
    expect(raiseEdgeConfigAlert({ kind: "edge_config_unbuildable", dedupKey: `cb-spy:${Date.now()}`, title: "t", message: "m", nodeId: 7 }, ban), "CB-SPY: started").toBe(true);
    await lap();
    expect([vi.isMockFunction(canhBaoDung.raiseCriticalStopAlert), vi.mocked(canhBaoDung.raiseCriticalStopAlert).mock.calls.length - goi0, raised.length, raised[0]?.kind, dongStopAlert()], "CB-SPY").toEqual([
      true,
      1,
      1,
      "edge_config_unbuildable",
      [],
    ]);
  });
});

// HST 28/11 — over the WHOLE file: not one line of the original raiseCriticalStopAlert (its first statement prints "[StopAlert] CRITICAL").
afterAll(() => {
  expect(dongStopAlert(), "CanhBao: original sender lines over the whole file").toEqual([]);
});
