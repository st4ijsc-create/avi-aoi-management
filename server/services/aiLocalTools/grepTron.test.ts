/**
 * V14 — grep_repo và find_files phải TÌM ĐƯỢC thật: vòng duyệt cây không còn bỏ mục thứ 301 trở đi của mỗi thư mục (trần mục của vòng duyệt tách khỏi trần HIỂN THỊ
 * của list_files), vòng quét grep nhường event loop theo lát, và find_files chạm trần kết quả thì tác nhân nêu lý do như grep.
 *
 * Cấu hình đọc qua truy cập có kiểu rộng để tệp này kiểm kiểu được cả khi mã chưa có CAU_HINH_DUYET (lượt đỏ-trước).
 * GIỚI HẠN CÓ TÊN: «V14-TEP-LON-CHUA-TIM» (phần sau trần byte của tệp lớn vẫn chưa được tìm) · «V14-TRAN-TONG-GHIM-HANG» (trần số tệp 20000 và hạn giờ chỉ ghim bằng hằng).
 *
 * ĐỘT BIẾN PHẢI BẮT: vòng duyệt còn trần 300 · mặc định khác 5000 · list_files đổi trần hiển thị · câu khai in hằng thay vì trần đang áp · tham số trần bị bỏ qua ·
 * không nhường · nhường một lần · không kiểm hạn sau khi nhường · nhường làm đổi kết quả · find_files không nêu trần kết quả · nêu cả khi không cắt.
 */
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../aiCopilotActions", () => ({ proposeAction: vi.fn(), confirmAction: vi.fn(), cancelAction: vi.fn(), getAction: vi.fn() }));
// RBAC thật hỏi DB — mock (cùng khuôn grepKhaiCat.test.ts).
const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

import "./index";
import { listTools, type Tool } from "./toolRegistry";
import * as hopCat from "./repoSandbox";
import { taoBoThucThiMayChu } from "../ai/agent/boThucThiMayChu";

interface CauHinhDuyet {
  mucMoiThuMuc: number;
  latQuetMs: number;
}
const cauHinh = (): CauHinhDuyet | undefined => (hopCat as unknown as { CAU_HINH_DUYET?: CauHinhDuyet }).CAU_HINH_DUYET;
const MAC_DINH = cauHinh() ? { ...cauHinh()! } : null;
/** Ghi vào cấu hình thật nếu có; trên mã chưa có cấu hình thì ghi vào vật nháp (không ảnh hưởng gì). */
const datCauHinh = (v: Partial<CauHinhDuyet>) => Object.assign(cauHinh() ?? {}, v);

const AUTH = { userId: 7, role: "engineer" };
const CAU_CHAM_TRAN = "[partial: result limit or time limit reached — narrow the path or pattern]";
let GOC = "";

const tool = (ten: string): Tool<any, any> => listTools().find((t) => t.name === ten)!;
const goiTool = (ten: string, args: Record<string, unknown>): Promise<any> => tool(ten).handler!({ ...args, __authCtx: AUTH } as never);
const grep = (args: Record<string, unknown>) => goiTool("grep_repo", args);
const timTep = (pattern: string) => goiTool("find_files", { pattern });
const so3 = (i: number) => String(i).padStart(3, "0");

async function tacNhan(ten: string, thamSo: Record<string, unknown>) {
  const nguoi = { id: 7, role: "engineer", name: "Ky su grep" };
  const bo = taoBoThucThiMayChu({
    execCtx: { user: nguoi, lang: "vi" },
    gocDuAn: GOC,
    user: nguoi,
    coQuyenThucThi: false,
    checkpoint: null,
    phuThuoc: {
      executeDecision: (async (q: { tool: string; args: Record<string, unknown> }) => ({ result: await goiTool(q.tool, q.args) })) as never,
      kiemKillSwitch: async () => false,
    },
  });
  const ctx = { cheDo: "hoi" as const, runId: "11111111-1111-4111-8111-111111111111", luot: 1, signal: new AbortController().signal, phat: () => undefined };
  return bo.chay({ id: "c1", ten, thamSo }, ctx);
}

