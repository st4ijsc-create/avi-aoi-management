/**
 * X-EDGE-ABORT-TUOI — the words of the start of the R-6-d window (foeKetCucKhongRo.mocChu), pure:
 *   • L1-a: a run with NO rejection claim keeps its words byte for byte (the flags absent ≡ false; the old start MOC_CUA_SO, never the long one);
 *   • L1-b: a run with a rejection claim gets the long start; past its window the STOP left to the node says the node may NOT send it (conditional);
 *   • the three places kiem-dinh found able to take the flag (HST 28/11, bản 3 A: the flag goes in, no named limit): the URGENT of a run that ended
 *     with no sweep (chuKetThucKhongQuet), the words of an unread definition (chuKhongDocDinhNghia / chuBamSauKhongDoc), the walker's own call
 *     (foeEngine: baoStopChuaRaAbort with the run's context) — a run with the claim ⇒ the long start; any other run ⇒ the old bytes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { KHONG_CO_BU_TRU, MOC_CUA_SO, chuBamSauKhongDoc, chuKhongDocDinhNghia, noiDungCanhBaoKhongRo } from "./foeKetCucKhongRo";

const DAI = "when the run was aborted, or when it was first rejected if it was"; // hàng X-EDGE-ABORT-TUOI, chép tay
const CU = "when the run was aborted"; // the words before this lot, chép tay
const choNut = (x: Record<string, unknown> = {}) =>
  noiDungCanhBaoKhongRo({ loai: "abortStopNotSent", runId: 7, stepId: "s9", compId: KHONG_CO_BU_TRU, error: "FOE_STOP_NOT_SENT", lan: "nut", biet: true, vi: { nguon: "doc", ma: "NOT_CONFIRMED" }, chuAbort: "choNut", adapterNut: true, tuTrungTam: true, ...x } as never);
const ketThuc = (x: Record<string, unknown> = {}) =>
  noiDungCanhBaoKhongRo({ loai: "stopEndedUnswept", runId: 9, stepId: "s3", compId: KHONG_CO_BU_TRU, error: "FOE_STOP_NOT_SENT", lan: "ket", ketThuc: "aborted", ...x } as never);
const khongDoc = (x: Record<string, unknown> = {}) =>
  noiDungCanhBaoKhongRo({ loai: "abortDefUnread", runId: 11, stepId: "?", compId: KHONG_CO_BU_TRU, error: "FOE_STOP_NOT_SENT", lan: "chot", ...x } as never);

describe("X-EDGE-ABORT-TUOI — the words of the window's start", () => {
  it("★ CHU-L1-A — a run with no rejection claim: the same bytes with the flags absent or false; the old start, never the long one (control)", () => {
    const a = choNut();
    expect([a.title, a.message], "CHU-L1-A: false ≡ absent").toEqual([choNut({ coKhoaTuChoi: false, nutKhongGui: false }).title, choNut({ coKhoaTuChoi: false, nutKhongGui: false }).message]);
    expect(MOC_CUA_SO, "CHU-L1-A: the old start").toBe(CU);
    expect(a.message, "CHU-L1-A: the old window clause").toContain(`if it reaches central within 15 minutes from ${CU}. The run's steps show it confirmed`);
    expect(a.message.includes("first rejected"), "CHU-L1-A: no long start").toBe(false);
    expect(a.title.endsWith("left to the edge node, NOT confirmed"), "CHU-L1-A: the title").toBe(true);
  });

  it("★ CHU-L1-B — a run with a rejection claim: the long start in the same clause; nothing else of the words changes", () => {
    const a = choNut();
    const b = choNut({ coKhoaTuChoi: true });
    expect(b.message, "CHU-L1-B: the long clause").toContain(`if it reaches central within 15 minutes from ${DAI}. The run's steps show it confirmed`);
    expect(b.message.replace(DAI, CU), "CHU-L1-B: only the start differs").toBe(a.message);
    expect(b.title, "CHU-L1-B: the title").toBe(a.title);
  });

  it("★ CHU-L1-C — that run past its window: the STOP left to the node says the node may NOT send it (conditional, no promise either way), with the long start", () => {
    const c = choNut({ coKhoaTuChoi: true, nutKhongGui: true });
    expect(c.title.endsWith("left to the edge node, which may NOT send it"), "CHU-L1-C: the title").toBe(true);
    expect(c.message, "CHU-L1-C: the body").toContain(
      `The edge node may NOT send it either: more than 15 minutes have passed from ${DAI}, so a node that is told the age of the abort runs no STOP sweep for it (the run's own steps may still send it), while an older node may still send it; nothing here confirms either way. Check the machine on site now and use the machine's direct STOP / E-STOP.`,
    );
    expect(/The node sends it|if it reaches central within/.test(c.message), "CHU-L1-C: no road promised").toBe(false);
  });
});

describe("X-EDGE-ABORT-TUOI — the three places that now take the flag (bản 3 A)", () => {
  it("★ CHU-CO-1 — the URGENT of a run that ended aborted with no sweep: the claim ⇒ the long start; a plain run ⇒ the old clause, byte for byte", () => {
    const a = ketThuc();
    const b = ketThuc({ coKhoaTuChoi: true });
    expect(a.message, "CHU-CO-1: plain").toContain(`A press of Abort within 15 minutes of ${CU} may send it, but may not reach it: none is promised.`);
    expect(a.message.includes("first rejected"), "CHU-CO-1: plain, no long start").toBe(false);
    expect(b.message, "CHU-CO-1: the claim").toContain(`A press of Abort within 15 minutes of ${DAI} may send it, but may not reach it: none is promised.`);
    expect([b.title, b.message.replace(DAI, CU)], "CHU-CO-1: only the start differs").toEqual([a.title, a.message]);
  });

  it("★ CHU-CO-2 — the words of an unread definition (chuBamSauKhongDoc / chuKhongDocDinhNghia, and its URGENT abortDefUnread): the claim ⇒ the long start; absent ≡ false ⇒ the old bytes", () => {
    expect(chuBamSauKhongDoc(), "CHU-CO-2: absent ≡ false").toBe(chuBamSauKhongDoc(false));
    expect(chuBamSauKhongDoc(), "CHU-CO-2: the old clause").toBe(`A further press of Abort may send it but may not reach it, and none can be counted on after 15 minutes from ${CU}`);
    expect(chuBamSauKhongDoc(true), "CHU-CO-2: the long clause").toBe(`A further press of Abort may send it but may not reach it, and none can be counted on after 15 minutes from ${DAI}`);
    expect(chuKhongDocDinhNghia(7, true).endsWith(` ${chuBamSauKhongDoc(true)}.`), "CHU-CO-2: the unread definition, the claim").toBe(true);
    expect(chuKhongDocDinhNghia(7), "CHU-CO-2: the unread definition, plain").toBe(chuKhongDocDinhNghia(7, false));
    expect(khongDoc({ coKhoaTuChoi: true }).message, "CHU-CO-2: its URGENT, the claim").toContain(chuBamSauKhongDoc(true));
    expect(khongDoc().message, "CHU-CO-2: its URGENT, plain").toContain(chuBamSauKhongDoc(false));
  });

  it("★ CHU-CO-3 — the walker's own call (census of foeEngine.ts): ONE call of baoStopChuaRaAbort with rc.runId, and it passes the flag built from the run's context", () => {
    const src = readFileSync(path.join(__dirname, "foeEngine.ts"), "utf8").replace(/\r\n/g, "\n");
    const goi = [...src.matchAll(/baoStopChuaRaAbort\(rc\.runId,[^\n]*/g)].map((m) => m[0]);
    expect(goi, "CHU-CO-3: the walker's call").toEqual(['baoStopChuaRaAbort(rc.runId, ds.map((x) => ({ id: x.id, vi: x.vi, chu: chuStopAbort(chuCua(x), x.ben || ctxBen) })), rc.runOwner, false, "chot", chuRc);']);
    expect(src, "CHU-CO-3: the flag from the run's context").toContain("const coKhoaRc = mocTuChoiMs({ contextJson: rc.context }) !== null;");
    expect(src, "CHU-CO-3: past its window ⇒ the node will NOT send").toContain('const chuRc = { mocTuChoi: coKhoaRc, nutKhongGui: coKhoaRc && !trongCuaAbort({ status: "aborted", finishedAt: null, contextJson: rc.context }) };');
  });
});
