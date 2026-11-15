/**
 * B1 `.csv` ở BỘ THỰC THI MÁY CHỦ của tác nhân: (1) dòng mô tả `read_file` CHỈ khi cờ AI_AGENT_CSV_DOC=1 (tắt ⇒ từng byte như cũ); (2) lời nhắn "CSV cap" khi `.csv` bị cắt;
 * (3) `docThoTrongHopCat` (đọc trước khi ghi) KHÔNG mở `.csv` (GHI chưa được duyệt). THUẦN: executeDecision / kiemKillSwitch giả, thư mục tạm thật, không CSDL.
 * ĐỘT BIẾN PHẢI BẮT: mô tả đổi khi cờ tắt · mô tả đổi tool khác · bỏ lời nhắn cắt · docThoTrongHopCat mở ngoài sandbox-projects.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONG_CU, congCuTheoCheDo } from "@shared/agentCore";
import { docThoTrongHopCat, moTaDocCsv, taoBoThucThiMayChu } from "./boThucThiMayChu";

let REPO: string;
let DU_AN: string;
beforeEach(() => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csv-agent-")));
  DU_AN = path.join(REPO, "sandbox-projects", "agent-f");
  fs.mkdirSync(path.join(DU_AN, "du_lieu"), { recursive: true });
  fs.mkdirSync(path.join(REPO, "docs"), { recursive: true });
  fs.writeFileSync(path.join(DU_AN, "du_lieu", "nho.csv"), "ma,so\nA,1\n");
  fs.writeFileSync(path.join(REPO, "docs", "ngoai.csv"), "a,b\n");
  vi.stubEnv("AI_AGENT_CSV_DOC", "1");
  vi.spyOn(process, "cwd").mockReturnValue(REPO);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(REPO, { recursive: true, force: true });
});

function taoBo(data: Record<string, unknown> | null = null) {
  const nguoi = { id: 1, role: "admin", name: "Ky su csv" };
  const executeDecision = vi.fn(async () => ({ result: { data, note: null } }));
  const bo = taoBoThucThiMayChu({
    execCtx: { user: nguoi, lang: "vi", projectRoot: DU_AN },
    gocDuAn: DU_AN,
    user: nguoi,
    coQuyenThucThi: false,
    checkpoint: null,
    phuThuoc: { executeDecision: executeDecision as never, kiemKillSwitch: async () => false },
  });
  const ctx = { cheDo: "hoi" as const, runId: "11111111-1111-4111-8111-111111111111", luot: 1, signal: new AbortController().signal, phat: () => undefined };
  return { bo, ctx, executeDecision };
}
const moTa = (ds: Array<{ function: { name: string; description?: string } }>, ten: string) => ds.find((t) => t.function.name === ten)!.function.description!;

describe("mô tả `read_file` cho model — chỉ khi cờ bật", () => {
  it("★★★ cờ TẮT (vắng / 0 / true / rỗng) ⇒ toàn bộ danh sách công cụ BẰNG ĐÚNG danh sách gốc (từng byte, mọi chế độ)", () => {
    for (const v of [undefined, "0", "true", ""]) {
      vi.unstubAllEnvs();
      vi.spyOn(process, "cwd").mockReturnValue(REPO);
      if (v !== undefined) vi.stubEnv("AI_AGENT_CSV_DOC", v);
      else delete process.env.AI_AGENT_CSV_DOC;
      const { bo } = taoBo();
      for (const cheDo of ["hoi", "sua", "tu-dong"] as const) {
        expect(JSON.stringify(bo.congCu(cheDo)), `${String(v)} · ${cheDo}`).toBe(JSON.stringify(congCuTheoCheDo(cheDo, [])));
      }
    }
  });
  it("★★★ cờ BẬT ⇒ CHỈ `read_file` đổi: mô tả = gốc + một câu về `.csv`; mọi tool khác và mọi tham số giữ nguyên", () => {
    const { bo } = taoBo();
    const ds = bo.congCu("sua");
    const goc = congCuTheoCheDo("sua", []);
    expect(ds.length).toBe(goc.length);
    for (let i = 0; i < ds.length; i++) {
      if (ds[i]!.function.name === "read_file") continue;
      expect(JSON.stringify(ds[i])).toBe(JSON.stringify(goc[i]));
    }
    const mt = moTa(ds, "read_file");
    // NGUYÊN VĂN của main (shared/agentCore/congCu.ts, 2c02b83d9) + đúng một câu
    expect(moTa(goc, "read_file")).toBe("Read a text file of the project. Returns numbered lines. Use start_line/end_line for large files.");
    expect(mt).toBe(
      "Read a text file of the project. Returns numbered lines. Use start_line/end_line for large files. .csv files can only be read with read_file, by exact path inside the project directory (first 200 lines / 32 KB); find_files and grep do not scan .csv files.",
    );
    expect(JSON.stringify(ds.find((t) => t.function.name === "read_file")!.function.parameters)).toBe(JSON.stringify(goc.find((t) => t.function.name === "read_file")!.function.parameters));
  });
  it("★★ moTaDocCsv thuần: tool khác `read_file` trả về CHÍNH đối tượng; không đột biến đầu vào", () => {
    const rf = CONG_CU.find((t) => t.function.name === "read_file")!;
    const truoc = JSON.stringify(rf);
    const ra = moTaDocCsv(rf);
    expect(ra).not.toBe(rf);
    expect(JSON.stringify(rf)).toBe(truoc);
    const khac = CONG_CU.find((t) => t.function.name === "list_dir")!;
    expect(moTaDocCsv(khac)).toBe(khac);
  });
});

describe("lời nhắn khi `.csv` bị cắt (quan sát model thấy)", () => {
  it("★★★ csv bị cắt ⇒ dòng đầu nêu 'CSV cap', số dòng đã trả và byte thật; không cắt ⇒ KHÔNG có lời nhắn đó", async () => {
    const cat = taoBo({ path: "du_lieu/dai.csv", bytes: 70_000, truncated: true, redacted: false, content: "a,b\n1,2\n", csv: { rows: 200, cutByLines: true } });
    const r = await cat.bo.chay({ id: "c1", ten: "read_file", thamSo: { path: "du_lieu/dai.csv" } }, cat.ctx);
    expect(r.ok).toBe(true);
    expect(r.choModel).toContain("CSV cap (32768 bytes / 200 lines)");
    expect(r.choModel).toContain("only the first 200 rows are shown, cut after line 200 (byte 8 of 70000); later lines are NOT visible and cannot be read further with this tool");
    const khong = taoBo({ path: "du_lieu/nho.csv", bytes: 14, truncated: false, redacted: false, content: "ma,so\nA,1\n", csv: { rows: 2, cutByLines: false } });
    const r2 = await khong.bo.chay({ id: "c2", ten: "read_file", thamSo: { path: "du_lieu/nho.csv" } }, khong.ctx);
    expect(r2.choModel).not.toContain("CSV cap");
    const thuong = taoBo({ path: "a.ts", bytes: 99_000, truncated: true, redacted: false, content: "x\n" });
    const r3 = await thuong.bo.chay({ id: "c3", ten: "read_file", thamSo: { path: "a.ts" } }, thuong.ctx);
    expect(r3.choModel).toContain("TRUNCATED");
    expect(r3.choModel).not.toContain("CSV cap");
  });
});

describe("docThoTrongHopCat — đường ĐỌC-TRƯỚC-KHI-GHI KHÔNG mở `.csv` (ghi chưa duyệt), cờ bật", () => {
  it("★★★ `.csv` trong dự án / gốc repo / ngoài sandbox-projects ⇒ DENIED_EXT; tệp mã vẫn đọc được", () => {
    expect(docThoTrongHopCat(DU_AN, "du_lieu/nho.csv")).toMatchObject({ ok: false, ma: "DENIED_EXT" });
    expect(docThoTrongHopCat(DU_AN, "du_lieu/chua-co.csv")).toMatchObject({ ok: false, ma: "DENIED_EXT" });
    expect(docThoTrongHopCat(REPO, "sandbox-projects/agent-f/du_lieu/nho.csv")).toMatchObject({ ok: false, ma: "DENIED_EXT" });
    expect(docThoTrongHopCat(REPO, "docs/ngoai.csv")).toMatchObject({ ok: false, ma: "DENIED_EXT" });
    fs.writeFileSync(path.join(DU_AN, "ma.py"), ["x = 1", ""].join("\n"));
    expect(docThoTrongHopCat(DU_AN, "ma.py")).toEqual({ ok: true, tonTai: true, noiDung: ["x = 1", ""].join("\n") });
  });
});
