/**
 * CENSUS — mọi chỗ trong server/ CHỜ sự kiện `drain` (backpressure) phải nằm trong danh sách ghim dưới đây.
 *
 * Vì sao: Node ≥ 24.22 (đo 24.22.2 / 26.13.0) làm mất `drain` khi `ServerResponse.write(CHUỖI đa byte)` — vòng chờ treo vĩnh viễn
 * (xem `toWireBuffer` ở exportRouter). `net.Socket` và `stream.Writable` KHÔNG bị (đo cùng ngày). Quét 2026-10-30: đúng 2 nơi chờ `drain`.
 *
 * Thêm một chỗ chờ `drain` mới ⇒ test đỏ ⇒ thêm vào danh sách kèm LOẠI NGUỒN GHI:
 *   - "http-response": nguồn ghi là `ServerResponse`/`ClientRequest` ⇒ PHẢI ghi Buffer (`toWireBuffer`), test này kiểm mọi `res.write(` của tệp đó;
 *   - "writable": `stream.Writable` / `net.Socket` thuần ⇒ chuỗi đa byte an toàn.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const GOC = join(__dirname, "..", ".."); // server/

const GHIM: Record<string, "http-response" | "writable"> = {
  "api/export/exportRouter.ts": "http-response",
  "services/telemetryBus.ts": "writable", // ws = Writable của pg COPY, không phải HTTP
};

function tepNguon(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    if (ten === "node_modules") continue;
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) tepNguon(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten) && !/\.d\.ts$/.test(ten)) ra.push(p);
  }
  return ra;
}

const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Chờ/nghe sự kiện `drain` hoặc đọc cờ cần-drain (KHÔNG tính từ "drain" trong nghĩa khác: hàng đợi, kiểu "drain" của plugin…). */
const CHO_DRAIN = /\b(?:once|on|addListener|prependListener)\(\s*["']drain["']|events?\.once\([^)]*["']drain["']|writableNeedDrain|\bawaitDrain\b/;

describe("census chờ `drain` trong server/", () => {
  const thay = tepNguon(GOC)
    .map((p) => ({ rel: relative(GOC, p).split(sep).join("/"), mã: boChuThich(readFileSync(p, "utf8")) }))
    .filter((f) => CHO_DRAIN.test(f.mã))
    .map((f) => f.rel)
    .sort();

  it("tập tệp chờ drain == danh sách ghim (thêm/bớt một chỗ ⇒ phải xem lại nguồn ghi)", () => {
    expect(thay).toEqual(Object.keys(GHIM).sort());
  });

  it("★ tệp http-response: MỌI `.write(` lên response đều bọc `toWireBuffer(`", () => {
    for (const [rel, loai] of Object.entries(GHIM)) {
      if (loai !== "http-response") continue;
      const ma = boChuThich(readFileSync(join(GOC, rel), "utf8"));
      const loi = [...ma.matchAll(/\bres\.write\(([^;]*)\)/g)].filter((m) => !m[1].trimStart().startsWith("toWireBuffer("));
      expect(loi.map((m) => m[0]), `${rel}: res.write chuỗi trần`).toEqual([]);
    }
  });
});
