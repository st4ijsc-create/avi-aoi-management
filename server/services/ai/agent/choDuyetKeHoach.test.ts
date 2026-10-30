/** Đợt 11.3-C — móc chờ duyệt kế hoạch của host: FAIL-CLOSED, chỉ nhận "duyệt" khi sổ nói ĐÚNG, trần chờ, huỷ. */
import { describe, expect, it } from "vitest";
import { bamKeHoach } from "@shared/agentCore";
import { baoKeHoachDaQuyet, taoChoDuyetKeHoach, type PhuThuocChoDuyet } from "./choDuyetKeHoach";
import type { HangKeHoach } from "../../../db/aiAgentKeHoach";

const VIEC = [{ noiDung: "a", trangThai: "cho" as const }];
const BAM = bamKeHoach(VIEC);
const U = 7;
const R = "11111111-1111-4111-8111-111111111111";

interface Gia {
  nopTra?: { bam: string; viec: typeof VIEC } | null;
  /** chuỗi trả của `doc` lần lượt (lần cuối lặp lại) */
  doc: Array<HangKeHoach | null>;
  tranMs?: number;
}
function dung(g: Gia) {
  let t = 0;
  let i = 0;
  const nhat = { nop: 0, chot: [] as string[], ngu: 0 };
  const dep: Partial<PhuThuocChoDuyet> = {
    nop: async () => {
      nhat.nop++;
      return g.nopTra === undefined ? { bam: BAM, viec: VIEC } : g.nopTra;
    },
    doc: async () => {
      if (i > 200) throw new Error("vòng chờ không dừng (mất kiểm hạn?)"); // lỗi ra ĐỎ sạch thay vì treo
      return g.doc[Math.min(i++, g.doc.length - 1)] ?? null;
    },
    chot: async (_u, _r, _b, thanh) => {
      nhat.chot.push(thanh);
      return true;
    },
    now: () => t,
    ngu: async (ms) => {
      nhat.ngu++;
      t += ms;
    },
    tranMs: g.tranMs ?? 5_000,
    nhipMs: 1_000,
  };
  const moc = taoChoDuyetKeHoach({ userId: U, runId: R }, dep);
  let sanSang = 0;
  const chay = (signal = new AbortController().signal) => moc({ bam: BAM, viec: VIEC.map((v) => ({ ...v })), signal, daSanSang: () => sanSang++ });
  return { chay, nhat, sanSang: () => sanSang };
}
const hang = (o: Partial<HangKeHoach> = {}): HangKeHoach => ({
  bam: BAM,
  viec: VIEC,
  trangThai: "cho",
  nopLuc: new Date(0),
  duyetLuc: null,
  duyetBoi: null,
  ...o,
});
const DUYET = (o: Partial<HangKeHoach> = {}) => hang({ trangThai: "duyet", duyetLuc: new Date("2026-10-31T01:00:00.000Z"), duyetBoi: U, ...o });

