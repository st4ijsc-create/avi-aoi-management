/**
 * HA-10 — phủ danh sách ĐÃ DUYỆT. THUẦN (AST typescript, không fs / mạng).
 * ĐỘT BIẾN PHẢI BẮT: tag sai dạng · ca skip/todo/each/tên động vẫn tính · ca rỗng / expect(hằng) vẫn tính · ca CŨ đổi tên vẫn tính · không PASSED vẫn tính · GIỮ vẫn đòi ca ·
 * một tag phủ nhiều dòng · expect không matcher vẫn tính · tag lạ làm dòng thiếu biến mất · thông điệp lộ nội dung thẻ.
 */
import { describe, expect, it } from "vitest";
import { boTienToTag, CAU_LUAT_PHU, docDongDaDuyet, docVitestJson, loiNhacPhu, quetCaTest, tenMoiCa, tinhPhu } from "./kiemPhu";

const QT = [
  "Danh sách dưới khoá ĐÃ DUYỆT đã được duyệt. Làm ngay.",
  "ĐÃ DUYỆT:",
  "1. Bỏ null khỏi query.",
  "2. Bỏ chuỗi rỗng.",
  "3. GIỮ: mọi test đang xanh vẫn xanh.",
  "4) Ca biên: path kết thúc bằng ?",
  "",
  "5. Dòng sau khoảng trống",
  "Dòng này không đánh số nên dừng",
  "6. Không được đọc",
].join("\n");

describe("docDongDaDuyet", () => {
  it("★★★ đọc dòng đánh số dưới `ĐÃ DUYỆT:`, nhận `1.` và `4)`, GIỮ nhận cả không dấu, bỏ qua dòng trống, DỪNG ở dòng không đánh số", () => {
    expect(docDongDaDuyet(QT)).toEqual([
      { k: 1, giu: false, noiDung: "Bỏ null khỏi query." },
      { k: 2, giu: false, noiDung: "Bỏ chuỗi rỗng." },
      { k: 3, giu: true, noiDung: "GIỮ: mọi test đang xanh vẫn xanh." },
      { k: 4, giu: false, noiDung: "Ca biên: path kết thúc bằng ?" },
      { k: 5, giu: false, noiDung: "Dòng sau khoảng trống" },
    ]);
    expect(docDongDaDuyet("ĐÃ DUYỆT:\n1. a\n2. GIU: b")[1]!.giu).toBe(true);
    expect(docDongDaDuyet("da duyet:\n7. x")[0]!.k).toBe(7);
  });
  it("★★ không có khối / rỗng / undefined ⇒ []; khoá k trùng giữ lần đầu; số có khoảng trắng thụt vẫn nhận", () => {
    expect(docDongDaDuyet(undefined)).toEqual([]);
    expect(docDongDaDuyet("")).toEqual([]);
    expect(docDongDaDuyet("không có khối nào\n1. x")).toEqual([]);
    expect(docDongDaDuyet("ĐÃ DUYỆT:\n1. đầu\n1. trùng\n  2. thụt")).toEqual([
      { k: 1, giu: false, noiDung: "đầu" },
      { k: 2, giu: false, noiDung: "thụt" },
    ]);
  });
});

