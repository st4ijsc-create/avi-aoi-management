/**
 * ★★★ 2026-08-24 — **TẠO KHUNG DỰ ÁN TỪ HỘI THOẠI: cổng ra đầu–cuối của ĐỊNH TUYẾN + HẬU KIỂM.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA MỆNH ĐỀ FILE NÀY PHÁT BIỂU (và `cliTaoKhung.test.ts` đo phần GHI THẬT xuống đĩa):
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. Câu *"tạo dự án C# WPF đọc file pdf"* — KHÔNG một đường dẫn nào — phải tới được
 *      `apply_diff_batch` với danh sách tệp do MODEL chọn, MỌI mục `original: ""`, qua HITL.
 *      (Trước bản vá: câu ấy rơi xuống nhánh SINH MÃ — mã in ra màn hình, 0 tệp trên đĩa.)
 *   2. Ngoại lệ ấy là CREATE-ONLY và fail-closed: tệp ĐÃ tồn tại / đường xấu / quá trần / manifest
 *      hỏng ⇒ KHÔNG đề xuất gì (fail-safe về câu trả lời thường), và câu từ chối nêu ĐÍCH DANH.
 *   3. KHÔNG nới đường cũ: "tạo file mới <đường>" vẫn đi đường tạo-MỘT-tệp; "sửa X: …" vẫn đi
 *      đường sửa; bộ chọn LLM vẫn không khởi xướng được tool ghi.
 *
 * ⚠ KHÔNG gọi model thật: `generateTextStream` bị chặn ở tầng thấp nhất (`aiGgufEngine`).
 * ⚠ Gốc dự án là thư mục TẠM riêng (mkdtemp) — không chạm `sandbox-projects/**` (đề thi).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  manh: [] as string[],
  /**
   * ★ Lượt TỰ SỬA cần model trả lời KHÁC NHAU theo lượt: phần tử [0] cho lượt gốc, [1] cho lượt
   * tự sửa. Không rỗng ⇒ stub `shift()` mỗi lần gọi và BỎ QUA `manh`. Rỗng ⇒ hành vi cũ nguyên.
   */
  manhTheoLuot: [] as string[][],
  systemPromptNhan: "" as string,
  promptNhan: "" as string,
  moiPrompt: [] as string[],
  quyetDinh: [] as Array<{ tool: string | null; args: Record<string, unknown> }>,
}));

vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateText: vi.fn(),
  chatCompletion: vi.fn(),
  generateEmbedding: vi.fn(),
  describeImage: vi.fn(),
  generateJSON: vi.fn(async () => ({
    data: { tool: "none", args: {} },
    raw: "{}",
    modelId: "stub",
    totalTimeMs: 1,
    tokensPrompt: 1,
    tokensGenerated: 1,
  })),
  generateTextStream: async function* (opt: any) {
    h.systemPromptNhan = String(opt?.systemPrompt ?? "");
    h.promptNhan = String(opt?.prompt ?? "");
    h.moiPrompt.push(h.promptNhan);
    const manh = h.manhTheoLuot.length > 0 ? (h.manhTheoLuot.shift() ?? []) : h.manh;
    for (const m of manh) yield { type: "token", token: m };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: manh.length };
  },
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({ insert: () => ({ values: async () => undefined }) })),
}));

/**
 * ⚠ MOCK **BỘ PHẬN** (đúng khuôn `aiCodingTaoTep.stream.test.ts`): `read_file` chạy THẬT — đó là
 * điều kiện để mệnh đề *"đã kiểm CHƯA-tồn-tại qua đúng cửa đọc"* có nghĩa. Chỉ tool GHI bị chặn ở
 * cửa `executeDecision` (đúng CỬA mọi `kind:"write"` phải đi qua) để lưới không cần `ai_pending_actions`.
 */
vi.mock("./aiLocalTools", async (goc) => {
  const that = await goc<typeof import("./aiLocalTools")>();
  return {
    ...that,
    executeDecision: async (d: any, ctx: any) => {
      h.quyetDinh.push({ tool: d.tool, args: d.args });
      if (d.tool === "apply_diff" || d.tool === "apply_diff_batch") {
        return {
          result: null,
          pendingAction: {
            actionId: "act-test",
            token: "tok-test",
            tool: d.tool,
            summary: `[HITL] ${d.tool} — cần bạn duyệt`,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            args: d.args,
            preview: { entityType: "repo_file_batch", entityName: "", changes: [], warnings: [], humanSummary: "" },
          },
        };
      }
      return that.executeDecision(d, ctx);
    },
  };
});

import { streamAnswer, type StreamEvent } from "./aiLocalKnowledgeService";
import { bocManifestKhung, chuanHoaTepMoi, MOC_TEP_KHUNG } from "./aiCodingAgent";
import { laYDinhTaoDuAn } from "./aiLocalTools/intentClassifier";
import { TRAN_TEP_MOI_LO } from "./aiLocalTools/writeHandlers/applyDiffBatch";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// GỐC DỰ ÁN TẠM — thư mục TRỐNG, **KHÔNG git** (đúng hình dạng "thư mục mới thêm qua Quản lý dự án")
// ════════════════════════════════════════════════════════════════════════════════════════════════
let GOC = "";
const ID_DU_AN = "taokhung";
/** Tệp CÓ THẬT trong gốc tạm — để đo ca "manifest chứa tệp đã tồn tại". */
const TEP_DA_CO = "src/DaCo.cs";

