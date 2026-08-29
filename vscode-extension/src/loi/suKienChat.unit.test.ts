/**
 * LƯỚI vòng trạng thái một lượt chat. Bất biến I3: (1) `done` PHẢI được xử — thiếu nó thì một
 * luồng bị cắt ngang giữa chừng không thể phân biệt với một luồng đã xong; (2) `degraded:true`
 * PHẢI thay chữ đã stream bằng `answer` thật của server; (3) khung hỏng (`hong`) KHÔNG được im
 * lặng — phải nổi thành cảnh báo, đúng hợp đồng của `khungSse.ts`.
 */
import { describe, it, expect } from "vitest";
import { trangThaiBanDau, apDungSuKienChat, ketLuanLuotChat } from "./suKienChat";

function gomToken(tokens: string[]) {
  return tokens.reduce(
    (tt, t) => apDungSuKienChat(tt, { type: "token", token: t }),
    trangThaiBanDau(),
  );
}

describe("apDungSuKienChat", () => {
  it("★★★ gom token theo thứ tự", () => {
    const tt = gomToken(["Xin ", "chào"]);
    expect(tt.traLoi).toBe("Xin chào");
  });

  it("★★★ `done` bình thường (không degraded) GIỮ NGUYÊN chữ đã stream, đánh dấu đã hoàn tất", () => {
    let tt = gomToken(["Xin ", "chào"]);
    tt = apDungSuKienChat(tt, { type: "done", answer: "Xin chào", degraded: false });
    expect(tt.daNhanDone).toBe(true);
    expect(tt.degraded).toBe(false);
    expect(tt.traLoi).toBe("Xin chào");
  });

  it("★★★ `done` với degraded:true THAY chữ đã stream bằng `answer` thật của server", () => {
    let tt = gomToken(["chữ", "rác", "giữa", "chừng"]);
    tt = apDungSuKienChat(tt, {
      type: "done",
      answer: "Câu trả lời THẬT sau khi vòng công cụ suy biến",
      degraded: true,
    });
    expect(tt.degraded).toBe(true);
    expect(tt.traLoi).toBe("Câu trả lời THẬT sau khi vòng công cụ suy biến");
    expect(tt.traLoi).not.toContain("rác");
  });

  it("★★ `done` degraded:true nhưng `answer` KHÔNG PHẢI chuỗi ⇒ giữ chữ đã stream (không thay bằng rác kiểu khác)", () => {
    let tt = gomToken(["giữ ", "nguyên"]);
    tt = apDungSuKienChat(tt, { type: "done", answer: null, degraded: true });
    expect(tt.traLoi).toBe("giữ nguyên");
    expect(tt.degraded).toBe(false);
  });

  it("★★ `error` đánh dấu đã báo lỗi, không đụng vào traLoi", () => {
    let tt = gomToken(["a"]);
    tt = apDungSuKienChat(tt, { type: "error", error: "Model hết VRAM" });
    expect(tt.daBaoLoi).toBe(true);
    expect(tt.traLoi).toBe("a");
  });
});

describe("ketLuanLuotChat", () => {
  it("★★★ luồng kết thúc CÓ `done` ⇒ không cảnh báo gì", () => {
    let tt = gomToken(["ok"]);
    tt = apDungSuKienChat(tt, { type: "done", answer: "ok", degraded: false });
    expect(ketLuanLuotChat(tt, []).canhBao).toBeNull();
  });

  it("★★★ luồng kết thúc KHÔNG có `done` ⇒ cảnh báo CẮT NGANG, không im lặng coi là xong", () => {
    const tt = gomToken(["nửa", "câu"]);
    const r = ketLuanLuotChat(tt, []);
    expect(r.canhBao).toContain("CẮT NGANG");
    expect(r.traLoi).toBe("nửacâu");
  });

  it("★★ đã có `error` riêng rồi thì KHÔNG lặp lại cảnh báo cắt ngang", () => {
    let tt = gomToken(["a"]);
    tt = apDungSuKienChat(tt, { type: "error", error: "x" });
    expect(ketLuanLuotChat(tt, []).canhBao).toBeNull();
  });

  it("★★★ khung hỏng (`hong`) KHÔNG bị nuốt im lặng — nổi thành cảnh báo kèm số lượng", () => {
    let tt = gomToken(["ok"]);
    tt = apDungSuKienChat(tt, { type: "done", answer: "ok", degraded: false });
    const r = ketLuanLuotChat(tt, ["{rac}", "{con rac nua}"]);
    expect(r.canhBao).toContain("2");
  });

  it("★★ cắt ngang VÀ khung hỏng cùng lúc ⇒ cả hai cảnh báo cùng nổi lên", () => {
    const tt = gomToken(["nửa"]);
    const r = ketLuanLuotChat(tt, ["{rac}"]);
    expect(r.canhBao).toContain("CẮT NGANG");
    expect(r.canhBao).toContain("1");
  });
});
