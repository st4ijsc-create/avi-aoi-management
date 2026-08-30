// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// WS-HMI-1 whole-branch review, finding L3 — `package.json`'s `//test:runtime` marker instructs future
// authors to list any new `runtime-tests/*.test.mjs` explicitly in the `test:runtime` script (a glob
// exits 0 on zero matches, which is precisely the failure this convention exists to avoid — see that
// marker's own text) and to "re-verify the printed test COUNT grew, not just that the command still
// exits 0." Measured: nothing anywhere CROSS-CHECKED the instruction against reality — a seventh file
// added to `runtime-tests/` and never added to the script would simply never run, `npm run test:runtime`
// would exit 0 with a green (but stale) count, and nobody would notice until a human re-counted by hand.
// This file is that cross-check, made mechanical. Same shape as `hmiWiring.test.mjs`'s guard against a
// silent revert: a convention stated in prose, closed with a real assertion.
//
// 🔴 Bài này KHÔNG đo: rằng MỖI file trong `runtime-tests/` thật sự CHỨA test hữu ích — chỉ đo rằng tập
// file trên đĩa và tập file được liệt kê trong script `test:runtime` là ĐÚNG MỘT tập, hai chiều. Một file
// rỗng hay vô nghĩa nhưng có tên đúng vẫn qua được bài này; đó là việc của người review, không phải của
// một bài đối chiếu tên file.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = dirname(HERE)

test("package.json's test:runtime script liệt kê ĐÚNG tập file *.test.mjs có trên đĩa trong runtime-tests/ — không thừa, không thiếu", () => {
  const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8"))
  const script = pkg.scripts["test:runtime"]
  assert.ok(typeof script === "string" && script.length > 0, 'package.json thiếu scripts["test:runtime"]')

  // Bóc TÊN FILE từ script — hình dạng đã biết: "node --test runtime-tests/a.test.mjs runtime-tests/b.test.mjs …"
  const listedInScript = [...script.matchAll(/runtime-tests\/([\w.-]+\.test\.mjs)/g)].map((m) => m[1]).sort()
  assert.ok(listedInScript.length > 0, 'không bóc được file nào từ scripts["test:runtime"] — regex đã hỏng, hoặc hình dạng script đã đổi khỏi "runtime-tests/<file>.test.mjs"')

  const onDisk = readdirSync(join(WEB, "runtime-tests")).filter((f) => f.endsWith(".test.mjs")).sort()

  const missingFromScript = onDisk.filter((f) => !listedInScript.includes(f))
  const extraInScript = listedInScript.filter((f) => !onDisk.includes(f))

  assert.deepEqual(
    missingFromScript,
    [],
    `File(s) có trên đĩa nhưng KHÔNG được liệt kê trong scripts["test:runtime"], nên KHÔNG BAO GIỜ chạy: ${missingFromScript.join(", ")} — thêm vào script VÀ cập nhật comment "//test:runtime" (xem marker cạnh nó)`
  )
  assert.deepEqual(
    extraInScript,
    [],
    `scripts["test:runtime"] liệt kê (các) file KHÔNG có trên đĩa: ${extraInScript.join(", ")} — script đang trỏ tới file đã xoá/đổi tên`
  )
})
