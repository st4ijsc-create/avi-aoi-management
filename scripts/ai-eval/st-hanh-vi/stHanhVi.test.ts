/**
 * ★ Đợt 12 B1 — bộ chấm ST HÀNH VI (vendor/oip-plc, CHỈ AST walker). 5 ca hành vi (TON / TOF / TP theo `scan(dt)`, CTU, máy trạng thái)
 * + 2 ca chấm (chương trình SAI bị bắt, chương trình bị từ chối biên dịch) + 4 ca an toàn — MỖI lớp chặn sinh mã có ca đỏ RIÊNG, và ca
 * gộp chứng minh MỘT lớp bất kỳ còn lại vẫn chặn.
 * Bước thời gian 0.25 s (biểu diễn nhị phân đúng ⇒ cộng dồn không trôi). Ngữ nghĩa bộ định thời như PLC thật: lần quét THẤY sườn có ET = 0,
 * mỗi lần quét sau cộng dt ⇒ Q của TON (PT = 1 s) bật ở lần quét thứ 1 + PT/dt = 5.
 */
import { afterEach, describe, expect, it } from "vitest";
import { bienDichST, chamKichBan, LoiSinhMa, voiBaySinhMa } from "./stHanhVi";
import { compile, setScanEngine } from "../../../vendor/oip-plc/src/plc/interpreter";
import { codegenFallbacks } from "../../../vendor/oip-plc/src/plc/scanCodegen";

afterEach(() => {
  setScanEngine("walker");
});

const DT = 0.25;

describe("B1 — hành vi theo thời gian mô phỏng", () => {
  it("TON: Q sau đúng PT liên tục IN; IN rơi ⇒ Q tắt và đếm lại", () => {
    const st = "VAR_INPUT go : BOOL; END_VAR VAR_OUTPUT done : BOOL; et : TIME; END_VAR VAR t : TON; END_VAR\nt(IN := go, PT := T#1s);\ndone := t.Q;\net := t.ET;";
    const kq = chamKichBan(st, [
      { vao: { go: true }, dt: DT, lan: 4, ky: { done: false, et: 750 }, nhan: "ET 0.75s" },
      { dt: DT, lan: 1, ky: { done: true, et: 1000 }, nhan: "ET 1.00s" },
      { vao: { go: false }, dt: DT, ky: { done: false, et: 0 }, nhan: "IN roi" },
      { vao: { go: true }, dt: DT, lan: 4, ky: { done: false }, nhan: "dem lai ET 0.75s" },
      { dt: DT, ky: { done: true }, nhan: "dem lai ET 1.00s" },
    ]);
    expect(kq).toEqual({ dat: true, lech: [] });
  });

  it("TOF: IN rơi ⇒ Q giữ thêm đúng PT rồi tắt", () => {
    const st = "VAR_INPUT go : BOOL; END_VAR VAR_OUTPUT q : BOOL; END_VAR VAR t : TOF; END_VAR\nt(IN := go, PT := T#500ms);\nq := t.Q;";
    expect(
      chamKichBan(st, [
        { vao: { go: true }, dt: DT, ky: { q: true } },
        { vao: { go: false }, dt: DT, lan: 2, ky: { q: true }, nhan: "ET 0.25s sau roi" },
        { dt: DT, ky: { q: false }, nhan: "ET 0.50s sau roi" },
      ]),
    ).toEqual({ dat: true, lech: [] });
  });

  it("TP: xung dài ĐÚNG PT dù IN giữ lâu hơn; không kích lại khi IN vẫn cao", () => {
    const st = "VAR_INPUT go : BOOL; END_VAR VAR_OUTPUT q : BOOL; END_VAR VAR t : TP; END_VAR\nt(IN := go, PT := T#500ms);\nq := t.Q;";
    expect(
      chamKichBan(st, [
        { vao: { go: true }, dt: DT, lan: 2, ky: { q: true }, nhan: "ET 0.25s" },
        { dt: DT, ky: { q: false }, nhan: "ET 0.50s = het PT" },
        { dt: DT, lan: 4, ky: { q: false }, nhan: "IN van cao" },
      ]),
    ).toEqual({ dat: true, lech: [] });
  });

  it("CTU: đếm SƯỜN LÊN, Q khi CV >= PV, RESET về 0", () => {
    const st = "VAR_INPUT cu : BOOL; r : BOOL; END_VAR VAR_OUTPUT q : BOOL; cv : INT; END_VAR VAR c : CTU; END_VAR\nc(CU := cu, R := r, PV := 3);\nq := c.Q;\ncv := c.CV;";
    const xung = (n: number) => Array.from({ length: n }, () => [{ vao: { cu: true }, dt: DT }, { vao: { cu: false }, dt: DT }]).flat();
    expect(
      chamKichBan(st, [
        ...xung(2),
        { vao: { cu: true }, dt: DT, lan: 3, ky: { cv: 3, q: true }, nhan: "giu cao 3 lan quet = 1 suon" },
        { vao: { cu: false, r: true }, dt: DT, ky: { cv: 0, q: false } },
      ]),
    ).toEqual({ dat: true, lech: [] });
  });

  it("máy trạng thái (CASE + TON): CHO → CHAY khi start; CHAY → DUNG khi cảm biến; DUNG → CHO sau 1 s", () => {
    const st = [
      "VAR_INPUT start : BOOL; cam : BOOL; END_VAR",
      "VAR_OUTPUT motor : BOOL; buoc : INT; END_VAR",
      "VAR t : TON; END_VAR",
      "CASE buoc OF",
      "  0: motor := FALSE; IF start THEN buoc := 1; END_IF;",
      "  1: motor := TRUE; IF cam THEN buoc := 2; END_IF;",
      "  2: motor := FALSE;",
      "END_CASE;",
      "t(IN := buoc = 2, PT := T#1s);",
      "IF t.Q THEN buoc := 0; END_IF;",
    ].join("\n");
    expect(
      chamKichBan(st, [
        { dt: DT, ky: { buoc: 0, motor: false } },
        { vao: { start: true }, dt: DT, ky: { buoc: 1 } },
        { vao: { start: false }, dt: DT, ky: { motor: true } },
        { vao: { cam: true }, dt: DT, ky: { buoc: 2 } },
        { vao: { cam: false }, dt: DT, lan: 3, ky: { buoc: 2, motor: false }, nhan: "0.75s o DUNG" },
        { dt: DT, ky: { buoc: 0 }, nhan: "1.00s ⇒ ve CHO" },
      ]),
    ).toEqual({ dat: true, lech: [] });
  });
});