describe("quetCaTest — AST", () => {
  it("★★★ it/test/.only/.concurrent tính; .skip/.todo/.each/.skipIf(…)() KHÔNG tính; tên template có ${} hoặc biến ⇒ tenDong", () => {
    const q = quetCaTest(`
      it("[D1] a", () => { expect(f(1)).toBe(2); });
      test("[D2] b", () => { expect(f(2)).toBe(3); });
      it.only("[D3] c", () => { expect(f(3)).toBe(4); });
      it.concurrent("[D4] d", async () => { expect(await g()).toBe(1); });
      it.skip("[D5] e", () => { expect(f(5)).toBe(6); });
      it.todo("[D6] f");
      it.each([1, 2])("[D7] g %s", (n) => { expect(f(n)).toBe(n); });
      it.skipIf(true)("[D8] h", () => { expect(f(8)).toBe(9); });
      const ten = "[D9] i";
      it(ten, () => { expect(f(9)).toBe(1); });
      it(\`[D10] j \${ten}\`, () => { expect(f(10)).toBe(1); });
      it(\`[D11] k\`, () => { expect(f(11)).toBe(1); });
    `);
    expect(q.ca.map((c) => c.tag)).toEqual([1, 2, 3, 4, 11]);
    expect(q.tenDong).toBe(2);
  });
  it("★★★ expect THẬT: giá trị không phải hằng + có matcher; `.not` / `.resolves` / expect.soft vẫn tính; expect không matcher, expect(hằng), hằng so hằng KHÔNG", () => {
    const ca = (than: string) => quetCaTest(`it("[D1] x", () => { ${than} });`).ca[0]!;
    expect(ca("expect(f(1)).toBe(2);").assertThat).toBe(true);
    expect(ca("expect(f(1)).not.toBe(2);").assertThat).toBe(true);
    expect(ca("await expect(p()).resolves.toBe(2);").assertThat).toBe(true);
    expect(ca("expect.soft(f(1)).toBe(2);").assertThat).toBe(true);
    expect(ca("const y = f(1); expect(y).toEqual({ a: 1 });").assertThat).toBe(true);
    expect(ca("expect(x.y).toBeTruthy();").assertThat).toBe(true);
    expect(ca("").assertThat).toBe(false);
    expect(ca("").chiHangSo).toBe(false);
    expect(ca("console.log(f(1));").assertThat).toBe(false);
    expect(ca("expect(f(1));").assertThat).toBe(false); // không có matcher
    expect(ca("expect(f(1));").chiHangSo).toBe(false);
    for (const hang of ["expect(true).toBe(true);", "expect(1).toBe(1);", 'expect("a").toBe("a");', "expect([1, 2]).toEqual([1, 2]);", "expect({ a: 1 }).toEqual({ a: 1 });", "expect(1 + 1).toBe(2);", "expect(null).toBeNull();", "expect(undefined).toBeUndefined();", "expect(-1).toBe(-1);"]) {
      const c = ca(hang);
      expect(c.assertThat, hang).toBe(false);
      expect(c.chiHangSo, hang).toBe(true);
    }
    // một expect thật trong số nhiều expect hằng ⇒ tính
    expect(ca("expect(1).toBe(1); expect(f(2)).toBe(3);").assertThat).toBe(true);
  });
  it("★★ tệp không phải mã hợp lệ ⇒ không ném, không ca (fail-closed)", () => {
    expect(quetCaTest("}{ đây không phải mã ((").ca).toEqual([]);
    expect(quetCaTest("").ca).toEqual([]);
  });
  it("★★ tag phải ở ĐẦU tên và đúng dạng `[Dk] ` (có dấu cách): `[D3]x`, ` [D3] x`, `[d3] x`, `[D] x`, `D3 x` ⇒ không tag", () => {
    const tags = ["[D3]x", " [D3] x", "[d3] x", "[D] x", "D3 x", "[D3] ok", "[D12] ok", "[D1234] no"].map((t) => quetCaTest(`it(${JSON.stringify(t)}, () => { expect(f()).toBe(1); });`).ca[0]!.tag);
    expect(tags).toEqual([null, null, null, null, null, 3, 12, null]);
  });
});

const dong = (qt = QT) => docDongDaDuyet(qt);
const caXanh = (k: number, ten = "nội dung") => `it("[D${k}] ${ten}", () => { expect(f(${k})).toBe(${k}); });`;

