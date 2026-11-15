/**
 * B1 `.csv` ở TẦNG TOOL của tác nhân: `read_file` đọc `.csv` trong dự án (cờ AI_AGENT_CSV_DOC=1, dưới sandbox-projects); `find_files` / `grep_repo` KHÔNG quét `.csv`; `list_files` vẫn chỉ nêu TÊN như cũ.
 * THUẦN: RBAC và kho duyệt là bản GIẢ (giống find_files.test), thư mục tạm thật, không CSDL.
 * ĐỘT BIẾN PHẢI BẮT: tool không truyền `choPhepCsv` · mở `.csv` cho grep / find_files / list_files · bỏ ghi chú cắt · khoá dính chữ lọt vào kết quả tool · cờ tắt vẫn đọc được.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));
vi.mock("../aiCopilotActions", () => ({ proposeAction: vi.fn() }));

import "./index";
import { listTools, type Tool } from "./toolRegistry";
import { xoaSoNganSach } from "./repoSandbox";

const AUTH = { userId: 7, role: "engineer" };
let REPO = "";
let DU_AN = "";
const THAN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const dongCsv = (n: number) => Array.from({ length: n }, (_, i) => `r${i},TU_KHOA_CSV_${i}`).join("\n") + "\n";
const tool = (ten: string): Tool<any, any> => listTools().find((t) => t.name === ten)!;
const doc = (p: string, goc = DU_AN) => tool("read_file").handler!({ path: p, __authCtx: AUTH, __projectRoot: goc } as never);

beforeAll(() => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csv-tool-")));
  DU_AN = path.join(REPO, "sandbox-projects", "agent-f");
  fs.mkdirSync(path.join(DU_AN, "du_lieu"), { recursive: true });
  fs.mkdirSync(path.join(REPO, "docs"), { recursive: true });
  fs.writeFileSync(path.join(DU_AN, "du_lieu", "nho.csv"), "ma,so\nA,1\nB,2\n");
  fs.writeFileSync(path.join(DU_AN, "du_lieu", "dai.csv"), dongCsv(250));
  fs.writeFileSync(path.join(DU_AN, "du_lieu", "khoa.csv"), `ma,ghi_chu\nA,tokenX${"sk-ant-api03-"}${THAN}\nB,ok\n`);
  fs.writeFileSync(path.join(DU_AN, "doc.py"), "# TU_KHOA_CSV_5 trong ma nguon\n");
  fs.writeFileSync(path.join(REPO, "docs", "ngoai.csv"), "a,b\n");
});
afterAll(() => fs.rmSync(REPO, { recursive: true, force: true }));
beforeEach(() => {
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  xoaSoNganSach();
  vi.unstubAllEnvs();
  vi.stubEnv("AI_AGENT_CSV_DOC", "1");
  vi.spyOn(process, "cwd").mockReturnValue(REPO);
});

describe("read_file — `.csv` trong dự án (cờ bật)", () => {
  it("★★★ đọc `.csv` nhỏ: nội dung nguyên văn, không cắt, có dòng đầu nêu số byte", async () => {
    const r = await doc("du_lieu/nho.csv");
    expect(r.note).toBeUndefined();
    expect(r.data.content).toBe("ma,so\nA,1\nB,2\n");
    expect(r.data.truncated).toBe(false);
    expect(r.data.bytes).toBe(14);
    expect(r.textSummary).toContain("A,1");
  });
  it("★★★ `.csv` 250 dòng: trả 200 dòng đầu, truncated=true, và LỜI NÓI RÕ ràng 'đã cắt' kèm số dòng đã trả + byte thật + trần", async () => {
    const r = await doc("du_lieu/dai.csv");
    expect(r.data.truncated).toBe(true);
    expect(r.data.content.split("\n").filter(Boolean).length).toBe(200);
    expect(r.data.bytes).toBe(Buffer.byteLength(dongCsv(250)));
    const bs = Buffer.byteLength(r.data.content);
    const that = Buffer.byteLength(dongCsv(250));
    expect(r.textSummary).toContain(`; CSV: chỉ trả 200 dòng đầu, CẮT sau dòng 200 (byte ${bs} / ${that} byte); các dòng sau KHÔNG được hiển thị và KHÔNG đọc tiếp được bằng công cụ này (trần 32768 byte / 200 dòng)`);
    expect(r.textSummary).toContain("TU_KHOA_CSV_199");
    expect(r.textSummary).not.toContain("TU_KHOA_CSV_200");
  });
  it("★★★ khoá hình Anthropic DÍNH CHỮ trong ô `.csv` bị che TRƯỚC khi vào kết quả tool (data.content VÀ textSummary)", async () => {
    const r = await doc("du_lieu/khoa.csv");
    expect(r.data.redacted).toBe(true);
    expect(r.data.content).not.toContain(THAN);
    expect(r.textSummary).not.toContain(THAN);
    expect(r.textSummary).not.toContain(THAN.slice(0, 12));
    expect(JSON.stringify(r)).not.toContain(THAN);
    expect(r.data.content).toContain("B,ok");
  });
});

describe("read_file — vị trí cắt tính theo BYTE thật (UTF-8 đa byte)", () => {
  it("★★★ `.csv` tiếng Việt 250 dòng: số byte đã hiển thị trong lời nhắn là BYTE (không phải số ký tự)", async () => {
    const nd = Array.from({ length: 250 }, (_, i) => `d${i},Nguyễn Văn Ê`).join(String.fromCharCode(10)) + String.fromCharCode(10);
    fs.writeFileSync(path.join(DU_AN, "du_lieu", "viet.csv"), nd);
    const r = await doc("du_lieu/viet.csv");
    const bs = Buffer.byteLength(r.data.content);
    expect(bs).toBeGreaterThan(r.data.content.length);
    expect(r.textSummary).toContain(`(byte ${bs} / ${Buffer.byteLength(nd)} byte)`);
  });
});

describe("read_file — `.csv` bị TỪ CHỐI như cũ (DENIED_EXT)", () => {
  it("★★★ cờ TẮT ⇒ DENIED_EXT nêu `.csv`", async () => {
    vi.stubEnv("AI_AGENT_CSV_DOC", "0");
    const r = await doc("du_lieu/nho.csv");
    expect(r.note).toBe("DENIED_EXT");
    expect(r.data.content).toBeNull();
    // NGUYÊN VĂN như main (2c02b83d9, repoReadTools.ts ketQuaTuChoiHopCat) — không đổi một byte khi cờ tắt
    expect(r.textSummary).toBe(
      "Phần mở rộng .csv không nằm trong danh sách TRẮNG của hộp cát. Hộp cát chỉ mở cho tệp mã nguồn/cấu hình dạng văn bản; mọi đuôi khác bị từ chối theo mặc định (danh sách TRẮNG, không phải danh sách đen).",
    );
  });
  it("★★★ cờ BẬT nhưng `.csv` NGOÀI sandbox-projects (gốc repo / docs) ⇒ DENIED_EXT", async () => {
    expect((await doc("docs/ngoai.csv", REPO)).note).toBe("DENIED_EXT");
    expect((await doc("ngoai.csv", path.join(REPO, "docs"))).note).toBe("DENIED_EXT");
  });
});

describe("grep / find_files KHÔNG quét `.csv` (đóng với `.csv`, cờ bật); list_files không đổi", () => {
  it("★★★ find_files `**/*.csv` ⇒ rỗng; `**/*` không có `.csv` nhưng có `.py`", async () => {
    const a = await tool("find_files").handler!({ pattern: "**/*.csv", __authCtx: AUTH, __projectRoot: DU_AN } as never);
    expect(a.data.files).toEqual([]);
    const b = await tool("find_files").handler!({ pattern: "**/*", __authCtx: AUTH, __projectRoot: DU_AN } as never);
    expect(b.data.files.some((f: string) => f.endsWith(".csv"))).toBe(false);
    expect(b.data.files).toContain("doc.py");
  });
  it("★★★ list_files VẪN liệt kê TÊN `.csv` như trước (hành vi cũ, không đổi bởi B1) — để mô hình biết đường mà `read_file`; cờ tắt cũng y hệt", async () => {
    const lay = async () => JSON.stringify((await tool("list_files").handler!({ path: "du_lieu", __authCtx: AUTH, __projectRoot: DU_AN } as never)).data);
    const bat = await lay();
    expect(bat).toContain("nho.csv");
    vi.stubEnv("AI_AGENT_CSV_DOC", "0");
    expect(await lay()).toBe(bat);
  });
  it("★★★ grep_repo tìm từ khoá có trong `.csv` ⇒ chỉ trúng tệp mã nguồn, KHÔNG có `.csv` nào trong kết quả", async () => {
    const r = await tool("grep_repo").handler!({ pattern: "TU_KHOA_CSV_5", __authCtx: AUTH, __projectRoot: DU_AN } as never);
    const s = JSON.stringify(r);
    expect(s).toContain("doc.py");
    expect(s).not.toContain(".csv");
    expect(s).not.toContain("TU_KHOA_CSV_5,");
  });
});
