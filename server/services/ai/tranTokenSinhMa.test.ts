import { describe, it, expect, beforeEach } from "vitest";
import {
  tranTokenSinhMa,
  nenThuLaiVoiTranRong,
  ghiModelDaNghi,
  modelDaTungNghi,
  __resetONhoForTests,
  TRAN_SINH_KHONG_NGHI,
  TRAN_SINH_BIET_NGHI,
  DEM_AN_TOAN_TOKEN,
  SAN_TOKEN_SINH,
} from "./tranTokenSinhMa";

describe("tranTokenSinhMa — G18 (audit 2026-09-22)", () => {
  it("★★★ HÀNH VI CŨ KHÔNG ĐỔI MỘT BYTE: model không nghĩ ⇒ đúng 3.000 như trước", () => {
    expect(tranTokenSinhMa({ ctxSlotTokens: 32768, tokenPrompt: 2000, modelDaTungNghi: false })).toBe(TRAN_SINH_KHONG_NGHI);
    expect(TRAN_SINH_KHONG_NGHI).toBe(3_000);
  });

  it("★★★ CA THẬT ĐÃ ĐO: Qwen3.6 tiêu tới 8.015 token ⇒ trần rộng phải chứa được con số ấy", () => {
    const tran = tranTokenSinhMa({ ctxSlotTokens: 32768, tokenPrompt: 2000, modelDaTungNghi: true });
    expect(tran).toBe(TRAN_SINH_BIET_NGHI);
    expect(tran).toBeGreaterThan(8_015);
  });

  it("★★★ KHÔNG BAO GIỜ vượt ngữ cảnh slot: min(mong muốn, ctx − prompt − đệm)", () => {
    // ctx 16384/slot, prompt 3000 ⇒ còn 16384−3000−256 = 13128 < 16000 ⇒ phải kẹp.
    expect(tranTokenSinhMa({ ctxSlotTokens: 16384, tokenPrompt: 3000, modelDaTungNghi: true })).toBe(16384 - 3000 - DEM_AN_TOAN_TOKEN);
    // Kẹp cả model không nghĩ khi ctx quá hẹp.
    expect(tranTokenSinhMa({ ctxSlotTokens: 2048, tokenPrompt: 500, modelDaTungNghi: false })).toBe(2048 - 500 - DEM_AN_TOAN_TOKEN);
  });

  it("★★★ BẤT BIẾN: với MỌI đầu vào hữu hạn, kết quả ≤ mong muốn theo lớp VÀ ≥ sàn", () => {
    for (const ctx of [512, 2048, 8192, 16384, 32768, 65536]) {
      for (const p of [0, 100, 1000, 5000, 20000]) {
        for (const nghi of [true, false]) {
          const r = tranTokenSinhMa({ ctxSlotTokens: ctx, tokenPrompt: p, modelDaTungNghi: nghi });
          expect(r).toBeLessThanOrEqual(nghi ? TRAN_SINH_BIET_NGHI : TRAN_SINH_KHONG_NGHI);
          expect(r).toBeGreaterThanOrEqual(SAN_TOKEN_SINH);
          if (ctx - p - DEM_AN_TOAN_TOKEN >= SAN_TOKEN_SINH) expect(r).toBeLessThanOrEqual(ctx - p - DEM_AN_TOAN_TOKEN);
        }
      }
    }
  });

  it("★ prompt đã nuốt gần hết ctx ⇒ vẫn trả SÀN, không âm, không ném", () => {
    expect(tranTokenSinhMa({ ctxSlotTokens: 4096, tokenPrompt: 4000, modelDaTungNghi: true })).toBe(SAN_TOKEN_SINH);
  });

  it("★ cấu hình rác ⇒ bỏ ràng buộc ctx, rơi về trần theo lớp — đường sinh chữ KHÔNG chết vì một số hỏng", () => {
    for (const ctx of [NaN, -1, 0, Infinity as number]) {
      expect(tranTokenSinhMa({ ctxSlotTokens: ctx, tokenPrompt: 100, modelDaTungNghi: true })).toBe(TRAN_SINH_BIET_NGHI);
    }
    expect(tranTokenSinhMa({ ctxSlotTokens: 32768, tokenPrompt: NaN, modelDaTungNghi: false })).toBe(TRAN_SINH_KHONG_NGHI);
  });
});

