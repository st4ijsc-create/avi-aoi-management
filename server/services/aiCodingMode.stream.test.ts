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
  /**
   * ★★★ doc 79 · TRỤC 1 (D) — MỤC LỤC giả: cặp `[đường dẫn, điểm]` mà tầng truy hồi "trả về".
   *
   * ⚠⚠ CHỈ bước XẾP HẠNG bị thay. Bước ĐỌC vẫn là `executeDecision({tool:"read_file"})` THẬT trên
   *    đĩa thật, qua hộp cát thật — đó là điều kiện để phép so "khớp BYTE với tệp trên đĩa" ở §7 có
   *    nghĩa. Thay cả hai tầng thì lưới sẽ chỉ chứng minh hai hằng số của chính nó bằng nhau.
   * ⚠ Vì sao phải thay: bước thật nạp `knowledge/embeddings.jsonl` (162 MB) + model nhúng — 14 s
   *   lượt lạnh, và kết quả phụ thuộc dữ liệu chỉ mục, tức KHÔNG tất định.
   */
  mucLucGia: [] as Array<[string, number]>,
  /**
   * ★ VÁ LIVE 2026-08-20 — thân chunk của pha TOÀN KHO. Đây là nơi cầu "tài liệu → mã" lấy đường
   * dẫn; để rỗng ⇒ pha B không mót được gì (đúng như câu "RBAC" đo được ở live).
   */
  thanToanKho: "" as string,
  /** Số lượt tầng mục lục ĐƯỢC GỌI — ca âm đọc con số này, không chỉ đọc kết quả. */
  soLuotMucLuc: 0,
  /** Đếm THEO PHA: một lưới chỉ đếm tổng sẽ vẫn xanh khi một pha chết hẳn. */
  luotTheoPha: {} as Record<string, number>,
}));