function ghi(rel: string, noiDung: string): void {
  mkdirSync(path.dirname(path.join(GOC, rel)), { recursive: true });
  writeFileSync(path.join(GOC, rel), noiDung);
}

beforeAll(() => {
  GOC = realpathSync(mkdtempSync(path.join(tmpdir(), "greptron-")));
  // 305 mục: theo tên, f300…f304 đứng sau mốc 300
  for (let i = 0; i < 305; i++) {
    const than = i === 0 ? "goi(MOC_GAN);\n" : i === 302 ? "export function chiKhaiBao() {}\n" : i === 304 ? "goi(MOC_XA);\n" : "x();\n";
    ghi(`to/f${so3(i)}.ts`, than);
  }
  for (let i = 0; i < 201; i++) ghi(`nhieu-kq/f${so3(i)}.ts`, "x();\n");
  for (let i = 0; i < 20; i++) ghi(`nho/f${so3(i)}.ts`, "goi(MOC_N);\n");
  ghi("sach/a.ts", "goi(MOC_S);\n");
  process.env.AI_REPO_SANDBOX_ROOT = GOC;
}, 60_000);
afterAll(() => {
  delete process.env.AI_REPO_SANDBOX_ROOT;
  try { rmSync(GOC, { recursive: true, force: true }); } catch { /* best-effort */ }
});
let doDongHo: { mockRestore: () => void } | null = null;
beforeEach(() => {
  hopCat.xoaSoNganSach();
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  process.env.AI_REPO_SANDBOX_ROOT = GOC;
});
afterEach(() => {
  doDongHo?.mockRestore();
  doDongHo = null;
  if (MAC_DINH) datCauHinh(MAC_DINH);
});

describe("V14 §1 — mục thứ 301 trở đi tìm được ở cấu hình MẶC ĐỊNH", () => {
  it("V14-R1 grep thấy dòng khớp trong tệp đứng sau mốc 300, và không khai cắt", async () => {
    const r = await grep({ pattern: "MOC_XA", path: "to" });
    expect(r.data.matches.map((m: any) => m.path)).toEqual(["to/f304.ts"]);
    expect(r.data.truncated).toBe(false);
    expect(r.textSummary).not.toContain("mục đầu");
  });

  it("V14-R2 find_files thấy tệp đứng sau mốc 300", async () => {
    const r = await timTep("to/f30*.ts");
    expect(r.data.files).toEqual(["to/f300.ts", "to/f301.ts", "to/f302.ts", "to/f303.ts", "to/f304.ts"]);
    expect(r.data.truncated).toBe(false);
  });

  it("V14-R3 ghim mặc định sản phẩm", () => {
    expect(cauHinh()).toEqual({ mucMoiThuMuc: 5000, latQuetMs: 50 });
    expect(hopCat.TRAN_TEP_QUET).toBe(20_000);
    expect(hopCat.TRAN_TEP_PHANG).toBe(20_000);
    expect(hopCat.HAN_GIO_GREP_MS).toBe(10_000);
    expect(hopCat.TRAN_MUC_LIET_KE).toBe(300);
  });

  it("V14-R4 list_files vẫn HIỂN THỊ tối đa 300 mục và khai đã cắt", async () => {
    const r = await goiTool("list_files", { path: "to" });
    expect(r.data.entries).toHaveLength(300);
    expect(r.data.truncated).toBe(true);
  });

  it("V14-R14 quét trọn thư mục trên 300 mục ⇒ ghi chú chỉ-thấy-khai-báo phát lại", async () => {
    const r = await grep({ pattern: "chiKhaiBao", path: "to" });
    expect(r.data.count).toBe(1);
    expect(r.textSummary).toContain("CHƯA thấy nơi nào GỌI");
  });
});

