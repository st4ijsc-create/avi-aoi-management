/**
 * ★★★ doc 79 · TRỤC 1 (C) — CỔNG RA ĐẦU–CUỐI CỦA CHẾ ĐỘ LẬP TRÌNH (không Playwright, không model thật).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ PHÉP ĐO NÀY LÀ BẢN TẤT ĐỊNH CỦA ĐÚNG LỖI CHỦ DỰ ÁN BÁO (2026-08-19)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Họ mở `/ai-coding-workspace`, chọn "Demo Csharp", gõ:
 *     *"viết code C# cho chương trình chat LAN sử dụng socket"*
 * và nhận: *"Chưa rõ yêu cầu lập trình. Hãy nêu một **đường dẫn tệp cụ thể**…"*
 *
 * Gốc rễ: `streamCodingAnswer` có 5 đường ra, và đường thứ năm — *"không tool nào khớp"* —
 * **KHÔNG BAO GIỜ gọi model**. §1 dưới đây khẳng định câu ấy nay đi vào NHÁNH SINH MÃ và trả về mã
 * THẬT. §2 khẳng định công tắc tắt vẫn còn (và khi tắt thì nói THẬT lý do, không im lặng).
 *
 * §3 là mảnh cuối của doc 79: vòng lặp tác nhân *đọc → SỬA*. Nó khẳng định ba điều CÙNG LÚC:
 *   (a) `original` gửi cho `apply_diff` là NỘI DUNG THẬT TRÊN ĐĨA (không phải model tự nhớ) —
 *       đây là điểm neo của hàng rào băm chống TOCTOU;
 *   (b) lượt ghi đi qua **`executeDecision`**, cửa DUY NHẤT đẩy mọi `kind:"write"` vào HITL
 *       `proposeAction`; và
 *   (c) **KHÔNG một byte nào rời ra đĩa** trong lượt này — tệp thi (`sandbox-projects/`) còn nguyên.
 *
 * ⚠ `sandbox-projects/**` là ĐỀ THI: lưới này chỉ ĐỌC nó và kiểm tra nó KHÔNG đổi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  manh: [] as string[],
  systemPromptNhan: "" as string,
  promptNhan: "" as string,
  /** Mọi quyết định đi qua `executeDecision` — bản kiểm đếm của §3. */
  quyetDinh: [] as Array<{ tool: string | null; args: Record<string, unknown> }>,
  /** Bộ chọn tool LLM giả: `null` ⇒ nó abstain (mặc định). */
  llmDoanTool: null as { tool: string; args: Record<string, unknown> } | null,
  /**
   * Ô `data` GIẢ cho `read_file` — chỉ để dựng ba ca fail-closed (`truncated`/`redacted`/quá dài)
   * mà môi trường thật không tạo ra được theo yêu cầu. `null` ⇒ `read_file` chạy THẬT trên đĩa.
   */
  docGia: null as { path: string; content: string; truncated?: boolean; redacted?: boolean } | null,
}));

vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateText: vi.fn(),
  chatCompletion: vi.fn(),
  generateEmbedding: vi.fn(),
  describeImage: vi.fn(),
  generateJSON: vi.fn(async () => ({
    data: h.llmDoanTool ?? { tool: "none", args: {} },
    raw: "{}",
    modelId: "stub",
    totalTimeMs: 1,
    tokensPrompt: 1,
    tokensGenerated: 1,
  })),
  generateTextStream: async function* (opt: any) {
    h.systemPromptNhan = String(opt?.systemPrompt ?? "");
    h.promptNhan = String(opt?.prompt ?? "");
    for (const m of h.manh) yield { type: "token", token: m };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: h.manh.length };
  },
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({ insert: () => ({ values: async () => undefined }) })),
}));

/**
 * ⚠ MOCK **BỘ PHẬN**, không phải toàn bộ: `read_file`/`list_files` phải chạy THẬT (hộp cát + RBAC +
 * nội dung thật trên đĩa), chỉ `apply_diff` bị chặn lại ở cửa HITL để lưới không cần CSDL
 * `ai_pending_actions`. Nhờ vậy §3 vẫn đo đúng thứ nó tưởng đang đo: **đường đi**, không phải một
 * bản dựng lại của đường đi.
 */
