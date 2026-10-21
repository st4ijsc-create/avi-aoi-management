// node --test scripts/ai-eval/ngau-nhien/lib/st-scl/scl.test.mjs — chuẩn hoá Siemens SCL → IEC ST (không cần Docker).
import test from "node:test";
import assert from "node:assert/strict";
import { sclSangSt, stSangScl, dauHieuScl, tachDoan } from "./scl.mjs";

test("bỏ # ở tham chiếu biến nhưng GIỮ hằng có tiền tố kiểu (16#, T#, WORD#16#)", () => {
  assert.equal(sclSangSt("#a := 16#FF; #t := T#1s; #w := WORD#16#00FF; #b := #a + DINT#5;"), "a := 16#FF; t := T#1s; w := WORD#16#00FF; b := a + DINT#5;");
});

test("không chạm chuỗi và chú thích", () => {
  // `//` đổi thành (* *) (MATIEC không nhận `//`), nội dung giữ nguyên
  assert.equal(sclSangSt("#s := '#x \"y\"'; // #z \"w\"\n(* #k *)"), "s := '#x \"y\"'; (* #z \"w\" *)\n(* #k *)");
});

test("tên khối/biến toàn cục trong ngoặc kép, thuộc tính, VERSION, REGION, BEGIN", () => {
  const scl = 'FUNCTION_BLOCK "Quat"\n{ S7_Optimized_Access := \'TRUE\' }\nVERSION : 0.1\nVAR\n  t : TON_TIME;\nEND_VAR\nBEGIN\nREGION chay\n  #t(IN := "G_NOW" > T#0s, PT := T#1s);\nEND_REGION\nEND_FUNCTION_BLOCK';
  const st = sclSangSt(scl);
  assert.match(st, /^FUNCTION_BLOCK Quat\n/);
  assert.doesNotMatch(st, /S7_Optimized|VERSION|REGION|BEGIN|"/);
  assert.match(st, /t : TON;/);
  assert.match(st, /t\(IN := G_NOW > T#0s, PT := T#1s\);/);
  assert.equal(st.split("\n").length, scl.split("\n").length); // giữ số dòng ⇒ chẩn đoán trỏ đúng dòng SCL
});

test("IEC_TIMER / IEC_COUNTER lấy kiểu từ lời gọi `#x.TON(` / `#c.CTU(`", () => {
  const st = sclSangSt("VAR\n x : IEC_TIMER;\n c : IEC_COUNTER;\nEND_VAR\n#x.TON(IN := TRUE, PT := T#1s);\n#c.CTU(CU := #x.Q, PV := 3);\n#q := #x.Q;");
  assert.match(st, /x : TON;/);
  assert.match(st, /c : CTU;/);
  assert.match(st, /\nx\(IN := TRUE, PT := T#1s\);\nc\(CU := x\.Q, PV := 3\);\nq := x\.Q;/);
});

test("stSangScl: khung có thuộc tính, # trong thân, TON → TON_TIME, END_IF;", () => {
  const scl = stSangScl("FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR t : TON; END_VAR\n  IF x THEN t(IN := x); END_IF\nEND_FUNCTION_BLOCK\n");
  assert.match(scl, /FUNCTION_BLOCK "A"\n\{ S7_Optimized_Access := 'TRUE' \}\nVERSION : 0\.1/);
  assert.match(scl, /t : TON_TIME;/);
  assert.match(scl, /IF #x THEN #t\(IN := #x\); END_IF;/);
  assert.deepEqual(dauHieuScl(scl), { tenKhoiNgoacKep: true, soThamChieuThang: 3 });
});

test("MIN/MAX/SEL dạng tham số hình thức → vị trí (sắp theo tên), dạng vị trí để nguyên", () => {
  assert.equal(sclSangSt("#r := MIN(IN2 := #b, IN1 := MAX(IN1 := #a, IN2 := 0.0));"), "r := MIN(MAX(a, 0.0), b);");
  assert.equal(sclSangSt("#r := SEL(G := #c, IN0 := 1, IN1 := 2);"), "r := SEL(c, 1, 2);");
  assert.equal(sclSangSt("#r := MIN(#a, #b);"), "r := MIN(a, b);");
  assert.equal(sclSangSt("#r := LIMIT(MX := #h, IN := #v, MN := #l);"), "r := LIMIT(l, v, h);");
});

test("tachDoan nhận chuỗi có $' thoát", () => {
  assert.deepEqual(tachDoan("a := 'x$'y'; b").map((d) => d.loai), ["ma", "chuoi", "ma"]);
});
