/**
 * G2-D — LƯỚI cho apply-diff THEO TỪNG KHỐI (hunk).
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ LỚP HẬU QUẢ ĐANG CANH: MẤT MÃ CỦA NGƯỜI DÙNG.
 * ══════════════════════════════════════════════════════════════════════════════════
 * Một phép dịch offset sai một dòng, một ký tự `\r` bị nuốt, hay một lượt áp mù khi
 * buffer đã đổi — cả ba đều KHÔNG báo lỗi. Chúng ghi đè im lặng rồi trả về một chuỗi
 * trông hợp lý. Vì vậy mọi khẳng định ở đây so sánh TỪNG KÝ TỰ (`toBe` trên chuỗi
 * nguyên vẹn), không so "số dòng", không so "có chứa".
 *
 * BA BẤT BIẾN TRỤ CỘT (mỗi cái đều đã được ĐỘT BIẾN để chứng minh nó đo được):
 *   B1. `projectHunks(plan, MỌI id).text === plan.modified` — từng ký tự. Đây là ca
 *       chống hồi quy: "áp mọi khối" phải bằng ĐÚNG "áp tất cả" của đường cũ.
 *   B2. Kết quả KHÔNG phụ thuộc thứ tự chọn (#2 rồi #5 ≡ #5 rồi #2 ≡ tập {2,5}).
 *   B3. Buffer đổi giữa chừng ⇒ TỪ CHỐI, không ghi đè.
 *
 * ⚠ `text.split("\n").join("\n") === text` là một SONG ÁNH tuyệt đối — nó giữ nguyên
 *   cả `\r` của CRLF lẫn dòng rỗng cuối do newline cuối sinh ra. Toàn bộ thiết kế dựa
 *   trên tính chất đó; các ca CRLF/newline-cuối bên dưới là phép ĐO tính chất ấy chứ
 *   không phải trang trí.
 */
import { describe, it, expect } from "vitest";
import {
  applyHunkSelection,
  computeHunkPlan,
  detectEol,
  normalizeEol,
  projectHunks,
  textSignature,
  DEFAULT_MAX_DIFF_LINES,
  type HunkPlan,
} from "./diffHunks";

const ids = (plan: HunkPlan) => plan.hunks.map((h) => h.id);
const applyAll = (plan: HunkPlan) => {
  const r = projectHunks(plan, ids(plan));
  if (!r.ok) throw new Error(`projectHunks failed: ${r.reason}`);
  return r.text;
};
const applySome = (plan: HunkPlan, pick: number[]) => {
  const r = projectHunks(plan, pick.map((i) => plan.hunks[i].id));
  if (!r.ok) throw new Error(`projectHunks failed: ${r.reason}`);
  return r.text;
};

