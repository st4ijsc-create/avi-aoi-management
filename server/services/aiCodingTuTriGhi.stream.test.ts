/**
 * ★★★ 2026-08-24 · VÒNG TỰ-TRỊ-GHI — ĐIỂM GỌI PRODUCTION trong `streamCodingAnswer`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA MỆNH ĐỀ (khuôn `aiCodingTaoKhung.stream.test.ts`: mock model bằng `h.manh`, thư mục TẠM):
 *   1. cờ BẬT + "tự sửa cho test xanh" + model sinh vá + test lượt 2 XANH ⇒ vòng dừng **"xanh"**,
 *      sổ WORM có hàng, và **byte ĐÃ vào đĩa đúng chỗ** (đúng tệp mà `trichTepTuLoi` nhặt từ lỗi).
 *   2. cờ TẮT ⇒ câu "vòng tự trị đang TẮT" (nêu ĐÍCH DANH hai cờ), KHÔNG một lượt ghi nào.
 *   3. "đọc tệp X" (KHÔNG phải tự trị) ⇒ ĐƯỜNG THƯỜNG (read_file), KHÔNG khởi động vòng.
 *
 * ĐỘT BIẾN PHẢI BẮT:
 *   • điểm gọi bỏ kiểm `laYDinhTuTri` ⇒ câu thường vào nhánh tự trị (hiện câu "TẮT" thay vì đọc tệp) ⇒ §3 ĐỎ.
 *   • cờ-tắt rơi xuống đường thường thay vì nói thật ⇒ §2 (không thấy "TẮT") ĐỎ.
 *
 * ⚠ KHÔNG mock cái đang được đo: điểm gọi + `chayVongTuTriGhi` + `sinhBanVa` THẬT (qua
 *   `chuanBiBanSuaMotTep`) + bước CHẠY (`aiCodingVerify`) + chính sách. Chỉ ba cạnh I/O bị thay:
 *   engine GGUF (model), `confirmAction` (không sinh tiến trình — GHI THẬT ra thư mục tạm ở lượt
 *   apply_diff để đo "đĩa đổi"), và sổ audit + kill-switch (db). `executeDecision` PASSTHROUGH:
 *   `read_file`/`list_files` chạy THẬT trên thư mục tạm; chỉ `run_command`/`apply_diff` bị chặn ở cửa.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  manh: [] as string[],
  /** Đầu ra model THEO LƯỢT: [0]=bước 1 (chọn tệp), [1]=bước 2 (SEARCH/REPLACE), [2]=lượt lùi nếu có. */
  manhTheoLuot: [] as string[][],
  moiPrompt: [] as string[],
  quyetDinh: [] as Array<{ tool: string | null; args: Record<string, unknown> }>,
  /** Tham số apply_diff lượt ghi — để `confirmAction` ghi ĐÚNG nội dung ra đĩa. */
  applyGoi: [] as Array<{ path: string; original: string; modified: string }>,
  /** Chuỗi kết quả run_command theo lượt: {out, exit}. */
  runSeq: [] as Array<{ out: string; exit: number | null }>,
  runIdx: 0,
  /** Hàng kill-switch giả: [] = chưa bật. */
  killRows: [] as Array<{ value: string }>,
  /** Hàng WORM audit đã ghi. */
  auditRows: [] as Array<{ action: string; details: unknown }>,
  /** Gốc dự án tạm (điền ở beforeAll). */
  GOC: "" as string,
}));

vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateText: vi.fn(),
  chatCompletion: vi.fn(),
  generateEmbedding: vi.fn(),
  describeImage: vi.fn(),
  generateJSON: vi.fn(async () => ({ data: { tool: "none", args: {} }, raw: "{}", modelId: "stub", totalTimeMs: 1, tokensPrompt: 1, tokensGenerated: 1 })),
  generateTextStream: async function* (opt: any) {
    h.moiPrompt.push(String(opt?.prompt ?? ""));
    const manh = h.manhTheoLuot.length > 0 ? (h.manhTheoLuot.shift() ?? []) : h.manh;
    for (const m of manh) yield { type: "token", token: m };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: manh.length };
  },
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({
    // kill-switch: select→[] (chưa bật). insert: best-effort, không đo.
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.killRows }) }) }),
    insert: () => ({ values: async () => undefined }),
  })),
}));