describe("B1 — so kiểu + bước thời gian lẻ (rà kiem-dinh w12, d)", () => {
  it("so CHẶT: kỳ vọng false mà ST trả INT 0 ⇒ lệch; kỳ vọng 1 mà ST trả TRUE ⇒ lệch", () => {
    const st = "VAR_OUTPUT so : INT; co : BOOL; END_VAR\nso := 0;\nco := TRUE;";
    expect(chamKichBan(st, [{ dt: DT, ky: { so: false, co: 1 } }]).lech.map((l) => l.ten).sort()).toEqual(["co", "so"]);
    expect(chamKichBan(st, [{ dt: DT, ky: { so: 0, co: true } }])).toEqual({ dat: true, lech: [] });
  });
  it("PT KHÔNG chia hết dt (TON 300 ms, dt 250 ms): Q bật ở lần quét đầu tiên ET ≥ PT (ET 0 · 250 · 500 ⇒ lần 3)", () => {
    const st = "VAR_INPUT go : BOOL; END_VAR VAR_OUTPUT q : BOOL; et : TIME; END_VAR VAR t : TON; END_VAR\nt(IN := go, PT := T#300ms);\nq := t.Q;\net := t.ET;";
    expect(
      chamKichBan(st, [
        { vao: { go: true }, dt: DT, lan: 2, ky: { q: false, et: 250 }, nhan: "ET 250 < 300" },
        { dt: DT, ky: { q: true }, nhan: "ET ≥ 300" },
      ]),
    ).toEqual({ dat: true, lech: [] });
  });
});

