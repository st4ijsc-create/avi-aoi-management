/**
 * Vitest global setup — runs before every test file.
 *
 * Forces DATABASE_URL to an ISOLATED test database so the integration tests that hit a real
 * DB via getDb() (some DESTRUCTIVE, e.g. auth.setupAdmin wipes users) run WITHOUT ever
 * touching the dev/prod database.
 *
 * IMPORTANT: we deliberately do NOT load the whole .env — that would inject production
 * feature flags (FOE_ENABLED, AI_*, GGUF_*, …) and break the many tests that assert a flag
 * is OFF-by-default. We read ONLY the DB connection string from .env.
 *
 * Provision the test DB once with:  node scripts/setup-test-db.mjs
 *
 * SAFETY GUARD: the resolved test db name MUST contain "test" and MUST differ from the dev
 * db — otherwise we throw and abort the run rather than risk wiping dev data.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Read a SINGLE key from a .env file without injecting anything else into process.env. */
function readEnvKey(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1 || t.slice(0, i).trim() !== key) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return undefined;
}

function deriveTestUrl(devUrl: string): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const u = new URL(devUrl);
  const devName = u.pathname.replace(/^\//, "") || "postgres";
  u.pathname = "/" + devName + "_test";
  return u.toString();
}

const envFile = resolve(process.cwd(), ".env");
const devUrl = process.env.DATABASE_URL ?? readEnvKey(envFile, "DATABASE_URL");

if (devUrl) {
  const testUrl = deriveTestUrl(devUrl);
  const testName = new URL(testUrl).pathname.replace(/^\//, "");
  const devName = new URL(devUrl).pathname.replace(/^\//, "");

  if (!/test/i.test(testName) || testName === devName) {
    throw new Error(
      `[vitest.setup] Refusing to run: resolved test DB "${testName}" must contain "test" and ` +
      `differ from the dev DB "${devName}". Set TEST_DATABASE_URL to a dedicated test database.`,
    );
  }
  process.env.DATABASE_URL = testUrl;
}

// Minimal non-fatal defaults (only set when unset — never override a flag the test sets).
process.env.EXTERNAL_MQTT_ENABLED ??= "false";
process.env.NODE_ENV ??= "test";

/**
 * VRAM Pha 2A Task 3 — KHÔNG test đơn vị nào được sinh `powershell.exe`.
 *
 * `vramWiring.commitMeasured()` đo `actualBytes` bằng bộ đếm `\GPU Process Memory`, và mỗi đầu đo
 * là một `powershell.exe` + `Get-CimInstance Win32_Process` — **~1,5 s/lượt, hai lượt mỗi cửa sổ**
 * (đo được ở nghiệm thu sống). Nhiều test mock `node-llama-cpp` để "nạp" model tức thì rồi đi qua
 * đúng đường đó: `aiGgufEngine.test.ts` mở tới ba cửa sổ trong một ca ⇒ **~9 s telemetry** trên
 * một ca có trần 5 s. Trước dòng này, 12 ca ở đó đỏ vì HẾT GIỜ — không phải vì sai.
 *
 * `off` ⇒ đầu dò trả `null` ngay, lượt commit thành `measureFailed`, KHÔNG có tiến trình con nào.
 * Test nào cần đường đo THẬT thì `vi.mock("./vramProcessProbe")` — bản giả thay CẢ module nên cờ
 * này không đụng tới nó (xem `server/services/vram/wiring.*.test.ts`).
 *
 * ⚠ Ai muốn viết test khẳng định `actualBytes` có số: ĐỪNG gỡ dòng này (gỡ ra là cả bộ test chậm
 * thêm hàng phút và bất định theo tải máy) — hãy mock `./vramProcessProbe` trong chính file đó.
 */
process.env.VRAM_PROCESS_PROBE ??= "off";
