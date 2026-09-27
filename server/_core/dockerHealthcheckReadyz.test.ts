/**
 * doc 81 Đợt 1C Task 6 — Docker HEALTHCHECK của app trỏ `/readyz` (SELECT 1 thật, 503 khi DB mất),
 * còn probe LIVENESS của Helm/k8s giữ `/health` (200 khi tiến trình trả lời — không restart pod vì DB chập).
 *
 * Đọc NGUYÊN VĂN tệp triển khai (oracle = văn bản tệp, không phải mã sản phẩm). Quét MỌI
 * `docker-compose*.yml` trong repo (trừ node_modules) để một compose mới không lọt khỏi luật.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function timCompose(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (relative(ROOT, full).split(/[\\/]/).length > 4) continue;
      timCompose(full, out);
    } else if (/^docker-compose.*\.ya?ml$/.test(name)) out.push(full);
  }
  return out;
}

/** Healthcheck gọi HTTP vào app (cổng 3000/${PORT}) — các dịch vụ khác (pg_isready, emqx ctl…) không thuộc luật. */
const RE_HC_APP = /https?:\/\/127\.0\.0\.1:(?:3000|\$\{PORT\})(\/[\w-]*)/g;

describe("Task 6 — Docker HEALTHCHECK của app = /readyz; liveness Helm = /health", () => {
  it("★ Dockerfile: HEALTHCHECK gọi /readyz", () => {
    const txt = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    const hc = txt.slice(txt.indexOf("HEALTHCHECK"));
    const paths = [...hc.slice(0, 300).matchAll(RE_HC_APP)].map((m) => m[1]);
    expect(paths).toEqual(["/readyz"]);
  });

  it("★ mọi docker-compose*.yml: healthcheck HTTP vào app đều gọi /readyz", () => {
    const files = timCompose(ROOT);
    expect(files.length, "cầu chì: phải thấy compose thật").toBeGreaterThanOrEqual(2);
    const hits: Array<{ file: string; path: string }> = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((ln, i) => {
        if (!/test:/.test(ln) && !/wget|curl/.test(ln)) return;
        for (const m of ln.matchAll(RE_HC_APP)) hits.push({ file: `${relative(ROOT, f)}:${i + 1}`, path: m[1] });
      });
    }
    expect(hits.length, "cầu chì: phải thấy ít nhất một healthcheck app").toBeGreaterThanOrEqual(2);
    expect(hits.filter((h) => h.path !== "/readyz")).toEqual([]);
  });

  it("Helm: liveness GIỮ /health, readiness /readyz (không đổi)", () => {
    const v = readFileSync(join(ROOT, "deploy/helm/synapse/values.yaml"), "utf8");
    const khoi = (ten: string) => v.slice(v.indexOf(`  ${ten}:`), v.indexOf(`  ${ten}:`) + 200);
    expect(khoi("liveness")).toMatch(/path:\s*\/health\b/);
    expect(khoi("readiness")).toMatch(/path:\s*\/readyz\b/);
  });
});
