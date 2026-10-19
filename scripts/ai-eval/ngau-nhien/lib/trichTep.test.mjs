// Lưới của bộ trích tệp đường (a):  node --test scripts/ai-eval/ngau-nhien/lib/trichTep.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { trichTep, dungCauTraLoiGia } from "./trichTep.mjs";

const B = (tepGiai, dinhDanh) => ({ tepGiai, dinhDanh });

test("dòng đánh dấu đầu khối (định dạng yêu cầu) — bị bỏ khỏi nội dung", () => {
  const r = trichTep("```ts\n// tệp: src/a.ts\nexport const a = 1;\n```\n```ts\n// file: src/b.ts\nexport const b = 2;\n```", B(["src/a.ts", "src/b.ts"]));
  assert.deepEqual(r.thieu, []);
  assert.equal(r.tep["src/a.ts"].trim(), "export const a = 1;");
  assert.equal(r.tep["src/b.ts"].trim(), "export const b = 2;");
});

test("đường trong chuỗi thông tin của rào", () => {
  const r = trichTep("```python sol.py\nx = 1\n```\n```rust:src/lib.rs\nfn a() {}\n```", B(["sol.py", "src/lib.rs"]));
  assert.deepEqual(r.thieu, []);
  assert.equal(r.tep["sol.py"].trim(), "x = 1");
  assert.equal(r.cach["src/lib.rs"], "rao");
});

test("đường ở dòng chữ ngay trước khối (đậm, tiêu đề, đường Windows)", () => {
  const r = trichTep("**src/a.ts**\n```ts\nA\n```\n### `src\\b.ts`:\n```ts\nB\n```", B(["src/a.ts", "src/b.ts"]));
  assert.equal(r.tep["src/a.ts"].trim(), "A");
  assert.equal(r.tep["src/b.ts"].trim(), "B");
});

test("khớp đuôi đường duy nhất (model bỏ thư mục)", () => {
  const r = trichTep("```go\n// tệp: xu_ly.go\npackage bai\n```", B(["xu_ly.go"]));
  assert.equal(r.tep["xu_ly.go"].trim(), "package bai");
  const r2 = trichTep("```js\n// tệp: ndjson.mjs\nX\n```", B(["src/ndjson.mjs"]));
  assert.equal(r2.tep["src/ndjson.mjs"].trim(), "X");
});

test("một tệp, không đánh dấu: ưu tiên khối chứa định danh, rồi khối dài nhất", () => {
  const r = trichTep("Ví dụ dùng:\n```py\nprint(1)\n```\nLời giải:\n```py\ndef duong_re_nhat(c, a, b):\n    return None\n```", B(["duong_di.py"], "duong_re_nhat"));
  assert.match(r.tep["duong_di.py"], /def duong_re_nhat/);
});

test("khối trong <think> bị bỏ", () => {
  const r = trichTep("<think>\n```py\n# tệp: a.py\nSAI\n```\n</think>\n```py\n# tệp: a.py\nDUNG\n```", B(["a.py"]));
  assert.equal(r.tep["a.py"].trim(), "DUNG");
});

test("nhiều khối cùng tệp ⇒ lấy khối cuối", () => {
  const r = trichTep("```py\n# tệp: a.py\nV1\n```\nSửa lại:\n```py\n# tệp: a.py\nV2\n```", B(["a.py"]));
  assert.equal(r.tep["a.py"].trim(), "V2");
});

test("không có rào, một tệp ⇒ cả câu trả lời", () => {
  const r = trichTep("SELECT 1", B(["q.sql"]));
  assert.equal(r.tep["q.sql"], "SELECT 1");
});

test("nhiều tệp, thiếu hơn một ⇒ báo thiếu (không đoán)", () => {
  const r = trichTep("```ts\nA\n```\n```ts\nB\n```", B(["src/a.ts", "src/b.ts", "src/c.ts"]));
  assert.deepEqual(r.thieu.sort(), ["src/a.ts", "src/b.ts", "src/c.ts"]);
});

test("nhiều tệp, thiếu đúng một ⇒ khối còn lại", () => {
  const r = trichTep("```ts\n// tệp: src/a.ts\nA\n```\n```ts\nB\n```", B(["src/a.ts", "src/b.ts"]));
  assert.equal(r.tep["src/b.ts"].trim(), "B");
});

test("khứ hồi câu trả lời giả của kiểm thước", () => {
  const tep = { "src/a.ts": "const s = `x`;\n", "q.sql": "SELECT 1;\n", "a.py": "x = 1\n" };
  const r = trichTep(dungCauTraLoiGia(tep), B(Object.keys(tep)));
  for (const [k, v] of Object.entries(tep)) assert.equal(r.tep[k].trim(), v.trim());
});

test("dòng chú thích chỉ có đường (không chữ 'tệp:')", () => {
  const r = trichTep("```cpp\n// src/ngoac.cpp\n#include \"ngoac.hpp\"\n```", B(["src/ngoac.cpp"]));
  assert.equal(r.cach["src/ngoac.cpp"], "danh-dau");
  assert.equal(r.tep["src/ngoac.cpp"].trim(), '#include "ngoac.hpp"');
});
