/**
 * ★★★ LƯỚI cho parser "lỗi → VỊ TRÍ" của panel Problems (`shared/aiCodingLoiViTri.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỘT BIẾN FILE NÀY PHẢI BẮT ĐƯỢC:
 *   • nới regex tsc để khớp `warning TS`  (đổi `error` → `(?:error|warning)` / `\w+`)  ⇒ §1 ĐỎ
 *   • bỏ ràng buộc `:<số>:<số>` ở khuôn khung stack vitest (đẻ mục rác từ dòng TÊN CA)  ⇒ §2 ĐỎ
 *   • v1 "suy" đường tuyệt đối dotnet/node thành một `tep` (mở nhầm tệp)               ⇒ §3 ĐỎ
 *   • coi đầu vào không-chuỗi/rỗng là hợp lệ (ném / trả rác)                            ⇒ §4 ĐỎ
 *
 * Fixture đều là khuôn NGUYÊN VĂN (trích từ đầu ra THẬT ghi trong docs/superpowers/reports/*).
 * THUẦN — không React, chạy: `node node_modules/vitest/vitest.mjs run shared/aiCodingLoiViTri.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { phanTichLoiViTri, giaiDuongTuyetDoiTheoHauTo, type DiaDiemLoi } from "./aiCodingLoiViTri";

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — tsc (`npm run check` / `check:tests`): vị trí ĐẦY ĐỦ, và KHÔNG nuốt `warning`", () => {
  /**
   * Khối tsc nhiều dòng, khuôn NGUYÊN VĂN (đầu ra `tsc --noEmit`, không `pretty`):
   *   • dòng 1 lấy từ `docs/…/2026-08-05-vram-pha3-tra-no.md` (đầu ra `npm run check:tests`),
   *   • dòng 2 lấy từ `docs/…/2026-08-02-dot2-report.md` (đầu ra `npx tsc --noEmit`),
   *   • dòng 3 theo đúng ví dụ trong brief.
   */
  const KHOI_TSC = [
    "server/services/vram/_muta_luoiGia.test.ts(13,7): error TS2353: Object literal may only specify known properties, and 'ceiling' does not exist in type 'HeadroomInput'.",
    "client/src/pages/SessionManagement.tsx(195,64): error TS2339: Property 'userAgent' does not exist on type 'Session'.",
    "server/_core/dataErrorStringCensus.test.ts(96,41): error TS7006: Parameter 'row' implicitly has an 'any' type.",
  ].join("\r\n"); // ⚠ CRLF: đầu ra lệnh trên Windows

  it("★★★ ba dòng tsc ⇒ ba mục, mỗi mục có tep + dong + cot ĐÚNG (đường tương đối, dấu `/`)", () => {
    const r = phanTichLoiViTri(KHOI_TSC);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual<DiaDiemLoi>({
      tep: "server/services/vram/_muta_luoiGia.test.ts",
      dong: 13,
      cot: 7,
      thongDiep:
        "error TS2353: Object literal may only specify known properties, and 'ceiling' does not exist in type 'HeadroomInput'.",
    });
    expect(r[1].tep).toBe("client/src/pages/SessionManagement.tsx");
    expect(r[1].dong).toBe(195);
    expect(r[1].cot).toBe(64);
    expect(r[2]).toEqual<DiaDiemLoi>({
      tep: "server/_core/dataErrorStringCensus.test.ts",
      dong: 96,
      cot: 41,
      thongDiep: "error TS7006: Parameter 'row' implicitly has an 'any' type.",
    });
  });

  /**
   * ⚠⚠ CANH CHÍNH ĐỘT BIẾN. `tsc` với một số cấu hình in `warning TS…` — nó KHÔNG phải một mục lỗi
   * để nhảy tới. Nếu ai nới regex thành `(?:error|warning)` thì dòng này sinh một `DiaDiemLoi` và ca
   * này ĐỎ. Viết-trước, xác nhận-xanh, rồi thử nới tay ⇒ đỏ ⇒ hoàn nguyên.
   */
  it("★★★ `warning TS…` KHÔNG sinh mục lỗi (nới regex nuốt `warning` là đột biến)", () => {
    const canhBao = "client/src/App.tsx(1,10): warning TS6133: 'React' is declared but its value is never read.";
    expect(phanTichLoiViTri(canhBao)).toEqual([]);
    // Đối chứng: cùng khuôn nhưng là `error` ⇒ CÓ đúng một mục.
    const loi = "client/src/App.tsx(1,10): error TS6133: 'React' is declared but its value is never read.";
    expect(phanTichLoiViTri(loi)).toHaveLength(1);
  });

  it("★ dòng nối tiếp (message tsc xuống dòng, thụt lề) ⇒ BỎ QUA, không đẻ mục rác", () => {
    const block =
      "server/x.ts(13,7): error TS2353:\n" +
      "  Object literal may only specify known properties, and 'ceiling'\n" +
      "  does not exist in type 'HeadroomInput'.";
    const r = phanTichLoiViTri(block);
    expect(r).toHaveLength(1); // chỉ dòng đầu (có vị trí) thành mục; hai dòng thụt lề bị bỏ
    expect(r[0].tep).toBe("server/x.ts");
    expect(r[0].dong).toBe(13);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — vitest: `FAIL <đường>` ⇒ dong null; `❯ <đường>:<dòng>:<cột>` ⇒ có dòng", () => {
  /**
   * Khuôn NGUYÊN VĂN của một block vitest hỏng (trích `docs/…/2026-08-02-dot2-report.md`): một dòng
   * khung stack `❯ …:11:21`, một dòng tổng kết `FAIL  … > … > …`, kèm một dòng TÊN CA cũng mở đầu
   * bằng `❯` (phải bị bỏ qua) và một dòng `AssertionError` (bỏ qua).
   */
  const KHOI_VITEST = [
    " ❯ scripts/ai-bench/bench.production-parity.test.ts:11:21",
    " FAIL  scripts/ai-bench/bench.production-parity.test.ts > bench.mjs — khớp đường sản xuất > KHÔNG còn hard-code contextSize 'auto' cho embedding",
    "AssertionError: expected 'model.createEmbeddingContext({ contextSize: \"…' to match …",
    " ❯ nhúng bằng modelId TRÙNG GGUF_DEFAULT_MODEL (mô phỏng modelId từ HTTP), rồi sinh chữ — KHÔNG throw, tự lành",
  ].join("\n");

  it("★★★ khung stack `❯ path:dòng:cột` ⇒ tep + dong + cot đầy đủ", () => {
    const r = phanTichLoiViTri(KHOI_VITEST);
    const stack = r.find((m) => m.dong !== null);
    expect(stack).toBeDefined();
    expect(stack!.tep).toBe("scripts/ai-bench/bench.production-parity.test.ts");
    expect(stack!.dong).toBe(11);
    expect(stack!.cot).toBe(21);
  });

  it("★★★ dòng tổng kết `FAIL <đường>` ⇒ tep CÓ, dong null (biết tệp, chưa biết dòng)", () => {
    const r = phanTichLoiViTri(KHOI_VITEST);
    const fail = r.find((m) => m.tep === "scripts/ai-bench/bench.production-parity.test.ts" && m.dong === null);
    expect(fail, "phải có đúng một mục FAIL không-dòng").toBeDefined();
    expect(fail!.cot).toBeNull();
  });

  it("★★★ dòng TÊN CA mở đầu bằng `❯` (không có `:số:số`) ⇒ BỎ QUA — nếu không sẽ đẻ mục rác", () => {
    const r = phanTichLoiViTri(KHOI_VITEST);
    // Đúng 2 mục: 1 khung stack + 1 FAIL. Dòng tên-ca và dòng AssertionError không thành mục.
    expect(r).toHaveLength(2);
    expect(r.some((m) => /nhúng bằng modelId/.test(m.thongDiep))).toBe(false);
  });

  it("★ `Failed:`/`Failed!` của dotnet KHÔNG bị nhầm là `FAIL <đường>` của vitest", () => {
    // `FAIL ` đòi khoảng trắng ngay sau — `Failed` có chữ `e`, không khớp.
    expect(phanTichLoiViTri("Failed!  - Failed:     2, Passed:     4, Skipped:     0, Total:     6")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — dotnet / node: đường TUYỆT ĐỐI ⇒ tep=null (v1 KHÔNG mở nhầm tệp)", () => {
  /** Khối `dotnet test` hỏng, khung stack in đường TUYỆT ĐỐI (`…:line 42`). */
  const KHOI_DOTNET = [
    "Failed AoiTests.HeadroomCalculatorTests.Rejects_Negative [12 ms]",
    "  Error Message:",
    "   Assert.Throws() Failure: No exception was thrown.",
    "  Stack Trace:",
    "     at AoiTests.HeadroomCalculatorTests.Rejects_Negative() in D:\\SOURCES\\avi-aoi-management\\dotnet\\AoiTests\\HeadroomCalculatorTests.cs:line 42",
  ].join("\r\n");

  it("★★★ khung stack `.NET` đường tuyệt đối ⇒ CÓ dòng thông tin nhưng tep=null (không bấm được)", () => {
    const r = phanTichLoiViTri(KHOI_DOTNET);
    // Chỉ dòng có bộ định vị (`:line 42`) thành mục; các dòng còn lại bị bỏ.
    expect(r).toHaveLength(1);
    expect(r[0].tep).toBeNull();
    expect(r[0].dong).toBeNull();
    expect(r[0].cot).toBeNull();
    expect(r[0].thongDiep).toContain("HeadroomCalculatorTests.cs:line 42");
  });

  it("★★★ đường tuyệt đối Windows `C:\\` LẪN `D:\\` đều bị nhận là tuyệt đối ⇒ tep=null", () => {
    const block = [
      "   at Foo.Bar() in C:\\proj\\src\\Bar.cs:line 7", // .NET, ổ C
      "   at TestContext.<anonymous> (D:\\proj\\test\\foo.test.js:10:9)", // node, ổ D, `:dòng:cột`
    ].join("\n");
    const r = phanTichLoiViTri(block);
    expect(r).toHaveLength(2);
    expect(r.every((m) => m.tep === null)).toBe(true);
  });

  it("★★ đường tuyệt đối trong `❯` (nếu vitest lỡ in tuyệt đối) ⇒ vẫn tep=null, KHÔNG suy bừa", () => {
    const r = phanTichLoiViTri("❯ D:\\SOURCES\\avi-aoi-management\\server\\foo.test.ts:10:5");
    expect(r).toHaveLength(1);
    expect(r[0].tep).toBeNull();
  });

  it("★ đường tuyệt đối KHÔNG kèm bộ định vị dòng (chỉ là log) ⇒ BỎ QUA, không đẻ mục", () => {
    expect(phanTichLoiViTri("Loaded config from D:\\SOURCES\\avi-aoi-management\\app.config.json")).toEqual([]);
    // `http://a.b:80` KHÔNG bị nhận nhầm là ổ đĩa (lookbehind chặn chữ cái đứng trước `:`).
    expect(phanTichLoiViTri("Server listening on http://localhost:3000")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — biên: rỗng / không-chuỗi / rác / hỗn hợp", () => {
  it("★★★ đầu vào rỗng hoặc không phải chuỗi ⇒ [] (không ném)", () => {
    expect(phanTichLoiViTri("")).toEqual([]);
    // ép kiểu để mô phỏng caller gọi bằng `any` — parser phải fail-safe, không ném.
    expect(phanTichLoiViTri(null as unknown as string)).toEqual([]);
    expect(phanTichLoiViTri(undefined as unknown as string)).toEqual([]);
    expect(phanTichLoiViTri(123 as unknown as string)).toEqual([]);
  });

  it("★★ block toàn dòng rác ⇒ [] (không khớp khuôn nào)", () => {
    const rac = [
      "> synapse-platform@1.0.0 check",
      "> cross-env NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit",
      "",
      "npm notice New minor version available",
    ].join("\n");
    expect(phanTichLoiViTri(rac)).toEqual([]);
  });

  it("★★ hỗn hợp tsc + vitest + dotnet trong MỘT khối ⇒ giữ đúng thứ tự và đúng phân loại", () => {
    const hon = [
      "server/a.ts(3,1): error TS2304: Cannot find name 'x'.", // tsc → đầy đủ
      " ❯ server/b.test.ts:9:4", // vitest stack → có dòng
      " FAIL  server/b.test.ts > mô tả > ca", // vitest FAIL → dong null
      "     at X.Y() in C:\\r\\Z.cs:line 5", // dotnet → tep null
      "chỉ là một dòng văn xuôi", // rác → bỏ
    ].join("\r\n");
    const r = phanTichLoiViTri(hon);
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({ tep: "server/a.ts", dong: 3, cot: 1 });
    expect(r[1]).toMatchObject({ tep: "server/b.test.ts", dong: 9, cot: 4 });
    expect(r[2]).toMatchObject({ tep: "server/b.test.ts", dong: null, cot: null });
    expect(r[3]).toMatchObject({ tep: null, dong: null, cot: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — giaiDuongTuyetDoiTheoHauTo: suy đường TUYỆT ĐỐI → TƯƠNG ĐỐI AN TOÀN theo cây workspace", () => {
  it("★★★ khớp cơ bản: abs khớp đúng MỘT tệp trong cây ⇒ trả đường tương đối ấy", () => {
    expect(giaiDuongTuyetDoiTheoHauTo("D:\\proj\\src\\Foo.cs", ["src/Foo.cs"])).toBe("src/Foo.cs");
  });

  /**
   * ⚠⚠ CANH ĐỘT BIẾN "chọn dài nhất". Cây có CẢ `Calculator.cs` (gốc) LẪN `src/Calculator.cs`; abs
   * `…/src/Calculator.cs` là hậu tố căn-đoạn của CẢ HAI (`/Calculator.cs` và `/src/Calculator.cs`).
   * Phải chọn cái DÀI NHẤT = `src/Calculator.cs`, KHÔNG hút nhầm tệp gốc. Đổi `>` thành `<` (chọn
   * ngắn nhất) ⇒ ca này ĐỎ.
   */
  it("★★★ hậu-tố-căn-ĐOẠN + chọn DÀI NHẤT: `Calculator.cs` gốc KHÔNG bị hút nhầm từ abs `…/src/Calculator.cs`", () => {
    expect(
      giaiDuongTuyetDoiTheoHauTo("D:\\proj\\src\\Calculator.cs", ["Calculator.cs", "src/Calculator.cs"]),
    ).toBe("src/Calculator.cs");
    // Thứ tự trong danh sách KHÔNG đổi kết quả (dài nhất thắng bất kể vị trí).
    expect(
      giaiDuongTuyetDoiTheoHauTo("D:\\proj\\src\\Calculator.cs", ["src/Calculator.cs", "Calculator.cs"]),
    ).toBe("src/Calculator.cs");
  });

  /**
   * ⚠⚠ CANH ĐỘT BIẾN "căn-đoạn". `Calculator.cs` là hậu tố THÔ của `…/myCalculator.cs` nhưng KHÔNG
   * phải hậu tố CĂN-ĐOẠN (không có `/` trước). Bỏ dấu `/` trong `'/' + fn` (thành `endsWith(fn)`) ⇒
   * dòng này khớp bừa ⇒ ĐỎ.
   */
  it("★★★ căn-ĐOẠN chặn khớp GIỮA-TÊN: `Calculator.cs` KHÔNG khớp abs `…/myCalculator.cs`", () => {
    expect(giaiDuongTuyetDoiTheoHauTo("D:\\proj\\src\\myCalculator.cs", ["Calculator.cs"])).toBeNull();
  });

  /**
   * ⚠⚠ CANH ĐỘT BIẾN "hoà → null". ≥2 tệp CÙNG khớp ở độ dài dài nhất ⇒ mơ hồ ⇒ null. (Với quy tắc
   * hậu-tố-căn-đoạn, hoà THẬT chỉ nổ khi danh sách chứa MỤC TRÙNG — dùng entry lặp để chạm đúng guard.)
   * Bỏ guard (`return best`) ⇒ ca này ĐỎ (trả `src/Calculator.cs` thay vì null).
   */
  it("★★★ HOÀ ở độ dài dài nhất (≥2 khớp cùng độ dài) ⇒ null (mơ hồ ⇒ KHÔNG đoán)", () => {
    expect(
      giaiDuongTuyetDoiTheoHauTo("D:\\proj\\src\\Calculator.cs", ["src/Calculator.cs", "src/Calculator.cs"]),
    ).toBeNull();
    // Đối chứng: chỉ một khớp ⇒ KHÔNG hoà, trả đường ấy.
    expect(
      giaiDuongTuyetDoiTheoHauTo("D:\\proj\\src\\Calculator.cs", ["src/Calculator.cs"]),
    ).toBe("src/Calculator.cs");
  });

  it("★★ strip ổ đĩa `D:` + chuẩn hoá `\\`↔`/` (abs `\\` vs tệp `/`, và ngược lại)", () => {
    // abs có ổ đĩa + gạch `\`; tệp gạch `/` ⇒ khớp (ổ đĩa chỉ là tiền tố, suffix bỏ qua).
    expect(giaiDuongTuyetDoiTheoHauTo("D:\\a\\b\\Foo.cs", ["a/b/Foo.cs"])).toBe("a/b/Foo.cs");
    // abs gạch `/`; tệp gạch `\` ⇒ vẫn khớp sau chuẩn hoá; trả dạng `/`.
    expect(giaiDuongTuyetDoiTheoHauTo("D:/a/b/Foo.cs", ["a\\b\\Foo.cs"])).toBe("a/b/Foo.cs");
  });

  it("★★ không khớp / abs rỗng / dsTep rỗng ⇒ null (⇒ backward-compat: caller v1 luôn null)", () => {
    expect(giaiDuongTuyetDoiTheoHauTo("D:\\proj\\src\\Foo.cs", ["src/Bar.cs"])).toBeNull();
    expect(giaiDuongTuyetDoiTheoHauTo("", ["src/Foo.cs"])).toBeNull();
    expect(giaiDuongTuyetDoiTheoHauTo("D:\\proj\\src\\Foo.cs", [])).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — csc (`dotnet build`): lỗi C# bấm-được; tuyệt đối giải theo cây; `warning CS` bị bỏ", () => {
  const CAY = [
    "sandbox-projects/csharp/src/Calculator.cs",
    "sandbox-projects/csharp/Program.cs",
  ] as const;

  it("★★★ đường TƯƠNG ĐỐI ⇒ tep+dong+cot ĐẦY ĐỦ (dùng thẳng như tsc)", () => {
    const r = phanTichLoiViTri("src/Calculator.cs(23,16): error CS0103: The name 'x' does not exist");
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual<DiaDiemLoi>({
      tep: "src/Calculator.cs",
      dong: 23,
      cot: 16,
      thongDiep: "error CS0103: The name 'x' does not exist",
    });
  });

  it("★★★ đường TUYỆT ĐỐI khớp cây ⇒ giải về tương đối, BẤM-ĐƯỢC; `[proj.csproj]` KHÔNG lẫn vào tep", () => {
    const raw =
      "D:\\SOURCES\\avi-aoi-management\\sandbox-projects\\csharp\\src\\Calculator.cs(23,16): error CS1002: ; expected [D:\\SOURCES\\avi-aoi-management\\sandbox-projects\\csharp\\CalculatorDemo.csproj]";
    const r = phanTichLoiViTri(raw, CAY);
    expect(r).toHaveLength(1);
    expect(r[0].tep).toBe("sandbox-projects/csharp/src/Calculator.cs");
    expect(r[0].dong).toBe(23);
    expect(r[0].cot).toBe(16);
    expect(r[0].thongDiep).toContain("error CS1002");
    // tep KHÔNG được dính đuôi locator hay `.csproj`.
    expect(r[0].tep).not.toContain("(");
    expect(r[0].tep).not.toContain("csproj");
  });

  it("★★★ đường TUYỆT ĐỐI KHÔNG khớp cây ⇒ tep=null (dòng thông tin, KHÔNG mở nhầm tệp)", () => {
    const raw = "D:\\OTHER\\repo\\src\\Ngoai.cs(9,3): error CS1002: ; expected";
    const r = phanTichLoiViTri(raw, CAY);
    expect(r).toHaveLength(1);
    expect(r[0].tep).toBeNull();
    expect(r[0].dong).toBeNull();
    expect(r[0].cot).toBeNull();
    expect(r[0].thongDiep).toContain("error CS1002"); // GIỮ msg ở dòng thông tin
  });

  it("★★★ đường TUYỆT ĐỐI mà KHÔNG truyền cây (v1 mode, 1 tham số) ⇒ tep=null (backward-compat)", () => {
    const raw =
      "D:\\SOURCES\\avi-aoi-management\\sandbox-projects\\csharp\\src\\Calculator.cs(23,16): error CS1002: ; expected";
    const r = phanTichLoiViTri(raw);
    expect(r).toHaveLength(1);
    expect(r[0].tep).toBeNull();
  });

  /**
   * ⚠⚠ CANH CHÍNH ĐỘT BIẾN §CS-warning (y hệt §1 của tsc). Nới `error\s+CS` → `(?:error|warning)` /
   * `\w+` ⇒ dòng `warning CS` sinh một mục ⇒ ca này ĐỎ.
   */
  it("★★★ `warning CS…` KHÔNG sinh mục lỗi (nới regex nuốt `warning` là đột biến)", () => {
    const canhBao = "src/Calculator.cs(23,16): warning CS0168: The variable 'x' is declared but never used";
    expect(phanTichLoiViTri(canhBao, CAY)).toEqual([]);
    // Đối chứng: cùng khuôn nhưng `error` ⇒ CÓ đúng một mục.
    const loi = "src/Calculator.cs(23,16): error CS0168: The variable 'x' is declared but never used";
    expect(phanTichLoiViTri(loi, CAY)).toHaveLength(1);
  });

  it("★ csc KHÔNG lẫn với tsc: `error TS` KHÔNG khớp RE_CSC và ngược lại", () => {
    // Một dòng `error TS` chỉ tạo mục qua tsc (đầy đủ), KHÔNG nhân đôi qua csc.
    expect(phanTichLoiViTri("a/b.ts(1,2): error TS2304: x", CAY)).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§7 — dotnet stack `:line` (NÂNG): khớp cây ⇒ BẤM-ĐƯỢC; không khớp ⇒ tep=null (v1)", () => {
  const CAY = ["dotnet/AoiTests/HeadroomCalculatorTests.cs", "dotnet/Aoi/HeadroomCalculator.cs"] as const;
  const RAW =
    "     at AoiTests.HeadroomCalculatorTests.Rejects_Negative() in D:\\SOURCES\\avi-aoi-management\\dotnet\\AoiTests\\HeadroomCalculatorTests.cs:line 42";

  it("★★★ khớp cây ⇒ tep giải về tương đối, dong=42, cot=null (bấm-được)", () => {
    const r = phanTichLoiViTri(RAW, CAY);
    expect(r).toHaveLength(1);
    expect(r[0].tep).toBe("dotnet/AoiTests/HeadroomCalculatorTests.cs");
    expect(r[0].dong).toBe(42);
    expect(r[0].cot).toBeNull();
  });

  it("★★★ KHÔNG khớp cây ⇒ tep=null nhưng vẫn là dòng thông tin (không mở nhầm)", () => {
    const r = phanTichLoiViTri(RAW, ["dotnet/Khac/Foo.cs"]);
    expect(r).toHaveLength(1);
    expect(r[0].tep).toBeNull();
    expect(r[0].dong).toBeNull();
    expect(r[0].thongDiep).toContain("HeadroomCalculatorTests.cs:line 42");
  });

  it("★ v1 mode (không truyền cây) ⇒ tep=null Y HỆT v1", () => {
    const r = phanTichLoiViTri(RAW);
    expect(r).toHaveLength(1);
    expect(r[0].tep).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§8 — node stack tuyệt đối `D:\\…:dòng:cột` (NÂNG): khớp cây ⇒ BẤM-ĐƯỢC", () => {
  const RAW = "   at TestContext.<anonymous> (D:\\SOURCES\\avi-aoi-management\\scripts\\bench.test.js:10:9)";

  it("★★★ khớp cây ⇒ tep tương đối, dong=10, cot=9", () => {
    const r = phanTichLoiViTri(RAW, ["scripts/bench.test.js"]);
    expect(r).toHaveLength(1);
    expect(r[0].tep).toBe("scripts/bench.test.js");
    expect(r[0].dong).toBe(10);
    expect(r[0].cot).toBe(9);
  });

  it("★★★ không khớp cây / v1 mode ⇒ tep=null (giữ kỷ luật không mở nhầm)", () => {
    expect(phanTichLoiViTri(RAW, ["scripts/other.js"])[0].tep).toBeNull();
    expect(phanTichLoiViTri(RAW)[0].tep).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§9 — hỗn hợp CÓ cây: .NET giải được, tsc/vitest KHÔNG đổi; và backward-compat tuyệt đối", () => {
  it("★★★ cùng khối + truyền cây ⇒ dotnet stack giải được, tsc/vitest giữ NGUYÊN", () => {
    const hon = [
      "server/a.ts(3,1): error TS2304: Cannot find name 'x'.", // tsc → đầy đủ
      " ❯ server/b.test.ts:9:4", // vitest stack → có dòng
      " FAIL  server/b.test.ts > mô tả > ca", // vitest FAIL → dong null
      "     at X.Y() in D:\\SOURCES\\avi-aoi-management\\dotnet\\Aoi\\Foo.cs:line 5", // dotnet → giải được
    ].join("\r\n");
    const r = phanTichLoiViTri(hon, ["dotnet/Aoi/Foo.cs"]);
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({ tep: "server/a.ts", dong: 3, cot: 1 });
    expect(r[1]).toMatchObject({ tep: "server/b.test.ts", dong: 9, cot: 4 });
    expect(r[2]).toMatchObject({ tep: "server/b.test.ts", dong: null, cot: null });
    expect(r[3]).toMatchObject({ tep: "dotnet/Aoi/Foo.cs", dong: 5, cot: null });
  });

  it("★★★ CÙNG khối, KHÔNG truyền cây ⇒ .NET stack tep=null (backward-compat CỨNG, y v1)", () => {
    const hon = [
      "server/a.ts(3,1): error TS2304: Cannot find name 'x'.",
      "     at X.Y() in D:\\SOURCES\\avi-aoi-management\\dotnet\\Aoi\\Foo.cs:line 5",
    ].join("\r\n");
    const r = phanTichLoiViTri(hon);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ tep: "server/a.ts", dong: 3, cot: 1 });
    expect(r[1].tep).toBeNull();
  });
});
