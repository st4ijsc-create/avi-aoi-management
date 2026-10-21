import { describe, expect, it } from "vitest";
import { hoSoDangGan, luotTotNhat, soSanh, tapDangGan, tiLeDat, type LuotDo } from "./soSanhLuotDo";

const r = (id: number, profileId: string, suite: string, nPass: number | null, nTasks: number | null, p50Ms: number | null, at: string): LuotDo => ({
  id, profileId, suite, nPass, nTasks, nRuns: 1, p50Ms, p90Ms: p50Ms, gitSha: "abc", createdAt: at,
});

describe("soSanhLuotDo", () => {
  it("tiLeDat: thiếu số liệu ⇒ null", () => {
    expect(tiLeDat({ nPass: 3, nTasks: 4 })).toBe(0.75);
    expect(tiLeDat({ nPass: null, nTasks: 4 })).toBeNull();
    expect(tiLeDat({ nPass: 0, nTasks: 0 })).toBeNull();
  });
  it("luotTotNhat: chỉ trong CÙNG bộ đo; đúng nhất, hoà thì mới nhất", () => {
    const ds = [r(1, "p", "s", 3, 4, 100, "2026-10-20"), r(2, "p", "s", 4, 4, 900, "2026-10-19"), r(3, "p", "s", 4, 4, 500, "2026-10-21"), r(4, "p", "khac", 4, 4, 1, "2026-10-21")];
    expect(luotTotNhat(ds, "p", "s")?.id).toBe(3);
    expect(luotTotNhat(ds, "q", "s")).toBeNull();
    expect(luotTotNhat(ds, "p", null)).toBeNull();
  });
  it("soSanh: đúng hơn thắng; hoà đúng thì nhanh hơn; khác nhau suite không so (null)", () => {
    const a = r(1, "a", "s", 3, 4, 100, "2026-10-20");
    const b = r(2, "b", "s", 4, 4, 900, "2026-10-20");
    expect(soSanh(a, b)).toBe("hon"); // chậm hơn nhưng đúng hơn ⇒ vẫn hơn
    expect(soSanh(b, a)).toBe("kem");
    expect(soSanh(b, r(3, "c", "s", 4, 4, 100, "2026-10-20"))).toBe("hon");
    expect(soSanh(b, r(3, "c", "s", 4, 4, 900, "2026-10-20"))).toBe("bang");
    expect(soSanh(null, b)).toBe("khongSo");
    expect(soSanh(a, r(4, "d", "s", null, 4, 1, "2026-10-20"))).toBe("khongSo");
  });
  it("hoSoDangGan / tapDangGan: chỉ active; .env không có hồ sơ", () => {
    const gan = [
      { roleId: "plc", scopeKind: "global", scopeId: null, mode: "active", profileId: "p1" },
      { roleId: "plc", scopeKind: "global", scopeId: null, mode: "thu", profileId: "p2" },
      { roleId: "kb", scopeKind: "global", scopeId: null, mode: "active", profileId: null },
    ];
    expect(hoSoDangGan(gan, "plc")).toBe("p1");
    expect(hoSoDangGan(gan, "kb")).toBeNull();
    expect([...tapDangGan(gan, [{ id: "plc", evalSuite: "plc-st-v1" }, { id: "kb", evalSuite: null }])]).toEqual(["p1|plc-st-v1"]);
  });
});