describe("B1 — chấm", () => {
  it("chương trình SAI (PT nhầm 2 s) bị bắt: lệch đúng bước, đúng biến", () => {
    const sai = "VAR_INPUT go : BOOL; END_VAR VAR_OUTPUT done : BOOL; END_VAR VAR t : TON; END_VAR\nt(IN := go, PT := T#2s);\ndone := t.Q;";
    const kq = chamKichBan(sai, [{ vao: { go: true }, dt: DT, lan: 4, ky: { done: true }, nhan: "1.00s" }]);
    expect(kq).toEqual({ dat: false, lech: [{ buoc: 0, nhan: "1.00s", ten: "done", ky: true, thuc: false }] });
  });

  it("chương trình bị checker từ chối (REAL gán vào INT, cú pháp hỏng) ⇒ dat=false + loi, KHÔNG ném", () => {
    expect(chamKichBan("VAR r : REAL := 2.7; a : INT; END_VAR\na := r;", [{ dt: DT }])).toMatchObject({ dat: false, loi: expect.stringMatching(/^bien-dich: .*REAL/) });
    expect(chamKichBan("VAR a : INT; END_VAR\na := ;", [{ dt: DT }])).toMatchObject({ dat: false, loi: expect.stringMatching(/^bien-dich: /) });
  });
});

describe("B1 — an toàn: ba lớp chặn sinh mã, mỗi lớp một ca đỏ riêng", () => {
  const ST = "VAR_INPUT go : BOOL; END_VAR VAR_OUTPUT q : BOOL; END_VAR\nq := go;";

  it("lớp 1 — engine bị đổi thành 'typed' từ ngoài ⇒ bienDichST TỪ CHỐI (và đặt lại walker)", () => {
    setScanEngine("typed");
    expect(() => bienDichST(ST)).toThrow(/engine bi doi thanh 'typed'/);
    expect(setScanEngine("walker")).toBe("walker");
  });

  it("lớp 2 — bẫy: trong voiBaySinhMa `new Function` / `Function` / `eval` NÉM; ra khỏi bẫy (kể cả khi ném) thì trả lại", () => {
    const F = globalThis.Function;
    const E = globalThis.eval;
    voiBaySinhMa(() => {
      expect(() => new Function("return 1")).toThrow(LoiSinhMa);
      expect(() => (globalThis as { Function: (s: string) => unknown }).Function("return 1")).toThrow(LoiSinhMa);
      expect(() => (0, globalThis.eval)("1")).toThrow(LoiSinhMa);
    });
    expect(globalThis.Function).toBe(F);
    expect(globalThis.eval).toBe(E);
    expect(() =>
      voiBaySinhMa(() => {
        throw new Error("x");
      }),
    ).toThrow("x");
    expect(globalThis.Function).toBe(F);
    expect(globalThis.eval).toBe(E);
    expect(new Function("return 7")()).toBe(7);
  });

  it("lớp 3 — va-vendor.patch: gọi THẲNG vendor với engine 'typed', KHÔNG bẫy ⇒ evaluate() NÉM 'cam sinh ma (dieu-phoi 03/11)', chương trình lùi về walker vẫn chạy", () => {
    codegenFallbacks.length = 0;
    setScanEngine("typed");
    const p = compile(ST);
    p.setInput("go", true);
    p.scan(DT);
    expect(p.get("q")).toBe(true);
    expect(codegenFallbacks.join(" | ")).toContain("cam sinh ma (dieu-phoi 03/11)");
  });

  it("gộp — engine 'typed' lọt qua lớp 1, chạy trong bẫy: MỘT lớp còn lại bất kỳ (bẫy hoặc patch) vẫn chặn; chương trình chạy trên walker", () => {
    codegenFallbacks.length = 0;
    const p = voiBaySinhMa(() => {
      setScanEngine("typed");
      return compile(ST);
    });
    p.setInput("go", true);
    voiBaySinhMa(() => p.scan(DT));
    expect(p.get("q")).toBe(true);
    // thông điệp của patch HOẶC của bẫy — không có cái nào ⇒ đã sinh mã thật
    expect(codegenFallbacks.join(" | ")).toMatch(/cam sinh ma/);
  });
});
