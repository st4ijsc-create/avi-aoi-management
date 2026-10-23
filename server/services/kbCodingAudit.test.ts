/**
 * ★★ Đợt 9 — DẤU VẾT THẬT của đường KB coding / agent: chạy CỔNG THẬT + `aiLlmAudit` THẬT, chỉ thay `getDb` và engine.
 * Câu hỏi khoá: "mở `ai_llm_audit` ra, mỗi lượt model của màn lập trình có ĐÚNG MỘT hàng, mang nhãn bề mặt `kb_*`, và KHÔNG hàng
 * nào chứa mã nguồn của người dùng?". Cờ `AI_LLM_AUDIT_ENABLED` tắt ⇒ 0 hàng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.fn();
const insertValuesMock = vi.fn(async (_rows?: unknown) => undefined);
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
vi.mock("../db/connection", () => ({ getDb: () => getDbMock() }));

const MODEL_THUC = "Qwen3-Model-Thuc-Chay-Q4";
let engineTraLoi = "RESP_MA_NGUOI_DUNG_XYZ y := x;";
let engineNem = false;
vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: async () => true,
  ggufModelFileExists: () => false,
  codeModelBasename: () => undefined,
  generateTextStream: async function* () {
    yield { type: "token", token: engineTraLoi };
    yield { type: "done", tokensPrompt: 11, tokensGenerated: 7, modelId: `/models/${MODEL_THUC}.gguf` };
  },
  chatCompletion: async () => ({ text: "", toolCalls: [{ function: { name: "read_file" } }], finishReason: "tool_calls", tokensPrompt: 5, tokensGenerated: 2, modelId: MODEL_THUC }),
  chatCompletionStream: async function* () {
    if (engineNem) throw new Error("boom");
    yield { type: "token", token: engineTraLoi };
    yield { type: "done", tokensPrompt: 13, tokensGenerated: 9, modelId: MODEL_THUC, toolCalls: [{ function: { name: "read_file" } }, { function: { name: "grep" } }] };
  },
}));

vi.mock("./flow/lib/bienDichST", async (importOriginal) => {
  const that = await importOriginal<typeof import("./flow/lib/bienDichST")>();
  return {
    ...that,
    bienDichST: async (ma: string) =>
      ma.includes("AND ;")
        ? { ok: false, ms: 3, chanDoan: [{ tep: "ma.st", dong: 4, cot: 3, mucDo: "error", ma: "E007", thongDiep: "Unexpected token" }] }
        : { ok: true, ms: 3, chanDoan: [] },
  };
});

import { flushLlmAudit, stopLlmAuditFlushTimer } from "./ai/aiLlmAudit";
import { flush as flushGateway, ghiLuotNgoaiCong, stopGatewayFlushTimer } from "./aiGateway";
import { streamCodingModel } from "./aiCodingAgent";
import { hoiModelChonTool } from "./ai/phuQuyetToolNative";
import { taoGoiModelMayChu } from "./ai/agent/goiModelMayChu";
import { chayKiemBienDichST } from "./aiLocalKnowledgeCodingKiemST";

type Hang = Record<string, unknown>;
const hangAudit = (): Hang[] =>
  insertValuesMock.mock.calls.flatMap((c) => (c[0] ?? []) as Hang[]).filter((r) => typeof r.promptSha256 === "string");
const hangSoDo = (): Hang[] =>
  insertValuesMock.mock.calls.flatMap((c) => (c[0] ?? []) as Hang[]).filter((r) => typeof r.promptSha256 !== "string" && typeof r.tokensIn === "number");

async function xa(): Promise<void> {
  await flushLlmAudit();
  await flushGateway();
}

const MA_BI_MAT = "CODE_NGUOI_DUNG_BI_MAT_XYZ";
const SECRET = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const FB_SAI = "FUNCTION_BLOCK A\n  y := x AND ;\nEND_FUNCTION_BLOCK";
const FB_DUNG = "FUNCTION_BLOCK A\n  y := x;\nEND_FUNCTION_BLOCK";
const tl = (ma: string) => `Mã:\n\`\`\`st\n${ma}\n\`\`\`\nXong.`;

beforeEach(async () => {
  delete process.env.AI_LLM_AUDIT_ENABLED;
  delete process.env.AI_KIEM_BIEN_DICH_ST;
  engineTraLoi = "RESP_MA_NGUOI_DUNG_XYZ y := x;";
  engineNem = false;
  getDbMock.mockResolvedValue({ insert: insertMock });
  await xa(); // bộ đệm là trạng thái MODULE: xả hàng của ca trước rồi mới xoá vết mock
  vi.clearAllMocks();
  getDbMock.mockResolvedValue({ insert: insertMock });
});

afterEach(() => {
  stopLlmAuditFlushTimer();
  stopGatewayFlushTimer();
});

async function rut<T>(g: AsyncGenerator<unknown, T>): Promise<T> {
  for (;;) {
    const n = await g.next();
    if (n.done) return n.value;
  }
}

describe("streamCodingModel — hàng audit của lượt sinh KB coding", () => {
  it("MỘT hàng, nhãn kb_*, model THỰC (basename từ chunk done), có responseSha256, KHÔNG chứa mã người dùng", async () => {
    await rut(streamCodingModel({ auditTask: "kb_sinh_ma", systemPrompt: "s", prompt: `viết ${MA_BI_MAT} với khoá ${SECRET}`, maxTokens: 100, userId: 5 }));
    await xa();
    const h = hangAudit();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ task: "kb_sinh_ma", model: MODEL_THUC, outcome: "ok", userId: 5 });
    expect(String(h[0].promptSha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(h[0].responseSha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(h[0].responseChars).toBeGreaterThan(0);
    const json = JSON.stringify(h);
    expect(json).not.toContain(MA_BI_MAT);
    expect(json).not.toContain("RESP_MA_NGUOI_DUNG_XYZ");
    expect(json).not.toContain(SECRET);
    // sổ đo vẫn ghi MỘT hàng, task thô hợp lệ (không phải nhãn kb_*)
    expect(hangSoDo()).toHaveLength(1);
    expect(hangSoDo()[0].task).not.toMatch(/^kb_/);
  });

  it("không có auditTask ⇒ nhãn thô như cũ (hành vi cũ không đổi)", async () => {
    await rut(streamCodingModel({ systemPrompt: "s", prompt: "p", maxTokens: 100 }));
    await xa();
    expect(hangAudit()).toHaveLength(1);
    expect(String(hangAudit()[0].task)).not.toMatch(/^kb_/);
  });

  it("AI_LLM_AUDIT_ENABLED=false ⇒ 0 hàng audit, sổ đo vẫn ghi", async () => {
    process.env.AI_LLM_AUDIT_ENABLED = "false";
    await rut(streamCodingModel({ auditTask: "kb_sinh_ma", systemPrompt: "s", prompt: "p", maxTokens: 100 }));
    await xa();
    expect(hangAudit()).toHaveLength(0);
    expect(hangSoDo()).toHaveLength(1);
  });
});

describe("chayKiemBienDichST — hàng kb_kiem_st", () => {
  const boiCanh = { tier: 2, model: "ModelChinh", userId: 9 };
  const chay = (cauTraLoi: string, goiLai: (t: string, l: string) => Promise<string>) =>
    rut(chayKiemBienDichST({ beMat: "tro-ly", cauTraLoi, goiLai, boiCanh }));

  it("sạch ngay lần đầu ⇒ vẫn MỘT hàng: tier/model/người dùng của lượt chính, mẩu số liệu, băm (không mã), KHÔNG thêm hàng sổ đo", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "all";
    await chay(tl(FB_DUNG), async () => "");
    await xa();
    const h = hangAudit();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ task: "kb_kiem_st", tier: 2, model: "ModelChinh", userId: 9, outcome: "ok" });
    expect(String(h[0].redactedSnippet)).toMatch(/^kiem-bien-dich-st ok=1 trang-thai=sach vong=0 sua=0 con=0 ms=\d+/);
    expect(JSON.stringify(h)).not.toContain("FUNCTION_BLOCK");
    expect(hangSoDo()).toHaveLength(0); // chiNhatKy: không phải một lượt model
  });

  it("con-loi ⇒ mẩu mang MÃ lỗi, không mã nguồn; da-sua ⇒ responseSha256 khác promptSha256 (băm hai bản)", async () => {
    process.env.AI_KIEM_BIEN_DICH_ST = "all";
    await chay(tl(FB_SAI), async () => tl(FB_SAI));
    await xa();
    expect(String(hangAudit()[0].redactedSnippet)).toContain("trang-thai=con-loi");
    expect(String(hangAudit()[0].redactedSnippet)).toContain("ma=E007");
    expect(JSON.stringify(hangAudit())).not.toContain("AND ;");

    insertValuesMock.mockClear();
    await chay(tl(FB_SAI), async () => tl(FB_DUNG));
    await xa();
    const h = hangAudit();
    expect(h).toHaveLength(1);
    expect(String(h[0].redactedSnippet)).toContain("trang-thai=da-sua");
    expect(h[0].promptSha256).not.toBe(h[0].responseSha256);
  });

  it("cờ vòng kiểm TẮT hoặc không có mã ST ⇒ 0 hàng; AI_LLM_AUDIT_ENABLED=false ⇒ 0 hàng", async () => {
    await chay(tl(FB_SAI), async () => tl(FB_DUNG)); // cờ tắt (mặc định)
    process.env.AI_KIEM_BIEN_DICH_ST = "all";
    await chay("chỉ văn bản", async () => "");
    process.env.AI_LLM_AUDIT_ENABLED = "false";
    await chay(tl(FB_DUNG), async () => "");
    await xa();
    expect(hangAudit()).toHaveLength(0);
  });
});

describe("hai đường NGOÀI cổng — ghiLuotNgoaiCong", () => {
  it("bộ chọn tool: MỘT hàng kb_chon_tool + MỘT hàng sổ đo; câu hỏi người dùng không nằm trong hàng nào", async () => {
    const r = await hoiModelChonTool(`đọc ${MA_BI_MAT} giúp tôi`);
    expect(r).toBe("read_file");
    await xa();
    const h = hangAudit();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ task: "kb_chon_tool", model: MODEL_THUC, outcome: "ok" });
    expect(JSON.stringify(h)).not.toContain(MA_BI_MAT);
    expect(hangSoDo()).toHaveLength(1);
    expect(hangSoDo()[0]).toMatchObject({ task: "intent", tokensIn: 5, tokensOut: 2 });
  });

  it("agent: MỖI lượt model một hàng kb_agent_luot (người chạy, tokens, tên công cụ — không đối số/mã); lượt hỏng ⇒ outcome error", async () => {
    const goi = taoGoiModelMayChu({ userId: 7 });
    const vao = (ndung: string) => ({ tinNhan: [{ role: "user" as const, content: ndung }], congCu: [], signal: new AbortController().signal });
    const dung = async (ndung: string) => {
      const g = goi(vao(ndung));
      for (;;) {
        const n = await g.next();
        if (n.done) break;
      }
    };
    await dung(`sửa ${MA_BI_MAT}`);
    await xa();
    let h = hangAudit();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ task: "kb_agent_luot", userId: 7, outcome: "ok", model: MODEL_THUC });
    expect(String(h[0].redactedSnippet)).toBe("kb-agent-luot cong-cu=read_file,grep");
    expect(String(h[0].responseSha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(h)).not.toContain(MA_BI_MAT);
    expect(JSON.stringify(h)).not.toContain("RESP_MA_NGUOI_DUNG_XYZ");
    expect(hangSoDo()[0]).toMatchObject({ task: "chat", tokensIn: 13, tokensOut: 9 });

    insertValuesMock.mockClear();
    engineNem = true;
    await expect(dung("lượt hỏng")).rejects.toBeTruthy();
    await xa();
    h = hangAudit();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ task: "kb_agent_luot", outcome: "error" });
  });

  it("agent theo vai trò (khongGhiDauVet) ⇒ KHÔNG ghi dấu vết chỉ-ghi (lượt đã đếm qua cổng ở quanLyLuotChay) — tránh hai hàng cho một lượt", async () => {
    const goi = taoGoiModelMayChu({ userId: 7, khongGhiDauVet: true });
    const g = goi({ tinNhan: [{ role: "user" as const, content: "x" }], congCu: [], signal: new AbortController().signal });
    for (;;) {
      const n = await g.next();
      if (n.done) break;
    }
    await xa();
    expect(hangAudit()).toHaveLength(0);
    expect(hangSoDo()).toHaveLength(0);
  });

  it("helper KHÔNG ném và KHÔNG gating (đầu vào lạ vẫn chỉ ghi/nuốt); chiNhatKy ⇒ không có hàng sổ đo", async () => {
    expect(() => ghiLuotNgoaiCong({ task: "code", auditTask: "kb_x".repeat(20), tier: 99, latencyMs: -5, tokensIn: Number.NaN })).not.toThrow();
    ghiLuotNgoaiCong({ task: "code", auditTask: "kb_kiem_st", chiNhatKy: true, auditSnippet: "x" });
    ghiLuotNgoaiCong({ task: "code", auditTask: "kb_chuan_hoa_model", chiNhatKy: true, model: "/models/Ten-Model-Q4.GGUF" });
    await xa();
    expect(hangAudit().length).toBeGreaterThanOrEqual(3);
    expect(hangAudit().find((r) => r.task === "kb_chuan_hoa_model")?.model).toBe("Ten-Model-Q4"); // basename, không .gguf
    expect(hangSoDo()).toHaveLength(1); // chỉ lệnh gọi đầu (không chiNhatKy)
  });
});