const HITL_GIA = {
  actionId: "act-test",
  token: "tok-test",
  tool: "apply_diff",
  summary: "Áp thay đổi vào tệp \"sandbox-projects/csharp-demo/src/Calculator.cs\" (qua người duyệt).",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  args: {},
  preview: { entityType: "repo_file", entityName: "", changes: [], warnings: [], humanSummary: "" },
} as any;

vi.mock("./aiLocalTools", async (goc) => {
  const that = await goc<typeof import("./aiLocalTools")>();
  return {
    ...that,
    executeDecision: async (d: any, ctx: any) => {
      h.quyetDinh.push({ tool: d.tool, args: d.args });
      if (d.tool === "apply_diff") return { result: null, pendingAction: { ...HITL_GIA, args: d.args } };
      if (d.tool === "read_file" && h.docGia) {
        return {
          result: {
            type: "action_result",
            title: "Đọc tệp trong repo",
            data: { bytes: h.docGia.content.length, truncated: false, redacted: false, ...h.docGia },
            textSummary: h.docGia.content,
          },
        };
      }
      return that.executeDecision(d, ctx);
    },
  };
});

import { streamAnswer, laYDinhSuaTep, type StreamEvent } from "./aiLocalKnowledgeService";

const TEP_THI = "sandbox-projects/csharp-demo/src/Calculator.cs";
const DUONG_THI = path.resolve(process.cwd(), TEP_THI);

let idPhien = 9000;
function admin() {
  return { user: { id: ++idPhien, role: "admin", name: "T" }, lang: "vi" as const };
}

async function chay(
  question: string,
  execCtx?: any,
  themCtx?: Record<string, unknown>,
): Promise<{ events: StreamEvent[]; chu: string; done?: StreamEvent }> {
  const events: StreamEvent[] = [];
  const tokens: string[] = [];
  const ctx = { codingMode: true, uiLanguage: "vi" as const, ...themCtx };
  for await (const e of streamAnswer(question, 5, [], "engineer", ctx, execCtx)) {
    events.push(e);
    if (e.type === "token") tokens.push(e.token);
  }
  return { events, chu: tokens.join(""), done: events.find((e) => e.type === "done") };
}

const MA_CSHARP = [
  "```csharp",
  "using System.Net.Sockets;",
  "public class ChatLan { public void Start() { var l = new TcpListener(System.Net.IPAddress.Any, 5000); l.Start(); } }",
  "```",
  "",
  "- Dùng `TcpListener` cho máy chủ và `TcpClient` cho máy trạm.",
].join("\n");

