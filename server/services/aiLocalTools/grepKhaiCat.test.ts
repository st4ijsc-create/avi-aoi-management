/**
 * V13 — grep_repo và find_files phải KHAI phần chưa tìm: (a) tệp lớn hơn trần byte mỗi tệp (chỉ grep đọc nội dung); (b) thư mục quá trần số mục: vòng duyệt cây chỉ lấy
 * 300 mục đầu theo tên và trước V13 vứt cờ báo cắt, nên kết quả vẫn nói "đã đi hết cây thư mục được phép". Phía tác nhân phải nêu ĐÚNG lý do cắt.
 * Không khuyên đọc tiếp bằng start_line: read_file bị kẹp cùng trần byte. Không nâng trần nào.
 *
 * Tệp này cũng là ca giết đột biến sống của lô trước «V9-W14-DEN-V13», theo chiều đúng: thư mục có tệp bị cắt PHẢI khai.
 * GIỚI HẠN CÓ TÊN, không thuộc V13: «V13-DONG-1000» (mỗi dòng chỉ khớp 1000 ký tự đầu, không khai) · «V13-SAU-12» (thư mục sâu quá 12 cấp bị bỏ, không khai).
 *
 * ĐỘT BIẾN PHẢI BẮT: không khai tệp bị cắt · không khai thư mục bị cắt · vẫn nói "đã đi hết" · truncated sai · liệt kê quá 3 ví dụ / đếm sai · tính cả tệp chưa quét hay đã bị loaiTru ·
 * đổi byte khi không cắt gì · tác nhân nêu sai lý do · mất câu cũ khi chạm trần kết quả · find_files im lặng · khuyên start_line.
 */
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../aiCopilotActions", () => ({ proposeAction: vi.fn(), confirmAction: vi.fn(), cancelAction: vi.fn(), getAction: vi.fn() }));
// RBAC thật hỏi DB — mock (cùng khuôn grepLoaiTru.test.ts); phép đo ở đây là việc KHAI phần chưa tìm.
const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import "./index";
import { listTools, type Tool } from "./toolRegistry";
import { xoaSoNganSach, TRAN_BYTE_MOI_TEP, TRAN_MUC_LIET_KE } from "./repoSandbox";
import { taoBoThucThiMayChu } from "../ai/agent/boThucThiMayChu";

const AUTH = { userId: 7, role: "engineer" };
const BYTE = String(TRAN_BYTE_MOI_TEP);
const MUC = String(TRAN_MUC_LIET_KE);
/* Cụm khai báo được ghim NGUYÊN CỤM: câu cũ đã có sẵn "300 tệp", "4 tệp", tên thư mục, nên kiểm riêng con số hay tên là kiểm rỗng. */
const khaiTep = (n: number) => `${n} tệp chỉ được tìm trong ${BYTE} byte đầu`;
const khaiThuMuc = (n: number) => `${n} thư mục chỉ được duyệt ${MUC} mục đầu`;
const enTep = (n: number) => `${n} file(s) were searched only in their first ${BYTE} bytes`;
const enThuMuc = (n: number) => `${n} directory(ies) listed only their first ${MUC} entries`;
const CAU_CU = "[partial: result limit or time limit reached — narrow the path or pattern]";
let GOC = "";

const tool = (ten: string): Tool<any, any> => listTools().find((t) => t.name === ten)!;
const grep = (args: Record<string, unknown>): Promise<any> => tool("grep_repo").handler!({ ...args, __authCtx: AUTH } as never);
const timTep = (pattern: string): Promise<any> => tool("find_files").handler!({ pattern, __authCtx: AUTH } as never);
const demLan = (s: string, con: string) => s.split(con).length - 1;

function ghi(rel: string, noiDung: string): void {
  mkdirSync(path.dirname(path.join(GOC, rel)), { recursive: true });
  writeFileSync(path.join(GOC, rel), noiDung);
}
/** Tệp lớn hơn trần byte: `dau` ở dòng 1, "goi(MOC_CUOI);" nằm SAU mốc cắt. */
const noiDungLon = (dau: string) => `${dau}\n` + ("// dem cho du byte ".padEnd(99, "-") + "\n").repeat(700) + "goi(MOC_CUOI);\n";

