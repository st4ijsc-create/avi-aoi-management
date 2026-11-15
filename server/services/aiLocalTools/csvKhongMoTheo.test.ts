/**
 * B1 `.csv` — CA PHỦ ĐỊNH CHO TỪNG ĐƯỜNG KHÔNG ĐƯỢC MỞ THEO + CENSUS điểm gọi. Cờ AI_AGENT_CSV_DOC=1 BẬT trong cả tệp này (chứng minh không rò theo khi cờ bật).
 * Phạm vi duyệt: chỉ `read_file` (đọc) và `apply_diff.phanQuyetChinhSachDuong(duong, goc)` (ghi) hỏi `csvDuocPhep`. KHÔNG mở theo: chỉ mục mã, nhập ZIP, cửa git, dòng chữ prompt,
 * `grep`/`glob`, tạo khung, xoá/đổi tên, IDE người dùng, đường AI ngoài.
 * ĐỘT BIẾN PHẢI BẮT: thêm `.csv` vào DUOI_CHO_PHEP · thêm điểm gọi `csvDuocPhep` ở nơi khác · đặt `choPhepCsv` ở người gọi khác (IDE / git / ST) · chỉ mục / ZIP / git đổi sang dùng `csvDuocPhep`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DUOI_CAM_NGOAI, DUOI_CHO_PHEP, DUOI_CHO_PHEP_NGOAI, TEN_TEP_CHO_PHEP, phanQuyetTepNgoai } from "../../../shared/aiNgoaiDenyList";
import { docTepChiMuc } from "../ai/chiMucMa/hopCatChiMuc";
import { lyDoBoQua } from "../ai/duAnCaNhan/nhapZipAnToan";
import { duoiDuocPhep, duyetTepDocDuoc } from "./repoSandbox";
import { phanQuyetChinhSachDuong } from "./writeHandlers/applyDiff";

let REPO: string;
let DU_AN: string;
beforeEach(() => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csv-khong-")));
  DU_AN = path.join(REPO, "sandbox-projects", "agent-f");
  fs.mkdirSync(path.join(DU_AN, "du_lieu"), { recursive: true });
  fs.writeFileSync(path.join(DU_AN, "du_lieu", "nho.csv"), "ma,so\nA,1\n");
  fs.writeFileSync(path.join(DU_AN, "ma.py"), "x = 1\n");
  vi.stubEnv("AI_AGENT_CSV_DOC", "1");
  vi.spyOn(process, "cwd").mockReturnValue(REPO);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(REPO, { recursive: true, force: true });
});

describe("KHÔNG mở theo — hành vi (cờ BẬT)", () => {
  it("★★★ tập đuôi dùng chung KHÔNG có `.csv`: duoiDuocPhep, DUOI_CHO_PHEP, DUOI_CHO_PHEP_NGOAI, TEN_TEP_CHO_PHEP; DUOI_CAM_NGOAI vẫn có", () => {
    expect(duoiDuocPhep("a.csv")).toBe(false);
    expect(DUOI_CHO_PHEP.has(".csv")).toBe(false);
    expect(DUOI_CHO_PHEP_NGOAI.has(".csv")).toBe(false);
    expect(TEN_TEP_CHO_PHEP.has("a.csv")).toBe(false);
    expect(DUOI_CAM_NGOAI.has(".csv")).toBe(true);
  });
  it("★★★ đường AI NGOÀI: phanQuyetTepNgoai từ chối `.csv`", () => {
    expect(phanQuyetTepNgoai("du_lieu/nho.csv")).not.toBeNull();
  });
  it("★★★ chỉ mục mã (docTepChiMuc) từ chối `.csv` trong chính dự án", () => {
    expect(docTepChiMuc(DU_AN, "du_lieu/nho.csv")).toMatchObject({ ok: false, ma: "DENIED_EXT" });
    expect(docTepChiMuc(DU_AN, "ma.py").ok).toBe(true);
  });
  it("★★★ nhập ZIP (lyDoBoQua) bỏ qua `.csv`", () => {
    expect(lyDoBoQua("du_lieu/nho.csv")).not.toBeNull();
    expect(lyDoBoQua("ma.py")).toBeNull();
  });
  it("★★★ grep / find_files (duyetTepDocDuoc) KHÔNG đưa `.csv` vào danh sách quét", () => {
    const kq = duyetTepDocDuoc(DU_AN, "", 200, Date.now() + 10_000);
    expect(kq.tep).toContain("ma.py");
    expect(kq.tep.some((t) => t.endsWith(".csv"))).toBe(false);
  });
  it("★★★ xoá / đổi tên (phanQuyetChinhSachDuong KHÔNG truyền gốc) vẫn từ chối `.csv`; dự án đúng thì chỉ cửa GHI mở (có gốc)", () => {
    expect(phanQuyetChinhSachDuong("du_lieu/nho.csv")).toMatchObject({ ok: false, ma: "DENIED_EXT" });
    expect(phanQuyetChinhSachDuong("du_lieu/nho.csv", DU_AN)).toEqual({ ok: true });
  });
});

/** Tệp nguồn sản xuất (không test) dưới server/ + shared/ — bản kiểm đếm theo VĂN BẢN, cùng kỷ luật với các census khác của hộp cát. */
function nguonSanXuat(): Array<{ rel: string; text: string }> {
  const goc = path.resolve(__dirname, "..", "..", "..");
  const ra: Array<{ rel: string; text: string }> = [];
  const di = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__fixtures__") continue;
        di(p);
      } else if (/\.(ts|tsx|mjs|cjs)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) {
        ra.push({ rel: path.relative(goc, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8") });
      }
    }
  };
  di(path.join(goc, "server"));
  di(path.join(goc, "shared"));
  return ra;
}
/** Bỏ chú thích để câu chữ giải thích không bị đếm là điểm gọi. */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("CENSUS — chỉ đúng chỗ được duyệt hỏi `.csv`", () => {
  const nguon = nguonSanXuat();
  const dem = (re: RegExp) => nguon.map((f) => ({ rel: f.rel, n: (boChuThich(f.text).match(re) ?? []).length })).filter((x) => x.n > 0);
  it("★★★ điểm gọi `csvDuocPhep(` ngoài chính nó: đúng HAI chỗ (repoSandbox.moTepTrongHopCat — đọc; applyDiff.phanQuyetChinhSachDuong — ghi)", () => {
    const goi = dem(/\bcsvDuocPhep\(/g).filter((x) => x.rel !== "server/services/aiLocalTools/csvTrongDuAn.ts");
    expect(goi).toEqual([
      { rel: "server/services/aiLocalTools/repoSandbox.ts", n: 1 },
      { rel: "server/services/aiLocalTools/writeHandlers/applyDiff.ts", n: 1 },
    ]);
  });
  it("★★★ `choPhepCsv` xuất hiện ở đúng repoSandbox.ts (định nghĩa + dùng) và repoReadTools.ts (tool read_file đặt true) — IDE người dùng, git, ST KHÔNG có", () => {
    expect(dem(/\bchoPhepCsv\b/g).map((x) => x.rel).sort()).toEqual(["server/services/aiLocalTools/repoReadTools.ts", "server/services/aiLocalTools/repoSandbox.ts"]);
    const rt = boChuThich(nguon.find((f) => f.rel === "server/services/aiLocalTools/repoReadTools.ts")!.text);
    expect(rt.match(/choPhepCsv: true/g)?.length).toBe(1);
  });
  it("★★★ `csvBat(` ngoài định nghĩa: csvTrongDuAn.ts (một lần, trong csvDuocPhep) và boThucThiMayChu.ts (một lần, mô tả công cụ)", () => {
    const x = dem(/\bcsvBat\(/g);
    expect(x).toEqual([
      { rel: "server/services/ai/agent/boThucThiMayChu.ts", n: 1 },
      { rel: "server/services/aiLocalTools/csvTrongDuAn.ts", n: 2 }, // định nghĩa + một lần dùng
    ]);
  });
  it("★★★ KHÔNG nhập csvTrongDuAn: chỉ mục mã, nhập ZIP, cửa git, tạo khung, dòng chữ prompt, IDE router, xoá/đổi tên, đường AI ngoài", () => {
    const CAM = [
      "server/services/ai/chiMucMa/hopCatChiMuc.ts",
      "server/services/ai/chiMucMa/nguNghia.ts",
      "server/services/ai/duAnCaNhan/nhapZipAnToan.ts",
      "server/services/ai/gitDuAn/cuaGitDuAn.ts",
      "server/services/ai/dotnetNewScaffold.ts",
      "server/services/aiCodingAgent.ts",
      "server/services/aiLocalKnowledgeCodingTaoKhung.ts",
      "server/services/aiLocalKnowledgeCodingSua.ts",
      "server/services/aiLocalTools/writeHandlers/xoaDoiTenTep.ts",
      "server/services/aiLocalTools/kiemBienDichStTool.ts",
      "server/routers/repoWorkspaceRouter.ts",
      "shared/aiNgoaiDenyList.ts",
    ];
    for (const rel of CAM) {
      const f = nguon.find((x) => x.rel === rel);
      expect(f, `${rel} phải tồn tại`).toBeDefined();
      expect(boChuThich(f!.text), rel).not.toMatch(/csvTrongDuAn|csvDuocPhep|csvBat|choPhepCsv/);
    }
  });
  it("★★★ `shared/aiNgoaiDenyList.ts` không đổi theo hướng mở: `.csv` không nằm trong khối DUOI_CHO_PHEP", () => {
    const t = nguon.find((f) => f.rel === "shared/aiNgoaiDenyList.ts")!.text;
    const dau = t.indexOf("export const DUOI_CHO_PHEP:");
    const cuoi = t.indexOf("]);", dau);
    expect(dau).toBeGreaterThan(0);
    expect(t.slice(dau, cuoi)).not.toMatch(/["']\.csv["']/);
  });
});