const ENV = [
  "AI_CODING_GEN", "AI_CODING_EDIT", "AI_CODING_MODEL_TASK", "AI_SAFETY_ENABLED",
  "AI_REPO_SANDBOX_ROOTS",
] as const;

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  h.manh = [];
  h.systemPromptNhan = "";
  h.promptNhan = "";
  h.quyetDinh = [];
  h.llmDoanTool = null;
  h.docGia = null;
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — CÂU CỦA CHỦ DỰ ÁN đi vào nhánh SINH MÃ (không còn là ngõ cụt)", () => {
  const CAU = "viết code C# cho chương trình chat LAN sử dụng socket";

  it("★★★ trả về MÃ THẬT, KHÔNG phải \"Chưa rõ yêu cầu lập trình\"", async () => {
    h.manh = [MA_CSHARP];
    const r = await chay(CAU, admin());
    expect(r.chu, "đây chính là câu trả lời SAI mà chủ dự án đã nhận").not.toContain("Chưa rõ yêu cầu lập trình");
    expect(r.chu).toContain("TcpListener");
    expect(r.chu).toContain("```csharp");
    expect(r.done?.type === "done" && r.done.provider).toBe("ollama");
  });

  it("★★★ persona là KỸ SƯ LẬP TRÌNH — KHÔNG phải trợ lý vận hành, KHÔNG RAG", async () => {
    h.manh = [MA_CSHARP];
    const r = await chay(CAU, admin());
    expect(h.systemPromptNhan).toContain("KỸ SƯ LẬP TRÌNH");
    expect(h.systemPromptNhan).toContain("liên hệ kỹ sư kỹ thuật"); // nêu ĐÍCH DANH để CẤM
    // Không một trích dẫn RAG nào: nhánh lập trình không đi qua `retrieveKnowledge`.
    const meta = r.events.find((e) => e.type === "meta");
    expect(meta && meta.type === "meta" && meta.citations).toEqual([]);
  });

  it("★★ ngữ cảnh DỰ ÁN ĐANG CHỌN có mặt trong persona (tên + mục ở gốc)", async () => {
    h.manh = [MA_CSHARP];
    await chay(CAU, admin());
    expect(h.systemPromptNhan).toContain("Dự án đang mở");
    expect(h.systemPromptNhan).toMatch(/Mục ở thư mục gốc: .+/);
  });

  it("★★ chạy được KHÔNG cần execCtx (không có tool nào phải chạy) — vẫn ra mã", async () => {
    h.manh = [MA_CSHARP];
    const r = await chay(CAU);
    expect(r.chu).toContain("TcpListener");
  });

  it("★★★ câu hỏi React/PostgreSQL cũng vào nhánh sinh mã (không chỉ C#)", async () => {
    h.manh = ["```tsx\nexport function Todo() { return null; }\n```"];
    const r = await chay("viết một component React gọi API PostgreSQL để hiện danh sách todo", admin());
    expect(r.chu).toContain("export function Todo");
    expect(r.chu).not.toContain("Chưa rõ yêu cầu lập trình");
  });

  /**
   * ⚠⚠ LỖI CŨ QUAY LẠI DƯỚI MỘT CÁI TÊN KHÁC — ca này canh đúng chỗ đó.
   * Heuristic trả `null` cho câu sinh mã ⇒ bộ chọn LLM được hỏi ⇒ nếu nó ĐOÁN một `read_file` với
   * một tệp nó tự bịa, người dùng nhận *"Không có tệp … trong hộp cát"* thay vì mã.
   */
  it("★★★ bộ chọn LLM ĐOÁN một tệp không tồn tại ⇒ vẫn ra MÃ, không phải \"không có tệp\"", async () => {
    h.llmDoanTool = { tool: "read_file", args: { path: "ChatLanSocket.cs" } };
    h.manh = [MA_CSHARP];
    const r = await chay(CAU, admin());
    expect(r.chu, "một lượt đoán trượt không được nuốt mất câu hỏi").not.toContain("Không có tệp");
    expect(r.chu).toContain("TcpListener");
  });

  it("★★★ ĐỐI CHỨNG — heuristic CÓ khớp (câu có đường dẫn thật) thì vẫn ĐỌC, không sinh mã", async () => {
    h.manh = ["```csharp\nkhông bao giờ dùng\n```"];
    const r = await chay(`đọc ${TEP_THI} và cho biết có gì`, admin());
    expect(r.chu).toContain("namespace CalculatorDemo");
    expect(r.chu).not.toContain("không bao giờ dùng");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — CÔNG TẮC: tắt cờ ⇒ quay lại đường nói thật, KHÔNG im lặng", () => {
  it("★★★ `AI_CODING_GEN=0` ⇒ `codingNoToolMessage` VÀ khai rõ cờ nào đang tắt", async () => {
    process.env.AI_CODING_GEN = "0";
    h.manh = [MA_CSHARP];
    const r = await chay("viết code C# cho chương trình chat LAN sử dụng socket", admin());
    expect(r.chu).toContain("Chưa rõ yêu cầu lập trình");
    expect(r.chu, "im lặng về lý do là nói dối").toContain("AI_CODING_GEN=0");
    expect(r.chu).not.toContain("TcpListener");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — VÒNG LẶP TÁC NHÂN: đọc tệp THẬT → model dựng tệp mới → apply_diff qua HITL", () => {
  const CAU = `sửa ${TEP_THI} để Divide ném ArgumentException("Không chia được cho 0") khi mẫu số bằng 0`;

  /** Nội dung tệp thi ĐÃ SỬA — đúng thứ một model tử tế phải trả về. */
  function maDaSua(goc: string): string {
    return goc.replace(
      "        return a / b;",
      '        if (b == 0) throw new ArgumentException("Không chia được cho 0");\n        return a / b;',
    );
  }

  it("★★★ `original` gửi cho apply_diff = NỘI DUNG THẬT TRÊN ĐĨA (điểm neo băm chống TOCTOU)", async () => {
    const goc = fs.readFileSync(DUONG_THI, "utf8");
    h.manh = ["```csharp\n", maDaSua(goc), "\n```\n\n- Chặn mẫu số 0."];
    const r = await chay(CAU, admin());

    const doc = h.quyetDinh.find((q) => q.tool === "read_file");
    const ghi = h.quyetDinh.find((q) => q.tool === "apply_diff");
    expect(doc, `phải ĐỌC trước: ${JSON.stringify(h.quyetDinh.map((q) => q.tool))}`).toBeTruthy();
    expect(ghi, "phải đề xuất apply_diff").toBeTruthy();
    expect(ghi!.args.path).toBe(TEP_THI);
    expect(ghi!.args.original, "original PHẢI là byte trên đĩa, không phải model tự nhớ").toBe(goc);
    expect(String(ghi!.args.modified)).toContain("ArgumentException");
    expect(String(ghi!.args.modified)).not.toBe(goc);
    // Người dùng thấy thẻ duyệt, không thấy một lượt ghi đã xong.
    expect(r.events.some((e) => e.type === "pending_action" && e.toolName === "apply_diff")).toBe(true);
  });

  it("★★★ KHÔNG một byte nào rời ra đĩa trong lượt đề xuất (HITL là thật, không phải nhãn)", async () => {
    const truoc = fs.readFileSync(DUONG_THI);
    h.manh = ["```csharp\n", maDaSua(truoc.toString("utf8")), "\n```"];
    await chay(CAU, admin());
    expect(fs.readFileSync(DUONG_THI).equals(truoc), "tệp ĐỀ THI phải còn NGUYÊN").toBe(true);
  });

  it("★★ tệp cũng được ĐỌC THẬT trước khi sửa: sự kiện `tool` mang nội dung C# trên đĩa", async () => {
    const goc = fs.readFileSync(DUONG_THI, "utf8");
    h.manh = ["```csharp\n", maDaSua(goc), "\n```"];
    const r = await chay(CAU, admin());
    const ev = r.events.find((e) => e.type === "tool");
    expect(ev && ev.type === "tool" && ev.toolName).toBe("read_file");
    expect(ev && ev.type === "tool" && ev.toolResult.textSummary).toContain("namespace CalculatorDemo");
  });

  it("★★★ model KHÔNG trả khối mã ⇒ TỪ CHỐI đề xuất ghi (thà không sửa còn hơn đoán)", async () => {
    h.manh = ["Bạn nên thêm một phép kiểm mẫu số 0 vào hàm Divide."];
    const r = await chay(CAU, admin());
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff"), "không có khối mã ⇒ KHÔNG được đề xuất ghi").toBe(false);
    expect(r.chu).toContain("KHÔNG đề xuất ghi");
  });

  it("★★★ đầu ra THOÁI HOÁ ⇒ TỪ CHỐI ghi, và chữ rác bị THAY bằng câu sạch (`degraded`)", async () => {
    h.manh = ["```csharp\n", ...Array(400).fill("cell "), "\n```"];
    const r = await chay(CAU, admin());
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff")).toBe(false);
    expect(r.done && r.done.type === "done" && r.done.degraded).toBe(true);
    expect(r.done && r.done.type === "done" && r.done.answer).toContain("thoái hoá");
  });

  /**
   * ⚠⚠ BA CỔNG FAIL-CLOSED — đột biến M9 (gộp cả ba về mỗi `goc === null`) TỪNG SỐNG SÓT vì không ca
   * nào phát biểu chúng. Mỗi cổng chặn một cách hỏng KHÁC NHAU, và cả ba đều hỏng ÂM THẦM:
   *   • `truncated` ⇒ `original` không khớp băm đĩa ⇒ diff chắc chắn bị từ chối (làm phiền người duyệt);
   *   • `redacted`  ⇒ model chép lại chỗ CHE và ta ghi `[REDACTED…]` đè lên mã thật;
   *   • quá dài     ⇒ sửa một tệp mà chỉ nhìn được một phần là đoán mò.
   */
  const camSua: Array<[string, { path: string; content: string; truncated?: boolean; redacted?: boolean }, RegExp]> = [
    ["ĐÃ CẮT (truncated)", { path: TEP_THI, content: "class A {}", truncated: true }, /MỘT PHẦN/],
    ["ĐÃ CHE bí mật (redacted)", { path: TEP_THI, content: "class A {}", redacted: true }, /BÍ MẬT/],
    ["QUÁ DÀI", { path: TEP_THI, content: "x".repeat(60_001) }, /quá lớn/],
  ];
  for (const [ten, gia, mau] of camSua) {
    it(`★★★ ${ten} ⇒ KHÔNG đề xuất ghi, và nói RÕ lý do`, async () => {
      h.docGia = gia;
      h.manh = ["```csharp\nclass A { void X() {} }\n```"];
      const r = await chay(CAU, admin());
      expect(h.quyetDinh.some((q) => q.tool === "apply_diff"), "fail-closed: không được đề xuất ghi").toBe(false);
      expect(r.chu).toMatch(mau);
    });
  }

  it("★★★ `AI_CODING_EDIT=0` ⇒ KHÔNG gọi model, rơi về đường ĐỌC tất định của trục 1", async () => {
    process.env.AI_CODING_EDIT = "0";
    h.manh = ["```csharp\nkhông bao giờ dùng\n```"];
    const r = await chay(CAU, admin());
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff")).toBe(false);
    // Đường cũ vẫn trả NỘI DUNG THẬT của tệp (cổng ra của trục 1 không hồi quy).
    expect(r.chu).toContain("namespace CalculatorDemo");
    expect(r.chu).not.toContain("không bao giờ dùng");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — phân biệt ĐỌC với SỬA (bộ chọn tất định KHÔNG bị sửa một byte)", () => {
  const suaThat = [
    "sửa server/routers.ts cho gọn",
    "vá lỗi trong src/Calculator.cs",
    "thêm kiểm tra null vào shared/schema.ts",
    "fix the bug in server/routers.ts",
    "refactor client/src/App.tsx",
    "修改 server/routers.ts",
  ];
  for (const q of suaThat) {
    it(`★★ "${q}" ⇒ Ý ĐỊNH SỬA`, () => expect(laYDinhSuaTep(q)).toBe(true));
  }

  const chiDoc = [
    "đọc server/routers.ts và cho biết export gì",
    "mở toolRegistry.ts giúp tôi",
    "xem client/src/pages/AICodingWorkspace.tsx",
    "cho tôi thấy server/routers.ts", // "thấy" → "thay": KHÔNG được nhận là động từ sửa
    "đợi một chút rồi đọc server/routers.ts",
    "show me server/routers.ts",
  ];
  for (const q of chiDoc) {
    it(`★★★ "${q}" ⇒ CHỈ ĐỌC (nhận nhầm = đốt 30 s model + đẻ một thẻ duyệt không ai xin)`, () =>
      expect(laYDinhSuaTep(q)).toBe(false));
  }

  it("★★★ ĐỐI CHỨNG A/B — câu VẬN HÀNH không hề là ý định sửa", () => {
    expect(laYDinhSuaTep("OEE hôm nay của line 2 bao nhiêu")).toBe(false);
    expect(laYDinhSuaTep("máy nào đang offline")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §5 — VÒNG TỰ ĐỘNG: LƯỢT SỬA KẾ TIẾP (tệp GHIM) — TOCTOU + HITL
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ Lượt "đề xuất bản sửa kế tiếp" của vòng tự động. Nó KHÁC một lượt người gõ ở đúng một chỗ:
 * câu hỏi chở theo **ĐẦU RA TEST THẬT**, và bộ điều khiển vòng GHIM `codingEditPath`.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • bỏ nhánh ghim ⇒ §5.1 ĐỎ (bộ chọn tất định sẽ đi lạc sang `run_command`/tệp test);
 *   • dùng lại `original` của lượt TRƯỚC thay vì đọc lại đĩa ⇒ §5.2 ĐỎ (đây là điểm neo TOCTOU);
 *   • vòng tự ghi (bỏ HITL) ⇒ §5.3 ĐỎ (tệp trên đĩa phải KHÔNG đổi trong lượt đề xuất);
 *   • `AI_CODING_EDIT=0` mà vẫn gọi model ⇒ §5.4 ĐỎ.
 *
 * ⚠ Dùng một GỐC DỰ ÁN TẠM (không phải `sandbox-projects/**`, vốn là ĐỀ THI) vì §5.2 phải SỬA tệp
 *   trên đĩa giữa hai lượt để chứng minh lượt sau đọc lại.
 */
describe("§5 — VÒNG TỰ ĐỘNG: lượt sửa kế tiếp đọc LẠI đĩa, và vẫn dừng ở thẻ duyệt", () => {
  let gocTam = "";
  const REL = "Calc.cs";
  const V1 = "namespace D;\npublic class Calc { public int Div(int a, int b) { return a / b; } }\n";
  const V2 = "namespace D;\npublic class Calc { public int Div(int a, int b) { /* v2 */ return a / b; } }\n";

  /** Câu hỏi ĐÚNG HÌNH DẠNG bộ điều khiển vòng phát: có lệnh + có đường dẫn tệp TEST trong đầu ra. */
  const CAU_VONG = [
    "sửa Calc.cs để khắc phục lỗi sau khi chạy `dotnet test CalculatorDemo.sln`. Đây là đầu ra THẬT:",
    "",
    "Failed! - Failed: 2, Passed: 4",
    "  Assert.Throws() Failure",
    "  at CalculatorDemo.Tests.CalculatorTests.Divide_ByZero_Throws() in D:\\x\\tests\\CalculatorTests.cs:line 42",
  ].join("\n");

  beforeEach(() => {
    gocTam = fs.mkdtempSync(path.join(os.tmpdir(), "vong-tu-dong-"));
    fs.writeFileSync(path.join(gocTam, REL), V1, "utf8");
    process.env.AI_REPO_SANDBOX_ROOTS = `tam=Du an tam|${gocTam}`;
  });
  afterEach(() => {
    try { fs.rmSync(gocTam, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const ghim = { projectId: "tam", codingEditPath: REL };
  const maMoi = (goc: string) => goc.replace("return a / b;", 'if (b == 0) throw new System.ArgumentException("0"); return a / b;');

  it("★★★ 5.1 — tệp GHIM thắng bộ chọn: đề xuất sửa `Calc.cs`, KHÔNG chạy lại lệnh, KHÔNG đụng tệp test", async () => {
    h.manh = ["```csharp\n", maMoi(V1), "\n```"];
    const r = await chay(CAU_VONG, admin(), ghim);

    const ghiRa = h.quyetDinh.find((q) => q.tool === "apply_diff");
    expect(ghiRa, `phải đề xuất sửa: ${JSON.stringify(h.quyetDinh.map((q) => q.tool))}`).toBeTruthy();
    expect(ghiRa!.args.path).toBe(REL);
    expect(
      h.quyetDinh.some((q) => q.tool === "run_command"),
      "đầu ra test có chuỗi `dotnet test …` — không ghim thì bộ chọn sẽ chạy lại lệnh thay vì sửa",
    ).toBe(false);
    expect(String(ghiRa!.args.path)).not.toContain("CalculatorTests");
    expect(r.events.some((e) => e.type === "pending_action" && e.toolName === "apply_diff")).toBe(true);
  });

  /**
   * ⚠⚠⚠ ĐIỂM NEO CHỐNG TOCTOU. Sau lượt ghi thứ nhất, tệp TRÊN ĐĨA đã đổi. Nếu lượt hai gửi
   * `original` mà model/client "nhớ" từ lượt trước, `apply_diff` sẽ hoặc bị `BASE_MISMATCH` (tốt
   * nhất) hoặc — nếu ai đó nới hàng rào băm — GHI ĐÈ mất thay đổi vừa duyệt.
   */
  it("★★★ 5.2 — LƯỢT HAI đọc LẠI đĩa: `original` là byte MỚI, không phải byte lượt trước", async () => {
    h.manh = ["```csharp\n", maMoi(V1), "\n```"];
    await chay(CAU_VONG, admin(), ghim);
    const luot1 = h.quyetDinh.find((q) => q.tool === "apply_diff");
    expect(luot1!.args.original).toBe(V1);

    // "Người bấm duyệt" → tệp trên đĩa đổi. Lượt hai của vòng chạy trên hiện trường MỚI.
    fs.writeFileSync(path.join(gocTam, REL), V2, "utf8");
    h.quyetDinh = [];
    h.manh = ["```csharp\n", maMoi(V2), "\n```"];
    await chay(CAU_VONG, admin(), ghim);

    const luot2 = h.quyetDinh.find((q) => q.tool === "apply_diff");
    expect(luot2, "lượt hai phải đề xuất tiếp").toBeTruthy();
    expect(luot2!.args.original, "original PHẢI là byte trên đĩa LÚC NÀY").toBe(V2);
    expect(luot2!.args.original).not.toBe(V1);
    // Và nội dung tệp phải được ĐỌC LẠI thật (không phải suy ra) — có sự kiện read_file ở lượt hai.
    expect(h.quyetDinh.some((q) => q.tool === "read_file" && q.args.path === REL)).toBe(true);
  });

  it("★★★ 5.3 — HITL LÀ THẬT: lượt đề xuất của vòng KHÔNG ghi một byte nào xuống đĩa", async () => {
    const truoc = fs.readFileSync(path.join(gocTam, REL));
    h.manh = ["```csharp\n", maMoi(V1), "\n```"];
    const r = await chay(CAU_VONG, admin(), ghim);
    expect(fs.readFileSync(path.join(gocTam, REL)).equals(truoc), "tệp phải còn NGUYÊN").toBe(true);
    // Người dùng thấy một THẺ DUYỆT, không thấy một lượt ghi đã xong.
    expect(r.events.some((e) => e.type === "pending_action")).toBe(true);
  });

  it("★★★ 5.4 — `AI_CODING_EDIT=0` ⇒ nhánh ghim KHÔNG gọi model, KHÔNG đề xuất ghi", async () => {
    process.env.AI_CODING_EDIT = "0";
    h.manh = ["```csharp\nkhông bao giờ dùng\n```"];
    const r = await chay(CAU_VONG, admin(), ghim);
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff")).toBe(false);
    expect(r.chu).not.toContain("không bao giờ dùng");
  });

  it("★★★ 5.5 — VẮNG `codingEditPath` ⇒ hành vi cũ KHÔNG đổi một byte (A/B sạch)", async () => {
    h.manh = ["```csharp\n", maMoi(V1), "\n```"];
    const r = await chay(CAU_VONG, admin(), { projectId: "tam" });
    // Không ghim: câu này chứa `dotnet test …` nên bộ chọn tất định chọn `run_command` — đúng hành
    // vi TRƯỚC đợt này. Ca này tồn tại để chứng minh nhánh ghim KHÔNG rò sang đường cũ.
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff")).toBe(false);
    expect(r.events.some((e) => e.type === "pending_action" && e.toolName === "run_command")).toBe(true);
  });

  it("★★ 5.6 — đường GHIM ngoài hộp cát ⇒ TỪ CHỐI nói rõ, KHÔNG gọi model, KHÔNG đề xuất ghi", async () => {
    h.manh = ["```csharp\nkhông bao giờ dùng\n```"];
    const r = await chay(CAU_VONG, admin(), { projectId: "tam", codingEditPath: "../../../etc/passwd" });
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff")).toBe(false);
    expect(r.chu).not.toContain("không bao giờ dùng");
    expect(r.chu.length, "phải NÓI ra lý do, không im lặng").toBeGreaterThan(0);
  });
});