beforeAll(() => {
  GOC = realpathSync(mkdtempSync(path.join(tmpdir(), "grepkc-")));
  ghi("lon/big.ts", noiDungLon("goi(MOC_DAU);"));
  ghi("lon/nho.ts", "goi(MOC_NHO);\n");
  for (const i of [1, 2, 3, 4]) ghi(`nhieu-lon/b${i}.ts`, noiDungLon("goi(MOC_B);"));
  ghi("sach/a.ts", "goi(MOC_S);\n");
  // trần 80 kết quả đạt trong a-nhieu.ts trước khi tới z-lon.ts (duyệt theo tên)
  ghi("tran/a-nhieu.ts", "goi(MOC_T);\n".repeat(100));
  ghi("tran/z-lon.ts", noiDungLon("goi(MOC_Z);"));
  // vừa có tệp bị cắt (quét trước) vừa chạm trần kết quả
  ghi("ca-hai/a-lon.ts", noiDungLon("goi(MOC_H);"));
  ghi("ca-hai/b-nhieu.ts", "goi(MOC_H);\n".repeat(100));
  // 305 mục: theo tên, f300…f304 đứng SAU mốc 300
  for (let i = 0; i < 305; i++) ghi(`dong/f${String(i).padStart(3, "0")}.ts`, i === 0 ? "goi(MOC_GAN);\n" : i === 304 ? "goi(MOC_XA);\n" : "x();\n");
  // đúng 300 mục: không cắt gì
  for (let i = 0; i < 300; i++) ghi(`dong-vua/f${String(i).padStart(3, "0")}.ts`, i === 299 ? "goi(MOC_V);\n" : "x();\n");
  // bốn thư mục, mỗi cái quá trần đúng một mục
  for (const d of [1, 2, 3, 4]) for (let i = 0; i < 301; i++) ghi(`nhieu-dong/d${d}/f${String(i).padStart(3, "0")}.ts`, "x();\n");
  ghi("co-loai/k.ts", "goi(MOC_L);\n");
  for (let i = 0; i < 301; i++) ghi(`co-loai/to/f${String(i).padStart(3, "0")}.ts`, "x();\n");
  process.env.AI_REPO_SANDBOX_ROOT = GOC;
}, 120_000);
afterAll(() => {
  delete process.env.AI_REPO_SANDBOX_ROOT;
  try { rmSync(GOC, { recursive: true, force: true }); } catch { /* best-effort */ }
});
beforeEach(() => {
  xoaSoNganSach();
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  process.env.AI_REPO_SANDBOX_ROOT = GOC;
});

describe("V13 §1 — quét thư mục có tệp bị cắt theo trần byte PHẢI khai", () => {
  it("V13-H1 khớp TRƯỚC mốc cắt ⇒ truncated, nêu số tệp, tên tệp và số byte", async () => {
    const r = await grep({ pattern: "MOC_DAU", path: "lon" });
    expect(r.data.truncated).toBe(true);
    expect(r.data.matches.map((m: any) => `${m.path}:${m.line}`)).toEqual(["lon/big.ts:1"]);
    expect(r.textSummary).toContain(khaiTep(1));
    expect(r.textSummary).toContain("(vd: lon/big.ts)");
    expect(r.textSummary).not.toContain("start_line");
  });

  it("V13-H2 khớp chỉ SAU mốc cắt ⇒ NO_MATCH có khai, KHÔNG nói đã đi hết", async () => {
    const r = await grep({ pattern: "MOC_CUOI", path: "lon" });
    expect(r.note).toBe("NO_MATCH");
    expect(r.data.truncated).toBe(true);
    expect(r.textSummary).toContain(khaiTep(1));
    expect(r.textSummary).toContain("(vd: lon/big.ts)");
    expect(r.textSummary).not.toContain("đã đi hết");
  });

  it("V13-H3 bốn tệp bị cắt ⇒ đếm đúng 4, nêu đúng 3 tên", async () => {
    const r = await grep({ pattern: "KHONG_CO_DAU", path: "nhieu-lon" });
    expect(r.data.truncated).toBe(true);
    expect(r.textSummary).toContain(khaiTep(4));
    expect(demLan(r.textSummary, "nhieu-lon/b")).toBe(3);
  });

  it("V13-H7 vừa chạm trần kết quả vừa có tệp bị cắt ⇒ khai CẢ HAI", async () => {
    const r = await grep({ pattern: "MOC_H", path: "ca-hai" });
    expect(r.data.count).toBe(80);
    expect(r.textSummary).toContain("chạm trần 80 kết quả");
    expect(r.textSummary).toContain(khaiTep(1));
    expect(r.textSummary).toContain("(vd: ca-hai/a-lon.ts)");
  });
});

