/**
 * ★ 2026-09-24 — chủ dự án chốt (b): tệp KB do `kb:sync` SINH RA không vào git. Nguồn sự thật danh sách là
 * `KB_ARTIFACT_FILES` trong `kbSyncScheduler.ts` (thứ autosync chụp/khôi phục). Lưới này đọc danh sách ấy từ MÃ NGUỒN và
 * hỏi chính git (`git check-ignore`) — thêm một tệp sinh mới vào scheduler mà quên .gitignore ⇒ đỏ; và ngược lại tệp
 * NGƯỜI VIẾT bị ignore nhầm ⇒ đỏ.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const src = fs.readFileSync(path.join(ROOT, "server/services/kbSyncScheduler.ts"), "utf8");
const khoi = src.slice(src.indexOf("const KB_ARTIFACT_FILES"), src.indexOf("].map((f) => path.join(KNOWLEDGE_DIR, f));"));
const DS = [...khoi.matchAll(/"([^"]+\.(?:json|jsonl))"/g)].map((m) => m[1]);

const biBoQua = (rel: string): boolean => {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", rel], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
};

describe("KB sinh ra ⇔ .gitignore", () => {
  it("đọc được danh sách từ scheduler (thước không rỗng)", () => {
    expect(DS.length).toBeGreaterThanOrEqual(15);
    expect(DS).toContain("chunks.jsonl");
  });
  it("★ mọi tệp trong KB_ARTIFACT_FILES đều bị git bỏ qua", () => {
    const lot = DS.filter((f) => !biBoQua(`knowledge/${f}`));
    expect(lot, `tệp sinh ra còn theo dõi trong git: ${lot.join(", ")}`).toEqual([]);
  });
  it("★★★ và KHÔNG còn được git THEO DÕI (quy tắc ignore không có tác dụng với tệp đã tracked)", () => {
    // Bài học 2026-09-24: `126908389` thêm .gitignore nhưng KHÔNG gỡ tệp nào — `git commit -- <paths>` lấy nội dung CÂY
    // LÀM VIỆC của các đường ấy, tệp còn trên đĩa nên lệnh xoá trong index bị bỏ. Ca `check-ignore` ở trên vẫn xanh vì nó chỉ
    // hỏi QUY TẮC. Ca này hỏi đúng thứ cần: git còn theo dõi tệp không.
    const conTheoDoi = execFileSync("git", ["ls-files", "--", "knowledge/"], { cwd: ROOT, encoding: "utf8" })
      .split(String.fromCharCode(10)).map((f) => f.trim())
      .filter((f) => DS.some((d) => f === `knowledge/${d}`) || f === "knowledge/rag-eval-results.json" || f.startsWith("knowledge/operational/"));
    expect(conTheoDoi, `còn theo dõi: ${conTheoDoi.slice(0, 5).join(", ")}…`).toEqual([]);
  });
  it("★ thẻ sinh operational/*.md và kết quả eval bị bỏ qua", () => {
    expect(biBoQua("knowledge/operational/andon.md")).toBe(true);
    expect(biBoQua("knowledge/rag-eval-results.json")).toBe(true);
  });
  it("★★ tệp NGƯỜI VIẾT KHÔNG bị bỏ qua", () => {
    for (const f of [
      "knowledge/domain/aoi-thresholds.md",
      "knowledge/operational-approved/andon.md",
      "knowledge/studio-golden/st4i-may-aoi.jsonl",
      "knowledge/rag-eval-goldenset.json",
      "knowledge/golden-code/index.json",
    ]) expect(biBoQua(f), f).toBe(false);
  });
});