/**
 * ⚠ PASSTHROUGH — `read_file`/`list_files` chạy THẬT trên thư mục tạm (điều kiện để "đọc lại tệp
 * trong lượt" và "suy lệnh kiểm chứng từ mục ở gốc" có nghĩa). Chỉ tool GHI/CHẠY bị chặn ở cửa.
 */
vi.mock("./aiLocalTools", async (goc) => {
  const that = await goc<typeof import("./aiLocalTools")>();
  let runN = 0;
  let apN = 0;
  return {
    ...that,
    executeDecision: async (d: any, ctx: any) => {
      h.quyetDinh.push({ tool: d.tool, args: d.args });
      if (d.tool === "run_command") {
        return { result: null, pendingAction: { actionId: `run-${++runN}`, token: "t", tool: "run_command", args: d.args, summary: "", preview: {}, expiresAt: "" } };
      }
      if (d.tool === "apply_diff") {
        h.applyGoi.push({ path: String(d.args.path), original: String(d.args.original), modified: String(d.args.modified) });
        return { result: null, pendingAction: { actionId: `ap-${++apN}`, token: "t", tool: "apply_diff", args: d.args, summary: "", preview: {}, expiresAt: "" } };
      }
      return that.executeDecision(d, ctx); // read_file / list_files / grep_repo THẬT
    },
  };
});

vi.mock("./aiCopilotActions", async (goc) => {
  const that = await goc<typeof import("./aiCopilotActions")>();
  return {
    ...that,
    confirmAction: async (actionId: string) => {
      if (actionId.startsWith("ap-")) {
        // ★ "BYTE VÀO ĐĨA" của lượt tự-ghi: ghi THẬT `modified` ra thư mục tạm.
        const a = h.applyGoi[h.applyGoi.length - 1]!;
        fs.writeFileSync(path.join(h.GOC, a.path), a.modified);
        return { ok: true, status: "executed", result: { type: "action_result", note: null, textSummary: "đã ghi", data: { path: a.path, bytes: Buffer.byteLength(a.modified), created: false, sha256Before: "b0", sha256After: "a1" } } };
      }
      // run_command — tiêu một mục của chuỗi kết quả test.
      const seq = h.runSeq[h.runIdx] ?? h.runSeq[h.runSeq.length - 1] ?? { out: "Failed: 1", exit: 1 };
      h.runIdx++;
      return { ok: true, status: "executed", result: { type: "action_result", title: "Chạy lệnh", data: { exitCode: seq.exit, timedOut: false, output: seq.out }, textSummary: seq.out } };
    },
  };
});

vi.mock("./auditTrailService", async (goc) => {
  const that = await goc<typeof import("./auditTrailService")>();
  return {
    ...that,
    createAuditContext: (x: any) => ({ userId: x?.user?.id }),
    logCrudOperation: async (_c: unknown, e: any) => {
      h.auditRows.push({ action: e.action, details: e.details });
      return { id: h.auditRows.length };
    },
  };
});