describe("V13 §2 — thư mục quá trần số mục PHẢI khai (grep và find_files)", () => {
  it("V13-H12 grep: khớp nằm ở mục sau mốc ⇒ NO_MATCH có khai thư mục bị cắt, không nói đã đi hết", async () => {
    const r = await grep({ pattern: "MOC_XA", path: "dong" });
    expect(r.data.truncated).toBe(true);
    expect(r.note).toBe("NO_MATCH");
    expect(r.textSummary).toContain(khaiThuMuc(1));
    expect(r.textSummary).toContain("(vd: dong)");
    expect(r.textSummary).not.toContain("đã đi hết");
  });

  it("V13-H12b grep: có khớp trong phần tới được ⇒ vẫn khai", async () => {
    const r = await grep({ pattern: "MOC_GAN", path: "dong" });
    expect(r.data.truncated).toBe(true);
    expect(r.data.count).toBe(1);
    expect(r.textSummary).toContain(khaiThuMuc(1));
  });

  it("V13-H13 find_files: tệp cần tìm nằm sau mốc ⇒ không kết luận trơn là không có", async () => {
    const r = await timTep("dong/f30*.ts");
    expect(r.data.truncated).toBe(true);
    expect(r.note).toBe("NO_MATCH");
    expect(r.textSummary).toContain(khaiThuMuc(1));
    expect(r.textSummary).toContain("(vd: dong)");
  });

  it("V13-H13b find_files: có kết quả trong phần tới được ⇒ vẫn khai", async () => {
    const r = await timTep("dong/f00*.ts");
    expect(r.data.truncated).toBe(true);
    expect(r.data.files).toHaveLength(10);
    expect(r.textSummary).toContain(khaiThuMuc(1));
  });

  it("V13-H19 bốn thư mục bị cắt ⇒ đếm đúng 4, nêu đúng 3 tên", async () => {
    const r = await grep({ pattern: "KHONG_CO_DAU", path: "nhieu-dong" });
    expect(r.data.truncated).toBe(true);
    expect(r.textSummary).toContain(khaiThuMuc(4));
    expect(demLan(r.textSummary, "nhieu-dong/d")).toBe(3);
  });

  it("V13-H20 chính GỐC dự án bị cắt ⇒ nêu tên '.', không để trống", async () => {
    const goc2 = realpathSync(mkdtempSync(path.join(tmpdir(), "grepkc2-")));
    try {
      for (let i = 0; i < TRAN_MUC_LIET_KE + 1; i++) writeFileSync(path.join(goc2, `f${String(i).padStart(3, "0")}.ts`), "x();\n");
      process.env.AI_REPO_SANDBOX_ROOT = goc2;
      const r = await timTep("khong-co-*.ts");
      expect(r.data.truncated).toBe(true);
      expect(r.textSummary).toContain(`${khaiThuMuc(1)} (vd: .)`);
    } finally {
      rmSync(goc2, { recursive: true, force: true });
    }
  }, 60_000);

  it("V13-H21 loaiTru phủ thư mục bị cắt ⇒ không khai (người gọi đã bỏ nó)", async () => {
    const r = await grep({ pattern: "MOC_L", path: "co-loai", loaiTru: ["co-loai/to"] });
    expect(r.data.count).toBe(1);
    expect(r.data.truncated).toBe(false);
    expect(r.textSummary).not.toContain("mục đầu");
  });
});