beforeAll(() => {
  GOC = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tao-khung-stream-")));
  fs.mkdirSync(path.join(GOC, "src"), { recursive: true });
  fs.writeFileSync(path.join(GOC, TEP_DA_CO), "namespace X;\npublic class DaCo { }\n");
});
afterAll(() => {
  try {
    fs.rmSync(GOC, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

/** Một mục manifest đúng khuôn persona dặn. */
function tepKhung(duong: string, nhan: string, noiDung: string): string {
  return [`${MOC_TEP_KHUNG} ${duong}`, "```" + nhan, noiDung, "```"].join("\n");
}

const ND_CSPROJ = [
  '<Project Sdk="Microsoft.NET.Sdk">',
  "  <PropertyGroup>",
  "    <OutputType>WinExe</OutputType>",
  "    <TargetFramework>net8.0-windows</TargetFramework>",
  "    <UseWPF>true</UseWPF>",
  "  </PropertyGroup>",
  "</Project>",
].join("\n");
const ND_XAML = [
  '<Application x:Class="PdfReader.App"',
  '             xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"',
  '             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"',
  '             StartupUri="MainWindow.xaml" />',
].join("\n");
const ND_CS = ["namespace PdfReader;", "", "public partial class App : System.Windows.Application { }"].join("\n");
const ND_README = ["# PdfReader", "", "Build: `dotnet build --no-restore`"].join("\n");

/** Manifest 4 tệp — có `.xaml` CỐ Ý: đuôi này vừa được thêm vào danh sách trắng cho đường khung. */
const MANIFEST_WPF = [
  "Khung WPF tối thiểu, chưa cần package ngoài:",
  "",
  tepKhung("PdfReader.csproj", "xml", ND_CSPROJ),
  tepKhung("App.xaml", "xml", ND_XAML),
  tepKhung("App.xaml.cs", "csharp", ND_CS),
  tepKhung("README.md", "markdown", ND_README),
  "",
  "- Khung gồm 4 tệp; build bằng `dotnet build --no-restore`.",
].join("\n");

let idPhien = 7600;
function admin() {
  return { user: { id: ++idPhien, role: "admin", name: "T" }, lang: "vi" as const };
}

async function chay(question: string): Promise<{ events: StreamEvent[]; chu: string; done?: StreamEvent }> {
  const events: StreamEvent[] = [];
  const tokens: string[] = [];
  const ctx = { codingMode: true, uiLanguage: "vi" as const, projectId: ID_DU_AN };
  for await (const e of streamAnswer(question, 5, [], "engineer", ctx, admin())) {
    events.push(e);
    if (e.type === "token") tokens.push(e.token);
  }
  return { events, chu: tokens.join(""), done: events.find((e) => e.type === "done") };
}

function cacLo() {
  return h.quyetDinh.filter((q) => q.tool === "apply_diff_batch");
}

const ENV = ["AI_CODING_GEN", "AI_CODING_EDIT", "AI_CODING_REPO_CONTEXT", "AI_REPO_SANDBOX_ROOTS"] as const;

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.AI_CODING_REPO_CONTEXT = "0";
  process.env.AI_REPO_SANDBOX_ROOTS = `${ID_DU_AN}=Khung tam|${GOC}`;
  h.manh = [];
  h.manhTheoLuot = [];
  h.systemPromptNhan = "";
  h.promptNhan = "";
  h.moiPrompt = [];
  h.quyetDinh = [];
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — `laYDinhTaoDuAn`: vị từ THUẦN, A/B có dấu / không dấu (khuôn `intentClassifier.khongDau`)", () => {
  const co = [
    "tạo dự án C# WPF đọc file pdf",
    "tao du an C# WPF doc file pdf", // KHÔNG DẤU — người gõ telex tắt
    "khởi tạo dự án web mới",
    "khoi tao du an web moi",
    "dựng khung dự án console",
    "dung khung du an console",
    "tạo project WPF",
    "tao project WPF",
    "scaffold a WPF pdf reader",
    "create a new project for reading pdf",
    "创建一个项目：WPF 读取 pdf",
  ];
  for (const q of co) it(`★★ "${q}" ⇒ Ý ĐỊNH TẠO KHUNG`, () => expect(laYDinhTaoDuAn(q)).toBe(true));

  /**
   * ⚠⚠ CA ÂM QUAN TRỌNG HƠN CA DƯƠNG: nhận thừa là đốt một lượt model ~30 s + một thẻ duyệt N tệp
   * người dùng không xin; và hai câu đầu là ranh giới với HAI đường cũ phải GIỮ NGUYÊN.
   */
  const khong = [
    "tạo file mới src/x.ts chứa hàm formatNgay", // đường tạo-MỘT-tệp cũ — không được cướp
    "sửa src/App.cs: tạo thêm hàm đọc pdf", // đường sửa tất định — "tạo" ở đây là nội dung việc sửa
    "tao file moi src/x.ts",
    "dùng dự án này để build thử", // "dung" bỏ dấu trùng "dùng" — không có động từ dựng
    "khung dự án này bị hỏng chỗ nào", // câu HỎI về khung, không phải lệnh dựng
    "start the project and show logs", // "start project" = CHẠY, không phải scaffold
    "đọc file pdf trong dự án",
    "OEE hôm nay của line 2 bao nhiêu",
  ];
  for (const q of khong) it(`★★★ "${q}" ⇒ KHÔNG phải ý định tạo khung`, () => expect(laYDinhTaoDuAn(q)).toBe(false));
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — `bocManifestKhung`: bộ CHIA ĐOẠN thuần (nội dung tệp vẫn qua bocKhoiMa + chuanHoaTepMoi)", () => {
  it("★★★ manifest 3 tệp ⇒ đủ 3, đúng thứ tự, nội dung đã chuẩn hoá LF + một dòng trống cuối", () => {
    const r = bocManifestKhung(
      ["Mở đầu văn xuôi.", tepKhung("a.csproj", "xml", "<Project />"), tepKhung("src/App.cs", "csharp", "class A { }"), tepKhung("README.md", "markdown", "# X")].join("\n"),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tep.map((t) => t.duong)).toEqual(["a.csproj", "src/App.cs", "README.md"]);
    expect(r.tep[0]!.noiDung).toBe("<Project />\n");
    expect(r.tep[1]!.noiDung).toBe("class A { }\n");
  });

  it("★★ CRLF của model KHÔNG làm hỏng phép chia — nội dung ra vẫn LF thuần", () => {
    const crlf = tepKhung("a.cs", "csharp", "class A { }").replace(/\n/g, "\r\n");
    const r = bocManifestKhung(crlf);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tep[0]!.noiDung).toBe("class A { }\n");
    expect(r.tep[0]!.noiDung.includes("\r"), "tệp mới phải LF thuần (chuanHoaTepMoi)").toBe(false);
  });

  it("★★★ dòng tiêu đề NẰM TRONG một fence là NỘI DUNG, không cắt đôi manifest", () => {
    // README dạy lại chính khuôn này — trường hợp có thật với một tệp hướng dẫn.
    const readme = ["# Huong dan", "", `Khai tệp bằng dòng \`${MOC_TEP_KHUNG} <đường>\`, ví dụ:`, "", `${MOC_TEP_KHUNG} vi-du.cs`].join("\n");
    const r = bocManifestKhung([tepKhung("README.md", "markdown", readme), tepKhung("a.cs", "csharp", "class A { }")].join("\n"));
    expect(r.ok, !r.ok ? `${r.ma}: ${r.chiTiet}` : "").toBe(true);
    if (!r.ok) return;
    expect(r.tep.map((t) => t.duong)).toEqual(["README.md", "a.cs"]);
    expect(r.tep[0]!.noiDung).toContain("vi-du.cs");
  });

  it("★★ đường dẫn được GỌT nháy/backtick bao quanh, phần còn lại NGUYÊN VĂN", () => {
    const r = bocManifestKhung(tepKhung("`src/App.cs`", "csharp", "class A { }"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tep[0]!.duong).toBe("src/App.cs");
  });

  const hong: Array<[string, string, string]> = [
    ["không có dòng tiêu đề nào", "Đây là văn xuôi.\n```cs\nclass A { }\n```", "KHONG_CO_TEP"],
    ["tiêu đề không có đường", `${MOC_TEP_KHUNG}\n\`\`\`cs\nclass A { }\n\`\`\``, "TEP_KHONG_DUONG"],
    ["tệp khai tên mà không có khối", `${MOC_TEP_KHUNG} a.cs\nkhông có fence nào`, "TEP_THIEU_KHOI"],
    ["khối rỗng", tepKhung("a.cs", "csharp", "   "), "TEP_RONG"],
    ["cùng đường hai lần", [tepKhung("a.cs", "csharp", "x"), tepKhung("./a.cs", "csharp", "y")].join("\n"), "TEP_TRUNG"],
  ];
  for (const [ten, vao, ma] of hong) {
    it(`★★★ ${ten} ⇒ fail-closed mã ${ma} (không đoán, không trả một phần)`, () => {
      const r = bocManifestKhung(vao);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.ma).toBe(ma);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — CÂU CỦA CHỦ DỰ ÁN đi tới MỘT `apply_diff_batch`, mọi `original` RỖNG, qua HITL", () => {
  const CAU = "tạo dự án C# WPF đọc file pdf";

  it("★★★ manifest 4 tệp (có .xaml) ⇒ MỘT lô, mọi mục original='' , modified = nội dung đã chuẩn hoá, đĩa KHÔNG đổi", async () => {
    h.manh = [MANIFEST_WPF];
    const r = await chay(CAU);

    const lo = cacLo();
    expect(lo.length, "MỘT thẻ duyệt cho cả khung — toàn bộ điểm của đường này").toBe(1);
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff").length, "KHÔNG đề xuất lẻ song song").toBe(0);

    const files = lo[0]!.args.files as Array<{ path: string; original: string; modified: string }>;
    expect(files.map((f) => f.path)).toEqual(["PdfReader.csproj", "App.xaml", "App.xaml.cs", "README.md"]);
    for (const f of files) expect(f.original, `TẠO ⇒ neo của "${f.path}" phải là băm('')`).toBe("");
    expect(files[0]!.modified).toBe(chuanHoaTepMoi(ND_CSPROJ));
    expect(files[1]!.modified).toBe(chuanHoaTepMoi(ND_XAML));
    expect(files[3]!.modified.endsWith("\n"), "tệp mới kết thúc bằng newline").toBe(true);

    // HITL: pending_action, KHÔNG result; và CHƯA một tệp nào rơi xuống đĩa.
    const pa = r.events.filter((e) => e.type === "pending_action");
    expect(pa.length).toBe(1);
    expect((pa[0] as any).toolName).toBe("apply_diff_batch");
    for (const f of files) expect(fs.existsSync(path.join(GOC, f.path)), `${f.path} chưa ai duyệt`).toBe(false);
  });

  it("★★★ đã KIỂM chưa-tồn-tại qua ĐÚNG cửa đọc: mỗi tệp một lượt read_file TRƯỚC khi đề xuất", async () => {
    h.manh = [MANIFEST_WPF];
    await chay(CAU);
    const daDoc = h.quyetDinh.filter((q) => q.tool === "read_file").map((q) => String(q.args.path));
    for (const p of ["PdfReader.csproj", "App.xaml", "App.xaml.cs", "README.md"]) {
      expect(daDoc, `phải hỏi đĩa về "${p}" trước khi neo băm('')`).toContain(p);
    }
  });

  it("★★★ persona là TẠO KHUNG (trần 8 tệp + KHAI-THẬT NuGet hai chế độ) và prompt nhắc đúng khuôn manifest", async () => {
    h.manh = [MANIFEST_WPF];
    await chay(CAU);
    expect(h.moiPrompt.length, "MỘT lượt model cho cả khung — không phải N lượt").toBe(1);
    expect(h.systemPromptNhan).toContain("DỰNG KHUNG MỘT DỰ ÁN MỚI");
    expect(h.systemPromptNhan).toContain("Tối đa 8 tệp");
    /**
     * ★ ĐẢO CHIỀU CÓ GHI LÝ DO (2026-08-24, tiền lệ §7.8 aiCodingMode): ca cũ đòi persona chứa
     * `--no-restore` (luật "KHÔNG thêm package/NuGet NGOÀI" — nhà máy offline). Quyết định chủ dự
     * án đảo luật từ CẤM sang KHAI: *"người dùng phải chấp nhận và tìm cách tải và copy vào…; các
     * bên có internet thì vẫn phải kéo về bình thường"*. Persona nay (a) KHÔNG còn chữ cấm, (b) đòi
     * một dòng khai-thật HAI CHẾ ĐỘ khi manifest có `PackageReference`. Đột biến khôi phục câu cấm
     * cũ ⇒ vế (a) ĐỎ; đột biến xoá yêu cầu khai ⇒ vế (b) ĐỎ.
     */
    expect(h.systemPromptNhan, "luật cấm NuGet cũ phải BIẾN MẤT").not.toContain("KHÔNG thêm package/NuGet");
    expect(h.systemPromptNhan, "package phải được KHAI là ĐƯỢC PHÉP khi việc cần").toContain("ĐƯỢC PHÉP khi việc cần");
    expect(h.systemPromptNhan, "điều kiện khai-thật phải neo vào PackageReference").toContain("PackageReference");
    expect(h.systemPromptNhan, "chế độ offline: người dùng tự tải + chép local feed").toContain("tự tải package");
    expect(h.systemPromptNhan, "chế độ có internet: dotnet restore kéo bình thường").toContain("`dotnet restore` kéo về bình thường");
    // Dotfile hợp lệ (2026-08-24) phải được persona LIỆT KÊ — model hết đoán mù về tệp không-đuôi.
    expect(h.systemPromptNhan, "danh sách basename trắng phải được tiêm vào persona").toContain(".gitignore");
    expect(h.systemPromptNhan, "nhị phân vẫn bị dặn là NGOÀI danh sách").toContain("KHÔNG tệp nhị phân");
    expect(h.promptNhan).toContain(MOC_TEP_KHUNG);
    expect(h.promptNhan).toContain(CAU);
    expect(h.promptNhan, "không có tệp nào tồn tại ⇒ không được chở khối 'NỘI DUNG HIỆN TẠI'").not.toContain("NỘI DUNG HIỆN TẠI");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — HẬU KIỂM fail-closed: đã-tồn-tại · đường xấu · quá trần · manifest hỏng", () => {
  it("★★★ manifest chứa tệp ĐÃ TỒN TẠI ⇒ TỪ CHỐI CẢ LÔ [TEP_DA_TON_TAI], nêu đích danh, 0 đề xuất", async () => {
    h.manh = [[tepKhung("moi-1.cs", "csharp", "class M1 { }"), tepKhung(TEP_DA_CO, "csharp", "class DeLenTepCu { }")].join("\n")];
    const r = await chay("tạo dự án C# demo");
    expect(cacLo().length, "khung nửa vời tệ hơn không có ⇒ không một đề xuất nào").toBe(0);
    expect(r.chu).toContain("TEP_DA_TON_TAI");
    expect(r.chu, "phải nêu ĐÍCH DANH tệp phạm").toContain(TEP_DA_CO);
    expect(fs.existsSync(path.join(GOC, "moi-1.cs")), "tệp hợp lệ trong lô cũng KHÔNG được tạo lẻ").toBe(false);
  });

  const duongXau: Array<[string, string]> = [
    ["đường thoát `..`", "../thoat.cs"],
    ["đường tuyệt đối kiểu ổ đĩa", "C:/temp/x.cs"],
    ["thư mục cấm", "node_modules/x.cs"],
    ["tệp bí mật", "src/khoa.pem"],
  ];
  /**
   * ★ ĐẢO CHIỀU CÓ GHI LÝ DO (2026-08-24, tiền lệ §7.8 aiCodingMode): ca "đuôi ngoài danh sách
   * trắng ⇒ TỪ CHỐI CẢ LÔ" từng đứng trong bảng trên. Từ khi có luật LOẠI-AN-TOÀN (xem §7), một
   * tệp phạm ĐUÔI mà KHÔNG ai tham chiếu bị LOẠI + NÓI RÕ thay vì giết cả khung — bốn lượt live
   * chơi đập chuột với model là lý do. HÌNH DẠNG đường xấu (bảng trên) vẫn từ chối tuyệt đối:
   * đó là dấu hiệu thoát hộp cát, không phải thói quen xấu.
   */
  it(`★★★ đuôi ngoài danh sách trắng KHÔNG ai tham chiếu ("anh/logo.png") ⇒ LOẠI + NÓI, lô vẫn đề xuất KHÔNG kèm nó`, async () => {
    h.manh = [[tepKhung("hop-le.cs", "csharp", "class H { }"), tepKhung("anh/logo.png", "text", "gia-anh")].join("\n")];
    const r = await chay("tạo dự án C# demo");
    const lo = cacLo();
    expect(lo.length, "khung còn lại vẫn được đề xuất").toBe(1);
    const files = (lo[0]!.args.files as Array<{ path: string }>).map((f) => f.path);
    expect(files).toEqual(["hop-le.cs"]);
    expect(r.chu, "loại PHẢI nói").toContain("Đã LOẠI 1 tệp");
    expect(r.chu).toContain("anh/logo.png");
  });
  for (const [ten, duong] of duongXau) {
    it(`★★★ manifest có ${ten} ("${duong}") ⇒ TỪ CHỐI CẢ LÔ [DUONG_KHONG_HOP_LE], 0 đề xuất, 0 read_file`, async () => {
      h.manh = [[tepKhung("hop-le.cs", "csharp", "class H { }"), tepKhung(duong, "csharp", "class X { }")].join("\n")];
      const r = await chay("tạo dự án C# demo");
      expect(cacLo().length).toBe(0);
      expect(r.chu).toContain("DUONG_KHONG_HOP_LE");
      expect(r.chu).toContain(duong);
      expect(
        h.quyetDinh.filter((q) => q.tool === "read_file").length,
        "chính sách đường là phép THUẦN — phải chặn TRƯỚC khi đốt một lượt I/O nào",
      ).toBe(0);
    });
  }

  it(`★★★ manifest ${TRAN_TEP_MOI_LO + 1} tệp ⇒ vượt trần MỘT thẻ duyệt ⇒ 0 đề xuất, câu nêu con số`, async () => {
    const nhieu = Array.from({ length: TRAN_TEP_MOI_LO + 1 }, (_, i) => tepKhung(`src/f${i}.cs`, "csharp", `class F${i} { }`)).join("\n");
    h.manh = [nhieu];
    const r = await chay("tạo dự án C# demo");
    expect(cacLo().length).toBe(0);
    expect(r.chu).toContain(String(TRAN_TEP_MOI_LO));
    expect(r.chu).toContain(String(TRAN_TEP_MOI_LO + 1));
  });

  it("★★★ model trả VĂN XUÔI (không manifest) ⇒ FAIL-SAFE: chữ giữ nguyên làm câu trả lời, 0 đề xuất", async () => {
    h.manh = ["Đây là hướng dẫn tạo dự án WPF bằng Visual Studio, bước một mở File > New…"];
    const r = await chay("tạo dự án C# WPF đọc file pdf");
    expect(cacLo().length).toBe(0);
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff").length).toBe(0);
    expect(r.chu, "chữ model KHÔNG được biến mất").toContain("Visual Studio");
    expect(r.chu).toContain("KHONG_CO_TEP");
    const done = r.done as { answer?: string } | undefined;
    expect(String(done?.answer ?? ""), "answer của phiên phải giữ cả chữ model lẫn câu nói thật").toContain("Visual Studio");
  });

  it("★★ manifest có tệp thiếu KHỐI ⇒ fail-safe có mã, 0 đề xuất (không đề xuất phần còn lại)", async () => {
    h.manh = [[tepKhung("a.cs", "csharp", "class A { }"), `${MOC_TEP_KHUNG} b.cs`, "quên mất khối mã"].join("\n")];
    const r = await chay("tạo dự án C# demo");
    expect(cacLo().length).toBe(0);
    expect(r.chu).toContain("TEP_THIEU_KHOI");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — CHỐNG NỚI: hai đường cũ không đổi hành vi, cờ tắt ⇒ đường khung nhường sạch", () => {
  it("★★★ 'tạo file mới <đường>' vẫn đi đường tạo-MỘT-tệp (apply_diff), KHÔNG bị đường khung cướp", async () => {
    h.manh = ["```csharp\nnamespace X;\npublic class Moi { }\n```"];
    await chay("tạo file mới src/MotTepMoi.cs chứa class Moi");
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff").length, "đường một-tệp cũ phải ra apply_diff").toBe(1);
    expect(cacLo().length, "không có lô nào").toBe(0);
    expect(h.systemPromptNhan).toContain("TẠO MỘT TỆP MỚI");
  });

  it("★★★ cờ AI_CODING_EDIT=0 ⇒ đường khung trả false, câu rơi về đường cũ, KHÔNG có [HITL]", async () => {
    process.env.AI_CODING_EDIT = "0";
    h.manh = [MANIFEST_WPF];
    const r = await chay("tạo dự án C# WPF đọc file pdf");
    expect(cacLo().length).toBe(0);
    expect(r.chu).not.toContain("[HITL]");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ §6 — ĐÚNG MỘT LƯỢT TỰ SỬA MANIFEST.
 *
 * Vì sao tồn tại: nghiệm thu live 2026-08-24 — BA lượt liên tiếp model 30B nhét tệp ngoài danh
 * sách trắng vào khung WPF (`Strings.resx` → `appicon.ico` + `.editorconfig` → lại `appicon.ico`,
 * lượt cuối persona ĐÃ liệt kê nguyên danh sách trắng). Mỗi lượt đoán sai đốt ~4 phút người dùng.
 * ⇒ Server đưa NGUYÊN VĂN câu từ chối lại cho model đúng MỘT lần; hỏng tiếp thì fail-safe như cũ.
 */
describe("§6 — lượt tự sửa manifest: đúng MỘT, không hơn", () => {
  const CAU = "tạo dự án C# WPF đọc file pdf";
  /**
   * ⚠ csproj PHẢI THAM CHIẾU `appicon.ico` (`<ApplicationIcon>`): từ khi có luật LOẠI-AN-TOÀN, một
   * tệp phạm KHÔNG ai tham chiếu sẽ bị loại êm (xem §7) chứ không kích hoạt tự sửa — ca tự sửa cần
   * đúng loại phạm-có-tham-chiếu (loại nó là build gãy ⇒ bắt buộc model gỡ cả hai đầu).
   */
  const ND_CSPROJ_CO_ICO = ND_CSPROJ.replace(
    "  </PropertyGroup>",
    "    <ApplicationIcon>appicon.ico</ApplicationIcon>\n  </PropertyGroup>",
  );
  const MANIFEST_CO_ICO = [
    "Khung WPF kèm icon (SAI — icon ngoài danh sách trắng VÀ bị csproj tham chiếu):",
    "",
    tepKhung("PdfReader.csproj", "xml", ND_CSPROJ_CO_ICO),
    tepKhung("appicon.ico", "text", "khong-phai-noi-dung-icon-that"),
    "",
  ].join("\n");

  it("★★★ lượt 1 phạm đuôi cấm + lượt 2 sạch ⇒ MỘT lô được đề xuất, prompt lượt 2 mang NGUYÊN VĂN lỗi", async () => {
    h.manhTheoLuot = [[MANIFEST_CO_ICO], [MANIFEST_WPF]];
    const r = await chay(CAU);

    expect(h.moiPrompt.length, "đúng HAI lượt model: gốc + tự sửa").toBe(2);
    expect(h.moiPrompt[1], "prompt tự sửa phải mang mệnh lệnh sửa").toContain("BẮT BUỘC SỬA");
    expect(h.moiPrompt[1], "…và nêu ĐÍCH DANH tệp phạm để model biết bỏ cái gì").toContain("appicon.ico");
    expect(r.chu, "người dùng phải THẤY thông báo tự sửa trong dòng chữ").toContain("tự sửa");

    const lo = cacLo();
    expect(lo.length, "lượt 2 sạch ⇒ MỘT thẻ duyệt như đường thẳng").toBe(1);
    const files = lo[0]!.args.files as Array<{ path: string }>;
    expect(files.map((f) => f.path)).toEqual(["PdfReader.csproj", "App.xaml", "App.xaml.cs", "README.md"]);
  });

  it("★★★ CẢ HAI lượt đều phạm ⇒ fail-safe, 0 thẻ duyệt, và KHÔNG có lượt model thứ ba (trần là MỘT)", async () => {
    h.manhTheoLuot = [[MANIFEST_CO_ICO], [MANIFEST_CO_ICO]];
    const r = await chay(CAU);

    expect(h.moiPrompt.length, "trần tự sửa là MỘT — không có lượt thứ ba").toBe(2);
    expect(cacLo().length, "hai lần phạm ⇒ không đề xuất gì").toBe(0);
    expect(r.chu).toContain("TỪ CHỐI CẢ KHUNG");
    expect(fs.existsSync(path.join(GOC, "appicon.ico")), "0 byte chạm đĩa").toBe(false);
  });

  it("★★ lượt 1 SẠCH ⇒ KHÔNG có lượt tự sửa nào (đường thẳng không trả thêm tiền)", async () => {
    h.manhTheoLuot = [[MANIFEST_WPF]];
    await chay(CAU);
    expect(h.moiPrompt.length, "manifest sạch ngay ⇒ đúng MỘT lượt model").toBe(1);
    expect(cacLo().length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ §7 — LOẠI-AN-TOÀN: tệp phạm KHÔNG ai tham chiếu bị LOẠI + NÓI RÕ; có tham chiếu thì KHÔNG.
 * Sinh từ bốn lượt live đập chuột (resx → ico+editorconfig → ico → editorconfig): tự sửa bỏ đúng
 * tệp bị mắng rồi thêm tệp phạm khác — với loại KHÔNG-tham-chiếu, loại êm là đủ và rẻ hơn một
 * lượt 30B ~4 phút.
 */
describe("§7 — loại-an-toàn tệp phạm không-tham-chiếu", () => {
  const CAU = "tạo dự án C# WPF đọc file pdf";
  /**
   * ★ ĐẢO MỒI CÓ GHI LÝ DO (2026-08-24, tiền lệ §7.8 aiCodingMode): mồi phạm cũ là `.editorconfig`
   * — từ khi `TEN_TEP_CHO_PHEP` cho dotfile qua (quyết định chủ dự án *"tạo các file liên quan dự
   * án được như bình thường"*), nó thành tệp HỢP LỆ và ca này sẽ đo một vị từ không còn tồn tại.
   * Mồi mới là `anh/logo.png` — nhị phân THẬT SỰ ngoài danh sách (đường ống này ghi VĂN BẢN, một
   * icon "viết bằng text" là một tệp hỏng), tức đúng lớp phạm mà luật loại-an-toàn còn canh.
   */
  const MANIFEST_NHI_PHAN = [
    "Khung kèm ảnh nhị phân (phạm nhưng KHÔNG ai tham chiếu):",
    "",
    tepKhung("PdfReader.csproj", "xml", ND_CSPROJ),
    tepKhung("App.xaml", "xml", ND_XAML),
    tepKhung("anh/logo.png", "text", "gia-anh-nhi-phan"),
    "",
  ].join("\n");

  it("★★★ nhị phân không-tham-chiếu ⇒ LOẠI + câu khai rõ, lô vẫn đề xuất với phần còn lại, KHÔNG tốn lượt tự sửa", async () => {
    h.manhTheoLuot = [[MANIFEST_NHI_PHAN]];
    const r = await chay(CAU);

    expect(h.moiPrompt.length, "không cần lượt model thứ hai — loại êm rẻ hơn 4 phút 30B").toBe(1);
    const lo = cacLo();
    expect(lo.length, "khung còn lại vẫn được đề xuất").toBe(1);
    const files = (lo[0]!.args.files as Array<{ path: string }>).map((f) => f.path);
    expect(files).toEqual(["PdfReader.csproj", "App.xaml"]);
    expect(files).not.toContain("anh/logo.png");
    expect(r.chu, "loại PHẢI nói — im lặng cắt bớt là nói dối").toContain("Đã LOẠI 1 tệp");
    expect(r.chu).toContain("anh/logo.png");
  });

  it("★★★ CA DƯƠNG 2026-08-24 — `.gitignore` + `.editorconfig` là tệp dự án BÌNH THƯỜNG: vào lô đủ mặt, KHÔNG bị loại", async () => {
    /**
     * Trước bản vá `TEN_TEP_CHO_PHEP`: hai dotfile này bị `duoiDuocPhep` chặn (extname = "") ⇒ bị
     * loại-an-toàn khỏi lô. Quyết định chủ dự án: *"khi prompt yêu cầu tạo dự án thì vẫn tạo các
     * file liên quan dự án được như bình thường"* ⇒ chúng phải đi QUA như `.cs`/`.csproj`. Đột
     * biến gỡ nhánh basename khỏi `duoiDuocPhep` ⇒ hai tệp rơi khỏi `files` ⇒ ca này ĐỎ.
     */
    const M = [
      tepKhung("PdfReader.csproj", "xml", ND_CSPROJ),
      tepKhung(".gitignore", "text", "bin/\nobj/"),
      tepKhung(".editorconfig", "ini", "root = true"),
    ].join("\n");
    h.manhTheoLuot = [[M]];
    const r = await chay(CAU);

    expect(h.moiPrompt.length, "manifest sạch ⇒ MỘT lượt model, không tự sửa").toBe(1);
    const lo = cacLo();
    expect(lo.length).toBe(1);
    const files = (lo[0]!.args.files as Array<{ path: string; original: string }>);
    expect(files.map((f) => f.path), "dotfile phải ĐỦ MẶT trong lô, đúng thứ tự manifest").toEqual([
      "PdfReader.csproj",
      ".gitignore",
      ".editorconfig",
    ]);
    for (const f of files) expect(f.original, `TẠO ⇒ neo của "${f.path}" là băm('')`).toBe("");
    expect(r.chu, "KHÔNG có tệp nào bị loại ⇒ không được in câu loại").not.toContain("Đã LOẠI");
  });

  it("★★★ tệp phạm CÓ tham chiếu ⇒ KHÔNG loại êm — đi đường tự sửa, câu lỗi nêu tệp tham chiếu", async () => {
    // csproj nhắc "appicon.ico" ⇒ loại nó là build gãy ⇒ phải bắt model gỡ cả hai đầu.
    const ND_CSPROJ_ICO = ND_CSPROJ.replace(
      "  </PropertyGroup>",
      "    <ApplicationIcon>appicon.ico</ApplicationIcon>\n  </PropertyGroup>",
    );
    const M = [
      tepKhung("PdfReader.csproj", "xml", ND_CSPROJ_ICO),
      tepKhung("appicon.ico", "text", "gia-icon"),
    ].join("\n");
    h.manhTheoLuot = [[M], [M]];
    const r = await chay(CAU);

    expect(h.moiPrompt.length, "phạm-có-tham-chiếu ⇒ đúng đường tự sửa (2 lượt)").toBe(2);
    expect(cacLo().length, "cả hai lượt cùng phạm ⇒ 0 đề xuất").toBe(0);
    expect(r.chu).toContain("được tham chiếu bởi: PdfReader.csproj");
  });

  it("★★ MỌI tệp đều phạm không-tham-chiếu ⇒ không còn gì để đề xuất ⇒ TỪ CHỐI, không lô rỗng", async () => {
    // ★ Đảo mồi cùng lý do khối trên: `.editorconfig` nay HỢP LỆ ⇒ mồi phải là nhị phân thật sự.
    h.manhTheoLuot = [[tepKhung("logo.png", "text", "gia-anh")], [tepKhung("logo.png", "text", "gia-anh")]];
    const r = await chay(CAU);
    expect(cacLo().length).toBe(0);
    expect(r.chu).toContain("TỪ CHỐI CẢ KHUNG");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
/** ★ §7B — hai tinh chỉnh từ lượt live thứ 5: tham chiếu từ .md KHÔNG tính; thông báo tự-sửa SỐNG SÓT vào done. */
describe("§7B — tham chiếu .md không tính · thông báo tự-sửa vào bản ghi cuối", () => {
  it("★★★ tệp phạm chỉ được README.md nhắc tên ⇒ vẫn LOẠI-an-toàn (văn xuôi ≠ phụ thuộc build)", async () => {
    // Đo live lượt 5: sample.pdf bị giữ làm "có tham chiếu" chỉ vì README nhắc tên ⇒ giết cả khung oan.
    const M = [
      tepKhung("hop-le.cs", "csharp", "class H { }"),
      tepKhung("huong-dan.md", "markdown", "Xem sample.pdf để thử."),
      tepKhung("sample.pdf", "text", "gia-pdf"),
    ].join("\n");
    h.manhTheoLuot = [[M]];
    const r = await chay("tạo dự án C# demo");
    const lo = cacLo();
    expect(lo.length, "chỉ .md nhắc tên ⇒ như KHÔNG tham chiếu ⇒ loại êm, lô vẫn đề xuất").toBe(1);
    expect((lo[0]!.args.files as Array<{ path: string }>).map((f) => f.path)).toEqual(["hop-le.cs", "huong-dan.md"]);
    expect(r.chu).toContain("Đã LOẠI 1 tệp");
  });

  it("★★★ thông báo tự-sửa nằm TRONG văn bản done (client thay bong bóng bằng answer — token rời sẽ biến mất)", async () => {
    const ND_ICO_REF = ND_CSPROJ.replace("  </PropertyGroup>", "    <ApplicationIcon>appicon.ico</ApplicationIcon>\n  </PropertyGroup>");
    const XAU = [tepKhung("PdfReader.csproj", "xml", ND_ICO_REF), tepKhung("appicon.ico", "text", "x")].join("\n");
    h.manhTheoLuot = [[XAU], [MANIFEST_WPF]];
    const r = await chay("tạo dự án C# WPF đọc file pdf");
    // ⚠ Lượt tự sửa sinh HAI sự kiện done (một mỗi lượt model) — bản ghi cuối là cái CUỐI CÙNG.
    //   `r.done` của harness lấy cái ĐẦU (find) nên tự nó là một thước sai ở ca hai-lượt.
    const cacDone = r.events.filter((e) => e.type === "done") as Array<{ answer?: string }>;
    const doneCuoi = cacDone[cacDone.length - 1];
    expect(String(doneCuoi?.answer ?? ""), "bản ghi CUỐI phải giữ dấu vết lượt tự sửa").toContain("tự sửa");
    expect(cacLo().length).toBe(1);
  });
});
