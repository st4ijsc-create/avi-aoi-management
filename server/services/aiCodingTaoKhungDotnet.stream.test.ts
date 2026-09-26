/**
 * ★★★ 2026-08-24 — **KHUNG DỰ ÁN QUA `dotnet new`: ĐỊNH TUYẾN → SINH NỘI DUNG (mock) → apply_diff_batch → HITL.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN MỆNH ĐỀ FILE NÀY PHÁT BIỂU (bổ sung cho `aiCodingTaoKhung.stream.test.ts` — file kia đo đường MODEL):
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. Câu C#/.NET có template khớp ⇒ đi ĐƯỜNG `dotnet new`: `chayDotnetNewVaoTam` được gọi với ĐÚNG
 *      template (server ánh xạ) + slug (server dựng từ projectId), rồi khung tới `apply_diff_batch`
 *      với MỌI `original: ""`, qua HITL — và **KHÔNG một lượt model nào** (model có thể đang giữ VRAM).
 *   2. Khung có `<PackageReference>` ⇒ câu trả lời KHAI hai chế độ NuGet (offline / có internet).
 *   3. FAIL-SAFE: `dotnet new` lỗi/không có SDK ⇒ RƠI VỀ đường model tự viết, KHÔNG vỡ.
 *   4. Hậu kiểm create-only vẫn chạy: một tệp khung ĐÃ tồn tại ở gốc ⇒ TỪ CHỐI CẢ LÔ.
 *
 * ⚠ KHÔNG chạy `dotnet new` THẬT (brief cấm): `chayDotnetNewVaoTam` bị mock, `anhXaTemplateDotnet`/
 *   `slugDuAn` GIỮ THẬT (routing thật). Model bị chặn ở `aiGgufEngine`. Gốc là thư mục TẠM (mkdtemp).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  manh: [] as string[],
  systemPromptNhan: "" as string,
  moiPrompt: [] as string[],
  quyetDinh: [] as Array<{ tool: string | null; args: Record<string, unknown> }>,
  /** Lời gọi `chayDotnetNewVaoTam` đã ghi lại (template + slug server dựng). */
  dotnetGoi: [] as Array<{ template: string; slug: string }>,
  /** Kết quả `chayDotnetNewVaoTam` mock trả về; `null` ⇒ {ok:false} (fail-safe → model). */
  dotnetKet: null as
    | null
    | { ok: true; tep: Array<{ duong: string; noiDung: string }>; template: string; slug: string; coNuGet: boolean }
    | { ok: false; lyDo: string },
}));

vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateText: vi.fn(),
  chatCompletion: vi.fn(),
  generateEmbedding: vi.fn(),
  describeImage: vi.fn(),
  generateJSON: vi.fn(async () => ({ data: { tool: "none", args: {} }, raw: "{}", modelId: "stub", totalTimeMs: 1, tokensPrompt: 1, tokensGenerated: 1 })),
  generateTextStream: async function* (opt: any) {
    h.systemPromptNhan = String(opt?.systemPrompt ?? "");
    h.moiPrompt.push(String(opt?.prompt ?? ""));
    for (const m of h.manh) yield { type: "token", token: m };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: h.manh.length };
  },
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({ insert: () => ({ values: async () => undefined }) })),
}));

/** ⚠ MOCK BỘ PHẬN: `read_file` chạy THẬT (điều kiện để "đã kiểm CHƯA-tồn-tại" có nghĩa); chỉ chặn tool GHI. */
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

/** ★ Mock BƯỚC `dotnet new` (brief cấm chạy thật). `anhXaTemplateDotnet`/`slugDuAn` GIỮ THẬT ⇒ routing thật. */
vi.mock("./ai/dotnetNewScaffold", async (goc) => {
  const that = await goc<typeof import("./ai/dotnetNewScaffold")>();
  return {
    ...that,
    chayDotnetNewVaoTam: vi.fn(async (opts: { template: string; slug: string }) => {
      h.dotnetGoi.push({ template: opts.template, slug: opts.slug });
      return h.dotnetKet ?? { ok: false as const, lyDo: "lưới: chưa cấu hình dotnetKet" };
    }),
  };
});

import { streamAnswer, type StreamEvent } from "./aiLocalKnowledgeService";
import { chuanHoaTepMoi } from "./aiCodingAgent";

let GOC = "";
const ID_DU_AN = "taokhung";