// ────────────────────────────────────────────────────────────────────────────────
describe("computeHunkPlan — tách diff thành khối", () => {
  it("hai bản giống hệt ⇒ 0 khối, và áp-tất-cả trả về CHÍNH chuỗi đó", () => {
    const plan = computeHunkPlan("a\nb\nc", "a\nb\nc");
    expect(plan.hunks).toHaveLength(0);
    expect(applyAll(plan)).toBe("a\nb\nc");
  });

  it("một dòng đổi ⇒ ĐÚNG một khối, mang cả nội dung trước lẫn sau", () => {
    const plan = computeHunkPlan("a\nb\nc", "a\nB\nc");
    expect(plan.hunks).toHaveLength(1);
    expect(plan.hunks[0]).toMatchObject({
      index: 0,
      origStart: 1,
      origEnd: 2,
      removed: ["b"],
      added: ["B"],
    });
  });

  it("khối CHỈ THÊM dòng: phạm vi gốc rỗng (origStart === origEnd)", () => {
    const plan = computeHunkPlan("a\nb", "a\nx\nb");
    expect(plan.hunks).toHaveLength(1);
    expect(plan.hunks[0]).toMatchObject({ origStart: 1, origEnd: 1, removed: [], added: ["x"] });
    expect(applyAll(plan)).toBe("a\nx\nb");
  });

  it("khối CHỈ XOÁ dòng: added rỗng", () => {
    const plan = computeHunkPlan("a\nb\nc", "a\nc");
    expect(plan.hunks).toHaveLength(1);
    expect(plan.hunks[0]).toMatchObject({ origStart: 1, origEnd: 2, removed: ["b"], added: [] });
    expect(applyAll(plan)).toBe("a\nc");
  });

  it("khối VỪA THÊM VỪA XOÁ gộp thành MỘT khối, không tách đôi", () => {
    const plan = computeHunkPlan("a\nb\nc\nd", "a\nX\nY\nZ\nd");
    expect(plan.hunks).toHaveLength(1);
    expect(plan.hunks[0].removed).toEqual(["b", "c"]);
    expect(plan.hunks[0].added).toEqual(["X", "Y", "Z"]);
    expect(applyAll(plan)).toBe("a\nX\nY\nZ\nd");
  });

  it("định danh khối ỔN ĐỊNH qua các lần tính lại cùng đầu vào", () => {
    const a = "l1\nl2\nl3\nl4\nl5";
    const b = "l1\nL2\nl3\nl4\nL5";
    expect(ids(computeHunkPlan(a, b))).toEqual(ids(computeHunkPlan(a, b)));
  });

  it("định danh khối là DUY NHẤT ngay cả khi hai khối có nội dung y hệt nhau", () => {
    // Hai chỗ sửa GIỐNG HỆT nhau về nội dung — chỉ khác vị trí.
    const plan = computeHunkPlan("x\nsep\nx\n", "y\nsep\ny\n");
    expect(plan.hunks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids(plan)).size).toBe(plan.hunks.length);
  });

  it("thứ tự khối tăng dần theo origStart (điều kiện tiên quyết của phép áp một-lượt)", () => {
    const plan = computeHunkPlan("a\nb\nc\nd\ne\nf\ng", "A\nb\nC\nd\ne\nF\ng");
    const starts = plan.hunks.map((h) => h.origStart);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
    expect(plan.hunks.map((h) => h.index)).toEqual(plan.hunks.map((_, i) => i));
  });
});

