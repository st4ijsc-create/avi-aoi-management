/**
 * Phát lại fixture — so KẾT QUẢ CÔNG CỤ THẬT theo TẬP DÒNG, chịu được xUnit song song ghi chồng hai luồng (hai mẩu dính một dòng, dòng trống thừa).
 * THUẦN: không CSDL, không dotnet, không mạng. Mẫu lấy từ lần cổng đỏ thật của fixture cs-dat-phong (ghi vs phát).
 * ĐỘT BIẾN PHẢI BẮT: bỏ tách `[xUnit.net` · bỏ tách `Failed <Tên> [` · bỏ lọc dòng trống · bỏ trimEnd · tách nhầm `Failed!` tổng kết · nuốt mất một dòng.
 */
import { describe, expect, it } from "vitest";
import { dongDeSo, soSuKien, soYeuCau } from "./phatLaiLuot";

const yc = (tin: Array<{ role: string; content: string }>) => ({ heThong: "x", congCu: { ten: [], bam: "b" }, co: { disableThinking: false, preserveThinking: false }, tin });

// BẢN GHI: mỗi mẩu một dòng.
const GHI = [
  "$ dotnet test cs-dat-phong/tests/DatPhong.Tests",
  "exit code: 1 · tests: 3 failed, 33 passed → RED",
  "[xUnit.net 00:00:00.19]     DatPhong.Tests.EdgeCaseTests.A_NemXungDot [FAIL]",
  "  Failed DatPhong.Tests.EdgeCaseTests.A_NemXungDot [1 ms]",
  "  Error Message:",
  "   Assert.Throws() Failure: No exception was thrown",
  "Expected: typeof(DatPhong.XungDotLichException)",
  "  Stack Trace:",
  "[xUnit.net 00:00:00.19]     DatPhong.Tests.EdgeCaseTests.B_DonLe [FAIL]",
  "[xUnit.net 00:00:00.19]     DatPhong.Tests.EdgeCaseTests.C_ThuTu [FAIL]",
  "  Failed DatPhong.Tests.EdgeCaseTests.B_DonLe [< 1 ms]",
  "Failed!  - Failed:     3, Passed:    33, Skipped:     0, Total:    36, Duration: 51 ms - DatPhong.Tests.dll (net10.0)",
].join("\n");

// BẢN PHÁT (đúng hình dạng lần cổng đỏ): `[FAIL]` + `Failed A` DÍNH một dòng; có dòng trống ở giữa; thứ tự khác; thời gian khác.
const PHAT = [
  "$ dotnet test cs-dat-phong/tests/DatPhong.Tests",
  "exit code: 1 · tests: 3 failed, 33 passed → RED",
  "[xUnit.net 00:00:00.18]     DatPhong.Tests.EdgeCaseTests.A_NemXungDot [FAIL]",
  "[xUnit.net 00:00:00.19]     DatPhong.Tests.EdgeCaseTests.B_DonLe [FAIL]  Failed DatPhong.Tests.EdgeCaseTests.A_NemXungDot [1 ms]",
  "  Error Message:",
  "   Assert.Throws() Failure: No exception was thrown",
  "Expected: typeof(DatPhong.XungDotLichException)",
  "",
  "[xUnit.net 00:00:00.19]     DatPhong.Tests.EdgeCaseTests.C_ThuTu [FAIL]",
  "  Stack Trace:",
  "  Failed DatPhong.Tests.EdgeCaseTests.B_DonLe [< 1 ms]",
  "Failed!  - Failed:     3, Passed:    33, Skipped:     0, Total:    36, Duration: 60 ms - DatPhong.Tests.dll (net10.0)",
  "",
].join("\n");