describe("taoChoDuyetKeHoach", () => {
  it("★★★ duyệt hợp lệ (băm khớp, có giờ, đúng chủ) ⇒ duyet + luc ISO; báo sẵn sàng SAU khi nộp sổ", async () => {
    const d = dung({ doc: [hang(), DUYET()] });
    expect(await d.chay()).toEqual({ ketQua: "duyet", luc: "2026-10-31T01:00:00.000Z" });
    expect(d.nhat.nop).toBe(1);
    expect(d.sanSang()).toBe(1);
  });
  it("★★★ không nộp được sổ ⇒ BÁC, không báo sẵn sàng, không chờ", async () => {
    const d = dung({ nopTra: null, doc: [DUYET()] });
    expect(await d.chay()).toEqual({ ketQua: "bac" });
    expect(d.sanSang()).toBe(0);
    expect(d.nhat.ngu).toBe(0);
  });
  it("★★★ băm máy chủ tính lại ≠ băm lõi ⇒ BÁC (hai bên không cùng hàm/đầu vào)", async () => {
    const d = dung({ nopTra: { bam: "f".repeat(64), viec: VIEC }, doc: [DUYET()] });
    expect(await d.chay()).toEqual({ ketQua: "bac" });
    expect(d.sanSang()).toBe(0);
  });
  it("★★★ 'duyet' nhưng THIẾU giờ duyệt ⇒ BÁC (không tin)", async () => {
    const d = dung({ doc: [hang({ trangThai: "duyet", duyetLuc: null, duyetBoi: U })] });
    expect(await d.chay()).toEqual({ ketQua: "bac" });
  });
  it("★★★ 'duyet' nhưng người duyệt KHÔNG phải chủ lượt (hoặc NULL) ⇒ BÁC", async () => {
    expect(await dung({ doc: [DUYET({ duyetBoi: U + 1 })] }).chay()).toEqual({ ketQua: "bac" });
    expect(await dung({ doc: [DUYET({ duyetBoi: null })] }).chay()).toEqual({ ketQua: "bac" });
  });
  it("★★★ băm trong sổ khác băm đã nộp (kế hoạch bị thay) ⇒ BÁC kể cả khi trạng thái 'duyet'", async () => {
    expect(await dung({ doc: [DUYET({ bam: "e".repeat(64) })] }).chay()).toEqual({ ketQua: "bac" });
  });
  it("bác / hết-giờ trong sổ ⇒ trả đúng", async () => {
    expect(await dung({ doc: [hang({ trangThai: "bac" })] }).chay()).toEqual({ ketQua: "bac" });
    expect(await dung({ doc: [hang({ trangThai: "het-gio" })] }).chay()).toEqual({ ketQua: "het-gio" });
  });
  it("★★★ đọc sổ lỗi (null) KHÔNG phải duyệt: chờ tiếp, hết trần ⇒ het-gio và chốt sổ", async () => {
    const d = dung({ doc: [null], tranMs: 3_000 });
    expect(await d.chay()).toEqual({ ketQua: "het-gio" });
    expect(d.nhat.chot).toEqual(["het-gio"]);
    expect(d.nhat.ngu).toBeGreaterThanOrEqual(3);
  });
  it("hết trần mà người VỪA duyệt sát hạn (đọc lại sau chốt) ⇒ duyet, không het-gio", async () => {
    // lần 1: cho; lần 2 (sau hạn): vẫn cho → hết giờ; lần cuối đọc lại: đã duyệt
    const d = dung({ doc: [hang(), hang(), hang(), DUYET()], tranMs: 2_000 });
    const kq = await d.chay();
    expect(kq.ketQua).toBe("duyet");
  });
  it("hết trần mà sổ đã BÁC ngay sát hạn (đọc lại sau chốt) ⇒ bac, không het-gio", async () => {
    const d = dung({ doc: [hang(), hang(), hang(), hang({ trangThai: "bac" })], tranMs: 2_000 });
    expect((await d.chay()).ketQua).toBe("bac");
  });
  it("★★★ huỷ (signal) ⇒ bac và chốt sổ 'bac' CÓ ĐIỀU KIỆN", async () => {
    const ac = new AbortController();
    const d = dung({ doc: [hang()] });
    const p = d.chay(ac.signal);
    ac.abort();
    expect(await p).toEqual({ ketQua: "bac" });
    expect(d.nhat.chot).toEqual(["bac"]);
  });
  it("signal đã abort từ trước ⇒ vẫn nộp rồi bác ngay (không treo)", async () => {
    const ac = new AbortController();
    ac.abort();
    const d = dung({ doc: [hang()] });
    expect(await d.chay(ac.signal)).toEqual({ ketQua: "bac" });
  });
  it("baoKeHoachDaQuyet không có ai chờ ⇒ không ném", () => {
    expect(() => baoKeHoachDaQuyet("khong-ai-cho")).not.toThrow();
  });
});