describe("V13 §3 — đối chứng: không cắt gì thì không đổi một byte", () => {
  it("V13-H4 thư mục sạch: dữ liệu và chữ nguyên như trước, cả khi khớp lẫn khi không", async () => {
    const co = await grep({ pattern: "MOC_S", path: "sach" });
    expect(co.textSummary).toBe("/MOC_S/ — 1 kết quả trong 1 tệp đã quét:\nsach/a.ts:1: goi(MOC_S);");
    expect(Object.keys(co.data).sort()).toEqual(["count", "matches", "pattern", "scanned", "timedOut", "truncated"]);
    expect(co.data.truncated).toBe(false);
    const khong = await grep({ pattern: "KHONG_CO_DAU", path: "sach" });
    expect(khong.textSummary).toBe('Đã quét 1 tệp trong "sach" và KHÔNG dòng nào khớp /KHONG_CO_DAU/. Phạm vi quét đã đi hết cây thư mục được phép.');
  });

  it("V13-H5 loaiTru phủ tệp lớn ⇒ không khai (tệp đó không được quét)", async () => {
    const r = await grep({ pattern: "MOC_NHO", path: "lon", loaiTru: ["lon/big.ts"] });
    expect(r.data.truncated).toBe(false);
    expect(r.textSummary).not.toContain("byte đầu");
  });

  it("V13-H6 tệp lớn chưa được quét vì đã chạm trần kết quả trước ⇒ không tính nó", async () => {
    const r = await grep({ pattern: "MOC_T", path: "tran" });
    expect(r.data.count).toBe(80);
    expect(r.textSummary).not.toContain("byte đầu");
    expect(r.textSummary).not.toContain("z-lon");
  });

  it("V13-H8 đường MỘT tệp: chữ giữ như lô trước", async () => {
    const r = await grep({ pattern: "MOC_CUOI", path: "lon/big.ts" });
    expect(r.textSummary).toBe(`Đã quét 1 tệp trong "lon/big.ts" và KHÔNG dòng nào khớp /MOC_CUOI/. ⚠ tệp bị cắt: chỉ quét ${BYTE} byte đầu, phần sau CHƯA được tìm.`);
  });

  it("V13-H14 đúng 300 mục ⇒ không cắt: grep và find_files không khai gì", async () => {
    const g = await grep({ pattern: "MOC_V", path: "dong-vua" });
    expect(g.data.truncated).toBe(false);
    expect(g.textSummary).toBe("/MOC_V/ — 1 kết quả trong 300 tệp đã quét:\ndong-vua/f299.ts:1: goi(MOC_V);");
    const f = await timTep("dong-vua/f29*.ts");
    expect(f.data.truncated).toBe(false);
    expect(f.textSummary).toContain('"dong-vua/f29*.ts" — 10 tệp:\n');
  });
});

describe("V13 §4 — chữ gửi model nêu ĐÚNG lý do cắt", () => {
  const nguoi = { id: 7, role: "engineer", name: "Ky su grep" };
  async function goi(ten: string, thamSo: Record<string, unknown>) {
    const bo = taoBoThucThiMayChu({
      execCtx: { user: nguoi, lang: "vi" },
      gocDuAn: GOC,
      user: nguoi,
      coQuyenThucThi: false,
      checkpoint: null,
      phuThuoc: {
        executeDecision: (async (q: { tool: string; args: Record<string, unknown> }) => ({ result: await tool(q.tool).handler!({ ...q.args, __authCtx: AUTH } as never) })) as never,
        kiemKillSwitch: async () => false,
      },
    });
    const ctx = { cheDo: "hoi" as const, runId: "11111111-1111-4111-8111-111111111111", luot: 1, signal: new AbortController().signal, phat: () => undefined };
    return bo.chay({ id: "c1", ten, thamSo }, ctx);
  }

  it("V13-H9 grep chỉ cắt theo byte (có khớp): nêu số byte và tên, KHÔNG nói chạm trần kết quả / giờ, không khuyên start_line", async () => {
    const r = await goi("grep", { pattern: "MOC_DAU", path: "lon" });
    expect(r.choModel).toContain(`${enTep(1)} (e.g. lon/big.ts)`);
    expect(r.choModel).not.toContain("result limit or time limit");
    expect(r.choModel).not.toContain("start_line");
  });

  it("V13-H9b grep không khớp vì phần khớp nằm sau mốc cắt: câu trả lời nói rõ chưa tìm hết", async () => {
    const r = await goi("grep", { pattern: "MOC_CUOI", path: "lon" });
    expect(r.choModel).toContain("No matches for /MOC_CUOI/");
    expect(r.choModel).toContain(enTep(1));
    expect(r.choModel).not.toContain("limit or time");
  });

  it("V13-H9c grep trên MỘT tệp bị cắt: nêu đúng lý do là trần byte", async () => {
    const r = await goi("grep", { pattern: "MOC_DAU", path: "lon/big.ts" });
    expect(r.choModel).toContain(enTep(1));
    expect(r.choModel).not.toContain("result limit or time limit");
  });

  it("V13-H11 grep vừa chạm trần kết quả vừa cắt theo byte: nêu cả hai, câu cũ nguyên chữ", async () => {
    const r = await goi("grep", { pattern: "MOC_H", path: "ca-hai" });
    expect(r.choModel).toContain(enTep(1));
    expect(r.choModel).toContain(CAU_CU);
  });

  it("V13-H15 grep qua thư mục bị cắt số mục: không trả 'No matches' trơn", async () => {
    const r = await goi("grep", { pattern: "MOC_XA", path: "dong" });
    expect(r.choModel).toContain(`${enThuMuc(1)} (e.g. dong)`);
    expect(r.choModel).not.toContain("limit or time");
  });

  it("V13-H16 find_files không thấy vì thư mục bị cắt: không trả 'No files match' trơn", async () => {
    const r = await goi("find_files", { pattern: "dong/f30*.ts" });
    expect(r.choModel).toContain(enThuMuc(1));
    expect(r.choModel).toContain("No files match");
  });

  it("V13-H17 find_files có kết quả trong thư mục bị cắt: nêu lý do", async () => {
    const r = await goi("find_files", { pattern: "dong/f00*.ts" });
    expect(r.choModel).toContain(enThuMuc(1));
    expect(r.choModel).toContain("10 file(s)");
  });

  it("V13-H10 grep chỉ chạm trần kết quả: câu cũ nguyên chữ, không nhắc byte hay số mục", async () => {
    const r = await goi("grep", { pattern: "MOC_T", path: "tran" });
    expect(r.choModel).toContain(`\n${CAU_CU}`);
    expect(r.choModel).not.toContain("bytes");
    expect(r.choModel).not.toContain("entries");
  });

  it("V13-H18 không cắt gì: chữ gửi model của grep và find_files không có ghi chú cắt nào", async () => {
    const g = await goi("grep", { pattern: "MOC_S", path: "sach" });
    expect(g.choModel).toContain("1 match(es):\nsach/a.ts:1: goi(MOC_S);");
    expect(g.choModel).not.toContain("partial");
    const f = await goi("find_files", { pattern: "sach/*.ts" });
    expect(f.choModel).toContain("1 file(s):\nsach/a.ts");
    expect(f.choModel).not.toContain("truncated");
  });
});

