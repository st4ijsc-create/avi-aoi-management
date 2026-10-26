/**
 * Đợt 10.4 (N3) — CENSUS: chỗ DUY NHẤT dựng giao diện từ trường của `KetQuaKiemDinh` (`banChuanHoa`, `baiHocDeXuat`) là `HienThiKetQuaNgoai`.
 * Mọi tệp client (không phải test) nhắc tới các trường này phải LÀ bộ hiển thị, hoặc IMPORT nó — để lô sau không thêm đường render thô
 * (Markdown / innerHTML / liên kết) cho đầu ra AI ngoài. Đột biến: thêm tệp client render `banChuanHoa` mà không import ⇒ đỏ.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(__dirname, "../../../..");
function quet(dir: string, ra: string[] = []): string[] {
  for (const t of readdirSync(dir)) {
    if (t === "node_modules" || t === "dist") continue;
    const p = join(dir, t);
    if (statSync(p).isDirectory()) quet(p, ra);
    else if (/\.(ts|tsx)$/.test(t) && !/\.(test|spec)\.(ts|tsx)$/.test(t)) ra.push(p);
  }
  return ra;
}

describe("census — render kết quả AI ngoài chỉ qua HienThiKetQuaNgoai", () => {
  const files = quet(join(GOC, "client", "src"));
  it("quét đủ tệp (không phải glob rỗng)", () => expect(files.length).toBeGreaterThan(500));
  it("tệp client nhắc `banChuanHoa` / `baiHocDeXuat` ⇒ phải là bộ hiển thị hoặc import nó", () => {
    const vi: string[] = [];
    for (const f of files) {
      const rel = relative(GOC, f).split("\\").join("/");
      if (rel.endsWith("components/ai/HienThiKetQuaNgoai.tsx")) continue;
      const s = readFileSync(f, "utf8");
      if (!/\b(banChuanHoa|baiHocDeXuat)\b/.test(s)) continue;
      if (/HienThiKetQuaNgoai/.test(s)) continue;
      vi.push(rel);
    }
    expect(vi, "tệp render trường kết quả AI ngoài mà KHÔNG dùng HienThiKetQuaNgoai").toEqual([]);
  });
});
