// node --test scripts/ai-eval/ngau-nhien/lib/st-matiec/chaySTMatiec.test.mjs — ADAPTER RuSTy → MATIEC (không cần Docker).
import test from "node:test";
import assert from "node:assert/strict";
import { themChamPhay, doiGNow, doiDongHoGia, doiLoiKiem, doiTenBienTest, chuyenTest, bangKieu, lyDoNgoaiTapOpenplc } from "./chaySTMatiec.mjs";

test("nới `;` sau từ khoá kết khối, không nhân đôi", () => {
  assert.equal(themChamPhay("IF a THEN b := 1; END_IF\nEND_FOR;"), "IF a THEN b := 1; END_IF;\nEND_FOR;");
});

test("G_NOW và TIME_TO_LINT đổi sang bản của prelude", () => {
  assert.equal(doiGNow("x := TIME_TO_LINT(G_NOW - t);"), "x := KT_TIME_TO_LINT(KT_NOW(FALSE) - t);");
  assert.equal(doiGNow("y := fb.TIME_TO_LINT;"), "y := fb.TIME_TO_LINT;"); // thành viên, không phải lời gọi
});

test("đồng hồ giả chỉ đổi KIỂU, không đổi biến tên tp", () => {
  assert.equal(doiDongHoGia("tg : TON; a : ARRAY[0..1] OF TP; tp := 1;"), "tg : KT_TON; a : ARRAY[0..1] OF KT_TP; tp := 1;");
});

test("KT_DINT/KT_REAL → KT_XET với phép so; chuỗi chứa dấu phẩy và ngoặc không làm lệch đối số", () => {
  assert.equal(doiLoiKiem("KT_DINT('a, (b)', fb.X, 3);"), "KT_XET('a, (b)', (fb.X) = (3));");
  assert.equal(doiLoiKiem("KT_REAL('r', f(1, 2), 1.5, 0.01);"), "KT_XET('r', ABS((f(1, 2)) - (1.5)) <= (0.01));");
});

test("ép kiểu vế thực khi hai vế khác kiểu số đã biết", () => {
  const src = "FUNCTION_BLOCK B\nVAR_OUTPUT K : INT; END_VAR\nEND_FUNCTION_BLOCK";
  const t = "FUNCTION main : DINT\nVAR\n fb : B;\n m : ARRAY[0..1] OF DINT;\nEND_VAR\n KT_DINT('k', fb.K, m[0]);\n main := KT_TONG();\nEND_FUNCTION";
  assert.match(doiLoiKiem(t, bangKieu([src, t])), /KT_XET\('k', \(INT_TO_DINT\(fb\.K\)\) = \(m\[0\]\)\)/);
});

test("biến test trùng tên chuẩn (rs) đổi tên, giữ vị trí KIỂU", () => {
  assert.equal(doiTenBienTest("VAR\n rs : BOOL; x : RS;\nEND_VAR\n k(rs := rs);"), "VAR\n KTX_rs : BOOL; x : RS;\nEND_VAR\n k(KTX_rs := KTX_rs);");
});

test("FUNCTION main → PROGRAM KT_MAIN, giữ số dòng", () => {
  const t = "FUNCTION main : DINT\nVAR\n a : INT;\nEND_VAR\n main := KT_TONG();\nEND_FUNCTION\n";
  const r = chuyenTest(t);
  assert.equal(r, "PROGRAM KT_MAIN\nVAR KT_KQ : DINT;\n a : INT;\nEND_VAR\n KT_KQ := KT_TONG(FALSE);\nEND_PROGRAM\n");
  assert.equal(r.split("\n").length, t.split("\n").length);
});

test("tập OpenPLC: tv1 chỉ ngoài tập khi dùng TON chuẩn", () => {
  assert.ok(lyDoNgoaiTapOpenplc("st-tv9-dem-xuong", "gia"));
  assert.ok(lyDoNgoaiTapOpenplc("st-tv1-chong-doi", "chuan"));
  assert.equal(lyDoNgoaiTapOpenplc("st-tv1-chong-doi", "gia"), null);
  assert.equal(lyDoNgoaiTapOpenplc("st-tv3-nhap-nhay", "chuan"), null);
});