describe("nenThuLaiVoiTranRong — ba lớp bọc, một dấu vết sống sót", () => {
  const GOC = "[llamaServer] TỪ CHỐI TRUNG THỰC (G5-D, stream): model đã tiêu HẾT hạn mức 3000 token vào chuỗi SUY LUẬN";

  it("★★★ lớp 0 — lỗi gốc, còn `name` ⇒ THỬ LẠI", () => {
    expect(nenThuLaiVoiTranRong({ name: "LoiTokenCanKietVaoSuyLuan", message: GOC }, false)).toBe(true);
  });
  it("★★★ lớp 1 — `LoiStreamServer` bọc, còn `cause.name` (đường STRICT ném nguyên `e`) ⇒ THỬ LẠI", () => {
    const boc = { name: "LoiStreamServer", message: GOC, cause: { name: "LoiTokenCanKietVaoSuyLuan" } };
    expect(nenThuLaiVoiTranRong(boc, false)).toBe(true);
  });
  it("★★★ lớp 2+3 — `quyetDinhSauLoiServer` + `streamCodingModel` ném `new Error(msg)`: mất name, mất cause, CHỈ CÒN CHUỖI ⇒ vẫn THỬ LẠI", () => {
    // Đúng hình dạng thật: chiTiet gốc bị NHÚNG vào giữa một thông điệp khác.
    const cuoi = new Error(
      `[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D, generation): llama-server còn SỐNG nhưng lượt sinh chữ hỏng: ${GOC}. KHÔNG lùi về đường in-process…`,
    );
    expect(cuoi.name).toBe("Error"); // khẳng định lại: danh tính đã mất thật
    expect(nenThuLaiVoiTranRong(cuoi, false)).toBe(true);
  });
  it("★★★ đã chạy ở trần rộng rồi ⇒ KHÔNG thử lại (chặn lặp vô hạn), bất kể lớp nào", () => {
    expect(nenThuLaiVoiTranRong({ name: "LoiTokenCanKietVaoSuyLuan" }, true)).toBe(false);
    expect(nenThuLaiVoiTranRong(new Error(GOC), true)).toBe(false);
  });
  it("★ lỗi khác ⇒ không thử lại — trần rộng không chữa được lỗi mạng, 400, hay vượt ngữ cảnh", () => {
    for (const l of [
      { name: "TypeError" },
      new Error("ECONNREFUSED"),
      new Error("[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D, generation): … VƯỢT NGỮ CẢNH …"), // G1-D ≠ G5-D
      new Error("TỪ CHỐI TRUNG THỰC (G1, stream): luồng chữ ĐỨT GIỮA CHỪNG"),
      null, undefined, "x", 42,
    ]) {
      expect(nenThuLaiVoiTranRong(l, false), String((l as { message?: string })?.message ?? l)).toBe(false);
    }
  });
});

describe("ô nhớ model-đã-nghĩ", () => {
  beforeEach(() => __resetONhoForTests());
  it("★ mặc định: chưa model nào từng nghĩ", () => {
    expect(modelDaTungNghi("Qwen3.6-27B")).toBe(false);
  });
  it("★★★ ghi rồi đọc lại — và KHOÁ THEO MODEL: model khác không kế thừa", () => {
    ghiModelDaNghi("Qwen3.6-27B");
    expect(modelDaTungNghi("Qwen3.6-27B")).toBe(true);
    expect(modelDaTungNghi("Qwen3-Coder-30B")).toBe(false);
  });
  it("★ định danh rỗng/null không ném", () => {
    ghiModelDaNghi(null as unknown as string);
    expect(modelDaTungNghi(null as unknown as string)).toBe(true);
    expect(modelDaTungNghi("")).toBe(true);
  });
});