import { streamAnswer, type StreamEvent } from "./aiLocalKnowledgeService";
import { MOC_MO, MOC_NGAN, MOC_DONG } from "@shared/aiCodingMoc";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// GỐC DỰ ÁN TẠM — .sln (suy `dotnet test`) + tệp NGUỒN (có bug) + tệp TEST (đích gaming)
// ════════════════════════════════════════════════════════════════════════════════════════════════
let GOC = "";
const ID_DU_AN = "tutri";
const TEP_NGUON = "src/Calculator.cs";
const TEP_TEST = "tests/CalculatorTests.cs";
const ND_NGUON = ["namespace CalculatorDemo;", "", "public class Calculator", "{", "    public int Divide(int a, int b) => a / b;", "}", ""].join("\n");
const NEO_NGUON = "    public int Divide(int a, int b) => a / b;";
const THAY_NGUON = ["    public int Divide(int a, int b)", "    {", "        if (b == 0) throw new System.ArgumentException(\"b\");", "        return a / b;", "    }"].join("\n");
const ND_TEST = ["namespace CalculatorDemo.Tests;", "", "public class CalculatorTests", "{", "    public bool Divide_ByZero_Throws() => true;", "}", ""].join("\n");

/** BƯỚC 1 (chọn tệp): model trả `### FILE: <đường>`. */
const STEP1_NGUON = `### FILE: ${TEP_NGUON}`;
const STEP1_TEST = `### FILE: ${TEP_TEST}`;
const STEP1_BIA = "### FILE: src/DoesNotExist.cs"; // KHÔNG có trong cây ⇒ chonDuongTuTri null
/** BƯỚC 2 (sửa): model trả khối SEARCH/REPLACE (KHÔNG header — chuanBiBanSuaMotTep đã biết tệp). */
function khoiSua(neo: string, thay: string): string {
  return [MOC_MO, neo, MOC_NGAN, thay, MOC_DONG].join("\n");
}
const STEP2_MATCH = khoiSua(NEO_NGUON, THAY_NGUON); // neo KHỚP byte nội dung thật
const STEP2_TEST = khoiSua("    public bool Divide_ByZero_Throws() => true;", "    public bool Divide_ByZero_Throws() => false; // gamed");
/** Neo LỆCH BYTE (thêm `static` mà tệp thật KHÔNG có) — đúng lỗi live #2. */
const STEP2_OFF = khoiSua("    public static int Divide(int a, int b) => a / b;", THAY_NGUON);

function datTepGoc() {
  fs.rmSync(path.join(GOC, "src"), { recursive: true, force: true });
  fs.rmSync(path.join(GOC, "tests"), { recursive: true, force: true });
  fs.mkdirSync(path.join(GOC, "src"), { recursive: true });
  fs.mkdirSync(path.join(GOC, "tests"), { recursive: true });
  fs.writeFileSync(path.join(GOC, TEP_NGUON), ND_NGUON);
  fs.writeFileSync(path.join(GOC, TEP_TEST), ND_TEST);
  fs.writeFileSync(path.join(GOC, "CalculatorDemo.sln"), "Microsoft Visual Studio Solution File\n");
}

