import { describe, it, expect } from "vitest";
import { rollupVerdict, verdictLuuTru, type NutKetQua } from "./rollupVerdict";

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
});