describe("dongDeSo — tách mẩu dính, bỏ dòng trống / khoảng trắng cuối, sắp", () => {
  it("★★★ tách `[FAIL]  Failed X [` dính một dòng thành hai dòng", () => {
    expect(dongDeSo("[xUnit.net 00:00:00.19]     T.B [FAIL]  Failed T.A [1 ms]")).toEqual(["  Failed T.A [1 ms]", "[xUnit.net 00:00:00.19]     T.B [FAIL]"]);
  });
  it("★★★ hai mẩu `[xUnit.net` dính nhau ⇒ tách", () => {
    expect(dongDeSo("[xUnit.net 00:00:00.19]     T.A [FAIL][xUnit.net 00:00:00.19]     T.B [FAIL]")).toEqual(["[xUnit.net 00:00:00.19]     T.A [FAIL]", "[xUnit.net 00:00:00.19]     T.B [FAIL]"]);
  });
  it("★★ dòng trống và khoảng trắng cuối bị bỏ; thứ tự không ảnh hưởng", () => {
    expect(dongDeSo("b  \n\n\na\t\n")).toEqual(["a", "b"]);
    expect(dongDeSo("b\r\na")).toEqual(dongDeSo("a\nb"));
  });
  it("★★★ KHÔNG tách nhầm: `  Failed X [` ở ĐẦU dòng, dòng tổng kết `Failed!  - Failed:`, `Failed:` giữa dòng", () => {
    expect(dongDeSo("  Failed T.A [1 ms]")).toEqual(["  Failed T.A [1 ms]"]);
    expect(dongDeSo("Failed!  - Failed:     3, Passed:    33")).toEqual(["Failed!  - Failed:     3, Passed:    33"]);
    expect(dongDeSo("x Failed: 3 và Failed không có ngoặc")).toEqual(["x Failed: 3 và Failed không có ngoặc"]);
    expect(dongDeSo("a [xUnitX b")).toEqual(["a [xUnitX b"]);
  });
  it("★★ chuỗi rỗng ⇒ mảng rỗng", () => {
    expect(dongDeSo("")).toEqual([]);
  });
});

describe("soYeuCau / soSuKien — ghi vs phát của dotnet test chạy song song", () => {
  it("★★★ mẫu thật (dính dòng + dòng trống + khác thứ tự + khác thời gian) ⇒ KHỚP", () => {
    expect(soYeuCau(yc([{ role: "tool", content: GHI }]), yc([{ role: "tool", content: PHAT }]))).toBeNull();
    expect(soSuKien([{ loai: "ket-qua-tool", dauRa: GHI }], [{ loai: "ket-qua-tool", dauRa: PHAT }])).toBeNull();
  });
  it("★★★ mất MỘT dòng nội dung thật ⇒ vẫn LỆCH (không nới thành nuốt dòng)", () => {
    const thieu = PHAT.replace("Expected: typeof(DatPhong.XungDotLichException)\n", "");
    expect(thieu).not.toBe(PHAT);
    expect(soYeuCau(yc([{ role: "tool", content: GHI }]), yc([{ role: "tool", content: thieu }]))).toMatchObject({ truong: "tin[0]" });
    expect(soSuKien([{ loai: "ket-qua-tool", dauRa: GHI }], [{ loai: "ket-qua-tool", dauRa: thieu }])).toMatchObject({ duong: "suKien[0].dauRa" });
  });
  it("★★★ đổi kết quả thật (3 failed ⇒ 2 failed) ⇒ LỆCH", () => {
    const khac = PHAT.replace("3 failed, 33 passed", "2 failed, 34 passed");
    expect(soYeuCau(yc([{ role: "tool", content: GHI }]), yc([{ role: "tool", content: khac }]))).toMatchObject({ truong: "tin[0]" });
  });
  it("★★ tin của MODEL (assistant) không được nới: dính dòng / dòng trống ⇒ vẫn LỆCH", () => {
    expect(soYeuCau(yc([{ role: "assistant", content: "a\nb" }]), yc([{ role: "assistant", content: "a\n\nb" }]))).toMatchObject({ truong: "tin[0]" });
  });
});