beforeAll(() => {
  GOC = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tu-tri-stream-")));
  h.GOC = GOC;
});
afterAll(() => {
  try {
    fs.rmSync(GOC, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

let idPhien = 8600;
function admin() {
  return { user: { id: ++idPhien, role: "admin", name: "T" }, lang: "vi" as const };
}

async function chay(question: string): Promise<{ events: StreamEvent[]; chu: string }> {
  const events: StreamEvent[] = [];
  const tokens: string[] = [];
  const ctx = { codingMode: true, uiLanguage: "vi" as const, projectId: ID_DU_AN };
  for await (const e of streamAnswer(question, 5, [], "engineer", ctx, admin())) {
    events.push(e);
    if (e.type === "token") tokens.push(e.token);
  }
  return { events, chu: tokens.join("") };
}

const CAU_TU_TRI = "tự sửa cho test xanh";
const ENV = ["AI_CODING_AUTOLOOP", "AI_CODING_TU_TRI_GHI", "AI_CODING_TU_TRI_GHI_MAX", "AI_CODING_REPO_CONTEXT", "AI_CODING_LESSONS", "AI_REPO_SANDBOX_ROOTS"] as const;

/** Đầu ra `dotnet test` khi ĐỎ — stack trỏ tệp TEST bằng đường TUYỆT ĐỐI (đúng thứ live bắt được). */
const LOI_DO = [
  "Failed CalculatorDemo.Tests.CalculatorTests.Divide_ByZero_Throws [12 ms]",
  "  Error Message: Assert.Throws failed.",
  `  Stack Trace: at CalculatorDemo.Tests.CalculatorTests.Divide_ByZero_Throws() in C:\\Users\\dev\\${ID_DU_AN}\\tests\\CalculatorTests.cs:line 9`,
  "Failed!  - Failed: 1, Passed: 5, Total: 6",
].join("\n");
const XANH = "Passed!  - Failed: 0, Passed: 6, Total: 6";

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.AI_CODING_AUTOLOOP = "1"; // bước CHẠY (chayKiemChung)
  process.env.AI_CODING_TU_TRI_GHI = "1"; // bước GHI (apply_diff tự trị)
  process.env.AI_CODING_REPO_CONTEXT = "0"; // tắt thu-thập-ngữ-cảnh-mã ⇒ prompt gọn, model tự lo neo
  process.env.AI_CODING_LESSONS = "0"; // tắt bài học (không phụ thuộc DB bài học)
  process.env.AI_REPO_SANDBOX_ROOTS = `${ID_DU_AN}=Tu tri|${GOC}`;
  h.manh = [];
  h.manhTheoLuot = [];
  h.moiPrompt = [];
  h.quyetDinh = [];
  h.applyGoi = [];
  h.runSeq = [];
  h.runIdx = 0;
  h.killRows = [];
  h.auditRows = [];
  datTepGoc();
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — CỜ BẬT · HAI BƯỚC: model CHỌN nguồn → server ĐỌC nội dung thật → sửa khớp byte → XANH", () => {
  it("★★★ lỗi trỏ tests/…tuyệt đối · bước 1 chọn src/Calculator.cs · bước 2 SEARCH khớp nội dung THẬT · 0 đỏ ⇒ 'xanh', 1 ghi, đĩa đổi, sua_tep_test=false", async () => {
    // Bước 1 → chọn TỆP NGUỒN; Bước 2 → SEARCH/REPLACE (neo khớp byte nội dung tệp server đọc).
    h.manhTheoLuot = [[STEP1_NGUON], [STEP2_MATCH]];
    h.runSeq = [
      { out: LOI_DO, exit: 1 }, // ĐỎ: stack trỏ tests/CalculatorTests.cs bằng đường TUYỆT ĐỐI
      { out: XANH, exit: 0 },
    ];
    const r = await chay(CAU_TU_TRI);

    expect(h.quyetDinh.filter((q) => q.tool === "run_command").length, "hai lượt CHẠY test").toBe(2);
    expect(h.applyGoi.length, "một lượt GHI (lượt 1 đỏ ⇒ sửa; lượt 2 xanh ⇒ dừng)").toBe(1);

    // ★★★ HAI LƯỢT MODEL: [0] chọn tệp, [1] sửa. Đây là hình dạng "hai bước".
    expect(h.moiPrompt.length, "đúng HAI lượt model (chọn + sửa)").toBe(2);

    // ★★★ GỐC RỄ #2 ĐÃ VÁ: prompt bước 2 CHỨA NỘI DUNG TỆP THẬT ⇒ model COPY neo khớp byte (không đoán).
    //   (Đột biến "bỏ bước đọc-tệp-thật" ⇒ prompt sửa không có nội dung ⇒ ca này ĐỎ.)
    expect(h.moiPrompt[1], "prompt SỬA phải chở NGUYÊN VĂN nội dung tệp").toContain("public int Divide(int a, int b) => a / b;");
    expect(h.moiPrompt[0], "prompt CHỌN chỉ có cây tệp, KHÔNG có nội dung").not.toContain("public int Divide(int a, int b) => a / b;");

    // ★★★ CHỐNG-GAMING #1: chọn TỆP NGUỒN, KHÔNG phải tệp TEST mà stack lỗi trỏ tới.
    expect(h.applyGoi[0]!.path).toMatch(/Calculator\.cs$/);
    expect(h.applyGoi[0]!.path, "KHÔNG được là tệp test").not.toMatch(/tests?[\\/]/i);
    expect(h.applyGoi[0]!.original, "original = byte SERVER đọc từ đĩa").toBe(ND_NGUON);
    expect(h.applyGoi[0]!.modified).toContain("ArgumentException");

    // BYTE ĐÃ VÀO ĐĨA.
    const tren_dia = fs.readFileSync(path.join(GOC, h.applyGoi[0]!.path), "utf8");
    expect(tren_dia).toContain("ArgumentException");
    expect(tren_dia).not.toBe(ND_NGUON);

    // AUDIT WORM: một hàng, sua_tep_test=FALSE (sửa nguồn).
    expect(h.auditRows.length).toBe(1);
    expect((h.auditRows[0]!.details as any).metadata.sua_tep_test, "sửa NGUỒN ⇒ cờ TẮT").toBe(false);

    expect(r.chu).toContain("tự sửa");
    expect(r.chu).toContain("ĐÃ XANH");
    expect(r.events.some((e) => e.type === "tool_loop")).toBe(true);
  });

  it("★★★ bước 1 chọn ĐÚNG nhưng SEARCH bước 2 LỆCH BYTE (live #2) ⇒ server TỪ CHỐI ⇒ null ⇒ dừng an toàn, 0 ghi", async () => {
    // Bước 2 model viết `public static int` (tệp thật KHÔNG có `static`) ⇒ neo không khớp ⇒ lùi cả-tệp
    // cũng hỏng ⇒ chuanBiBanSuaMotTep trả ≠ "ok" ⇒ sinhBanVa null. Đây đúng "thà từ chối còn hơn áp nhầm".
    h.manhTheoLuot = [[STEP1_NGUON], [STEP2_OFF], [STEP2_OFF]];
    h.runSeq = [{ out: LOI_DO, exit: 1 }];
    const r = await chay(CAU_TU_TRI);

    expect(h.applyGoi.length, "neo lệch ⇒ KHÔNG ghi (không áp nhầm chỗ)").toBe(0);
    expect(h.auditRows.length).toBe(0);
    expect(r.chu).toContain("DỪNG");
    expect(fs.readFileSync(path.join(GOC, TEP_NGUON), "utf8"), "0 byte chạm đĩa").toBe(ND_NGUON);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — MODEL BỊA ĐƯỜNG (bước 1 chọn tệp KHÔNG TRONG CÂY) ⇒ DỪNG an toàn, 0 ghi", () => {
  it("★★★ bước 1 chọn src/DoesNotExist.cs ⇒ chonDuongTuTri null ⇒ KHÔNG tới bước sửa, 'DỪNG', 0 ghi/audit", async () => {
    h.manhTheoLuot = [[STEP1_BIA]];
    h.runSeq = [{ out: LOI_DO, exit: 1 }];
    const r = await chay(CAU_TU_TRI);

    expect(h.applyGoi.length, "đường bịa ⇒ KHÔNG ghi").toBe(0);
    expect(h.auditRows.length, "không ghi ⇒ không audit lượt").toBe(0);
    expect(h.moiPrompt.length, "chỉ bước 1 chạy; bịa đường ⇒ KHÔNG tốn lượt sửa").toBe(1);
    expect(r.chu, "dừng vì không dựng được bản vá hợp lệ").toContain("DỪNG");
    expect(fs.readFileSync(path.join(GOC, TEP_NGUON), "utf8")).toBe(ND_NGUON);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — MODEL SỬA TỆP TEST (gaming) ⇒ VẪN ghi (không chặn cứng) NHƯNG audit KHAI sua_tep_test=true", () => {
  it("★★★ bước 1 chọn tests/CalculatorTests.cs · bước 2 sửa test ⇒ ghi được, sổ WORM cờ sua_tep_test=true", async () => {
    h.manhTheoLuot = [[STEP1_TEST], [STEP2_TEST]];
    h.runSeq = [
      { out: LOI_DO, exit: 1 },
      { out: XANH, exit: 0 },
    ];
    const r = await chay(CAU_TU_TRI);

    expect(r.chu).toContain("ĐÃ XANH");
    expect(h.applyGoi.length, "sửa test KHÔNG bị chặn cứng ⇒ vẫn ghi").toBe(1);
    expect(h.applyGoi[0]!.path).toMatch(/tests[\\/]CalculatorTests\.cs$/);
    // ★★★ Chống-gaming ở TẦNG AUDIT: cờ PHẢI bật để người xem lại thấy model đã chạm tệp test.
    expect(h.auditRows.length).toBe(1);
    expect((h.auditRows[0]!.details as any).metadata.sua_tep_test, "model chạm tệp test ⇒ cờ BẬT").toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — CỜ TẮT: nói THẲNG 'đang TẮT', KHÔNG rơi xuống đường thường, 0 ghi (đột biến cờ-tắt)", () => {
  it("★★★ AI_CODING_TU_TRI_GHI vắng ⇒ câu 'vòng tự trị đang TẮT' + tên hai cờ, 0 run/apply/audit", async () => {
    delete process.env.AI_CODING_TU_TRI_GHI;
    h.runSeq = [{ out: LOI_DO, exit: 1 }];
    const r = await chay(CAU_TU_TRI);

    expect(r.chu, "phải NÓI THẲNG là đang tắt").toContain("TẮT");
    expect(r.chu, "nêu ĐÍCH DANH cờ tự-ghi").toContain("AI_CODING_TU_TRI_GHI");
    expect(r.chu, "nêu ĐÍCH DANH cờ autoloop").toContain("AI_CODING_AUTOLOOP");

    // KHÔNG một lượt chạy/ghi nào, và KHÔNG rơi xuống đường thường (không sinh mã).
    expect(h.quyetDinh.some((q) => q.tool === "run_command")).toBe(false);
    expect(h.applyGoi.length).toBe(0);
    expect(h.auditRows.length).toBe(0);
    expect(fs.readFileSync(path.join(GOC, TEP_NGUON), "utf8"), "0 byte chạm đĩa").toBe(ND_NGUON);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — CÂU THƯỜNG: 'đọc tệp X' KHÔNG khởi động vòng (đột biến bỏ kiểm laYDinhTuTri)", () => {
  it("★★★ 'đọc tệp src/Calculator.cs' ⇒ đường thường (HIỆN nội dung tệp), KHÔNG có câu tự trị, 0 run/apply", async () => {
    const r = await chay(`đọc tệp ${TEP_NGUON}`);

    // ⚠ Vòng tool ĐỌC gọi `executeDecision` NỘI-MODULE (mock cross-module không thấy) — nên đo ở
    //   ĐẦU RA: đường thường HIỆN nguyên văn nội dung tệp. Nếu điểm gọi bỏ kiểm `laYDinhTuTri`, câu
    //   này rơi vào nhánh tự trị và in "vòng tự trị đang TẮT" (batDau=false) THAY VÌ nội dung tệp.
    expect(r.chu, "đường ĐỌC phải hiện nội dung tệp thật").toContain("Divide");
    expect(r.chu, "câu thường KHÔNG được thấy nhãn vòng tự trị").not.toContain("vòng tự trị");
    expect(r.chu, "và tuyệt đối KHÔNG thấy câu TẮT của nhánh tự trị").not.toContain("TẮT");
    expect(h.quyetDinh.some((q) => q.tool === "run_command"), "0 lượt CHẠY").toBe(false);
    expect(h.applyGoi.length, "0 lượt GHI").toBe(0);
    expect(h.auditRows.length).toBe(0);
  });
});
