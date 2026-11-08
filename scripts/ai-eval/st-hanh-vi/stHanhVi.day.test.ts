/**
 * ★ Đợt 12 B1 (rà kiem-dinh w8–w11) — DÂY NỐI lớp 2: `bienDichST` gọi `compile` và MỌI `scan` BÊN TRONG bẫy (`globalThis.Function` /
 * `eval` bị thay lúc vendor chạy), và `chamKichBan` NÉM lại lỗi sinh mã (không biến lỗi an toàn thành "trượt").
 * Vendor được bọc bằng `vi.mock` (bản THẬT bên trong) để quan sát trạng thái toàn cục ĐÚNG lúc vendor chạy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const quanSat: string[] = [];
let nemSinhMa: "compile" | "scan" | null = null;
const F0 = globalThis.Function;
const E0 = globalThis.eval;
const trangThai = () => (globalThis.Function === F0 || globalThis.eval === E0 ? "KHONG-BAY" : "BAY");

vi.mock("../../../vendor/oip-plc/src/plc/interpreter", async (goc) => {
  const that = (await goc()) as typeof import("../../../vendor/oip-plc/src/plc/interpreter");
  return {
    ...that,
    compile: (nguon: string) => {
      quanSat.push(`compile:${trangThai()}`);
      // mô phỏng vendor cố sinh mã: gọi Function TOÀN CỤC (đúng đường của scanCodegen.evaluate trước patch)
      if (nemSinhMa === "compile") new globalThis.Function("return 1");
      const p = that.compile(nguon);
      const scan = p.scan.bind(p);
      return Object.assign(p, {
        scan: (dt: number) => {
          quanSat.push(`scan:${trangThai()}`);
          if (nemSinhMa === "scan") (0, globalThis.eval)("1");
          return scan(dt);
        },
      });
    },
  };
});

const { bienDichST, chamKichBan, LoiSinhMa } = await import("./stHanhVi");
const ST = "VAR_INPUT go : BOOL; END_VAR VAR_OUTPUT q : BOOL; END_VAR\nq := go;";

afterEach(() => {
  quanSat.length = 0;
  nemSinhMa = null;
});

describe("B1 — dây nối lớp 2 (bẫy bao compile + mọi scan)", () => {
  it("compile và từng scan chạy KHI bẫy đang bật; sau đó Function / eval trả lại", () => {
    const may = bienDichST(ST);
    may.datVao("go", true);
    may.quet(0.25, 3);
    expect(quanSat).toEqual(["compile:BAY", "scan:BAY", "scan:BAY", "scan:BAY"]);
    expect(globalThis.Function).toBe(F0);
    expect(globalThis.eval).toBe(E0);
    expect(may.doc("q")).toBe(true);
  });

  it("vendor cố sinh mã lúc compile / lúc scan ⇒ chamKichBan NÉM LoiSinhMa (không trả {dat:false} — lỗi an toàn, không phải lời giải trượt)", () => {
    nemSinhMa = "compile";
    expect(() => chamKichBan(ST, [{ dt: 0.25 }])).toThrow(LoiSinhMa);
    nemSinhMa = "scan";
    expect(() => chamKichBan(ST, [{ vao: { go: true }, dt: 0.25 }])).toThrow(LoiSinhMa);
    expect(globalThis.Function).toBe(F0);
    expect(globalThis.eval).toBe(E0);
  });
});