describe("V14 §2 — trần mục của vòng duyệt: tiêm được, và câu khai in trần ĐANG ÁP", () => {
  it("V14-R5 đặt trần 302 ⇒ cả tool lẫn tác nhân khai đúng số 302", async () => {
    datCauHinh({ mucMoiThuMuc: 302 });
    const r = await grep({ pattern: "MOC_XA", path: "to" });
    expect(r.textSummary).toContain("1 thư mục chỉ được duyệt 302 mục đầu (vd: to)");
    expect(r.data.truncated).toBe(true);
    const a = await tacNhan("grep", { pattern: "MOC_XA", path: "to" });
    expect(a.choModel).toContain("1 directory(ies) listed only their first 302 entries (e.g. to)");
    const f = await timTep("to/f30*.ts");
    expect(f.data.files).toEqual(["to/f300.ts", "to/f301.ts"]);
    expect(f.textSummary).toContain("1 thư mục chỉ được duyệt 302 mục đầu (vd: to)");
  });

  it("V14-R6 tham số của hàm duyệt thắng cấu hình; bỏ tham số thì theo cấu hình", () => {
    const duyet = hopCat.duyetTepDocDuoc as unknown as (...a: unknown[]) => { tep: string[]; thuMucBiCat: string[] };
    const theoThamSo = duyet(GOC, "nho", 20_000, Date.now() + 10_000, 12, 3);
    expect(theoThamSo.tep).toHaveLength(3);
    expect(theoThamSo.thuMucBiCat).toEqual(["nho"]);
    datCauHinh({ mucMoiThuMuc: 5 });
    const theoCauHinh = duyet(GOC, "nho", 20_000, Date.now() + 10_000);
    expect(theoCauHinh.tep).toHaveLength(5);
    expect(theoCauHinh.thuMucBiCat).toEqual(["nho"]);
  });
});

describe("V14 §3 — vòng quét grep nhường event loop", () => {
  /** Đếm số lượt macrotask chen vào TRONG LÚC một lượt grep đang chạy. Cổng quyền chỉ là microtask nên mọi lượt đếm đều đến từ chính vòng quét. */
  async function demChen(args: Record<string, unknown>) {
    let dem = 0;
    let xong = false;
    const nhip = () => {
      if (xong) return;
      dem++;
      setImmediate(nhip);
    };
    setImmediate(nhip);
    const r = await grep(args);
    xong = true;
    return { dem, r };
  }

  it("V14-R7 nhường NHIỀU lần trong một lượt quét 20 tệp (lát 0 ms)", async () => {
    datCauHinh({ latQuetMs: 0 });
    const { dem, r } = await demChen({ pattern: "MOC_N", path: "nho" });
    expect(dem).toBeGreaterThanOrEqual(19);
    expect(r.data.count).toBe(20);
  });

  it("V14-R8 việc đặt sẵn bằng setImmediate chạy TRƯỚC khi grep trả kết quả", async () => {
    datCauHinh({ latQuetMs: 0 });
    const thuTu: string[] = [];
    setImmediate(() => thuTu.push("viec-khac"));
    await grep({ pattern: "MOC_N", path: "nho" }).then(() => thuTu.push("grep"));
    expect(thuTu).toEqual(["viec-khac", "grep"]);
  });

  it("V14-R9 hạn giờ vẫn được kiểm sau khi nhường: quá hạn giữa chừng ⇒ dừng và khai", async () => {
    datCauHinh({ latQuetMs: 0 });
    const gioThat = Date.now.bind(Date);
    let lech = 0;
    doDongHo = vi.spyOn(Date, "now").mockImplementation(() => gioThat() + lech);
    setImmediate(() => { lech = 60_000; });
    const r = await grep({ pattern: "MOC_N", path: "nho" });
    expect(r.data.timedOut).toBe(true);
    expect(r.data.truncated).toBe(true);
    expect(r.data.scanned).toBeLessThan(20);
  });

  it("V14-R10 nhường hay không thì kết quả và thứ tự y hệt", async () => {
    datCauHinh({ latQuetMs: 0 });
    const co = await grep({ pattern: "MOC_N", path: "nho" });
    datCauHinh({ latQuetMs: 1_000_000 });
    const khong = await grep({ pattern: "MOC_N", path: "nho" });
    expect(co.textSummary).toBe(khong.textSummary);
    expect(co.data.matches).toEqual(khong.data.matches);
    expect(co.data.count).toBe(20);
  });
});