describe("tinhPhu", () => {
  it("★★★ đủ: mọi dòng không GIỮ có ca [Dk] thật ⇒ dongThieu rỗng; GIỮ KHÔNG đòi ca", () => {
    const p = tinhPhu(dong(), [caXanh(1), caXanh(2), caXanh(4), caXanh(5)].join("\n"));
    expect(p.dongCanPhu).toEqual([1, 2, 4, 5]);
    expect(p.dongGiu).toEqual([3]);
    expect(p.dongThieu).toEqual([]);
    expect(p.dongDaPhu).toEqual([1, 2, 4, 5]);
    expect(p.caMoi).toHaveLength(4);
  });
  it("★★★ thiếu: dòng 2 và 5 không có ca ⇒ dongThieu [2,5], không phụ thuộc thứ tự ca", () => {
    const p = tinhPhu(dong(), [caXanh(4), caXanh(1)].join("\n"));
    expect(p.dongThieu).toEqual([2, 5]);
    expect(p.dongDaPhu).toEqual([1, 4]);
  });
  it("★★★ MỘT ca không phủ nhiều dòng: ca `[D1]` chỉ phủ dòng 1 (không có cách gắn một tên cho mọi dòng)", () => {
    const p = tinhPhu(dong(), caXanh(1));
    expect(p.dongThieu).toEqual([2, 4, 5]);
  });
  it("★★★ ca RỖNG / chỉ log / expect không matcher ⇒ không tính (loaiBo.rong); toàn hằng ⇒ hangSoHang", () => {
    const nguon = [`it("[D1] a", () => {});`, `it("[D2] b", () => { console.log(1); });`, `it("[D4] c", () => { expect(true).toBe(true); });`, `it("[D5] d", () => { expect(1).toBe(1); });`].join("\n");
    const p = tinhPhu(dong(), nguon);
    expect(p.dongThieu).toEqual([1, 2, 4, 5]);
    expect(p.loaiBo).toMatchObject({ rong: 2, hangSoHang: 2 });
  });
  it("★★★ ca skip / todo / each / tên động ⇒ không tính", () => {
    const nguon = [`it.skip("[D1] a", () => { expect(f(1)).toBe(1); });`, `it.todo("[D2] b");`, `it.each([1])("[D4] c %s", (n) => { expect(f(n)).toBe(n); });`, "it(`[D5] d ${x}`, () => { expect(f(5)).toBe(5); });"].join("\n");
    const p = tinhPhu(dong(), nguon);
    expect(p.dongThieu).toEqual([1, 2, 4, 5]);
    expect(p.loaiBo.tenDong).toBe(1);
  });
  it("★★★ ca CŨ đổi tên để gắn tag KHÔNG tính: tên (có tag hoặc bỏ tag) trùng một ca ở base ⇒ caCuDoiTen", () => {
    const cu = new Set(["giữ nguyên hành vi A", "[D2] đã có từ base"]);
    const nguon = [caXanh(1, "ca mới thật"), caXanh(2, "đã có từ base"), `it("[D4] giữ nguyên hành vi A", () => { expect(f(4)).toBe(4); });`, caXanh(5)].join("\n");
    const p = tinhPhu(dong(), nguon, { tenCaCu: cu });
    expect(p.dongThieu).toEqual([2, 4]); // [D2]: tên TRÙNG NGUYÊN VĂN một ca ở base ⇒ ca cũ; [D4]: đổi tên ca cũ (bỏ tag trùng)
    expect(p.caCuDoiTen).toEqual(["[D2] đã có từ base", "[D4] giữ nguyên hành vi A"]);
    expect(p.loaiBo.caCuDoiTen).toBe(2);
    expect(p.dongDaPhu).toEqual([1, 5]);
  });
  it("★★★ kiểm cuối: chỉ ca vitest báo PASSED mới tính (đỏ / skip / không có trong JSON ⇒ không)", () => {
    const nguon = [caXanh(1), caXanh(2), caXanh(4), caXanh(5)].join("\n");
    const passed = new Set(["[D1] nội dung", "[D4] nội dung"]);
    const p = tinhPhu(dong(), nguon, { passed });
    expect(p.dongDaPhu).toEqual([1, 4]);
    expect(p.dongThieu).toEqual([2, 5]);
    expect(p.loaiBo.khongPassed).toBe(2);
  });
  it("★★ tag LẠ ([D99], không có trong thẻ) không phủ gì và được liệt kê; không có khối ĐÃ DUYỆT ⇒ không dòng nào cần phủ", () => {
    const p = tinhPhu(dong(), `${caXanh(99)}\n${caXanh(1)}`);
    expect(p.tagLa).toEqual([99]);
    expect(p.dongThieu).toEqual([2, 4, 5]);
    expect(tinhPhu([], caXanh(1))).toMatchObject({ dongCanPhu: [], dongThieu: [] });
  });
  it("★★ ca không tag không phủ; hai ca cùng tag tính một lần cho dòng ấy", () => {
    const p = tinhPhu(dong(), [`it("không tag", () => { expect(f(1)).toBe(1); });`, caXanh(1, "một"), caXanh(1, "hai")].join("\n"));
    expect(p.dongDaPhu).toEqual([1]);
    expect(p.caMoi).toHaveLength(2);
  });
});