describe("V13 §5 — find_files chỉ chạm trần SỐ TỆP / giờ (kết quả tool dựng sẵn; không cần cây hàng vạn tệp)", () => {
  const nguoi = { id: 7, role: "engineer", name: "Ky su grep" };
  async function goiGia(truncated: boolean) {
    const bo = taoBoThucThiMayChu({
      execCtx: { user: nguoi, lang: "vi" },
      gocDuAn: GOC,
      user: nguoi,
      coQuyenThucThi: false,
      checkpoint: null,
      phuThuoc: {
        executeDecision: (async () => ({
          result: { type: "table", title: "find_files", note: "NO_MATCH", textSummary: "khong thay", data: { pattern: "x*.ts", count: 0, truncated, timedOut: false, files: [] } },
        })) as never,
        kiemKillSwitch: async () => false,
      },
    });
    const ctx = { cheDo: "hoi" as const, runId: "11111111-1111-4111-8111-111111111111", luot: 1, signal: new AbortController().signal, phat: () => undefined };
    return bo.chay({ id: "c1", ten: "find_files", thamSo: { pattern: "x*.ts" } }, ctx);
  }

  it("V13-H22 NO_MATCH mà bản duyệt bị cắt ⇒ nói rõ chưa tìm hết; trọn vẹn ⇒ câu cũ", async () => {
    const cat = await goiGia(true);
    expect(cat.choModel).toContain('No files match "x*.ts" (search was partial: limit or time reached).');
    expect(cat.choModel).not.toContain("[partial:");
    const tron = await goiGia(false);
    expect(tron.choModel).toContain('No files match "x*.ts".');
    expect(tron.choModel).not.toContain("partial");
  });
});

/**
 * LƯỢT 2 — ba ca dưới viết SAU KHI biết đột biến sống x24, x26 (bộ chốt trước của kiem-dinh); đo lại chúng KHÔNG phải bộ chốt trước.
 * GIỚI HẠN CÓ TÊN «V13-VI-DU-THU-TU»: giấy phạm vi chỉ hứa TỐI ĐA 3 ví dụ, không hứa là 3 đường ĐẦU ⇒ không ca nào ghim ví dụ nào được chọn (đột biến x25).
 */