// ────────────────────────────────────────────────────────────────────────────────
describe("dịch chuyển offset — chỗ dễ sai nhất", () => {
  // Bảy dòng, ba chỗ sửa KHÔNG liền nhau. Sau khi áp khối #0 (1 dòng → 2 dòng) mọi
  // toạ độ phía sau lệch +1; áp tiếp khối #2 mà không dịch sẽ ghi vào SAI DÒNG.
  const ORIG = "l0\nl1\nl2\nl3\nl4\nl5\nl6";
  const MOD = "A0\nA0b\nl1\nl2\nB3\nl4\nl5\nC6\nC6b";

  it("khối #0 nở ra 2 dòng ⇒ khối sau vẫn ghi ĐÚNG chỗ", () => {
    const plan = computeHunkPlan(ORIG, MOD);
    expect(plan.hunks.length).toBe(3);
    expect(applySome(plan, [0])).toBe("A0\nA0b\nl1\nl2\nl3\nl4\nl5\nl6");
    // #0 + #1: dòng l3 → B3, dù #0 đã nở thêm một dòng phía trên.
    expect(applySome(plan, [0, 1])).toBe("A0\nA0b\nl1\nl2\nB3\nl4\nl5\nl6");
    // #0 + #2 (BỎ QUA #1): l3 phải còn NGUYÊN, l6 phải đổi.
    expect(applySome(plan, [0, 2])).toBe("A0\nA0b\nl1\nl2\nl3\nl4\nl5\nC6\nC6b");
  });

  it("chọn khối #1 rồi #2 (KHÔNG liền nhau) cho kết quả đúng từng ký tự", () => {
    const plan = computeHunkPlan(ORIG, MOD);
    expect(applySome(plan, [1, 2])).toBe("l0\nl1\nl2\nB3\nl4\nl5\nC6\nC6b");
  });

  it("THỨ TỰ CHỌN không ảnh hưởng kết quả (#0,#2 ≡ #2,#0)", () => {
    const plan = computeHunkPlan(ORIG, MOD);
    expect(applySome(plan, [2, 0])).toBe(applySome(plan, [0, 2]));
  });

  it("áp theo THỨ TỰ NGƯỢC (#2 → #1 → #0) ≡ áp xuôi ≡ áp tất cả", () => {
    const plan = computeHunkPlan(ORIG, MOD);
    expect(applySome(plan, [2, 1, 0])).toBe(applySome(plan, [0, 1, 2]));
    expect(applySome(plan, [2, 1, 0])).toBe(MOD);
  });

  it("khối LIỀN KỀ — chỉ cách nhau ĐÚNG một dòng không đổi (bẫy lệch-một)", () => {
    const plan = computeHunkPlan("a\nb\nc", "A\nb\nC");
    expect(plan.hunks).toHaveLength(2);
    expect(plan.hunks[0]).toMatchObject({ origStart: 0, origEnd: 1 });
    expect(plan.hunks[1]).toMatchObject({ origStart: 2, origEnd: 3 });
    expect(applySome(plan, [0])).toBe("A\nb\nc");
    expect(applySome(plan, [1])).toBe("a\nb\nC");
    expect(applySome(plan, [0, 1])).toBe("A\nb\nC");
  });

  it("hai khối CHỈ-THÊM liền kề chèn đúng chỗ, không dồn cục", () => {
    const plan = computeHunkPlan("a\nb\nc", "a\nX\nb\nY\nc");
    expect(plan.hunks).toHaveLength(2);
    expect(applySome(plan, [0])).toBe("a\nX\nb\nc");
    expect(applySome(plan, [1])).toBe("a\nb\nY\nc");
    expect(applySome(plan, [0, 1])).toBe("a\nX\nb\nY\nc");
  });

  it("khối XOÁ ở đầu file và khối XOÁ ở cuối file", () => {
    const plan = computeHunkPlan("a\nb\nc\nd", "b\nc");
    expect(applyAll(plan)).toBe("b\nc");
    expect(applySome(plan, [0])).toBe("b\nc\nd");
    expect(applySome(plan, [1])).toBe("a\nb\nc");
  });

  it("chọn TẬP RỖNG ⇒ trả về bản gốc y nguyên (hoàn tác về điểm xuất phát)", () => {
    const plan = computeHunkPlan(ORIG, MOD);
    const rong = projectHunks(plan, []);
    expect(rong.ok).toBe(true);
    expect(rong.ok && rong.text).toBe(ORIG);
  });

  it("nhận rồi HOÀN TÁC: bật {0,1} rồi bỏ {0} ≡ chỉ có {1}", () => {
    const plan = computeHunkPlan(ORIG, MOD);
    expect(applySome(plan, [1])).toBe(applySome(plan, [1]));
    // Hoàn tác là một phép chiếu lại từ BẢN GỐC, không phải phép nghịch đảo tại chỗ —
    // nên nó không thể tích luỹ sai số.
    const sau = applySome(plan, [0, 1]);
    const hoanTac = applySome(plan, [1]);
    expect(sau).not.toBe(hoanTac);
    expect(hoanTac).toBe("l0\nl1\nl2\nB3\nl4\nl5\nl6");
  });

  it("id lạ ⇒ TỪ CHỐI, không im lặng bỏ qua", () => {
    const plan = computeHunkPlan(ORIG, MOD);
    const r = projectHunks(plan, [plan.hunks[0].id, "khong-ton-tai"]);
    expect(r).toMatchObject({ ok: false, reason: "unknown-hunk", id: "khong-ton-tai" });
  });
});

