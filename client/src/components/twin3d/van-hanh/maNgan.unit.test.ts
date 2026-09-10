/**
 * maNgan.unit.test.ts — Đợt 38 (Pareto #7 QA Đợt 37): rút tiền tố chung để tên trạm/máy KHÔNG bị cắt ở 1280×720.
 * Dữ liệu = 12 mã trạm THẬT của chuyền 2 (`.qa-dot38/truoc/p7-line-2-1280x720.json`), không bịa.
 */
import { describe, it, expect } from "vitest";
import { rutTienTo, tienToChung } from "./maNgan";

const TRAM_LINE_2 = [
  "SIM-L2-SPI-ST", "SIM-L2-AOI-ST", "SIM-L2-AVI-ST", "SIM-L2-ICT-ST", "SIM-L2-FCT-ST", "SIM-L2-CONVEYOR-ST",
  "SIM-L2-PWR-ST", "SIM-L2-ASSY-ST", "SIM-L2-SCREW-ST", "SIM-L2-PACK-ST", "SIM-L2-ROBOT-ST", "SIM-L2-AGV-ST",
];

describe("tienToChung — cắt tại ranh giới, không rút gần đúng", () => {
  it("★★★ 12 trạm thật của chuyền 2 ⇒ `SIM-L2-` (giữ dấu `-`), KHÔNG phải `SIM-L2-S` hay `SIM-L2`", () => {
    expect(tienToChung(TRAM_LINE_2)).toBe("SIM-L2-");
  });
  it("★★★ phần còn lại của mọi mã khác rỗng và đọc được", () => {
    const p = tienToChung(TRAM_LINE_2);
    const ngan = TRAM_LINE_2.map((m) => rutTienTo(m, p));
    expect(ngan).toEqual(["SPI-ST", "AOI-ST", "AVI-ST", "ICT-ST", "FCT-ST", "CONVEYOR-ST", "PWR-ST", "ASSY-ST", "SCREW-ST", "PACK-ST", "ROBOT-ST", "AGV-ST"]);
    for (const n of ngan) expect(n.length).toBeGreaterThan(0);
  });
  it("★ tiền tố chung nằm GIỮA một từ (`SPI`/`SCREW` ⇒ `S`) ⇒ lùi về ranh giới trước đó", () => {
    expect(tienToChung(["L2-SPI", "L2-SCREW"])).toBe("L2-");
  });
  it("★ không có ranh giới nào trong tiền tố chung ⇒ KHÔNG rút (`ABC1`/`ABC2` ⇒ \"\")", () => {
    expect(tienToChung(["ABC1", "ABC2"])).toBe("");
  });
  it("★ một mã lạc loài (không cùng tiền tố) ⇒ không rút gì cả — không rút gần đúng", () => {
    expect(tienToChung([...TRAM_LINE_2, "SIM-L3-AOI-ST"])).toBe("SIM-");
    expect(tienToChung([...TRAM_LINE_2, "X-1"])).toBe("");
  });
  it("★ một mã TRÙNG HỆT tiền tố ⇒ không rút (nó sẽ mất tên)", () => {
    expect(tienToChung(["SIM-L2-", "SIM-L2-AOI"])).toBe("");
  });
  it("< 2 mã ⇒ không rút; mảng rỗng ⇒ \"\"", () => {
    expect(tienToChung(["SIM-L2-AOI"])).toBe("");
    expect(tienToChung([])).toBe("");
  });
  it("ranh giới ở ngay đầu (`-A`/`-B`) ⇒ không rút", () => {
    expect(tienToChung(["-A", "-B"])).toBe("");
  });
});

describe("rutTienTo — an toàn với mọi đầu vào", () => {
  it("rút đúng khi khớp; trả nguyên mã khi tiền tố rỗng / không khớp / rút xong sẽ rỗng", () => {
    expect(rutTienTo("SIM-L2-AOI", "SIM-L2-")).toBe("AOI");
    expect(rutTienTo("SIM-L2-AOI", "")).toBe("SIM-L2-AOI");
    expect(rutTienTo("SIM-L3-AOI", "SIM-L2-")).toBe("SIM-L3-AOI");
    expect(rutTienTo("SIM-L2-", "SIM-L2-")).toBe("SIM-L2-");
  });
});