describe("loiNhacPhu — thông điệp trả cho model", () => {
  it("★★★ thiếu ⇒ chỉ số dòng + tag; KHÔNG chứa nội dung dòng thẻ", () => {
    const p = tinhPhu(dong(), caXanh(1));
    const m = loiNhacPhu(p);
    expect(m).toContain("dòng 2, 4, 5 chưa có ca");
    expect(m).toContain("[D2], [D4], [D5]");
    for (const rieng of ["Bỏ chuỗi rỗng", "Ca biên", "kết thúc bằng"]) expect(m).not.toContain(rieng);
  });
  it("★★ đủ ⇒ dòng xác nhận; không dòng cần phủ ⇒ chuỗi rỗng", () => {
    expect(loiNhacPhu(tinhPhu(dong(), [caXanh(1), caXanh(2), caXanh(4), caXanh(5)].join("\n")))).toContain("đủ 4/4");
    expect(loiNhacPhu(tinhPhu([], ""))).toBe("");
    expect(CAU_LUAT_PHU).toContain("[Dk]");
  });
});

describe("docVitestJson / tenMoiCa", () => {
  it("★★ chỉ ca status 'passed' (đỏ / skipped bị bỏ); JSON hỏng hoặc không có testResults ⇒ null", () => {
    const j = JSON.stringify({ testResults: [{ assertionResults: [{ title: "[D1] a", status: "passed" }, { title: "[D2] b", status: "failed" }, { title: "[D3] c", status: "skipped" }] }, { assertionResults: [{ title: "[D4] d", status: "passed" }] }] });
    expect([...docVitestJson(j)!].sort()).toEqual(["[D1] a", "[D4] d"]);
    expect(docVitestJson("không phải json")).toBeNull();
    expect(docVitestJson("{}")).toBeNull();
    expect(docVitestJson(JSON.stringify({ testResults: [{}] }))!.size).toBe(0);
  });
  it("★★ tenMoiCa liệt kê mọi ca tên thuần (kể cả không tag)", () => {
    expect([...tenMoiCa(`it("a", () => {}); test("[D1] b", () => {}); it.skip("c", () => {});`)].sort()).toEqual(["[D1] b", "a"]);
  });
});

describe("boTienToTag (bo-the-phu)", () => {
  it("★★★ bỏ ĐÚNG tiền tố `[Dk] ` của tên ca, giữ phần còn lại; không đụng chuỗi/chú thích khác; số ca không đổi; idempotent", () => {
    const nguon = [`// ví dụ: "[D1] trong chú thích" không được đụng`, `const s = "[D2] chuỗi thường";`, `it("[D1] một", () => { expect(f(1)).toBe(1); });`, "it(`[D12] hai`, () => { expect(f(2)).toBe(2); });", `it("không tag", () => { expect(f(3)).toBe(3); });`].join("\n");
    const r = boTienToTag(nguon);
    expect(r.soBo).toBe(2);
    expect(r.nguon).toContain(`it("một", `);
    expect(r.nguon).toContain("it(`hai`, ");
    expect(r.nguon).toContain(`"[D1] trong chú thích"`);
    expect(r.nguon).toContain(`"[D2] chuỗi thường"`);
    expect(r.nguon).toContain(`it("không tag", `);
    expect(quetCaTest(r.nguon).ca).toHaveLength(quetCaTest(nguon).ca.length);
    expect(quetCaTest(r.nguon).ca.every((c) => c.tag === null)).toBe(true);
    expect(boTienToTag(r.nguon)).toEqual({ nguon: r.nguon, soBo: 0 });
  });
  it("★★ nhiều ca cùng dòng / nhiều tag: không lệch vị trí sau khi bỏ (bỏ từ cuối lên)", () => {
    const nguon = `it("[D1] a", () => { expect(f(1)).toBe(1); }); it("[D2] b", () => { expect(f(2)).toBe(2); }); it("[D3] c", () => { expect(f(3)).toBe(3); });`;
    const r = boTienToTag(nguon);
    expect(r.soBo).toBe(3);
    expect(quetCaTest(r.nguon).ca.map((c) => c.ten)).toEqual(["a", "b", "c"]);
  });
});

