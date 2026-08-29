// Cổng Mốc 0: chạy CẢ HAI phía của hợp đồng schema và báo cáo cùng một chỗ.
//
// Vì sao cần một lệnh: hai phía sống ở hai toolchain (dotnet / node) và hai thư mục. Một người
// sửa schema rồi chỉ chạy phía mình là kịch bản drift chính mà Mốc 0 tồn tại để chặn.
//
// 🔴 Cổng này KHÔNG chạy Playwright, KHÔNG chạy bốn test project .NET khác, và KHÔNG build web.
// Nó chỉ đo hợp đồng. Xanh ở đây không có nghĩa nhánh sẵn sàng merge.

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const steps = [
  { name: ".NET contract tests", cmd: "dotnet", args: ["test", "tests/St4i.Hmi.Contracts.Tests"], cwd: ROOT },
  { name: "web contract tests", cmd: "npm", args: ["run", "test:contracts"], cwd: join(ROOT, "web") },
]

let failed = 0
for (const s of steps) {
  process.stdout.write(`\n=== ${s.name} ===\n`)
  const r = spawnSync(s.cmd, s.args, { cwd: s.cwd, stdio: "inherit", shell: process.platform === "win32" })
  if (r.status !== 0) { failed++; process.stdout.write(`!!! ${s.name} FAILED (exit ${r.status})\n`) }
}

process.stdout.write(failed === 0
  ? "\nCONTRACT GATE: PASS — hai phía đồng ý về cả ba schema.\n"
  : `\nCONTRACT GATE: FAIL — ${failed}/${steps.length} bước đỏ.\n`)
process.exit(failed === 0 ? 0 : 1)
