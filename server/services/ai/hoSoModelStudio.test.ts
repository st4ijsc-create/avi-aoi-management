/**
 * R3 — phần thuần của hồ sơ model: gom báo cáo đo theo nhãn · tìm chỗ khai lệch thứ đang chạy.
 * ĐỘT BIẾN PHẢI BẮT: gộp nhãn anh em (H-a- nuốt H-ab-) · đếm tệp không có bài · so model phân biệt hoa
 * thường · báo lệch khi server không liên lạc được.
 */
import { describe, it, expect } from "vitest";
import { gomBaoCao, timLech } from "./hoSoModelStudio";

const bai = (dat: boolean[]) => dat.map((chayDat, i) => ({ id: `b${i}`, chayDat }));

describe("gomBaoCao", () => {
  it("gom theo nhãn bỏ đuôi -<lượt>; nhãn anh em không nuốt nhau; mới nhất trước mỗi trục", () => {
    const r = gomBaoCao([
      { ten: "H-q36-1.json", mtimeMs: 100, noiDung: bai([true, false]) },
      { ten: "H-q36-2.json", mtimeMs: 200, noiDung: bai([true, true]) },
      { ten: "H-q36moe-1.json", mtimeMs: 300, noiDung: bai([false, false]) },
      { ten: "M-raw-1.json", mtimeMs: 50, noiDung: bai([true]) },
      { ten: "duan-x-1.json", mtimeMs: 400, noiDung: [{ kiem: { sql: "1/1", cs: "0/1", js: "0/0" } }] },
      { ten: "rac.json", mtimeMs: 999, noiDung: bai([true]) },
      { ten: "H-rong-1.json", mtimeMs: 999, noiDung: [] },
    ]);
    expect(r.map((x) => [x.truc, x.nhan, x.soLuot, x.dat, x.tong])).toEqual([
      ["M", "M-raw", 1, 1, 1],
      ["H", "H-q36moe", 1, 0, 2],
      ["H", "H-q36", 2, 3, 4],
      ["du-an", "duan-x", 1, 1, 2],
    ]);
  });
});

describe("timLech", () => {
  const ch = { modelKhai: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", llamaServerModel: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", ggufMaxCtx: 65536, nganSachNghi: 12000, hoSoSampling: "hien-tai", modelNhung: null };
  const dang = { trangThai: "ok" as const, modelFile: "qwen3.6-35b-a3b-ud-q4_k_xl.gguf", ctxMoiSlot: 65536, soSlot: 1, banDung: "b9814" };
  it("khớp (không phân biệt hoa thường) ⇒ không lệch", () => {
    expect(timLech(dang, ch)).toEqual([]);
  });
  it("server nạp model khác + ctx/slot nhỏ hơn trần ⇒ ba mã lệch", () => {
    expect(timLech({ ...dang, modelFile: "Qwen3-Coder-30B.gguf", ctxMoiSlot: 32768 }, ch)).toEqual([
      "llama-server-model-lech",
      "model-khai-lech",
      "ctx-slot-nho-hon-tran",
    ]);
  });
  it("server không liên lạc được ⇒ không kết luận lệch (chỉ báo thiếu khai nếu có)", () => {
    expect(timLech({ trangThai: "khong-lien-lac", lyDo: "timeout" }, ch)).toEqual([]);
    expect(timLech({ trangThai: "khong-lien-lac", lyDo: "timeout" }, { ...ch, modelKhai: null })).toEqual(["chua-khai-model"]);
  });
});
