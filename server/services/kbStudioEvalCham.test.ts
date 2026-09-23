/**
 * R1 — lưới cho phần chấm thuần của eval Training Studio (`kbStudioEvalCham.ts`).
 * Canh CÁCH CHẤM, cộng một lưới đọc chính bộ vàng thật trong repo (đề gõ sai phải đỏ ở đây,
 * không phải hiện thành "RAG kém" lúc chạy).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  phanTichBoVang,
  khopNguon,
  kiemDe,
  chamCau,
  tongHop,
  type CauVang,
  type HitTruyHoi,
} from "./kbStudioEvalCham";

const cauT: CauVang = { id: "T1", cauHoi: "NG bao nhiêu thì dừng line?", nguon: ["aoi-thresholds.md"], dapAn: { regex: ">\\s*2\\s*%" } };
const cauN: CauVang = { id: "N1", cauHoi: "Công thức nấu phở?", nguon: [] };
const hitDung: HitTruyHoi = { sourceRef: "aoi-thresholds.md", text: "| Critical | > 2 % | Dừng line |", score: 0.71 };
const hitLac: HitTruyHoi = { sourceRef: "howto-spc-control.md", text: "Cpk ≥ 1.33", score: 0.62 };

describe("phanTichBoVang", () => {
  it("đọc dòng hợp lệ, bỏ dòng trống và //", () => {
    const r = phanTichBoVang(`${JSON.stringify(cauT)}\n\n// ghi chú\n${JSON.stringify(cauN)}\n`);
    expect(r.loi).toEqual([]);
    expect(r.cau.map((c) => c.id)).toEqual(["T1", "N1"]);
  });

  it("kể ra từng dòng lỗi kèm số dòng: JSON hỏng · thiếu trường · id trùng · regex hỏng · ngoài corpus mà có dapAn · trường lạ", () => {
    const r = phanTichBoVang(
      [
        "{không phải json",
        JSON.stringify({ id: "A", nguon: [] }),
        JSON.stringify(cauT),
        JSON.stringify(cauT),
        JSON.stringify({ ...cauT, id: "B", dapAn: { regex: "(" } }),
        JSON.stringify({ id: "C", cauHoi: "hỏi gì đó", nguon: [], dapAn: { regex: "x" } }),
        JSON.stringify({ ...cauT, id: "D", nguonn: ["x"] }),
      ].join("\n"),
    );
    expect(r.cau.map((c) => c.id)).toEqual(["T1"]);
    expect(r.loi.map((l) => l.dong)).toEqual([1, 2, 4, 5, 6, 7]);
    expect(r.loi[2].lyDo).toMatch(/trùng/);
    expect(r.loi[3].lyDo).toMatch(/regex/);
  });
});

describe("khopNguon", () => {
  it("so theo tên tệp, không phân biệt hoa thường, bỏ thư mục", () => {
    expect(khopNguon("docs/AOI-Thresholds.md", ["aoi-thresholds.md"])).toBe(true);
    expect(khopNguon("C:\\x\\aoi-thresholds.md", ["aoi-thresholds.md"])).toBe(true);
    expect(khopNguon("aoi-thresholds.md.bak", ["aoi-thresholds.md"])).toBe(false);
    expect(khopNguon("aoi-thresholds.md", [])).toBe(false);
  });
});

describe("kiemDe — tách lỗi BỘ ĐO khỏi lỗi truy hồi", () => {
  it("tệp có, đáp án có ⇒ ok · tệp có, đáp án không có ⇒ hong · tệp vắng ⇒ vang-tep · câu ngoài ⇒ ok", () => {
    expect(kiemDe(cauT, [hitDung])).toBe("ok");
    expect(kiemDe(cauT, [{ ...hitDung, text: "không có số nào" }])).toBe("hong");
    expect(kiemDe(cauT, [hitLac])).toBe("vang-tep");
    expect(kiemDe(cauT, [])).toBe("vang-tep");
    expect(kiemDe(cauN, [])).toBe("ok");
  });
});

describe("chamCau", () => {
  it("trúng nguồn ở hạng 2, qua ngưỡng, đáp án trong ngữ cảnh", () => {
    const k = chamCau(cauT, [hitLac, hitDung], { nguong: 0.5, de: "ok" });
    expect(k).toMatchObject({ loai: "trong", hangNguon: 2, diemNguon: 0.71, quaNguong: true, dapAnNguCanh: true, duongOng: null });
    expect(k.top1).toEqual({ sourceRef: "howto-spc-control.md", score: 0.62 });
  });

  it("trúng nguồn nhưng DƯỚI ngưỡng ⇒ quaNguong=false (có trong top‑K nhưng không tới prompt)", () => {
    const k = chamCau(cauT, [{ ...hitDung, score: 0.42 }], { nguong: 0.5, de: "ok" });
    expect(k.hangNguon).toBe(1);
    expect(k.quaNguong).toBe(false);
  });

  it("câu ngoài corpus: top1 dưới ngưỡng ⇒ từ chối đúng; trên ngưỡng ⇒ sai; không hit ⇒ đúng", () => {
    expect(chamCau(cauN, [{ ...hitLac, score: 0.3 }], { nguong: 0.5, de: "ok" }).tuChoiDung).toBe(true);
    expect(chamCau(cauN, [hitLac], { nguong: 0.5, de: "ok" }).tuChoiDung).toBe(false);
    expect(chamCau(cauN, [], { nguong: 0.5, de: "ok" }).tuChoiDung).toBe(true);
  });
});

describe("tongHop", () => {
  it("fake-bad: corpus rỗng ⇒ mọi câu trong là vang-tep ⇒ 0 %, KHÔNG phải null", () => {
    const kq = [chamCau(cauT, [], { nguong: 0.5, de: kiemDe(cauT, []) })];
    const t = tongHop(kq);
    expect(t.trungNguon).toBe(0);
    expect(t.dapAnNguCanh).toBe(0);
    expect(t.mrr).toBe(0);
  });

  it("fake-ok: hit đúng tệp hạng 1 ⇒ 100 %, mrr 1", () => {
    const t = tongHop([chamCau(cauT, [hitDung], { nguong: 0.5, de: "ok", duongOng: true })]);
    expect(t).toMatchObject({ trungNguon: 1, mrr: 1, quaNguong: 1, dapAnNguCanh: 1, duongOng: 1 });
  });

  it("đường ống: 'từ corpus này' và 'mọi kho' là HAI tỷ lệ riêng (bản sao hệ thống lấn chỗ ≠ thiếu nguồn)", () => {
    const t = tongHop([
      chamCau(cauT, [hitDung], { nguong: 0.5, de: "ok", duongOng: false, duongOngBatKy: true }),
      chamCau({ ...cauT, id: "T2" }, [hitDung], { nguong: 0.5, de: "ok", duongOng: true, duongOngBatKy: true }),
    ]);
    expect(t.duongOng).toBe(0.5);
    expect(t.duongOngBatKy).toBe(1);
  });

  it("câu HỎNG bị loại khỏi mẫu số và đếm riêng", () => {
    const t = tongHop([
      chamCau(cauT, [hitDung], { nguong: 0.5, de: "ok" }),
      chamCau({ ...cauT, id: "T2" }, [], { nguong: 0.5, de: "hong" }),
    ]);
    expect(t.soCauHong).toBe(1);
    expect(t.trungNguon).toBe(1);
  });

  it("mẫu số 0 ⇒ null (không biết ≠ 0): không câu ngoài ⇒ tuChoiDung null; không chạy đường ống ⇒ duongOng null", () => {
    const t = tongHop([chamCau(cauT, [hitDung], { nguong: 0.5, de: "ok" })]);
    expect(t.tuChoiDung).toBeNull();
    expect(t.duongOng).toBeNull();
    expect(t.duongOngBatKy).toBeNull();
    expect(tongHop([]).trungNguon).toBeNull();
  });
});

describe("bộ vàng thật trong repo", () => {
  const dir = path.join(process.cwd(), "knowledge", "studio-golden");
  const tep = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));

  it("có ít nhất một bộ, và bộ ST4I ≥ 20 câu trong corpus (cổng ra R1)", () => {
    expect(tep).toContain("st4i-may-aoi.jsonl");
    const r = phanTichBoVang(fs.readFileSync(path.join(dir, "st4i-may-aoi.jsonl"), "utf8"));
    expect(r.cau.filter((c) => c.nguon.length > 0).length).toBeGreaterThanOrEqual(20);
    expect(r.cau.filter((c) => c.nguon.length === 0).length).toBeGreaterThanOrEqual(1);
  });

  it.each(tep)("%s đọc sạch, 0 dòng lỗi", (f) => {
    expect(phanTichBoVang(fs.readFileSync(path.join(dir, f), "utf8")).loi).toEqual([]);
  });

  it("mọi tệp nguồn của bộ ST4I có thật trong knowledge/domain và đáp án khớp văn bản tệp (đề không hỏng)", () => {
    const r = phanTichBoVang(fs.readFileSync(path.join(dir, "st4i-may-aoi.jsonl"), "utf8"));
    const tatCa = fs
      .readdirSync(path.join(process.cwd(), "knowledge", "domain"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ sourceRef: f, text: fs.readFileSync(path.join(process.cwd(), "knowledge", "domain", f), "utf8") }));
    const sai = r.cau.filter((c) => kiemDe(c, tatCa) !== "ok").map((c) => c.id);
    expect(sai).toEqual([]);
  });
});