describe("V14 §4 — find_files chạm trần kết quả thì tác nhân nêu lý do như grep", () => {
  it("V14-R11 chỉ chạm trần kết quả ⇒ có câu chạm trần", async () => {
    const a = await tacNhan("find_files", { pattern: "nhieu-kq/*.ts" });
    expect(a.choModel).toContain(CAU_CHAM_TRAN);
    expect(a.choModel).toContain("200 file(s) (truncated):");
  });

  it("V14-R12 không cắt ⇒ không có câu nào", async () => {
    const a = await tacNhan("find_files", { pattern: "sach/*.ts" });
    expect(a.choModel).toContain("1 file(s):\nsach/a.ts");
    expect(a.choModel).not.toContain("partial");
  });

  it("V14-R13 vừa chạm trần kết quả vừa có thư mục bị cắt ⇒ nêu CẢ HAI", async () => {
    datCauHinh({ mucMoiThuMuc: 302 });
    const a = await tacNhan("find_files", { pattern: "to/*.ts" });
    expect(a.choModel).toContain(CAU_CHAM_TRAN);
    expect(a.choModel).toContain("1 directory(ies) listed only their first 302 entries (e.g. to)");
  });

  it("V14-R15 chỉ cắt vì thư mục (dưới trần kết quả) ⇒ KHÔNG nói chạm trần kết quả hay giờ", async () => {
    datCauHinh({ mucMoiThuMuc: 302 });
    const a = await tacNhan("find_files", { pattern: "to/f30*.ts" });
    expect(a.choModel).toContain("2 file(s) (truncated):");
    expect(a.choModel).toContain("1 directory(ies) listed only their first 302 entries (e.g. to)");
    expect(a.choModel).not.toContain("result limit or time limit");
  });
});

/*
 * §5 — thêm SAU lượt đỏ-trước (đã báo trước, HST duyệt). Vòng quét có nhường ⇒ giữa phép hỏi ngân sách và phép trừ nay có chỗ chen. R16 là lưới chống hồi quy (mã cũ chạy
 * tuần tự nên cũng đạt); R16b chứng minh hai lượt CÙNG đã quét (không phải tuần tự tình cờ) bằng số lần nhường thật.
 */
describe("V14 §5 — nhường không được làm thủng ngân sách byte của phiên", () => {
  /** Ngân sách còn đúng 1 byte ⇒ cả hai lượt qua được phép hỏi đầu lượt nếu chúng chen nhau; mỗi lượt quét 20 tệp. */
  async function haiLuotSatTran() {
    datCauHinh({ latQuetMs: 0 });
    hopCat.tieuNganSach("u:7", hopCat.TRAN_BYTE_MOI_PHIEN - 1);
    return Promise.all([grep({ pattern: "MOC_N", path: "nho" }), grep({ pattern: "MOC_N", path: "nho" })]);
  }
  let doNhuong: { mockRestore: () => void } | null = null;
  afterEach(() => {
    doNhuong?.mockRestore();
    doNhuong = null;
  });

  it("V14-R16 hai lượt chen nhau khi ngân sách còn 1 byte ⇒ đúng một lượt phát, lượt kia BUDGET_EXCEEDED", async () => {
    const [a, b] = await haiLuotSatTran();
    expect([a.note ?? "OK", b.note ?? "OK"].sort()).toEqual(["BUDGET_EXCEEDED", "OK"]);
    const bi = a.note === "BUDGET_EXCEEDED" ? a : b;
    expect(bi.data.matches).toEqual([]);
    expect(bi.textSummary).not.toContain("MOC_N");
  });

  it("V14-R16b cùng cảnh: cả hai lượt đều quét đủ 20 tệp (nhường thật ≥ 20 lần mỗi lượt)", async () => {
    const dem = vi.spyOn(globalThis, "setImmediate");
    doNhuong = dem;
    await haiLuotSatTran();
    expect(dem.mock.calls.length).toBeGreaterThanOrEqual(40);
  });
});