beforeAll(() => {
  GOC = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tao-khung-dotnet-")));
});
afterAll(() => {
  try {
    fs.rmSync(GOC, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const ND_CSPROJ = ['<Project Sdk="Microsoft.NET.Sdk">', "  <PropertyGroup>", "    <OutputType>WinExe</OutputType>", "    <TargetFramework>net8.0-windows</TargetFramework>", "    <UseWPF>true</UseWPF>", "  </PropertyGroup>", "</Project>"].join("\n");
const ND_XAML = ['<Application x:Class="Taokhung.App" StartupUri="MainWindow.xaml" />'].join("\n");
const ND_CS = ["namespace Taokhung;", "", "public partial class App : System.Windows.Application { }"].join("\n");

function cayWpf(coNuGet = false): NonNullable<typeof h.dotnetKet> {
  return {
    ok: true,
    template: "wpf",
    slug: "Taokhung",
    coNuGet,
    tep: [
      { duong: "Taokhung.csproj", noiDung: ND_CSPROJ },
      { duong: "App.xaml", noiDung: ND_XAML },
      { duong: "App.xaml.cs", noiDung: ND_CS },
    ],
  };
}

let idPhien = 8600;
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
  h.systemPromptNhan = "";
  h.moiPrompt = [];
  h.quyetDinh = [];
  h.dotnetGoi = [];
  h.dotnetKet = null;
  // Gốc trạng thái nền: xoá mọi tệp khung có thể sót từ ca trước.
  for (const rel of ["Taokhung.csproj", "App.xaml", "App.xaml.cs"]) {
    try {
      fs.rmSync(path.join(GOC, rel), { force: true });
    } catch {
      /* best-effort */
    }
  }
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — câu C#/.NET đi ĐƯỜNG dotnet new: template+slug ĐÚNG, apply_diff_batch mọi original='', 0 lượt model", () => {
  const CAU = "tạo dự án C# WPF đọc file pdf";

  it("★★★ routing → chayDotnetNewVaoTam(template='wpf', slug='Taokhung'); MỘT lô, mọi original='', modified chuẩn hoá", async () => {
    h.dotnetKet = cayWpf();
    const r = await chay(CAU);

    expect(h.dotnetGoi.length, "phải gọi bước dotnet new ĐÚNG một lần").toBe(1);
    expect(h.dotnetGoi[0]!.template, "server ánh xạ WPF → 'wpf'").toBe("wpf");
    expect(h.dotnetGoi[0]!.slug, "slug do server dựng từ projectId 'taokhung'").toBe("Taokhung");
    expect(h.moiPrompt.length, "dotnet new KHÔNG cần model — 0 lượt gọi model").toBe(0);

    const lo = cacLo();
    expect(lo.length, "MỘT thẻ duyệt cho cả khung").toBe(1);
    const files = lo[0]!.args.files as Array<{ path: string; original: string; modified: string }>;
    expect(files.map((f) => f.path)).toEqual(["Taokhung.csproj", "App.xaml", "App.xaml.cs"]);
    for (const f of files) expect(f.original, `TẠO ⇒ neo "${f.path}" = băm('')`).toBe("");
    expect(files[0]!.modified, "modified = nội dung ĐÃ chuẩn hoá (LF + newline cuối)").toBe(chuanHoaTepMoi(ND_CSPROJ));

    // HITL: pending_action, CHƯA byte nào rơi xuống đĩa.
    expect(r.events.filter((e) => e.type === "pending_action").length).toBe(1);
    for (const f of files) expect(fs.existsSync(path.join(GOC, f.path)), `${f.path} chưa ai duyệt`).toBe(false);
  });

  it("★★★ đã KIỂM chưa-tồn-tại qua ĐÚNG cửa đọc: mỗi tệp một read_file TRƯỚC khi đề xuất", async () => {
    h.dotnetKet = cayWpf();
    await chay(CAU);
    const daDoc = h.quyetDinh.filter((q) => q.tool === "read_file").map((q) => String(q.args.path));
    for (const p of ["Taokhung.csproj", "App.xaml", "App.xaml.cs"]) expect(daDoc).toContain(p);
  });

  it("★★ câu note nói THẬT đã dùng `dotnet new wpf`, và sống vào bản ghi done", async () => {
    h.dotnetKet = cayWpf();
    const r = await chay(CAU);
    expect(r.chu).toContain("dotnet new wpf");
    const done = r.done as { answer?: string } | undefined;
    expect(String(done?.answer ?? "")).toContain("dotnet new wpf");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — KHAI NuGet hai chế độ khi khung có PackageReference", () => {
  it("★★★ coNuGet=true ⇒ câu trả lời khai offline (tự tải + local feed) VÀ có internet (dotnet restore)", async () => {
    h.dotnetKet = cayWpf(true);
    const r = await chay("tạo dự án C# WPF đọc file pdf");
    expect(r.chu, "phải neo vào PackageReference/NuGet").toContain("NuGet");
    expect(r.chu, "chế độ offline").toContain("local NuGet feed");
    expect(r.chu, "chế độ có internet").toContain("dotnet restore");
    expect(cacLo().length).toBe(1);
  });

  it("★★ coNuGet=false ⇒ KHÔNG in câu khai NuGet", async () => {
    h.dotnetKet = cayWpf(false);
    const r = await chay("tạo dự án C# WPF đọc file pdf");
    expect(r.chu).not.toContain("local NuGet feed");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — FAIL-SAFE: dotnet new lỗi/không có SDK ⇒ RƠI VỀ đường model tự viết", () => {
  it("★★★ chayDotnetNewVaoTam trả {ok:false} ⇒ model được gọi, khung model tới apply_diff_batch", async () => {
    h.dotnetKet = { ok: false, lyDo: "dotnet new lỗi: ENOENT (không có SDK)" };
    h.manh = [
      ["### FILE: Model.csproj", "```xml", "<Project />", "```", "### FILE: Program.cs", "```csharp", "class P { }", "```"].join("\n"),
    ];
    const r = await chay("tạo dự án C# console demo");

    expect(h.dotnetGoi.length, "vẫn THỬ dotnet trước").toBe(1);
    expect(h.moiPrompt.length, "dotnet lỗi ⇒ RƠI VỀ model (1 lượt)").toBe(1);
    expect(h.systemPromptNhan, "persona đường model là TẠO KHUNG").toContain("DỰNG KHUNG MỘT DỰ ÁN MỚI");
    const lo = cacLo();
    expect(lo.length, "khung model tới đúng MỘT lô").toBe(1);
    expect((lo[0]!.args.files as Array<{ path: string }>).map((f) => f.path)).toEqual(["Model.csproj", "Program.cs"]);
    expect(r.events.filter((e) => e.type === "pending_action").length).toBe(1);
  });

  it("★★ câu KHÔNG ánh xạ template (React) ⇒ KHÔNG gọi dotnet, đi thẳng model", async () => {
    // "tạo dự án React" — laYDinhTaoDuAn=true nhưng anhXaTemplateDotnet=null ⇒ bỏ qua nhánh dotnet.
    h.manh = [["### FILE: package.json", "```json", '{ "name": "x" }', "```"].join("\n")];
    await chay("tạo dự án React đọc pdf");
    expect(h.dotnetGoi.length, "React không ánh xạ template ⇒ KHÔNG chạm bước dotnet").toBe(0);
    expect(h.moiPrompt.length, "đi thẳng model").toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — HẬU KIỂM create-only vẫn chạy trên khung dotnet new", () => {
  it("★★★ một tệp khung ĐÃ tồn tại ở gốc ⇒ TỪ CHỐI CẢ LÔ [TEP_DA_TON_TAI], 0 đề xuất, 0 byte", async () => {
    fs.writeFileSync(path.join(GOC, "Taokhung.csproj"), "<Project />\n"); // đã có sẵn
    h.dotnetKet = cayWpf();
    const r = await chay("tạo dự án C# WPF đọc file pdf");
    expect(cacLo().length, "khung nửa vời tệ hơn không có").toBe(0);
    expect(r.chu).toContain("TEP_DA_TON_TAI");
    expect(r.chu, "nêu ĐÍCH DANH").toContain("Taokhung.csproj");
    // Không rơi về model: khung chuẩn đã sinh đúng, lỗi ở gốc dự án.
    expect(h.moiPrompt.length, "hậu kiểm từ chối KHÔNG kéo theo một lượt model").toBe(0);
    expect(fs.existsSync(path.join(GOC, "App.xaml")), "tệp hợp lệ trong lô cũng KHÔNG tạo lẻ").toBe(false);
  });
});
