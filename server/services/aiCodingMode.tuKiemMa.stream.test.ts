/**
 * ★ T1 (2026-11-10) — DÂY NỐI vòng tự kiểm mã vào nhánh SINH MÃ của chat coding (`streamCodingGenerate`), đo từ sự kiện SSE thật.
 * Model và trình biên dịch là GIẢ (kịch bản); đường `streamAnswer` → `streamCodingGenerate` → `chayTuKiemMa` là THẬT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** câu trả lời lượt chính */
  chinh: "" as string,
  /** các câu trả lời lượt sửa, lấy lần lượt */
  sua: [] as string[],
  prompts: [] as string[],
  /** kịch bản biên dịch: lấy lần lượt; hết ⇒ ok */
  bienDich: [] as Array<{ trangThai: "ok" | "loi" | "khong-kiem-duoc"; chanDoan: unknown[]; lyDo?: string }>,
  soLanBienDich: 0,
  /** mã đã tới trình biên dịch (theo lượt) */
  maDenBienDich: [] as string[],
  /** true ⇒ bước bổ sung `using` tất định (R2B) thêm một dòng `using System;` vào khối C# */
  boSungUsing: false,
  NL: String.fromCharCode(10),
}));

vi.mock("./ai/repoContextService", async (goc) => {
  const that = await goc<typeof import("./ai/repoContextService")>();
  return { ...that, gatherRepoIndexContext: async () => ({ block: "", tokens: 0, snippets: [], reason: "empty" as const, retrieved: 0 }) };
});
vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateText: vi.fn(),
  chatCompletion: vi.fn(),
  generateEmbedding: vi.fn(),
  describeImage: vi.fn(),
  generateJSON: vi.fn(async () => ({ data: { tool: "none", args: {} }, raw: "{}", modelId: "stub", totalTimeMs: 1, tokensPrompt: 1, tokensGenerated: 1 })),
  generateTextStream: async function* (opt: any) {
    const prompt = String(opt?.prompt ?? "");
    h.prompts.push(prompt);
    const chu = prompt.includes("Your code did not compile") ? (h.sua.shift() ?? "") : h.chinh;
    yield { type: "token", token: chu };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: 5 };
  },
}));
vi.mock("./ai/apiRef/chiMucUsingDotnet", async (goc) => {
  const that = await goc<typeof import("./ai/apiRef/chiMucUsingDotnet")>();
  return { ...that, napChiMucUsingDotnet: () => ({}) as never };
});

vi.mock("./ai/boSungUsingCSharp", async (goc) => {
  const that = await goc<typeof import("./ai/boSungUsingCSharp")>();
  return {
    ...that,
    boSungUsingTrongVanBan: (vanBan: string, chiMuc: never) =>
      h.boSungUsing
        ? { text: vanBan.replace("```csharp" + h.NL, "```csharp" + h.NL + "using System;" + h.NL), them: [{ ns: "System", vi: ["Math"] }] }
        : that.boSungUsingTrongVanBan(vanBan, chiMuc),
  };
});
vi.mock("./ai/tuKiemMa/bienDichMa", () => ({
  bienDichMa: vi.fn(async (khoi: { ma: string }) => {
    h.maDenBienDich.push(khoi.ma);
    h.soLanBienDich += 1;
    return h.bienDich.shift() ?? { trangThai: "ok", chanDoan: [] };
  }),
}));
vi.mock("../db/connection", async () => {
  const { dbGiaChiCoBangQuyen } = await import("../testing/dbGiaQuyen");
  return { getDb: vi.fn(async () => dbGiaChiCoBangQuyen()) };
});

import { streamAnswer, type StreamEvent } from "./aiLocalKnowledgeService";

const CAU = "viết code C# cho chương trình chat LAN sử dụng socket";
const HONG = "```csharp\npublic class A { class P { void X(){} } public void Y(){ new P().X(); } }\n```";
const DUNG = "```csharp\npublic class A { class P { internal void X(){} } public void Y(){ new P().X(); } }\n```";
const LOI = { trangThai: "loi" as const, chanDoan: [{ dong: 1, cot: 70, ma: "CS0122", thongDiep: "'A.P.X()' is inaccessible due to its protection level" }] };

