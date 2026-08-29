import { describe, it, expect } from "vitest";
import { rollupVerdict, verdictLuuTru, verdictXauHon, type NutKetQua, type ResultVerdict } from "./rollupVerdict";

const n = (result: "OK" | "NG" | "NTF", ntf = false, ntfSource: "machine" | "human" | "both" | null = null): NutKetQua =>
  ({ result, ntf, ntfSource });

describe("rollupVerdict — NG > NTF > OK", () => {
  it("có bất kỳ NG ⇒ NG, kể cả khi cũng có NTF", () => {
    expect(rollupVerdict([n("OK"), n("NTF", true, "machine"), n("NG")]).result).toBe("NG");
  });

  it("không NG mà có NTF ⇒ NTF", () => {
    expect(rollupVerdict([n("OK"), n("NTF", true, "machine"), n("OK")]).result).toBe("NTF");
  });

  it("toàn OK ⇒ OK", () => {
    expect(rollupVerdict([n("OK"), n("OK")]).result).toBe("OK");
  });

  it("cờ ntf THÔ cuộn theo OR, độc lập với result", () => {
    // con NG nhưng cũng bị đánh dấu ntf ⇒ cha là NG, nhưng ntf thô vẫn true
    const r = rollupVerdict([n("NG", true, "machine"), n("OK")]);
    expect(r.result).toBe("NG");
    expect(r.ntf).toBe(true);
  });

  it("ntfSource: chỉ machine ⇒ machine", () => {
    expect(rollupVerdict([n("NTF", true, "machine"), n("OK")]).ntfSource).toBe("machine");
  });

  it("ntfSource: chỉ human ⇒ human", () => {
    expect(rollupVerdict([n("NTF", true, "human"), n("OK")]).ntfSource).toBe("human");
  });

  it("ntfSource: có cả hai ⇒ both", () => {
    expect(rollupVerdict([n("NTF", true, "machine"), n("NTF", true, "human")]).ntfSource).toBe("both");
  });

  it("ntfSource: 'both' ở một con cũng ra both", () => {
    expect(rollupVerdict([n("NTF", true, "both"), n("OK")]).ntfSource).toBe("both");
  });

  it("không con nào có ntf ⇒ ntfSource null", () => {
    expect(rollupVerdict([n("OK"), n("NG")]).ntfSource).toBeNull();
  });

  it("MẢNG RỖNG ⇒ OK / false / null — KHÔNG ném lỗi", () => {
    expect(rollupVerdict([])).toEqual({ result: "OK", ntf: false, ntfSource: null });
  });
});