vi.mock("./ai/repoContextService", async (goc) => {
  const that = await goc<typeof import("./ai/repoContextService")>();
  return {
    ...that,
    gatherRepoIndexContext: async (i: import("./ai/repoContextService").GatherRepoIndexContextInput) => {
      h.soLuotMucLuc += 1;
      const pha = i?.cheDoVungMa ?? "sau";
      h.luotTheoPha[pha] = (h.luotTheoPha[pha] ?? 0) + 1;
      // Pha "tat" (toàn kho) trả MỘT chunk tài liệu; giá trị nằm ở THÂN, không ở `sourcePath` —
      // đúng hình dạng thật của kho. Pha "corpus" trả đường dẫn mã như `mucLucGia` khai.
      if (pha === "tat") {
        return {
          block: "khong-dung-toi",
          tokens: 0,
          snippets: h.thanToanKho
            ? [{ sourcePath: "docs/GIA_LAP.md", text: h.thanToanKho, score: 0.5, truncated: false }]
            : [],
          reason: (h.thanToanKho ? "ok" : "empty") as "ok" | "empty",
          retrieved: h.thanToanKho ? 1 : 0,
        };
      }
      return {
        block: "khong-dung-toi",
        tokens: 0,
        snippets: h.mucLucGia.map(([sourcePath, score]) => ({ sourcePath, text: "tom tat", score, truncated: false })),
        reason: "ok" as const,
        retrieved: h.mucLucGia.length,
      };
    },
  };
});

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
  /** ★ doc 81 · VIỆC 1 — lịch sử hội thoại; mặc định `[]` ⇒ mọi ca cũ không đổi một byte. */
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<{ events: StreamEvent[]; chu: string; done?: StreamEvent }> {
  const events: StreamEvent[] = [];
  const tokens: string[] = [];
  const ctx = { codingMode: true, uiLanguage: "vi" as const, ...themCtx };
  for await (const e of streamAnswer(question, 5, history, "engineer", ctx, execCtx)) {
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
  "AI_REPO_SANDBOX_ROOTS", "AI_CODING_REPO_CONTEXT", "AI_KNOWLEDGE_INDEX_ROOT",
  "LLAMA_SERVER_CTX_PER_SLOT",
] as const;

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  h.manh = [];
  h.systemPromptNhan = "";
  h.promptNhan = "";
  h.quyetDinh = [];
  h.llmDoanTool = null;
  h.docGia = null;
  h.mucLucGia = [];
  h.thanToanKho = "";
  h.soLuotMucLuc = 0;
  h.luotTheoPha = {};
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ doc 81 · VIỆC 1 — §6: LỊCH SỬ HỘI THOẠI ĐI ĐƯỢC TỪ `streamAnswer` TỚI PROMPT
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ ĐÂY LÀ LƯỚI DUY NHẤT ĐO **DÂY NỐI**, và không có nó thì lỗ gốc quay lại im lặng.
 *
 * `aiCodingHistory.test.ts` đo CHÍNH SÁCH (`dungKhoiLichSu`) và nó sẽ vẫn XANH kể cả khi
 * `streamAnswer` không truyền `history` xuống `streamCodingAnswer` — đúng hình dạng của lỗ gốc:
 * *"client gửi · tuyến parse · `streamAnswer` nhận — rồi vứt"*. Ở đây ta đọc `h.promptNhan`, tức
 * chuỗi THẬT đi vào `generateTextStream`.
 */
describe("§6 — doc 81 VIỆC 1: lịch sử tới được PROMPT (đo dây nối, không đo chính sách)", () => {
  const LS = [
    { role: "user" as const, content: "viết cho tôi phần A của trình chat LAN" },
    { role: "assistant" as const, content: "đây là phần A: class LanChatServerMocTest" },
  ];

  it("★★★ nhánh SINH MÃ: prompt CHỨA lượt trước — 'giờ làm tiếp phần B' hết rơi vào hư không", async () => {
    h.manh = [MA_CSHARP];
    await chay("giờ làm tiếp phần B", admin(), undefined, LS);
    expect(h.promptNhan, "★★★ lịch sử bị vứt ⇒ mọi câu tham chiếu lượt trước đều vô nghĩa").toContain(
      "class LanChatServerMocTest",
    );
    expect(h.promptNhan).toContain("phần A của trình chat LAN");
    expect(h.promptNhan).toContain("giờ làm tiếp phần B");
  });

  it("★★★ nhánh SỬA TỆP: prompt CHỨA lịch sử **và** nội dung tệp THẬT trên đĩa", async () => {
    h.manh = ["```csharp\nnamespace CalculatorDemo { }\n```"];
    await chay(`sửa ${TEP_THI} để Divide ném ArgumentException khi chia 0`, admin(), undefined, [
      { role: "user", content: "trước đó ta đã bàn về MOC_SUA_TEP" },
    ]);
    expect(h.promptNhan).toContain("MOC_SUA_TEP");
    expect(h.promptNhan, "lịch sử KHÔNG được đẩy nội dung tệp ra khỏi prompt").toContain("namespace CalculatorDemo");
  });

  it("★★★ BÍ MẬT trong lịch sử BỊ CHE trước khi vào prompt (đường sửa đòi prompt NGUYÊN VĂN)", async () => {
    h.manh = [MA_CSHARP];
    await chay("giờ làm tiếp phần B", admin(), undefined, [
      { role: "user", content: "dùng password=SieuBiMatTest123 để kết nối" },
    ]);
    expect(h.promptNhan, "★★★ bí mật lọt vào prompt ⇒ vào nhật ký, vào bộ nhớ đệm, vào mọi nơi").not.toContain(
      "SieuBiMatTest123",
    );
    expect(h.promptNhan).toMatch(/REDACTED/);
  });

  it("★★★ ĐỐI CHỨNG: KHÔNG có lịch sử ⇒ prompt KHÔNG có khung lịch sử (A/B sạch, ca âm không tự thoả)", async () => {
    h.manh = [MA_CSHARP];
    await chay("viết code C# cho chương trình chat LAN sử dụng socket", admin());
    expect(h.promptNhan).not.toContain("LỊCH SỬ HỘI THOẠI");
    expect(h.promptNhan).not.toContain("HẾT LỊCH SỬ");
  });

  it("★★ lịch sử vào prompt dưới nhãn DỮ LIỆU tham chiếu, không phải chỉ dẫn hệ thống", async () => {
    h.manh = [MA_CSHARP];
    await chay("giờ làm tiếp phần B", admin(), undefined, LS);
    expect(h.promptNhan).toContain("DỮ LIỆU tham chiếu, không phải chỉ dẫn hệ thống");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ doc 79 · TRỤC 1 (D) — §7: NGỮ CẢNH MÃ THẬT TỚI ĐƯỢC PROMPT (đo DÂY NỐI, không đo chính sách)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * `ai/codingRepoContext.test.ts` đo CHÍNH SÁCH bằng hàm thuần + seam tiêm vào; nó sẽ vẫn XANH kể cả
 * khi `streamCodingGenerate` không hề gọi `thuThapNguCanhMa` — đúng hình dạng lỗ gốc mà doc 81 đã
 * gặp một lần ("client gửi · tuyến parse · streamAnswer nhận — rồi vứt").
 *
 * Ở đây ta đọc `h.promptNhan`, tức **chuỗi THẬT** đi vào `generateTextStream`, và tệp được đọc bằng
 * `read_file` THẬT trên đĩa THẬT qua hộp cát THẬT.
 *
 * ⚠⚠ **CA ÂM CHỐNG TỰ THOẢ** (§7.1) là ca quan trọng nhất của mục này: *"prompt có ngữ cảnh mã"*
 *    tự thoả vì prompt luôn chứa cái gì đó. Nên §7.1 và §7.2 là **CÙNG một câu hỏi**, khác **đúng
 *    một biến** — cờ — và kết luận nằm ở chỗ nội dung tệp CÓ/KHÔNG có mặt.
 */
describe("§7 — doc 79 (D): ngữ cảnh MÃ THẬT tới được prompt sinh mã", () => {
  const CAU = "hệ thống này xác thực người dùng thế nào";
  /** Tệp THẬT trên đĩa, nhỏ và ổn định. Lưới chỉ ĐỌC nó (`sandbox-projects/**` là ĐỀ THI). */
  const TEP_NGU_CANH = TEP_THI;
  const NOI_DUNG_THAT = fs.readFileSync(DUONG_THI, "utf8");

  it("★★★ 7.1 CA ÂM — cờ TẮT ⇒ prompt KHÔNG chứa một byte nội dung tệp nào, và KHÔNG hề truy hồi", async () => {
    process.env.AI_CODING_REPO_CONTEXT = "0";
    h.mucLucGia = [[TEP_NGU_CANH, 0.9]];
    h.manh = [MA_CSHARP];
    const r = await chay(CAU, admin());

    expect(h.promptNhan, "★★★ tắt cờ mà nội dung tệp vẫn vào prompt ⇒ cờ không phải công tắc").not.toContain(
      "namespace CalculatorDemo",
    );
    expect(h.promptNhan).not.toContain("MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ");
    expect(h.soLuotMucLuc, "tắt cờ mà vẫn đi embed = đốt GPU cho hư không").toBe(0);
    expect(r.events.some((e) => e.type === "tool" && e.toolName === "read_file"), "không có ngữ cảnh ⇒ không có thẻ").toBe(false);
    expect(r.chu, "không có nguồn ⇒ KHÔNG được khoe chân nguồn").not.toContain("ĐỌC TỪ ĐĨA");
    // Hành vi cũ còn NGUYÊN: vẫn sinh mã bình thường.
    expect(r.chu).toContain("TcpListener");
  });

  it("★★★ 7.2 CHIỀU DƯƠNG — cờ BẬT ⇒ prompt chứa nội dung tệp, KHỚP BYTE với đĩa", async () => {
    h.mucLucGia = [[TEP_NGU_CANH, 0.9]];
    h.manh = [MA_CSHARP];
    await chay(CAU, admin());

    // ★ VÁ LIVE: HAI pha, và đếm THEO PHA — một lưới chỉ đếm tổng vẫn xanh khi một pha chết hẳn.
    expect(h.soLuotMucLuc).toBe(2);
    expect(h.luotTheoPha).toEqual({ corpus: 1, tat: 1 });
    expect(h.promptNhan).toContain("MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ");
    expect(h.promptNhan).toContain("[M1] " + TEP_NGU_CANH);
    // ★★★ Phép đo mạnh nhất: NGUYÊN VĂN tệp trên đĩa nằm trong prompt. Không phải "có chứa từ khoá",
    //     không phải "có một khối gì đó" — mà là đúng chuỗi `fs.readFileSync` trả về.
    expect(
      h.promptNhan,
      "★★★ nội dung vào prompt PHẢI là byte trên đĩa, không phải chunk tóm tắt",
    ).toContain(NOI_DUNG_THAT);
    expect(h.promptNhan, "chunk TÓM TẮT không được lọt vào prompt sinh mã").not.toContain("khong-dung-toi");
    // Yêu cầu của người dùng vẫn ở CUỐI prompt (vị trí model chú ý mạnh nhất).
    expect(h.promptNhan.indexOf("MÃ NGUỒN THẬT")).toBeLessThan(h.promptNhan.indexOf(CAU));
  });

  it("★★★ 7.3 NGƯỜI DÙNG THẤY — thẻ tool cho từng tệp và chân nguồn nằm trong `answer`", async () => {
    h.mucLucGia = [[TEP_NGU_CANH, 0.9]];
    h.manh = [MA_CSHARP];
    const r = await chay(CAU, admin());

    const the = r.events.filter((e) => e.type === "tool" && e.toolName === "read_file");
    /**
     * ⚠ ĐÚNG **MỘT** thẻ, không phải một thẻ mỗi tệp — `AICodingWorkspace` giữ `streamTool` là MỘT
     *   ô và `setStreamTool` GHI ĐÈ, nên N thẻ ⇒ người dùng chỉ thấy thẻ cuối. Ca này khoá luôn số
     *   lượng để một lượt "cải tiến" quay lại N thẻ phải nhìn thấy dòng này.
     */
    expect(the.length, "im lặng về nguồn là nói dối; nhưng N thẻ thì client chỉ hiện thẻ CUỐI").toBe(1);
    expect(the[0]!.type === "tool" && the[0]!.toolResult.textSummary).toContain(TEP_NGU_CANH);
    expect(the[0]!.type === "tool" && the[0]!.toolResult.textSummary).toContain("Đã đọc 1 tệp");
    // Chân nguồn phải nằm trong CHUỖI `answer` — phiên đã lưu chỉ giữ {role, content}, thẻ thì mất.
    const done = r.done;
    expect(done && done.type === "done" && done.answer).toContain(TEP_NGU_CANH);
    expect(done && done.type === "done" && done.answer).toContain("ĐỌC TỪ ĐĨA");
    expect(r.chu).toContain(TEP_NGU_CANH);
  });

  it("★★★ 7.4 TRỤC 2 — dự án đang chọn KHÁC gốc chỉ mục ⇒ KHÔNG đọc mã của repo chính", async () => {
    const gocTam = fs.mkdtempSync(path.join(os.tmpdir(), "ngu-canh-ma-"));
    try {
      fs.writeFileSync(path.join(gocTam, "Rieng.cs"), "namespace RiengBiet { }\n", "utf8");
      process.env.AI_REPO_SANDBOX_ROOTS = "tam=Du an tam|" + gocTam;
      h.mucLucGia = [[TEP_NGU_CANH, 0.95]]; // mục lục CHỈ biết repo chính
      h.manh = [MA_CSHARP];
      const r = await chay(CAU, admin(), { projectId: "tam" });

      expect(h.soLuotMucLuc, "sai gốc mà vẫn truy hồi ⇒ đường dẫn repo chính sẽ được đem đi đọc").toBe(0);
      /**
       * ⚠⚠ ĐÍNH CHÍNH TỰ KIỂM (đo bằng đột biến M2, 2026-08-20): bản đầu của ca này chỉ khẳng định
       *    *"prompt KHÔNG chứa `namespace CalculatorDemo`"* và tôi coi đó là bằng chứng chống rò rỉ.
       *    **Nó TỰ THOẢ.** Gỡ cổng gốc ra, mệnh đề ấy VẪN xanh — vì `read_file` chạy với
       *    `__projectRoot` = gốc tạm nên nó trả `NOT_FOUND`, không phải vì cổng gốc làm việc.
       *    ⇒ Mệnh đề ĐO ĐƯỢC là *"ta thậm chí KHÔNG THỬ đọc tệp của dự án khác"* — đếm trên bản
       *      kiểm `h.quyetDinh`, thứ ĐỎ ngay khi cổng biến mất.
       * ⚠ Nói thẳng ranh giới: byte không rời ra được là nhờ **hàng rào THỨ HAI** (`__projectRoot`
       *   tiêm bởi `argsWithAuthCtx`), độc lập với cổng ở đây. Ca này đo hàng rào THỨ NHẤT.
       */
      expect(
        h.quyetDinh.some((q) => q.tool === "read_file" && q.args.path === TEP_NGU_CANH),
        "★★★ RÒ RỈ XUYÊN DỰ ÁN: KHÔNG được ĐỘNG tới đường dẫn của repo chính khi đang mở dự án khác",
      ).toBe(false);
      expect(h.promptNhan).not.toContain("namespace CalculatorDemo");
      expect(r.chu).toContain("TcpListener"); // vẫn sinh mã bình thường
    } finally {
      fs.rmSync(gocTam, { recursive: true, force: true });
    }
  });

  it("★★★ 7.5 HỘP CÁT KHÔNG ĐƯỢC NỚI — mục lục trỏ .env / .. ⇒ KHÔNG một byte nào vào prompt", async () => {
    h.mucLucGia = [[".env", 0.99], ["../../../etc/passwd", 0.98], ["node_modules/x/index.js", 0.97]];
    h.manh = [MA_CSHARP];
    const r = await chay(CAU, admin());

    expect(h.promptNhan).not.toContain("MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ");
    expect(h.promptNhan).not.toContain("DATABASE_URL");
    expect(h.promptNhan).not.toContain("LLAMA_SERVER_MODEL");
    expect(r.events.some((e) => e.type === "tool" && e.toolName === "read_file")).toBe(false);
    expect(r.chu).toContain("TcpListener");
  });

  /**
   * ★★★ CA NÀY TỰ HIỆU CHỈNH TRẦN, có chủ ý — và bản đầu của nó ĐÃ ĐỎ VÌ LÝ DO SAI.
   *
   * Bản đầu dựng một "câu hỏi khổng lồ" 78 KB rồi khai rằng nó làm prompt vượt trần. Đo ra:
   * **KHÔNG vượt** (≈31.800/32.768) ⇒ khối ngữ cảnh mã vẫn ở lại và ca ĐỎ — nhưng đỏ vì thiết bị
   * đo sai, không vì mã sai. Ghim một hằng số ở đây là ghim một lời khai chỉ đúng cho MỘT kích
   * thước persona/tệp; đổi `Calculator.cs` một dòng là nó lại nói dối.
   *
   * ⇒ Cách đúng: **ĐO prompt gốc trước** (lượt phỏng, cờ TẮT), rồi đặt trần slot = *(prompt gốc +
   *   3.000 ra + 10)*. Khi ấy theo CẤU TẠO: prompt gốc VỪA KHÍT, và bất kỳ khối ngữ cảnh mã nào
   *   (≥ 10 token) đều làm nó vượt. Không có con số nào phải đoán.
   */
  it("★★★ 7.6 NGÂN SÁCH — ngữ cảnh mã KHÔNG BAO GIỜ đẩy prompt vượt trần slot", async () => {
    const { kiemNganSachNguCanh, uocLuongSoToken } = await import("./aiLlamaServerClient");

    // (1) LƯỢT PHỎNG — cờ TẮT ⇒ `h.promptNhan` là prompt GỐC, chưa có ngữ cảnh mã.
    process.env.AI_CODING_REPO_CONTEXT = "0";
    h.mucLucGia = [[TEP_NGU_CANH, 0.9]];
    h.manh = [MA_CSHARP];
    await chay(CAU, admin());
    const tokenGoc = uocLuongSoToken(h.systemPromptNhan) + uocLuongSoToken(h.promptNhan);
    expect(tokenGoc, "lượt phỏng phải thật sự chạy tới model").toBeGreaterThan(0);

    // (2) Trần VỪA KHÍT prompt gốc — thêm bất kỳ khối mã nào cũng vượt.
    process.env.LLAMA_SERVER_CTX_PER_SLOT = String(tokenGoc + 3_000 + 10);
    delete process.env.AI_CODING_REPO_CONTEXT;
    h.promptNhan = "";
    h.systemPromptNhan = "";
    h.soLuotMucLuc = 0;
    h.luotTheoPha = {};
    const r = await chay(CAU, admin());

    // (3) Thứ THẬT SỰ gửi lên model phải lọt ngân sách — đo bằng CHÍNH cổng sẽ ném ở tầng dưới.
    const canh = kiemNganSachNguCanh({ systemPrompt: h.systemPromptNhan, prompt: h.promptNhan, maxTokens: 3_000 });
    expect(
      canh.vua,
      "★★★ prompt gửi lên model PHẢI lọt ngân sách slot: " + canh.tokenVao + " + 3000 vs " + canh.tranMoiSlot,
    ).toBe(true);
    // Ngữ cảnh mã ĐÃ được thu thập (mục lục chạy) rồi mới bị NHƯỜNG CHỖ — đúng thứ tự chính sách.
    expect(h.soLuotMucLuc, "phải có thu thập thật thì phép nhường chỗ mới có nghĩa").toBe(2);
    // Chính sách: ngữ cảnh mã bị BỎ, lượt sinh mã VẪN CHẠY (không từ chối cả câu hỏi).
    expect(h.promptNhan).not.toContain("MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ");
    expect(r.chu).toContain("TcpListener");
    // Và KHÔNG khoe một nguồn mà model không hề nhìn thấy.
    expect(r.events.some((e) => e.type === "tool" && e.toolName === "read_file")).toBe(false);
    expect(r.chu).not.toContain("ĐỌC TỪ ĐĨA");
  });

  it("★★★ 7.7 THỨ TỰ NHƯỜNG CHỖ — LỊCH SỬ nhường TRƯỚC ngữ cảnh mã", async () => {
    h.mucLucGia = [[TEP_NGU_CANH, 0.9]];
    h.manh = [MA_CSHARP];
    // Lịch sử dài (mỗi lượt bị cắt còn 2.400 ký tự × 8 lượt), ngữ cảnh mã vẫn phải sống.
    const lichSuDai = Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "MOC_LICH_SU_" + i + " " + "van ban lap cho. ".repeat(400),
    }));
    await chay(CAU, admin(), undefined, lichSuDai);
    expect(h.promptNhan, "ngữ cảnh mã phải sống sót qua một lịch sử dài").toContain(NOI_DUNG_THAT);
    expect(h.promptNhan).toContain("MOC_LICH_SU_7"); // lượt GẦN NHẤT luôn được giữ
  });

  it("★★★ 7.8 ĐƯỜNG SỬA TỆP KHÔNG BỊ CHẠM — không có khối ngữ cảnh mã ở prompt sửa", async () => {
    h.mucLucGia = [["server/routers.ts", 0.99]];
    h.manh = ["```csharp\n", NOI_DUNG_THAT.replace("return a / b;", "return b == 0 ? 0 : a / b;"), "\n```"];
    await chay("sửa " + TEP_THI + " để Divide không chia cho 0", admin());
    expect(
      h.promptNhan,
      "đường SỬA đã sát trần vì chở cả tệp — thêm ngữ cảnh mã ở đó là biến chức năng đang chạy thành chức năng luôn ném",
    ).not.toContain("MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ");
    expect(h.soLuotMucLuc).toBe(0);
    expect(h.promptNhan).toContain("namespace CalculatorDemo"); // vẫn chở tệp đích như trước
  });

  it("★★ 7.9 mục lục RỖNG ⇒ hành vi CŨ y nguyên (không khung rỗng, không thẻ, không chân nguồn)", async () => {
    h.mucLucGia = [];
    h.manh = [MA_CSHARP];
    const r = await chay(CAU, admin());
    expect(h.promptNhan).not.toContain("MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ");
    expect(r.events.some((e) => e.type === "tool" && e.toolName === "read_file")).toBe(false);
    expect(r.chu).toContain("TcpListener");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ §8 — VÁ LIVE 2026-08-20. Ba mệnh đề mà lưới §7 (xanh 100%) **không phát biểu nổi**, và vì thế
//          tính năng chạy hỏng ba lượt liên tiếp trên máy thật mà mọi cổng vẫn báo xanh.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("§8 — VÁ LIVE: cầu tài liệu→mã, và persona phải NÓI RA khi không có mã", () => {
  const CAU_LIVE = "hệ thống này xác thực người dùng như thế nào?";
  /**
   * Tệp THẬT của REPO CHÍNH, nhỏ (280 byte) và ổn định. **Phải là tệp trong vùng mã** —
   * `sandbox-projects/**` (tệp thi của §7) cố ý KHÔNG thuộc `REPO_INDEX_SOURCE_PREFIXES`, nên cầu
   * tài liệu→mã không mót nó; ca đầu tiên của tôi dùng nhầm nó và ĐỎ, đúng như phải thế.
   */
  const TEP_MA_THAT = "shared/const.ts";
  const NOI_DUNG_MA_THAT = fs.readFileSync(path.resolve(process.cwd(), TEP_MA_THAT), "utf8");

  it("★★★ 8.1 CẦU TÀI LIỆU→MÃ chạy THẬT: kho mã RỖNG, chỉ có chunk tài liệu ⇒ vẫn đọc được tệp", async () => {
    // Đúng hình dạng live: pha kho-mã không trả gì, pha toàn-kho trả một chunk TÀI LIỆU có nhắc
    // đường dẫn tệp mã. Tệp đích là tệp THẬT trên đĩa, đọc qua `read_file` THẬT.
    h.mucLucGia = [];
    h.thanToanKho = "Hằng số dùng chung nằm ở `" + TEP_MA_THAT + "`, xem phần khai báo.";
    h.manh = [MA_CSHARP];
    const r = await chay(CAU_LIVE, admin());

    expect(h.luotTheoPha).toEqual({ corpus: 1, tat: 1 });
    expect(h.promptNhan, "★★★ cầu tài liệu→mã phải đưa được BYTE THẬT vào prompt").toContain(NOI_DUNG_MA_THAT);
    expect(h.promptNhan).toContain("MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ");
    // VĂN BẢN của chunk tài liệu KHÔNG được vào prompt — chỉ đường dẫn mót được mới vào.
    expect(h.promptNhan, "chunk tài liệu là CẦU, không phải hàng").not.toContain("xem phần khai báo");
    expect(r.events.some((e) => e.type === "tool" && e.toolName === "read_file")).toBe(true);
  });

  it("★★★ 8.1b CA ÂM CỦA CẦU — tài liệu nhắc `sandbox-projects/**` (NGOÀI vùng mã) ⇒ KHÔNG mót", async () => {
    h.mucLucGia = [];
    h.thanToanKho = "Máy tính mẫu nằm ở `" + TEP_THI + "`.";
    h.manh = [MA_CSHARP];
    const r = await chay(CAU_LIVE, admin());
    expect(
      h.quyetDinh.some((q) => q.tool === "read_file"),
      "★ cầu mót phải TÔN TRỌNG vùng mã, không biến mọi chuỗi giống đường dẫn thành lệnh đọc",
    ).toBe(false);
    expect(h.promptNhan).not.toContain("MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ");
    expect(r.chu).toContain("TcpListener");
  });

  it("★★★ 8.2 CA ÂM — chunk tài liệu KHÔNG nhắc tệp mã nào (câu RBAC ở live) ⇒ KHÔNG có ngữ cảnh", async () => {
    h.mucLucGia = [];
    h.thanToanKho = "# Quản lý vai trò\nMàn hình gán vai trò cho người dùng, không nhắc tệp nào.";
    h.manh = [MA_CSHARP];
    const r = await chay(CAU_LIVE, admin());

    expect(h.promptNhan, "★ nếu ca này có khối mã ⇒ cầu đang nuốt cả chunk doc làm 'mã'").not.toContain(
      "MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ",
    );
    expect(r.events.some((e) => e.type === "tool" && e.toolName === "read_file")).toBe(false);
    expect(r.chu).toContain("TcpListener"); // fail-safe: lượt sinh mã vẫn chạy
  });

  it("★★★ 8.3 PERSONA — ngữ cảnh mã RỖNG ⇒ system prompt BUỘC nói 'không có mã của dự án'", async () => {
    h.mucLucGia = [];
    h.thanToanKho = "";
    h.manh = [MA_CSHARP];
    await chay(CAU_LIVE, admin());
    /**
     * ⚠⚠ ĐÂY là hàng rào chống lượt live 1, nơi model bịa lớp C# `UserAuthenticator` băm SHA-256
     *    cho một repo TypeScript dùng bcrypt — **mà không hề báo là đang đoán**.
     */
    expect(h.systemPromptNhan).toContain("KHÔNG** CÓ MÃ NGUỒN CỦA DỰ ÁN ĐANG MỞ");
    expect(h.systemPromptNhan).toContain("bạn không có mã của dự án để dựa vào trong");
    expect(h.systemPromptNhan, "phải ĐÈ được nguyên tắc 4, nếu không nó vẫn bịa").toContain("ĐÈ nguyên tắc 4");
    // Và KHÔNG được khai ngược lại rằng đã đọc mã.
    expect(h.systemPromptNhan).not.toContain("MÃ NGUỒN THẬT ĐÃ ĐƯỢC ĐỌC TỪ ĐĨA");
  });

  it("★★★ 8.4 PERSONA — CÓ ngữ cảnh mã ⇒ đổi sang khối 'mã thật đứng trên trí nhớ' (A/B một biến)", async () => {
    h.mucLucGia = [[TEP_THI, 0.9]];
    h.manh = [MA_CSHARP];
    await chay(CAU_LIVE, admin());
    expect(h.systemPromptNhan).toContain("MÃ NGUỒN THẬT ĐÃ ĐƯỢC ĐỌC TỪ ĐĨA TRONG LƯỢT NÀY");
    expect(h.systemPromptNhan, "★★★ có mã mà vẫn dặn 'bạn không có mã' ⇒ persona tự mâu thuẫn").not.toContain(
      "KHÔNG** CÓ MÃ NGUỒN CỦA DỰ ÁN ĐANG MỞ",
    );
  });

  it("★★★ 8.5 NGỮ CẢNH BỊ NHƯỜNG CHỖ ⇒ persona phải DỰNG LẠI, không được dặn tin vào khối đã biến mất", async () => {
    const { uocLuongSoToken } = await import("./aiLlamaServerClient");
    // Lượt phỏng (cờ TẮT) để lấy trần vừa khít — cùng thủ pháp §7.6.
    process.env.AI_CODING_REPO_CONTEXT = "0";
    h.mucLucGia = [[TEP_THI, 0.9]];
    h.manh = [MA_CSHARP];
    await chay(CAU_LIVE, admin());
    const tokenGoc = uocLuongSoToken(h.systemPromptNhan) + uocLuongSoToken(h.promptNhan);

    process.env.LLAMA_SERVER_CTX_PER_SLOT = String(tokenGoc + 3_000 + 10);
    delete process.env.AI_CODING_REPO_CONTEXT;
    h.systemPromptNhan = "";
    h.promptNhan = "";
    await chay(CAU_LIVE, admin());

    expect(h.promptNhan).not.toContain("MÃ NGUỒN THẬT TỪ DỰ ÁN ĐANG MỞ"); // khối mã ĐÃ bị bỏ
    expect(
      h.systemPromptNhan,
      "★★★ dặn model tin vào một khối mã KHÔNG TỒN TẠI là dạy nó bịa — đúng lớp lỗi đang chữa",
    ).not.toContain("MÃ NGUỒN THẬT ĐÃ ĐƯỢC ĐỌC TỪ ĐĨA");
    expect(h.systemPromptNhan).toContain("KHÔNG** CÓ MÃ NGUỒN CỦA DỰ ÁN ĐANG MỞ");
  });
});