async function chay(themCtx: Record<string, unknown> = {}): Promise<{ done: Extract<StreamEvent, { type: "done" }>; chu: string; sk: StreamEvent[] }> {
  const sk: StreamEvent[] = [];
  let chu = "";
  for await (const e of streamAnswer(CAU, 5, [], "engineer", { codingMode: true, uiLanguage: "vi", ...themCtx } as never, undefined)) {
    sk.push(e);
    if (e.type === "token") chu += e.token;
  }
  return { done: sk.find((e) => e.type === "done") as Extract<StreamEvent, { type: "done" }>, chu, sk };
}

beforeEach(() => {
  delete process.env.AI_CHAT_TU_KIEM_MA;
  delete process.env.AI_CHAT_TU_KIEM_VONG;
  delete process.env.AI_CODING_REPO_CONTEXT;
  h.chinh = HONG;
  h.sua = [];
  h.prompts = [];
  h.bienDich = [];
  h.soLanBienDich = 0;
  h.maDenBienDich = [];
  h.boSungUsing = false;
});
afterEach(() => {
  delete process.env.AI_CHAT_TU_KIEM_MA;
  delete process.env.AI_CHAT_TU_KIEM_VONG;
});

describe("T1 tự kiểm mã trong streamCodingGenerate", () => {
  it("★★★ cờ TẮT (mặc định): không biên dịch, không lượt sửa, done không có tuKiemMa, answer = câu của model", async () => {
    h.bienDich = [LOI];
    const { done, chu } = await chay();
    expect(h.soLanBienDich).toBe(0);
    expect(h.prompts).toHaveLength(1);
    expect(done.tuKiemMa).toBeUndefined();
    expect(done.answerRevised).toBeUndefined();
    expect(chu).toContain("class P { void X()");
  });

  it("★★★ cờ BẬT, bản đầu sạch: biên dịch 1 lần, không gọi model lần hai, tuKiemMa 'sach', answer không đổi", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "1";
    const { done } = await chay();
    expect(h.soLanBienDich).toBe(1);
    expect(h.prompts).toHaveLength(1);
    expect(done.tuKiemMa).toContain("trang-thai=sach");
    expect(done.answerRevised).toBeUndefined();
    expect(done.answer).toContain("void X()");
  });

  it("★★★ cờ BẬT, CS0122 rồi sửa được: answer THAY bằng bản sửa + answerRevised + ghi chú; lời nhắc sửa mang mã lỗi và câu trước", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "1";
    h.bienDich = [LOI, { trangThai: "ok", chanDoan: [] }];
    h.sua = [DUNG];
    const { done, chu } = await chay();
    expect(h.prompts).toHaveLength(2);
    expect(h.prompts[1]).toContain("Your code did not compile");
    expect(h.prompts[1]).toContain("CS0122");
    expect(h.prompts[1]).toContain("class P { void X()"); // câu trả lời trước
    expect(done.answerRevised).toBe(true);
    expect(done.answer).toContain("internal void X()");
    expect(done.answer).not.toContain("class P { void X()");
    expect(done.answer).toContain("Đã tự biên dịch thử và sửa 1 lỗi");
    expect(done.tuKiemMa).toContain("trang-thai=da-sua");
    expect(done.tuKiemMa).toContain("vong=1");
    expect(chu).toContain("class P { void X()"); // bản đầu đã stream (không thay lặng lẽ: client thay bằng answer)
  });

  it("★★★ theo-luot: context.tuKiemMa=true ⇒ chạy, done.tuKiemMa mang nguon=luot", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "theo-luot";
    h.bienDich = [LOI, { trangThai: "ok", chanDoan: [] }];
    h.sua = [DUNG];
    const { done } = await chay({ tuKiemMa: true });
    expect(h.soLanBienDich).toBe(2);
    expect(done.tuKiemMa).toContain("nguon=luot");
    expect(done.answerRevised).toBe(true);
  });

  it("★★★ theo-luot nhưng lượt KHÔNG xin ⇒ không đổi một byte (A/B nhánh tắt)", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "theo-luot";
    h.bienDich = [LOI];
    const { done, chu } = await chay();
    expect(h.soLanBienDich).toBe(0);
    expect(h.prompts).toHaveLength(1);
    expect(done.tuKiemMa).toBeUndefined();
    expect(done.answerRevised).toBeUndefined();
    expect(chu).toContain("class P { void X()");
  });

  it("★★★ cờ env vắng / 0 + context.tuKiemMa=true ⇒ context BỊ BỎ QUA, không đổi một byte", async () => {
    h.bienDich = [LOI];
    for (const v of [undefined, "0", "true"]) {
      if (v === undefined) delete process.env.AI_CHAT_TU_KIEM_MA;
      else process.env.AI_CHAT_TU_KIEM_MA = v;
      h.prompts = [];
      h.soLanBienDich = 0;
      const { done } = await chay({ tuKiemMa: true });
      expect(h.soLanBienDich).toBe(0);
      expect(h.prompts).toHaveLength(1);
      expect(done.tuKiemMa).toBeUndefined();
      expect(done.answerRevised).toBeUndefined();
    }
  });

  it("★★ cờ '1' ghi nguon=env", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "1";
    const { done } = await chay();
    expect(done.tuKiemMa).toContain("nguon=env");
  });

  it("★★ còn lỗi sau hết vòng: answer GIỮ NGUYÊN (không revised), tuKiemMa con-loi ok=0, đúng số lượt model", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "1";
    process.env.AI_CHAT_TU_KIEM_VONG = "1";
    h.bienDich = [LOI, LOI];
    h.sua = [DUNG];
    const { done } = await chay();
    expect(h.prompts).toHaveLength(2);
    expect(done.answerRevised).toBeUndefined();
    expect(done.answer).toContain("class P { void X()");
    expect(done.tuKiemMa).toContain("ok=0");
    expect(done.tuKiemMa).toContain("trang-thai=con-loi");
  });

  it("★★ hạ tầng không kiểm được: giữ nguyên câu, tuKiemMa ok=na, không gọi model lần hai", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "1";
    h.bienDich = [{ trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "het-gio" }];
    const { done } = await chay();
    expect(h.prompts).toHaveLength(1);
    expect(done.tuKiemMa).toContain("ok=na");
    expect(done.answerRevised).toBeUndefined();
  });

  it("★★ câu trả lời không có khối mã duy nhất: bo-qua ⇒ done.tuKiemMa = ok=skip, không biên dịch", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "1";
    h.chinh = "Bạn dùng TcpListener ở phía máy chủ.";
    const { done } = await chay();
    expect(h.soLanBienDich).toBe(0);
    expect(done.tuKiemMa).toBe("ok=skip; nguon=env");
  });

  it("★★★ thứ tự: kiểm trên văn bản SAU khi bổ sung `using` (thiếu using không bị đổ cho model); bản sửa xong thay cả bản bổ sung", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "1";
    h.boSungUsing = true;
    h.bienDich = [LOI, { trangThai: "ok", chanDoan: [] }];
    h.sua = [DUNG];
    const { done } = await chay();
    expect(h.maDenBienDich[0]).toContain("using System;");
    expect(h.prompts[1]).toContain("using System;"); // câu trước gửi lại model = bản đã bổ sung using
    expect(done.answerRevised).toBe(true);
    expect(done.answer).toContain("internal void X()");
  });

  it("★★ bổ sung using xong, bản đầu sạch: answer = bản đã bổ sung using, tuKiemMa 'sach'", async () => {
    process.env.AI_CHAT_TU_KIEM_MA = "1";
    h.boSungUsing = true;
    const { done } = await chay();
    expect(h.maDenBienDich).toHaveLength(1);
    expect(h.maDenBienDich[0]).toContain("using System;");
    expect(done.answerRevised).toBe(true);
    expect(done.answer).toContain("using System;");
    expect(done.tuKiemMa).toContain("trang-thai=sach");
  });
});