describe("HA-10 bổ sung (kiem-dinh: k7/k8/k9 hằng; k17/k20 bộ đếm loaiBo và dòng GIỮ)", () => {
  const ca = (than: string) => quetCaTest(`it("[D1] x", () => { ${than} });`).ca[0]!;

  it("★★★ NaN / Infinity / -Infinity / undefined là HẰNG: expect(NaN).toBe(NaN) không được tính là ca thật", () => {
    for (const hang of ["expect(NaN).toBe(NaN);", "expect(NaN).toBeNaN();", "expect(Infinity).toBe(Infinity);", "expect(-Infinity).toBe(-Infinity);", "expect(undefined).toBe(undefined);"]) {
      const c = ca(hang);
      expect(c.assertThat, hang).toBe(false);
      expect(c.chiHangSo, hang).toBe(true);
    }
  });
  it("★★★ nhị phân hằng-với-BIẾN (cả hai thứ tự) và mảng / đối tượng có BIẾN KHÔNG phải hằng ⇒ ca thật", () => {
    for (const that of ["expect(x + 1).toBe(2);", "expect(1 + x).toBe(2);", "expect(x + y).toBe(2);", "expect([1, x]).toEqual([1, 2]);", "expect([x]).toEqual([1]);", "expect({ a: x }).toEqual({ a: 1 });", "expect(f(1) === 1).toBe(true);"]) {
      const c = ca(that);
      expect(c.assertThat, that).toBe(true);
      expect(c.chiHangSo, that).toBe(false);
    }
    // đối chứng: cả hai vế đều hằng ⇒ vẫn là hằng
    expect(ca("expect(1 + 2).toBe(3);").chiHangSo).toBe(true);
    expect(ca("expect([1, 2]).toEqual([1, 2]);").chiHangSo).toBe(true);
  });
  it("★★★ bộ đếm loaiBo: ca RỖNG đếm vào `rong`, ca toàn hằng đếm vào `hangSoHang` (không lẫn nhau; số lượng khác nhau để bắt đổi chỗ)", () => {
    const nguon = [`it("[D1] a", () => {});`, `it("[D2] b", () => { expect(true).toBe(true); });`, `it("[D4] c", () => { expect(1).toBe(1); });`, `it("[D5] d", () => { expect(NaN).toBe(NaN); });`].join("\n");
    const p = tinhPhu(dong(), nguon);
    expect(p.loaiBo).toEqual({ rong: 1, hangSoHang: 3, caCuDoiTen: 0, khongPassed: 0, tenDong: 0 });
    expect(p.dongThieu).toEqual([1, 2, 4, 5]);
  });
  it("★★★ ca mang tag của dòng GIỮ không phủ gì: dongDaPhu và caMoi KHÔNG chứa dòng GIỮ, không phải tag lạ, không vào loaiBo", () => {
    const p = tinhPhu(dong(), [caXanh(3, "giữ"), caXanh(1)].join("\n"));
    expect(p.dongDaPhu).toEqual([1]);
    expect(p.caMoi).toEqual(["[D1] nội dung"]);
    expect(p.dongGiu).toEqual([3]);
    expect(p.tagLa).toEqual([]);
    expect(p.loaiBo).toEqual({ rong: 0, hangSoHang: 0, caCuDoiTen: 0, khongPassed: 0, tenDong: 0 });
    expect(p.dongThieu).toEqual([2, 4, 5]);
  });
});