describe("V13 §6 — ranh giới loaiTru và trần KẾT QUẢ của find_files", () => {
  const TRAN_TIM = 200; // trần kết quả của find_files, như mô tả tool
  const nguoi = { id: 7, role: "engineer", name: "Ky su grep" };
  async function tacNhanTim(pattern: string) {
    const bo = taoBoThucThiMayChu({
      execCtx: { user: nguoi, lang: "vi" },
      gocDuAn: GOC,
      user: nguoi,
      coQuyenThucThi: false,
      checkpoint: null,
      phuThuoc: {
        executeDecision: (async (q: { tool: string; args: Record<string, unknown> }) => ({ result: await tool(q.tool).handler!({ ...q.args, __authCtx: AUTH } as never) })) as never,
        kiemKillSwitch: async () => false,
      },
    });
    const ctx = { cheDo: "hoi" as const, runId: "11111111-1111-4111-8111-111111111111", luot: 1, signal: new AbortController().signal, phat: () => undefined };
    return bo.chay({ id: "c1", ten: "find_files", thamSo: { pattern } }, ctx);
  }

  beforeAll(() => {
    // "ranh/x" bị loại; "ranh/x-khac" chỉ CHUNG TIỀN TỐ CHỮ với nó, không nằm trong nó
    ghi("ranh/k.ts", "goi(MOC_R);\n");
    for (let i = 0; i < 301; i++) ghi(`ranh/x/f${String(i).padStart(3, "0")}.ts`, "x();\n");
    for (let i = 0; i < 301; i++) ghi(`ranh/x-khac/f${String(i).padStart(3, "0")}.ts`, "x();\n");
    // 201 tệp: quá trần kết quả nhưng KHÔNG quá trần số mục
    for (let i = 0; i <= TRAN_TIM; i++) ghi(`tran-kq/f${String(i).padStart(3, "0")}.ts`, "x();\n");
    // 301 tệp: quá CẢ HAI trần
    for (let i = 0; i < 301; i++) ghi(`tran-ca/f${String(i).padStart(3, "0")}.ts`, "x();\n");
  }, 120_000);

  it("V13-H23 loaiTru theo RANH GIỚI đoạn: loại 'ranh/x' vẫn phải khai thư mục anh em 'ranh/x-khac'", async () => {
    const r = await grep({ pattern: "MOC_R", path: "ranh", loaiTru: ["ranh/x"] });
    expect(r.data.count).toBe(1);
    expect(r.data.truncated).toBe(true);
    expect(r.textSummary).toContain(`${khaiThuMuc(1)} (vd: ranh/x-khac)`);
  });

  it("V13-H24 find_files chỉ chạm trần kết quả (không thư mục nào bị cắt) ⇒ vẫn là bản cắt", async () => {
    const r = await timTep("tran-kq/*.ts");
    expect(r.data.files).toHaveLength(TRAN_TIM);
    expect(r.data.truncated).toBe(true);
    expect(r.data).not.toHaveProperty("thuMucBiCat");
    const a = await tacNhanTim("tran-kq/*.ts");
    expect(a.choModel).toContain(`${TRAN_TIM} file(s) (truncated):`);
    expect(a.choModel).toContain("[partial: result limit or time limit reached"); // V14 (6b), đổi CÓ CHỦ ĐÍCH: nêu lý do trần kết quả như grep
  });

  it("V13-H25 find_files vừa chạm trần kết quả vừa có thư mục bị cắt ⇒ giữ CẢ HAI lý do", async () => {
    const r = await timTep("tran-ca/*.ts");
    expect(r.data.files).toHaveLength(TRAN_TIM);
    expect(r.data.truncated).toBe(true);
    expect(r.data.conLyDoKhac).toBe(true);
    expect(r.data.thuMucBiCat).toEqual({ so: 1, viDu: ["tran-ca"] });
    expect(r.textSummary).toContain(`chạm trần ${TRAN_TIM} kết quả`);
    expect(r.textSummary).toContain(khaiThuMuc(1));
    const a = await tacNhanTim("tran-ca/*.ts");
    expect(a.choModel).toContain(`${TRAN_TIM} file(s) (truncated):`);
    expect(a.choModel).toContain(`${enThuMuc(1)} (e.g. tran-ca)`);
  });
});

/* V14 — trần mục của VÒNG DUYỆT nay mặc định 5.000. Các ca trên dựng thư mục 301–305 mục, nên cả tệp đặt trần = 300 qua chỗ tiêm dành cho ca kiểm, rồi trả lại. */
import { CAU_HINH_DUYET } from "./repoSandbox";
const MUC_MAC_DINH = CAU_HINH_DUYET.mucMoiThuMuc;
beforeAll(() => {
  CAU_HINH_DUYET.mucMoiThuMuc = TRAN_MUC_LIET_KE;
});
afterAll(() => {
  CAU_HINH_DUYET.mucMoiThuMuc = MUC_MAC_DINH;
});
