// Lưới bộ ghép chế độ CHAT với các DẠNG câu trả lời model hay gặp (cả lớp, có main, import riêng, gói main…), chạy thật.
//   node --test scripts/ai-eval/ngau-nhien/multipl-e/ghep.test.mjs      (cần dữ liệu đã tải: multipl-e/tai.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ROOT } from "../lib/moiTruong.mjs";
import { xoaThuMuc } from "../lib/cham.mjs";
import { docBo, ghepChat, khoiMaChat, tenHam } from "./ghep.mjs";
import { chayLo } from "./chay.mjs";

const DU_LIEU = `${ROOT}/tmp/ngau-nhien/multipl-e`;
const coDuLieu = fs.existsSync(`${DU_LIEU}/nguon.json`);
const bai = (lang) => docBo(DU_LIEU, "humaneval", lang).find((r) => r.name === "HumanEval_53_add");

const BIEN_THE = {
  java: [
    "```java\nimport java.util.*;\n\npublic class Solution {\n    public static long add(long x, long y) {\n        return Phu.cong(x, y);\n    }\n    public static void main(String[] args) {\n        System.out.println(add(1, 2));\n    }\n}\n\nclass Phu {\n    static long cong(long a, long b) { return a + b; }\n}\n```",
    "Lời giải:\n```java\npublic static long add(long x, long y) {\n    // dấu } trong chuỗi: \"}\"\n    return x + y;\n}\n```",
  ],
  cs: [
    "```csharp\nusing System;\nusing System.Linq;\n\npublic class Program\n{\n    public static long Add(long x, long y)\n    {\n        return new[] { x, y }.Sum();\n    }\n\n    public static void Main(string[] args)\n    {\n        Console.WriteLine(Add(1, 2));\n    }\n}\n```",
  ],
  cpp: [
    "```cpp\n#include <vector>\n#include <numeric>\nlong add(long x, long y) {\n    std::vector<long> v{x, y};\n    return std::accumulate(v.begin(), v.end(), 0L);\n}\n\nint main() {\n    return add(1, 2) == 3 ? 0 : 1;\n}\n```",
  ],
  go: [
    "```go\npackage main\n\nimport (\n\t\"fmt\"\n\t\"strings\"\n)\n\nfunc add(x int, y int) int {\n\t_ = strings.TrimSpace(\" \")\n\treturn x + y\n}\n\nfunc main() {\n\tfmt.Println(add(1, 2))\n}\n```",
  ],
  rs: [
    "```rust\nuse std::collections::HashMap;\n\nfn add(x: isize, y: isize) -> isize {\n    let _m: HashMap<&'static str, isize> = HashMap::new();\n    x + y\n}\n\nfn main() {\n    println!(\"{}\", add(1, 2));\n}\n```",
  ],
  py: ["<think>nháp</think>\n```python\ndef add(x: int, y: int) -> int:\n    return x + y\n```"],
  ts: ["```typescript\nfunction add(x: number, y: number): number {\n  return x + y;\n}\n```"],
};

for (const [lang, ds] of Object.entries(BIEN_THE)) {
  test(`chat ${lang}: ${ds.length} dạng câu trả lời đều ghép + chạy ĐẠT`, { skip: !coDuLieu && "chưa tải dữ liệu" }, async () => {
    const r = bai(lang);
    assert.ok(r, `thiếu HumanEval_53_add cho ${lang}`);
    const lo = ds.map((t, i) => ({ khoa: `${lang}-${i}`, prog: ghepChat(r, khoiMaChat(t, tenHam(r))) }));
    const goc = `${ROOT}/tmp/ngau-nhien-work/ghep-test-${lang}-${process.pid}`;
    const kq = await chayLo(lang, lo, { goc, duLieu: DU_LIEU });
    xoaThuMuc(goc);
    for (const { khoa, prog } of lo) assert.ok(kq.get(khoa).dat, `${khoa} TRƯỢT:\n${kq.get(khoa).duoiRa}\n---\n${prog}`);
  });
}
