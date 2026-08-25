import { describe, it, expect } from "vitest";
import { rollupVerdict, type NutKetQua } from "./rollupVerdict";

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