// ────────────────────────────────────────────────────────────────────────────────
describe("CRLF / LF / newline cuối — Windows repo, đây là ca THẬT", () => {
  it("detectEol nhận ra CRLF, LF, và mặc định LF khi không có dòng nào", () => {
    expect(detectEol("a\r\nb\r\n")).toBe("\r\n");
    expect(detectEol("a\nb\n")).toBe("\n");
    expect(detectEol("mot-dong-duy-nhat")).toBe("\n");
    // Đa số CRLF (2/3) vẫn khai CRLF; đa số LF khai LF.
    expect(detectEol("a\r\nb\r\nc\n")).toBe("\r\n");
    expect(detectEol("a\r\nb\nc\nd\n")).toBe("\n");
  });

  it("normalizeEol qua lại KHÔNG nhân đôi \\r", () => {
    expect(normalizeEol("a\r\nb", "\r\n")).toBe("a\r\nb");
    expect(normalizeEol("a\nb", "\r\n")).toBe("a\r\nb");
    expect(normalizeEol("a\r\nb", "\n")).toBe("a\nb");
  });

  it("file CRLF: khối áp xong vẫn CRLF, không rụng \\r nào", () => {
    const a = "line1\r\nline2\r\nline3\r\n";
    const b = "line1\r\nLINE2\r\nline3\r\n";
    const plan = computeHunkPlan(a, b);
    expect(plan.hunks).toHaveLength(1);
    expect(applyAll(plan)).toBe(b);
    expect(applyAll(plan)).toContain("\r\n");
    expect(applyAll(plan).split("\r\n")).toHaveLength(4);
  });

  it("CRLF + KHÔNG có newline cuối", () => {
    const a = "x\r\ny\r\nz";
    const b = "x\r\nY\r\nz";
    expect(applyAll(computeHunkPlan(a, b))).toBe(b);
    expect(applyAll(computeHunkPlan(a, b)).endsWith("z")).toBe(true);
  });

  it("LF + CÓ newline cuối: dòng rỗng cuối được giữ NGUYÊN", () => {
    const a = "x\ny\n";
    const b = "x\nY\n";
    const out = applyAll(computeHunkPlan(a, b));
    expect(out).toBe("x\nY\n");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("THÊM newline cuối là một khối áp được, và KHÔNG bị nuốt", () => {
    const plan = computeHunkPlan("x\ny", "x\ny\n");
    expect(plan.hunks.length).toBeGreaterThan(0);
    expect(applyAll(plan)).toBe("x\ny\n");
  });

  it("XOÁ newline cuối là một khối áp được", () => {
    const plan = computeHunkPlan("x\ny\n", "x\ny");
    expect(plan.hunks.length).toBeGreaterThan(0);
    expect(applyAll(plan)).toBe("x\ny");
  });

  it("⚠ ca 'stripThinking().trim()' — THỤT ĐẦU DÒNG và newline hai đầu phải NGUYÊN VẸN", () => {
    const suggested = "\n    return a + b;\n";
    const plan = computeHunkPlan("", suggested);
    expect(applyAll(plan)).toBe(suggested);
    // và không có một biến thể "gần đúng" nào lọt qua:
    expect(applyAll(plan)).not.toBe("return a + b;");
    expect(applyAll(plan)).not.toBe("    return a + b;");
    expect(applyAll(plan)).not.toBe(suggested.trim());
  });

  it("khoảng trắng cuối dòng và tab được giữ từng ký tự", () => {
    const a = "if (x) {\n\tdoWork();  \n}";
    const b = "if (x) {\n\tdoWork(); \n\tdoMore();\t\n}";
    expect(applyAll(computeHunkPlan(a, b))).toBe(b);
  });

  it("matchEol: LF của model được kéo về CRLF của buffer, và plan.modified phản ánh ĐÚNG cái sẽ ghi", () => {
    const a = "p\r\nq\r\nr\r\n";
    const b = "p\nQ\nr\n"; // model trả LF
    const tho = computeHunkPlan(a, b);
    // Không khớp EOL: MỌI dòng khác nhau → một khối nuốt cả file (trung thực nhưng vô dụng).
    expect(tho.eolMatched).toBe(false);
    expect(applyAll(tho)).toBe(b);

    const khop = computeHunkPlan(a, b, { matchEol: true });
    expect(khop.eolMatched).toBe(true);
    expect(khop.hunks).toHaveLength(1);
    expect(khop.modified).toBe("p\r\nQ\r\nr\r\n");
    expect(applyAll(khop)).toBe("p\r\nQ\r\nr\r\n");
  });

  it("matchEol khi hai bên ĐÃ cùng EOL ⇒ không đổi gì, eolMatched=false", () => {
    const plan = computeHunkPlan("a\nb\n", "a\nB\n", { matchEol: true });
    expect(plan.eolMatched).toBe(false);
    expect(plan.modified).toBe("a\nB\n");
  });
});

// ────────────────────────────────────────────────────────────────────────────────
describe("B1 — 'áp MỌI khối' ≡ 'áp tất cả' (bằng đúng, TỪNG KÝ TỰ)", () => {
  const CAP: Array<[string, string, string]> = [
    ["rỗng → rỗng", "", ""],
    ["rỗng → có nội dung", "", "hello\nworld\n"],
    ["có nội dung → rỗng", "hello\nworld\n", ""],
    ["một dòng đổi", "a", "b"],
    ["LF thường", "a\nb\nc\n", "a\nB\nc\n"],
    ["CRLF thường", "a\r\nb\r\nc\r\n", "a\r\nB\r\nc\r\n"],
    ["CRLF không newline cuối", "a\r\nb\r\nc", "a\r\nB\r\nc"],
    ["thêm newline cuối", "a\nb", "a\nb\n"],
    ["xoá newline cuối", "a\nb\n", "a\nb"],
    ["chỉ có newline", "\n", "\n\n"],
    ["nhiều dòng rỗng", "\n\n\n", "\n\nx\n"],
    ["thụt đầu dòng", "", "\n    return a + b;\n"],
    ["tab + khoảng trắng cuối", "\tx \n", "\tx\t\n  y  \n"],
    [
      "chương trình ST thật",
      "PROGRAM Main\r\nVAR\r\n  x : INT;\r\nEND_VAR\r\n  x := x + 1;\r\nEND_PROGRAM\r\n",
      "PROGRAM Main\r\nVAR\r\n  x : INT;\r\n  y : REAL;\r\nEND_VAR\r\n  x := x + 2;\r\n  y := INT_TO_REAL(x);\r\nEND_PROGRAM\r\n",
    ],
    ["xoá sạch giữa file", "a\nb\nc\nd\ne", "a\ne"],
    ["đảo thứ tự dòng", "1\n2\n3\n4", "4\n3\n2\n1"],
  ];

  for (const [ten, a, b] of CAP) {
    it(`${ten}: projectHunks(mọi id) === modified`, () => {
      const plan = computeHunkPlan(a, b);
      expect(applyAll(plan)).toBe(b);
      expect(plan.modified).toBe(b);
    });
  }

  it("fuzz tất định 400 cặp: áp-mọi-khối === modified, VÀ mọi tập con đều bắt đầu từ bản gốc", () => {
    // LCG tất định — hỏng là tái hiện được, không phải "thỉnh thoảng đỏ".
    let seed = 20260816;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const TOKEN = ["a", "b", "c", "  d", "\te", "", "x := 1;", "END_IF", "  "];

    for (let lan = 0; lan < 400; lan++) {
      const eol = rnd() < 0.5 ? "\n" : "\r\n";
      const n = 1 + Math.floor(rnd() * 12);
      const aLines: string[] = Array.from({ length: n }, () => pick(TOKEN));
      const bLines: string[] = [];
      for (const l of aLines) {
        const r = rnd();
        if (r < 0.18) continue; // xoá
        if (r < 0.34) { bLines.push(pick(TOKEN)); continue; } // đổi
        if (r < 0.44) { bLines.push(l); bLines.push(pick(TOKEN)); continue; } // thêm sau
        bLines.push(l);
      }
      const trailA = rnd() < 0.5 ? eol : "";
      const trailB = rnd() < 0.5 ? eol : "";
      const a = aLines.join(eol) + trailA;
      const b = bLines.join(eol) + trailB;

      const plan = computeHunkPlan(a, b);
      expect(applyAll(plan)).toBe(b);
      const rong = projectHunks(plan, []);
      expect(rong.ok && rong.text).toBe(a);
      if (plan.hunks.length >= 2) {
        const daoNguoc = projectHunks(plan, [...ids(plan)].reverse());
        expect(daoNguoc.ok && daoNguoc.text).toBe(b);
      }
    }
  });

  it("áp từng khối một cách TÍCH LUỸ (thêm dần vào tập chọn) hội tụ đúng bản modified", () => {
    const a = "1\n2\n3\n4\n5\n6\n7\n8\n9";
    const b = "1\nII\n3\n4\nV\nV2\n6\n7\n9";
    const plan = computeHunkPlan(a, b);
    expect(plan.hunks.length).toBeGreaterThanOrEqual(3);
    const chon: string[] = [];
    let cuoi = a;
    for (const h of plan.hunks) {
      chon.push(h.id);
      const r = projectHunks(plan, chon);
      expect(r.ok).toBe(true);
      if (r.ok) cuoi = r.text;
    }
    expect(cuoi).toBe(b);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
describe("B3 — buffer đổi giữa chừng ⇒ TỪ CHỐI, tuyệt đối không ghi đè", () => {
  const A = "a\nb\nc\nd\ne";
  const B = "a\nB\nc\nD\ne";

  it("buffer còn nguyên bản gốc, chưa áp gì ⇒ CHO PHÉP", () => {
    const plan = computeHunkPlan(A, B);
    const r = applyHunkSelection({ plan, applied: [], next: [plan.hunks[0].id], currentText: A });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("a\nB\nc\nd\ne");
  });

  it("buffer đúng bằng cái ta ĐÃ ghi ở lượt trước ⇒ CHO PHÉP áp tiếp", () => {
    const plan = computeHunkPlan(A, B);
    const b1 = plan.hunks[0].id;
    const b2 = plan.hunks[1].id;
    const sauLuot1 = "a\nB\nc\nd\ne";
    const r = applyHunkSelection({ plan, applied: [b1], next: [b1, b2], currentText: sauLuot1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(B);
  });

  it("người dùng GÕ THÊM giữa hai lượt ⇒ TỪ CHỐI (đây là ca mất mã)", () => {
    const plan = computeHunkPlan(A, B);
    const b1 = plan.hunks[0].id;
    const b2 = plan.hunks[1].id;
    const nguoiDungGoThem = "a\nB\nc\nd\ne\n// ghi chú của tôi";
    const r = applyHunkSelection({ plan, applied: [b1], next: [b1, b2], currentText: nguoiDungGoThem });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("buffer-changed");
    // và KHÔNG có trường `text` nào để lỡ tay ghi ra:
    expect((r as { text?: string }).text).toBeUndefined();
  });

  it("thay đổi CHỈ MỘT ký tự khoảng trắng cũng bị bắt", () => {
    const plan = computeHunkPlan(A, B);
    const r = applyHunkSelection({ plan, applied: [], next: ids(plan), currentText: A + " " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("buffer-changed");
  });

  it("đổi RIÊNG kiểu xuống dòng (LF→CRLF) cũng bị bắt — không coi là 'giống nhau'", () => {
    const plan = computeHunkPlan(A, B);
    const r = applyHunkSelection({ plan, applied: [], next: ids(plan), currentText: A.replace(/\n/g, "\r\n") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("buffer-changed");
  });

  it("chữ ký buffer báo được LỆCH mà không lộ nội dung mã", () => {
    const plan = computeHunkPlan(A, B);
    const r = applyHunkSelection({ plan, applied: [], next: ids(plan), currentText: "hoan toan khac" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "buffer-changed") {
      expect(r.expected).toBe(textSignature(A));
      expect(r.actual).toBe(textSignature("hoan toan khac"));
      expect(r.expected).not.toBe(r.actual);
      expect(r.actual).not.toContain("hoan toan khac");
    }
  });

  it("textSignature phân biệt được chuỗi cùng độ dài và chuỗi rỗng", () => {
    expect(textSignature("abc")).not.toBe(textSignature("abd"));
    expect(textSignature("")).toBe(textSignature(""));
    expect(textSignature("a\r\nb")).not.toBe(textSignature("a\nb"));
  });

  it("id lạ trong `next` ⇒ từ chối trước cả khi tính chuỗi", () => {
    const plan = computeHunkPlan(A, B);
    const r = applyHunkSelection({ plan, applied: [], next: ["ma-gia"], currentText: A });
    expect(r).toMatchObject({ ok: false, reason: "unknown-hunk", id: "ma-gia" });
  });

  it("id lạ trong `applied` ⇒ từ chối (trạng thái nội bộ đã hỏng, không đoán mò)", () => {
    const plan = computeHunkPlan(A, B);
    const r = applyHunkSelection({ plan, applied: ["ma-gia"], next: ids(plan), currentText: A });
    expect(r).toMatchObject({ ok: false, reason: "unknown-hunk" });
  });
});

// ────────────────────────────────────────────────────────────────────────────────
describe("cầu chì kích thước — LCS là O(n·m), không được treo trình duyệt", () => {
  /**
   * ★★★ doc 79 (2026-08-21) — CA NÀY ĐÃ ĐỔI, VÀ ĐỔI VÌ MỘT PHÉP ĐO.
   *
   * Bản cũ khẳng định *"file quá lớn ⇒ MỘT khối cả-file"* với dữ liệu là một tệp 1.550 dòng
   * đổi **đúng một dòng**. Nó xanh, và nó mô tả một hành vi HỎNG: thẻ duyệt hiện
   * **+1550 / −1550** cho một lượt sửa một dòng, tức người duyệt được mời bấm "Duyệt & ghi"
   * trên một diff nói rằng cả tệp vừa bị thay. Đo được ở live: một tệp **1.602 dòng** (≈28 KB,
   * nhỏ hơn cả trần của tác nhân sửa tệp) đã chạm ngưỡng này.
   *
   * Cầu chì vẫn còn — nó chỉ được đo trên PHẦN LÕI (sau khi cắt đầu/đuôi giống nhau), tức
   * đúng phần LCS phải chạy. Nên ca này nay nuôi bằng một diff mà phần lõi THẬT SỰ lớn.
   */
  it("PHẦN LÕI quá lớn ⇒ MỘT khối phủ lõi, khai báo oversize, bất biến B1 vẫn giữ", () => {
    const n = DEFAULT_MAX_DIFF_LINES + 50;
    const a = Array.from({ length: n }, (_, i) => `dong ${i}`).join("\n");
    // MỌI dòng đều khác ⇒ không cắt được gì ⇒ lõi = cả tệp ⇒ cầu chì nổ đúng lúc.
    const b = Array.from({ length: n }, (_, i) => `DONG KHAC ${i}`).join("\n");
    const plan = computeHunkPlan(a, b);
    expect(plan.oversize).toBe(true);
    expect(plan.hunks).toHaveLength(1);
    expect(applyAll(plan)).toBe(b);
    const rong = projectHunks(plan, []);
    expect(rong.ok && rong.text).toBe(a);
  });

  /**
   * ★★★ HÀNH VI MỚI — và đây là mệnh đề mà cả đường "sửa theo khối" dựa vào: một lượt sửa CÓ
   * ĐÍCH trên một tệp rất lớn phải cho ra một diff CÓ ĐÍCH, không phải một khối nuốt cả tệp.
   */
  it("★★★ tệp RẤT LỚN nhưng sửa CÓ ĐÍCH ⇒ KHÔNG oversize, đúng một khối +1 −1", () => {
    const n = DEFAULT_MAX_DIFF_LINES * 3;
    const a = Array.from({ length: n }, (_, i) => `dong ${i}`).join("\n");
    const b = Array.from({ length: n }, (_, i) => (i === 2000 ? "DA SUA" : `dong ${i}`)).join("\n");
    const plan = computeHunkPlan(a, b);
    expect(plan.oversize, "cắt đầu/đuôi giống nhau ⇒ lõi chỉ còn 1 dòng ⇒ cầu chì không chạm").toBe(false);
    expect(plan.hunks).toHaveLength(1);
    expect(plan.hunks[0].origStart).toBe(2000);
    expect(plan.hunks[0].removed).toEqual(["dong 2000"]);
    expect(plan.hunks[0].added).toEqual(["DA SUA"]);
    expect(applyAll(plan), "bất biến B1 TỪNG KÝ TỰ").toBe(b);
    const rong = projectHunks(plan, []);
    expect(rong.ok && rong.text).toBe(a);
  });

  it("★★★ CHÈN thuần vào GIỮA một tệp rất lớn ⇒ một khối +1 −0 (lõi rỗng một bên)", () => {
    const n = DEFAULT_MAX_DIFF_LINES * 2;
    const aLines = Array.from({ length: n }, (_, i) => `dong ${i}`);
    const bLines = [...aLines.slice(0, 900), "DONG MOI", ...aLines.slice(900)];
    const plan = computeHunkPlan(aLines.join("\n"), bLines.join("\n"));
    expect(plan.oversize).toBe(false);
    expect(plan.hunks).toHaveLength(1);
    expect(plan.hunks[0].removed).toEqual([]);
    expect(plan.hunks[0].added).toEqual(["DONG MOI"]);
    expect(applyAll(plan)).toBe(bLines.join("\n"));
    const rong = projectHunks(plan, []);
    expect(rong.ok && rong.text).toBe(aLines.join("\n"));
  });

  it("★★★ XOÁ thuần ở GIỮA một tệp rất lớn ⇒ một khối +0 −1", () => {
    const n = DEFAULT_MAX_DIFF_LINES * 2;
    const aLines = Array.from({ length: n }, (_, i) => `dong ${i}`);
    const bLines = [...aLines.slice(0, 900), ...aLines.slice(901)];
    const plan = computeHunkPlan(aLines.join("\n"), bLines.join("\n"));
    expect(plan.oversize).toBe(false);
    expect(plan.hunks).toHaveLength(1);
    expect(plan.hunks[0].removed).toEqual(["dong 900"]);
    expect(plan.hunks[0].added).toEqual([]);
    expect(applyAll(plan)).toBe(bLines.join("\n"));
  });

  it("dưới ngưỡng ⇒ tách khối bình thường", () => {
    const n = 200;
    const a = Array.from({ length: n }, (_, i) => `dong ${i}`).join("\n");
    const b = Array.from({ length: n }, (_, i) => (i === 7 ? "DA SUA" : `dong ${i}`)).join("\n");
    const plan = computeHunkPlan(a, b);
    expect(plan.oversize).toBe(false);
    expect(plan.hunks).toHaveLength(1);
    expect(plan.hunks[0].origStart).toBe(7);
  });
});
