/**
 * V9 — `grep_repo` với `path` là MỘT TỆP: tìm trong đúng tệp đó, kết quả cùng dạng như tìm trong thư mục. Trước V9: NOT_A_DIRECTORY kèm mẫu câu từ chối ĐỌC
 * ("Bạn KHÔNG có nội dung …") dù tác nhân đã đọc trọn tệp (3 lần trong lượt TK-5).
 * Đường một-tệp phải qua ĐÚNG các chốt của đường đọc tệp; không mở được ⇒ TỪ CHỐI rõ (không "0 kết quả"); bị cắt theo trần byte ⇒ khai.
 * Symlink / junction còn nằm TRONG gốc: theo read_file — KHÁC vòng duyệt cây (bỏ mọi symlink) một cách có chủ ý.
 *
 * ĐỘT BIẾN PHẢI BẮT: bỏ đường một-tệp · tệp mở không được thành "0 kết quả" · đọc tắt không qua moTepTrongHopCat (mất chốt đuôi / liên kết cứng / che bí mật / trần byte) ·
 * không khai bị cắt · không hỏi / không trừ ngân sách · bỏ qua loaiTru · đổi đầu ra của quét thư mục · đổi mã của đường không tồn tại.
 */
import { linkSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../aiCopilotActions", () => ({ proposeAction: vi.fn(), confirmAction: vi.fn(), cancelAction: vi.fn(), getAction: vi.fn() }));
// RBAC thật hỏi DB — mock (cùng khuôn grepLoaiTru.test.ts); phép đo ở đây là đường một-tệp của grep, không phải cổng quyền.
const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import "./index";
import { listTools, type Tool } from "./toolRegistry";
import { nganSachConLai, tieuNganSach, xoaSoNganSach, TRAN_BYTE_MOI_PHIEN, TRAN_BYTE_MOI_TEP } from "./repoSandbox";
import { taoBoThucThiMayChu } from "../ai/agent/boThucThiMayChu";

const AUTH = { userId: 7, role: "engineer" };
const KHOA_NGAN_SACH = "u:7";
/** Khoá giả kiểu bí mật: ghép lúc chạy để tệp test không mang chuỗi trần. */
const KHOA_GIA = ["gh", "p_"].join("") + "A1b2".repeat(9);
let GOC = "";
let NGOAI = "";

const tool = (ten: string): Tool<any, any> => listTools().find((t) => t.name === ten)!;
const grep = (args: Record<string, unknown>): Promise<any> => tool("grep_repo").handler!({ ...args, __authCtx: AUTH } as never);
const docTep = (args: Record<string, unknown>): Promise<any> => tool("read_file").handler!({ ...args, __authCtx: AUTH } as never);

beforeAll(() => {
  GOC = realpathSync(mkdtempSync(path.join(tmpdir(), "grepmt-")));
  NGOAI = realpathSync(mkdtempSync(path.join(tmpdir(), "grepmt-ngoai-")));
  for (const d of ["ma", "khac", "node_modules"]) mkdirSync(path.join(GOC, d), { recursive: true });
  // dòng GỌI (không phải khai báo) để không kích câu nhận xét "chỉ thấy định nghĩa"
  writeFileSync(path.join(GOC, "ma/a.ts"), "goi(MOC_X);\n");
  writeFileSync(path.join(GOC, "ma/b.ts"), "goi(MOC_X);\n");
  writeFileSync(path.join(GOC, "ma/may-chu.pem"), "goi(MOC_X);\n");
  writeFileSync(path.join(GOC, "ma/anh.png"), "goi(MOC_X);\n");
  writeFileSync(path.join(GOC, "ma/du.csv"), "goi(MOC_X);\n");
  writeFileSync(path.join(GOC, "node_modules/x.ts"), "goi(MOC_X);\n");
  writeFileSync(path.join(GOC, "khac/co-khoa.ts"), `goi(MOC_K, "${KHOA_GIA}");\n`);
  writeFileSync(path.join(GOC, "khac/cung.ts"), "goi(MOC_X);\n");
  linkSync(path.join(GOC, "khac/cung.ts"), path.join(GOC, "khac/cung-2.ts"));
  const dong = "// dem cho du byte ".padEnd(99, "-") + "\n";
  writeFileSync(path.join(GOC, "khac/lon.ts"), "goi(MOC_DAU);\n" + dong.repeat(700) + "goi(MOC_CUOI);\n");
  writeFileSync(path.join(NGOAI, "ngoai.ts"), "goi(MOC_NGOAI);\n");
  symlinkSync(NGOAI, path.join(GOC, "lien-ngoai"), "junction");
  symlinkSync(path.join(GOC, "ma"), path.join(GOC, "lien-trong"), "junction");
  process.env.AI_REPO_SANDBOX_ROOT = GOC;
});
afterAll(() => {
  delete process.env.AI_REPO_SANDBOX_ROOT;
  for (const d of ["lien-ngoai", "lien-trong"]) {
    try { rmSync(path.join(GOC, d), { recursive: false, force: true }); } catch { /* gỡ junction trước khi xoá cây */ }
  }
  for (const d of [GOC, NGOAI]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
beforeEach(() => {
  xoaSoNganSach();
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  process.env.AI_REPO_SANDBOX_ROOT = GOC;
});

describe("V9 — grep trên một tệp cho kết quả như trên thư mục", () => {
  it("V9-G1 tệp có khớp ⇒ đúng đường, số dòng, dòng khớp; cùng dạng chữ như quét thư mục", async () => {
    const r = await grep({ pattern: "MOC_X", path: "ma/a.ts" });
    expect(r.note).toBeUndefined();
    expect(r.data).toMatchObject({ scanned: 1, count: 1, truncated: false });
    expect(r.data.matches).toEqual([{ path: "ma/a.ts", line: 1, text: "goi(MOC_X);" }]);
    expect(r.textSummary).toBe("/MOC_X/ — 1 kết quả trong 1 tệp đã quét:\nma/a.ts:1: goi(MOC_X);");
  });

  it("V9-G2 tệp không khớp ⇒ NO_MATCH, đã quét đúng 1 tệp", async () => {
    const r = await grep({ pattern: "KHONG_CO_DAU", path: "ma/a.ts" });
    expect(r.note).toBe("NO_MATCH");
    expect(r.data).toMatchObject({ scanned: 1, count: 0, truncated: false });
  });

  it("V9-G11 loaiTru phủ đúng tệp đó ⇒ quét 0 tệp (chỉ thu hẹp)", async () => {
    const r = await grep({ pattern: "MOC_X", path: "ma/a.ts", loaiTru: ["ma"] });
    expect(r.note).toBe("NO_MATCH");
    expect(r.data).toMatchObject({ scanned: 0, count: 0 });
  });

  it("V9-G14 đường qua junction còn TRONG gốc: grep theo đúng phán quyết của read_file (read_file mở được ⇒ grep tìm được)", async () => {
    const d = await docTep({ path: "lien-trong/a.ts" });
    expect(d.note).toBeUndefined();
    const r = await grep({ pattern: "MOC_X", path: "lien-trong/a.ts" });
    expect(r.note).toBeUndefined();
    expect(r.data.count).toBe(1);
  });
});

describe("V9 — đường một-tệp qua đúng các chốt của đường đọc tệp; không mở được thì TỪ CHỐI, không phải 0 kết quả", () => {
  const khongLo = (r: any) => {
    expect(r.data?.matches ?? []).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("goi(MOC_");
  };

  it("V9-G3 tên tệp bí mật ⇒ DENIED_SECRET", async () => {
    const r = await grep({ pattern: "MOC_X", path: "ma/may-chu.pem" });
    expect(r.note).toBe("DENIED_SECRET");
    khongLo(r);
  });

  it("V9-G4 đuôi ngoài danh sách trắng, và .csv ⇒ DENIED_EXT", async () => {
    for (const p of ["ma/anh.png", "ma/du.csv"]) {
      const r = await grep({ pattern: "MOC_X", path: p });
      expect(r.note, p).toBe("DENIED_EXT");
      khongLo(r);
    }
  });

  it("V9-G5 tệp trong thư mục cấm ⇒ DENIED_DIR", async () => {
    const r = await grep({ pattern: "MOC_X", path: "node_modules/x.ts" });
    expect(r.note).toBe("DENIED_DIR");
    khongLo(r);
  });

  it("V9-G6a đường đi qua junction RA NGOÀI gốc ⇒ PATH_REJECTED, không lộ nội dung", async () => {
    const r = await grep({ pattern: "MOC_NGOAI", path: "lien-ngoai/ngoai.ts" });
    expect(r.note).toBe("PATH_REJECTED");
    khongLo(r);
  });

  it("V9-G6b tệp có hai liên kết cứng ⇒ PATH_REJECTED", async () => {
    const r = await grep({ pattern: "MOC_X", path: "khac/cung.ts" });
    expect(r.note).toBe("PATH_REJECTED");
    khongLo(r);
  });

  it("V9-G8 dòng khớp chứa khoá ⇒ ra đã che", async () => {
    const r = await grep({ pattern: "MOC_K", path: "khac/co-khoa.ts" });
    expect(r.data?.count).toBe(1);
    expect(r.textSummary).toContain("[REDACTED_SECRET]");
    expect(JSON.stringify(r)).not.toContain(KHOA_GIA);
  });
});

describe("V9 — trần byte và ngân sách", () => {
  it("V9-G7 tệp lớn hơn trần byte: chỉ thấy khớp trước mốc cắt, truncated, và nói rõ đã cắt (kể cả khi không khớp gì)", async () => {
    const hai = await grep({ pattern: "MOC_(DAU|CUOI)", path: "khac/lon.ts" });
    expect(hai.data?.matches?.map((m: any) => m.line)).toEqual([1]);
    expect(hai.data.truncated).toBe(true);
    expect(hai.textSummary).toContain(String(TRAN_BYTE_MOI_TEP));
    const sau = await grep({ pattern: "MOC_CUOI", path: "khac/lon.ts" });
    expect(sau.note).toBe("NO_MATCH");
    expect(sau.data.truncated).toBe(true);
    expect(sau.textSummary).toContain(String(TRAN_BYTE_MOI_TEP));
    expect(sau.textSummary).not.toContain("đã đi hết");
  });

  it("V9-G9 ngân sách phiên cạn ⇒ BUDGET_EXCEEDED; lượt thành công trừ đúng số ký tự phát ra", async () => {
    const truoc = nganSachConLai(KHOA_NGAN_SACH).conLai;
    const r = await grep({ pattern: "MOC_X", path: "ma/a.ts" });
    expect(r.note).toBeUndefined();
    expect(truoc - nganSachConLai(KHOA_NGAN_SACH).conLai).toBe(r.textSummary.length);
    tieuNganSach(KHOA_NGAN_SACH, TRAN_BYTE_MOI_PHIEN);
    const can = await grep({ pattern: "MOC_X", path: "ma/a.ts" });
    expect(can.note).toBe("BUDGET_EXCEEDED");
    expect(can.data?.matches ?? []).toEqual([]); expect(JSON.stringify(can)).not.toContain("goi(MOC_"); // hai khẳng định của khongLo, viết tại chỗ: hàm đó thuộc khối khác
  });
});

describe("V9 — đối chứng: không đổi thứ không thuộc V9", () => {
  it("V9-G10 quét thư mục: đầu ra đúng từng byte", async () => {
    const r = await grep({ pattern: "MOC_X", path: "ma" });
    expect(r.textSummary).toBe("/MOC_X/ — 2 kết quả trong 2 tệp đã quét:\nma/a.ts:1: goi(MOC_X);\nma/b.ts:1: goi(MOC_X);");
    expect(r.data).toMatchObject({ scanned: 2, count: 2, truncated: false });
  });

  it("V9-G13 đường không tồn tại ⇒ vẫn NOT_FOUND", async () => {
    const r = await grep({ pattern: "MOC_X", path: "ma/khong-co.ts" });
    expect(r.note).toBe("NOT_FOUND");
  });
});

describe("V9 — qua bộ thực thi của tác nhân (số đo của V9)", () => {
  it("V9-G12 grep trên một tệp: chữ gửi model là kết quả khớp, KHÔNG phải câu \"Bạn KHÔNG có nội dung\"", async () => {
    const nguoi = { id: 7, role: "engineer", name: "Ky su grep" };
    const bo = taoBoThucThiMayChu({
      execCtx: { user: nguoi, lang: "vi" },
      gocDuAn: GOC,
      user: nguoi,
      coQuyenThucThi: false,
      checkpoint: null,
      phuThuoc: {
        // executeDecision giả gọi handler THẬT của tool đã đăng ký (giữ nguyên đường grep_repo)
        executeDecision: (async (q: { tool: string; args: Record<string, unknown> }) => ({ result: await tool(q.tool).handler!({ ...q.args, __authCtx: AUTH } as never) })) as never,
        kiemKillSwitch: async () => false,
      },
    });
    const ctx = { cheDo: "hoi" as const, runId: "11111111-1111-4111-8111-111111111111", luot: 1, signal: new AbortController().signal, phat: () => undefined };
    const r = await bo.chay({ id: "c1", ten: "grep", thamSo: { pattern: "MOC_X", path: "ma/a.ts" } }, ctx);
    expect(r.choModel).not.toContain("Bạn KHÔNG có nội dung");
    expect(r.ok).toBe(true);
    expect(r.choModel).toContain("1 match(es):\nma/a.ts:1: goi(MOC_X);");
  });
});