describe("verdictLuuTru — cầu nối cờ ntf về bảng chữ cái BA giá trị của cột lưu trữ", () => {
  it("NG thắng NTF — đúng luật cuộn của chủ dự án", () => {
    expect(verdictLuuTru({ result: "NG", ntf: true })).toBe("NG");
    expect(verdictLuuTru({ result: "NG", ntf: false })).toBe("NG");
  });

  it("không NG mà có cờ ntf ⇒ NTF (đây chính là 6,55% bo sẽ biến mất nếu thiếu hàm này)", () => {
    expect(verdictLuuTru({ result: "OK", ntf: true })).toBe("NTF");
  });

  it("không NG, không ntf ⇒ OK", () => {
    expect(verdictLuuTru({ result: "OK", ntf: false })).toBe("OK");
  });

  it("nối THẲNG từ rollupVerdict: cây toàn OK nhưng một component gắn cờ ntf ⇒ lưu NTF", () => {
    const cuon = rollupVerdict([
      { result: "OK", ntf: false },
      { result: "OK", ntf: true, ntfSource: "machine" },
    ]);
    expect(cuon.result).toBe("OK");
    expect(cuon.ntf).toBe(true);
    expect(verdictLuuTru(cuon)).toBe("NTF");
  });

  it("giá trị trả về NẰM TRONG bảng chữ cái mà công thức final yield biết", () => {
    const ra = new Set<string>();
    for (const result of ["OK", "NG"] as const)
      for (const ntf of [true, false]) ra.add(verdictLuuTru({ result, ntf }));
    expect([...ra].sort()).toEqual(["NG", "NTF", "OK"]);
    expect(ra.has("NTF")).toBe(true);
  });

  // ── Vòng sửa 1 (2026-08-26) — bản đầu chỉ đọc cờ `ntf`, quên mất `result` tự nó cũng
  // có thể đã là "NTF" (đường khác v2.0, ví dụ rollupVerdict nhận trực tiếp một con có
  // result:"NTF"). Hai ca dưới đây canh ĐÚNG hai nguồn NTF độc lập đó.
  it("result ĐÃ là NTF (không qua cờ ntf) ⇒ vẫn NTF — NTF có HAI nguồn độc lập, thiếu nhánh này là đúng lỗi 6,55% mà hàm chống", () => {
    expect(verdictLuuTru({ result: "NTF", ntf: false })).toBe("NTF");
  });

  it("NG vẫn thắng cả khi NTF đến từ cờ ntf (không phải từ result) — thứ tự kiểm tra NG PHẢI đứng trước", () => {
    expect(verdictLuuTru({ result: "NG", ntf: true })).toBe("NG");
  });

  /**
   * Re-review (chết giữa chừng vì giới hạn phiên, điều phối đo lại và xác nhận): `verdictLuuTru`
   * có 3×2=6 tổ hợp đầu vào (`result` ba giá trị × `ntf` hai giá trị). Các ca phía trên
   * (viết rải rác qua brief gốc + vòng sửa 1) chỉ CỘNG LẠI thành 5/6 — thiếu đúng tổ hợp
   * CẢ HAI nguồn NTF cùng báo: `{result:"NTF", ntf:true}`. Mã KHÔNG sai ở tổ hợp này (đã đo:
   * trả "NTF", đúng), đây thuần tuý là LỖ TRONG LƯỚI, không phải lỗi trong hàm.
   *
   * Ca dưới đây quét ĐỦ cả 6 tổ hợp bằng một bảng tường minh thay vì rải rác từng `it()` —
   * mục đích là chống đúng LỚP lỗ này tái xuất hiện: nếu ai thêm giá trị thứ tư vào
   * `ResultVerdict` (vd "SKIP"), bảng dưới đây phải được cập nhật tay và `BANG.length` sẽ tố
   * ngay nếu quên, thay vì lặng lẽ để lại một tổ hợp không được canh như lần này.
   */
  it("quét ĐỦ 6 tổ hợp (3 result × 2 ntf) bằng bảng — chống lỗ tái xuất khi có ai thêm giá trị mới vào ResultVerdict", () => {
    const BANG: Array<{ result: ResultVerdict; ntf: boolean; kyVong: ResultVerdict }> = [
      { result: "OK", ntf: false, kyVong: "OK" },
      { result: "OK", ntf: true, kyVong: "NTF" },
      { result: "NG", ntf: false, kyVong: "NG" },
      { result: "NG", ntf: true, kyVong: "NG" }, // NG thắng dù NTF đến từ cờ
      { result: "NTF", ntf: false, kyVong: "NTF" },
      { result: "NTF", ntf: true, kyVong: "NTF" }, // CẢ HAI nguồn NTF cùng báo ⇒ vẫn NTF, không triệt tiêu nhau — tổ hợp mà re-review bắt thiếu
    ];
    expect(BANG.length, "phải đủ 3×2=6 tổ hợp — thiếu một tổ hợp là đúng lỗ vừa vá").toBe(6);
    for (const { result, ntf, kyVong } of BANG) {
      expect(verdictLuuTru({ result, ntf }), `verdictLuuTru({result:"${result}", ntf:${ntf}}) phải là "${kyVong}"`).toBe(kyVong);
    }
  });
});

describe("verdictXauHon — không bao giờ hạ cấp phán quyết", () => {
  it("thứ tự nghiêm trọng: OK < NTF < NG", () => {
    expect(verdictXauHon("OK", "NTF")).toBe("NTF");
    expect(verdictXauHon("NTF", "NG")).toBe("NG");
    expect(verdictXauHon("OK", "NG")).toBe("NG");
  });

  it("đối xứng — thứ tự đối số không đổi kết quả", () => {
    for (const a of ["OK", "NG", "NTF"] as const)
      for (const b of ["OK", "NG", "NTF"] as const)
        expect(verdictXauHon(a, b)).toBe(verdictXauHon(b, a));
  });

  it("luỹ đẳng — cùng giá trị trả về chính nó", () => {
    for (const v of ["OK", "NG", "NTF"] as const) expect(verdictXauHon(v, v)).toBe(v);
  });
});
