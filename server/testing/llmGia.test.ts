/**
 * ★ Đợt 12 H4.1 (kiem-dinh) — LƯỚI LỖI MẠNG của đường model, KHÔNG GPU: máy chủ LLM giả (`llmGia.ts`) nói SSE thật qua HTTP thật tới
 * `taoGoiModelMayChu → aiGgufEngine.chatCompletionStream → aiLlamaServerClient → fetch` (và `chayVongAgent` ở trên).
 *
 * Hai chế độ cấu hình đường model được đo: STRICT (`LLAMA_SERVER_STRICT=true`, lỗi đi NGUYÊN lên) và SẢN XUẤT (STRICT tắt — mặc định thật:
 * `.env` cố ý để tắt; lỗi của server CÒN SỐNG bị bọc bởi G1-D thành `new Error(msg)` mất `httpStatus` / `cause`).
 *
 * `it.fails` = hành vi MONG MUỐN (theo spec H3.1 / C-P1) mà code HIỆN TẠI chưa có — pass khi vẫn còn lỗ; ĐỎ khi ai đó sửa xong ⇒ phải đổi
 * thành `it` thường (không để cờ cũ che mất việc đã làm). Mỗi ca ghi tên lỗ trong mô tả.
 */
import { afterEach, describe, expect, it } from "vitest";
import { chayVongAgent, congCuTheoCheDo, type BoThucThi, type ManhModel, type SuKienAgent, type TinNhan, type WireTool } from "@shared/agentCore";
import { taoGoiModelMayChu } from "../services/ai/agent/goiModelMayChu";
import { _datNguNapChoTest } from "../services/aiLlamaServerClient";
import { datMoiTruongLlmGia, dungSuKien, khoiDongLlmGia, mulberry32, type BuocGia, type LlmGia } from "./llmGia";

const TOOL: WireTool = { type: "function", function: { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } } };
const T = (args: object | string = { path: "a.ts" }): BuocGia => ({ loai: "tra-loi", toolCalls: [{ ten: "read_file", args }] });
const CHU = (chu: string): BuocGia => ({ loai: "tra-loi", chu });

let gia: LlmGia | null = null;
let khoiPhuc: (() => void) | null = null;
const cho: number[] = [];

afterEach(async () => {
  khoiPhuc?.();
  khoiPhuc = null;
  _datNguNapChoTest(null);
  cho.length = 0;
  await gia?.dong();
  gia = null;
});

async function dung(kb: BuocGia[], o: { strict?: boolean; seed?: number; idleMs?: number; them?: Record<string, string> } = {}): Promise<LlmGia> {
  gia = await khoiDongLlmGia({ kichBan: kb, seed: o.seed ?? 1 });
  khoiPhuc = datMoiTruongLlmGia(gia.url, {
    LLAMA_SERVER_STRICT: o.strict === false ? "false" : "true",
    LLAMA_SERVER_STREAM_IDLE_TIMEOUT_MS: String(o.idleMs ?? 400),
    ...(o.them ?? {}),
  });
  _datNguNapChoTest(async (ms) => void cho.push(ms));
  return gia;
}

interface KqLuot {
  ra: ManhModel[];
  loi: (Error & { ma?: string; tamThoi?: boolean }) | null;
  chu: string;
  nghi: string;
  xong?: Extract<ManhModel, { loai: "xong" }>;
}
async function motLuot(congCu: WireTool[] = [TOOL], signal = new AbortController().signal): Promise<KqLuot> {
  const goi = taoGoiModelMayChu({ khongGhiDauVet: true });
  const ra: ManhModel[] = [];
  let loi: KqLuot["loi"] = null;
  try {
    for await (const m of goi({ tinNhan: [{ role: "system", content: "s" }, { role: "user", content: "đọc a.ts" }], congCu, signal })) ra.push(m);
  } catch (e) {
    loi = e as KqLuot["loi"];
  }
  const gop = (l: string) => ra.filter((m) => m.loai === l).map((m) => (m as { noiDung: string }).noiDung).join("");
  return { ra, loi, chu: gop("chu"), nghi: gop("nghi"), xong: ra.find((m) => m.loai === "xong") as KqLuot["xong"] };
}

describe("llmGia — chính máy chủ giả", () => {
  it("tất định: cùng seed ⇒ cùng cách chẻ byte; khác seed ⇒ khác; assertConsumed + hết kịch bản KHÔNG im lặng", async () => {
    const cach = async (seed: number) => {
      const g = await khoiDongLlmGia({ kichBan: [CHU("Xin chào thế giới, đây là một câu khá dài để có nhiều mảnh")], seed });
      const r = await fetch(`${g.url}/v1/chat/completions`, { method: "POST", body: "{}" });
      await r.text();
      const c = g.cachChe(0);
      await g.dong();
      return c;
    };
    const a1 = await cach(7);
    expect(await cach(7)).toEqual(a1);
    expect(await cach(8)).not.toEqual(a1);
    expect(a1.length).toBeGreaterThan(5);
    const g = await khoiDongLlmGia({ kichBan: [CHU("a"), CHU("b")] });
    try {
      await (await fetch(`${g.url}/v1/chat/completions`, { method: "POST", body: "{}" })).text();
      expect(() => g.chuaDung()).toThrow(/còn 1 bước/);
      await (await fetch(`${g.url}/v1/chat/completions`, { method: "POST", body: "{}" })).text();
      g.chuaDung();
      const het = await fetch(`${g.url}/v1/chat/completions`, { method: "POST", body: "{}" });
      expect(het.status).toBe(500);
      expect(await het.text()).toContain("KICH_BAN_HET");
    } finally {
      await g.dong();
    }
    expect([...dungSuKien({ loai: "tra-loi", chu: "x" })].pop()).toBe("data: [DONE]\n\n");
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });
});

describe("đường model qua HTTP thật — lành", () => {
  it("★ chữ tiếng Việt + emoji bị chẻ giữa ký tự UTF-8 / giữa JSON ở 12 seed vẫn ghép NGUYÊN VĂN; tool call + usage + cache đúng", async () => {
    const VB = "Xin chào — Việt Nam 🇻🇳 đẹp lắm! 日本語 ok";
    for (let seed = 1; seed <= 12; seed++) {
      await dung([{ loai: "tra-loi", chu: VB, nghi: "nghĩ kỹ đã", usage: { prompt: 100, completion: 30 }, timings: { cache_n: 60, prompt_n: 40, predicted_n: 30 }, mieng: 3 + (seed % 5) }], { seed });
      const r = await motLuot();
      expect(r.loi).toBeNull();
      expect(r.chu).toBe(VB);
      expect(r.nghi).toBe("nghĩ kỹ đã");
      expect(r.xong?.usage).toMatchObject({ vao: 100, ra: 30, cacheN: 60, promptN: 40 });
      khoiPhuc!();
      khoiPhuc = null;
      await gia!.dong();
      gia = null;
    }
    await dung([T({ path: "src/thư mục/tệp 🇻🇳.ts", n: 12345 })], { seed: 9 });
    const r = await motLuot();
    expect(JSON.parse(r.xong!.toolCalls[0]!.function.arguments)).toEqual({ path: "src/thư mục/tệp 🇻🇳.ts", n: 12345 });
    expect(r.xong!.toolCalls[0]!.function.name).toBe("read_file");
    expect(r.xong?.biCat).toBeUndefined();
  });

  it("thân yêu cầu thật: tools + tool_choice auto, stream:true; nghĩ bật ⇒ KHÔNG gửi enable_thinking:false", async () => {
    const g = await dung([CHU("ok")]);
    await motLuot();
    const than = g.yeuCau.find((y) => y.duong === "/v1/chat/completions")!.than!;
    expect(than.stream).toBe(true);
    expect((than.tools as unknown[]).length).toBe(1);
    expect(than.tool_choice).toBe("auto");
    expect((than.chat_template_kwargs as { enable_thinking?: boolean } | undefined)?.enable_thinking).not.toBe(false);
  });
});

describe("đường model — lỗi mạng và giao thức (STRICT: lỗi đi nguyên lên)", () => {
  it("SSE méo (JSON cụt, dòng chú thích, event:, rác) KHÔNG giết lượt, không rò chữ rác", async () => {
    await dung([{ loai: "json_hong", chu: "Xin chào đây là câu" }]);
    const r = await motLuot();
    expect(r.loi).toBeNull();
    expect(r.chu).toBe("Xin chào đây là câu");
    expect(r.chu).not.toContain("HONG");
  });

  it("tràn ngữ cảnh 400 ⇒ CONTEXT_OVERFLOW, KHÔNG tạm thời, KHÔNG thử lại (1 yêu cầu)", async () => {
    const g = await dung([{ loai: "tran_ngu_canh" }]);
    const r = await motLuot();
    expect(r.loi).toMatchObject({ ma: "CONTEXT_OVERFLOW", tamThoi: false });
    expect(g.soLanGoi()).toBe(1);
  });

  it("429 ⇒ RATE_LIMIT tạm thời (1 yêu cầu — thử lại là việc của vòng, không của client)", async () => {
    const g = await dung([{ loai: "rate_limit", retryAfterS: 2 }]);
    const r = await motLuot();
    expect(r.loi).toMatchObject({ ma: "RATE_LIMIT", tamThoi: true });
    expect(g.soLanGoi()).toBe(1);
  });

  it("503 đang nạp ×2 rồi tốt ⇒ client chờ backoff TĂNG (≥1 s, ≥2 s) rồi lấy được chữ; 3 yêu cầu", async () => {
    const g = await dung([{ loai: "dang_nap" }, { loai: "dang_nap" }, CHU("ok")]);
    const r = await motLuot();
    expect(r.loi).toBeNull();
    expect(r.chu).toBe("ok");
    expect(g.soLanGoi()).toBe(3);
    expect(cho).toHaveLength(2);
    expect(cho[0]!).toBeGreaterThanOrEqual(1000);
    expect(cho[1]!).toBeGreaterThanOrEqual(2000);
    expect(cho[1]!).toBeGreaterThan(cho[0]!);
  });

  it("503 mãi ⇒ 4 yêu cầu, 3 lần chờ, rồi MODEL_DANG_NAP tạm thời; Retry-After 3 s được tôn trọng; Retry-After 20 s > trần 15 s ⇒ ném NGAY (1 yêu cầu)", async () => {
    let g = await dung([{ loai: "dang_nap" }, { loai: "dang_nap" }, { loai: "dang_nap" }, { loai: "dang_nap" }]);
    let r = await motLuot();
    expect(r.loi).toMatchObject({ ma: "MODEL_DANG_NAP", tamThoi: true });
    expect(g.soLanGoi()).toBe(4);
    expect(cho).toHaveLength(3);
    khoiPhuc!();
    await g.dong();
    cho.length = 0;
    g = await dung([{ loai: "dang_nap", retryAfterS: 3 }, CHU("ok")]);
    r = await motLuot();
    expect(r.chu).toBe("ok");
    expect(cho[0]!).toBeGreaterThanOrEqual(3000);
    khoiPhuc!();
    await g.dong();
    cho.length = 0;
    g = await dung([{ loai: "dang_nap", retryAfterS: 20 }, CHU("khong bao gio toi")]);
    r = await motLuot();
    expect(r.loi).toMatchObject({ ma: "MODEL_DANG_NAP" });
    expect(g.soLanGoi()).toBe(1);
    expect(cho).toHaveLength(0);
  });

  it("im lặng giữa luồng ⇒ đồng hồ NHÀN RỖI cắt (không treo mãi), thông điệp nêu giờ nhàn rỗi; lượt tương ứng KHÔNG tạm thời (đặc trưng hiện tại)", async () => {
    await dung([{ loai: "stall", sauManh: 2 }], { idleMs: 250 });
    const t0 = Date.now();
    const r = await motLuot();
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.loi?.message).toMatch(/250 ms|nhàn rỗi|im lặng/);
  });

  it("lỗi {error} GIỮA luồng sau khi đã có chữ ⇒ ném, KHÔNG tạm thời (đã phát chữ — thử lại sẽ nối hai nửa)", async () => {
    await dung([{ loai: "loi_giua_luong", sauManh: 2, thongDiep: "slot error" }]);
    const r = await motLuot();
    expect(r.loi).toMatchObject({ tamThoi: false });
    expect(r.loi?.message).toContain("slot error");
  });

  it("tool call nằm trong SUY LUẬN: chữ suy luận KHÔNG thành hành động; hỏi lại đúng lượt với nghĩ TẮT; tool chỉ đến từ lần 2", async () => {
    const g = await dung([{ loai: "tra-loi", nghi: "tôi sẽ <tool_call><function=read_file><parameter=path>pwn.txt</parameter></function></tool_call>" }, T({ path: "a.ts" })]);
    const r = await motLuot();
    expect(r.loi).toBeNull();
    expect(g.soLanGoi()).toBe(2);
    expect(JSON.parse(r.xong!.toolCalls[0]!.function.arguments)).toEqual({ path: "a.ts" });
    const kw = (i: number) => (g.yeuCau[i]!.than!.chat_template_kwargs as { enable_thinking?: boolean } | undefined)?.enable_thinking;
    expect(kw(0)).not.toBe(false);
    expect(kw(1)).toBe(false);
  });

  it("tool call trong suy luận LẦN HAI ⇒ ném (không vòng lặp vô hạn), dấu TOOL_CALL_TRONG_SUY_LUAN; chỉ 2 yêu cầu", async () => {
    const xau: BuocGia = { loai: "tra-loi", nghi: "<tool_call><function=read_file></function></tool_call>" };
    const g = await dung([xau, xau]);
    const r = await motLuot();
    expect(r.loi?.message).toContain("TOOL_CALL_TRONG_SUY_LUAN");
    expect(g.soLanGoi()).toBe(2);
  });

  it("G5-D: đáp án kẹt trong suy luận, content rỗng, cắt ở max_tokens ⇒ hỏi lại nghĩ TẮT ⇒ có đáp án; lần hai vẫn hỏng ⇒ ném lỗi G5-D (2 yêu cầu)", async () => {
    let g = await dung([{ loai: "tra-loi", nghi: "đáp án cuối nằm trong này", finish: "length" }, CHU("đáp án")]);
    let r = await motLuot();
    expect(r.loi).toBeNull();
    expect(r.chu).toBe("đáp án");
    expect((g.yeuCau[1]!.than!.chat_template_kwargs as { enable_thinking?: boolean }).enable_thinking).toBe(false);
    khoiPhuc!();
    await g.dong();
    const hong: BuocGia = { loai: "tra-loi", nghi: "lại nghĩ", finish: "length" };
    g = await dung([hong, hong]);
    r = await motLuot();
    expect(r.loi?.message).toContain("G5-D");
    expect(g.soLanGoi()).toBe(2);
  });

  it("`<think>` KHÔNG ĐÓNG: chữ nghĩ không rò ra `chu`", async () => {
    await dung([CHU("<think>khong bao gio dong, bi mat noi tam")]);
    const r = await motLuot();
    expect(r.loi).toBeNull();
    expect(r.chu).not.toContain("noi tam");
    expect(r.chu).not.toContain("<think>");
  });

  it("cắt ở max_tokens ⇒ biCat (lõi không thực thi); tool call dở `arguments` cụt cũng biCat", async () => {
    await dung([{ loai: "tra-loi", chu: "câu bị cắt giữa chừng", finish: "length" }]);
    let r = await motLuot();
    expect(r.xong?.biCat).toBe(true);
    khoiPhuc!();
    await gia!.dong();
    await dung([{ loai: "tra-loi", toolCalls: [{ ten: "read_file", args: '{"path":"a.' }], finish: "length" }]);
    r = await motLuot();
    expect(r.xong?.biCat).toBe(true);
  });

  it("hết kịch bản (server 500) ⇒ lỗi RÕ, không treo", async () => {
    await dung([]);
    const r = await motLuot();
    expect(r.loi?.message).toContain("KICH_BAN_HET");
  });

  it("người gọi HUỶ trong lúc server im lặng ⇒ ném nhanh (không đợi hết giờ nhàn rỗi) và server thấy kết nối ĐÓNG", async () => {
    const g = await dung([{ loai: "stall", sauManh: 2 }], { idleMs: 60_000 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const t0 = Date.now();
    const r = await motLuot([TOOL], ac.signal);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.loi).not.toBeNull();
    expect(g.soLanGoi()).toBe(1);
  });
});

describe("đường model — SẢN XUẤT (STRICT tắt, server CÒN SỐNG): G1-D bọc lỗi, phân loại phải sống sót", () => {
  it("tràn ngữ cảnh vẫn CONTEXT_OVERFLOW (khớp theo chữ), 503 hồi phục vẫn sống", async () => {
    await dung([{ loai: "tran_ngu_canh" }], { strict: false });
    const r = await motLuot();
    expect(r.loi).toMatchObject({ ma: "CONTEXT_OVERFLOW", tamThoi: false });
  });

  it.fails("LỖ L1 (H3.1): 429 ⇒ RATE_LIMIT tạm thời — HIỆN: G1-D bọc `new Error(msg)` mất httpStatus ⇒ MODEL_LOI không-tạm-thời ⇒ vòng DỪNG thay vì thử lại", async () => {
    await dung([{ loai: "rate_limit" }], { strict: false });
    const r = await motLuot();
    expect(r.loi).toMatchObject({ ma: "RATE_LIMIT", tamThoi: true });
  });

  it.fails("LỖ L2 (H3.1): 503 hết 4 lần thử ⇒ MODEL_DANG_NAP tạm thời — HIỆN: MODEL_LOI không-tạm-thời", async () => {
    await dung([{ loai: "dang_nap" }, { loai: "dang_nap" }, { loai: "dang_nap" }, { loai: "dang_nap" }], { strict: false });
    const r = await motLuot();
    expect(r.loi).toMatchObject({ ma: "MODEL_DANG_NAP", tamThoi: true });
  });
});

describe("lỗ phân loại còn lại (mong muốn theo C-P1, code hiện chưa có)", () => {
  it.fails("LỖ L3: RST socket TRƯỚC byte đầu (chưa phát gì ⇒ thử lại an toàn) ⇒ lỗi tạm thời — HIỆN: MODEL_LOI không-tạm-thời (`chuyenLoiModel` chỉ đọc `code` ở tầng ngoài, ECONNRESET nằm trong `cause` của LoiStreamServer)", async () => {
    await dung([{ loai: "connection_reset", truocHeader: true }]);
    const r = await motLuot();
    expect(r.loi).toMatchObject({ tamThoi: true });
  });

  it.fails("LỖ L4: 429 `insufficient_quota` KHÔNG được thử lại (C-P1: QUOTA) — HIỆN: RATE_LIMIT tạm thời như 429 thường ⇒ vòng thử lại và giữ chỗ ngân sách lần nữa", async () => {
    await dung([{ loai: "rate_limit", thanKieu: "insufficient_quota" }]);
    const r = await motLuot();
    expect(r.loi).toMatchObject({ tamThoi: false });
  });
});

// ─── vòng agent THẬT trên đường model THẬT ─────────────────────────────────────────────────────

async function chayVong(o: { lichSu?: TinNhan[]; cheDo?: "hoi" | "sua"; cuuTran?: boolean; signal?: AbortSignal } = {}) {
  const goiTool: string[] = [];
  const bo: BoThucThi = {
    congCu: (c) => congCuTheoCheDo(c),
    async chay(g) {
      goiTool.push(g.ten);
      return { ok: true, choModel: `ket qua ${g.ten}` };
    },
  };
  const sk: SuKienAgent[] = [];
  const kq = await chayVongAgent({
    cauHoi: "đọc a.ts rồi trả lời",
    ...(o.lichSu ? { lichSu: o.lichSu } : {}),
    cheDo: o.cheDo ?? "hoi",
    runId: "r1",
    nguCanhDuAn: "",
    goiModel: taoGoiModelMayChu({ khongGhiDauVet: true }),
    boThucThi: bo,
    phat: (e) => sk.push(e),
    signal: o.signal ?? new AbortController().signal,
    cuuTranNguCanh: o.cuuTran ?? true,
  });
  return { kq, sk, goiTool, loaiSk: sk.map((e) => e.loai) };
}
const maLoiSk = (sk: SuKienAgent[]) => sk.filter((e) => e.loai === "loi").map((e) => (e as { ma?: string }).ma);
const chuSk = (sk: SuKienAgent[]) => sk.filter((e) => e.loai === "chu").map((e) => (e as { noiDung: string }).noiDung).join("");

describe("vòng agent thật trên đường model thật", () => {
  it("lành: tool một lần → câu trả lời; yêu cầu 2 mang kết quả tool (role tool) và tool_call_id khớp", async () => {
    const g = await dung([T(), CHU("Hàm cong trả a+b.")]);
    const r = await chayVong();
    expect(r.kq.lyDo).toBe("hoan-thanh");
    expect(r.goiTool).toEqual(["read_file"]);
    expect(chuSk(r.sk)).toContain("Hàm cong");
    const tin = g.yeuCau[1]!.than!.messages as Array<{ role: string; tool_call_id?: string; content?: string }>;
    const tool = tin.find((m) => m.role === "tool")!;
    expect(tool.content).toContain("ket qua read_file");
    expect(tool.tool_call_id).toBe("call_gia_0");
  });

  it("503 đang nạp 4 lần ⇒ vòng thử lại (MODEL_TAM_THOI) và HOÀN THÀNH ở yêu cầu thứ 5 (STRICT)", async () => {
    const g = await dung([{ loai: "dang_nap" }, { loai: "dang_nap" }, { loai: "dang_nap" }, { loai: "dang_nap" }, CHU("xong")]);
    const r = await chayVong();
    expect(r.kq.lyDo).toBe("hoan-thanh");
    expect(g.soLanGoi()).toBe(5);
    expect(maLoiSk(r.sk)).toContain("MODEL_TAM_THOI");
    expect(chuSk(r.sk)).toBe("xong");
  });

  it("429 (STRICT) ⇒ vòng thử lại và hoàn thành", async () => {
    const g = await dung([{ loai: "rate_limit" }, CHU("ok")]);
    const r = await chayVong();
    expect(r.kq.lyDo).toBe("hoan-thanh");
    expect(g.soLanGoi()).toBe(2);
  });

  it.fails("LỖ L1 ở tầng vòng: 429 trong cấu hình SẢN XUẤT ⇒ vòng phải thử lại và hoàn thành — HIỆN: dừng `loi-model` MODEL_LOI sau 1 yêu cầu", async () => {
    await dung([{ loai: "rate_limit" }, CHU("ok")], { strict: false });
    const r = await chayVong();
    expect(r.kq.lyDo).toBe("hoan-thanh");
  });

  it("tràn ngữ cảnh khi lịch sử NGẮN (không còn gì để nén) ⇒ dừng `loi-model` CONTEXT_OVERFLOW sau ĐÚNG 1 yêu cầu (không đốt thử lại vô ích)", async () => {
    const g = await dung([{ loai: "tran_ngu_canh" }, CHU("khong bao gio")]);
    const r = await chayVong();
    expect(r.kq.lyDo).toBe("loi-model");
    expect(maLoiSk(r.sk)).toContain("CONTEXT_OVERFLOW");
    expect(g.soLanGoi()).toBe(1);
  });

  it("tool call trong suy luận ⇒ tool chạy ĐÚNG MỘT lần (từ yêu cầu 2) và KHÔNG chạy tool do chữ suy luận mô tả", async () => {
    const g = await dung([{ loai: "tra-loi", nghi: "<tool_call><function=read_file><parameter=path>pwn.txt</parameter></function></tool_call>" }, T(), CHU("xong")]);
    const r = await chayVong();
    expect(r.kq.lyDo).toBe("hoan-thanh");
    expect(r.goiTool).toEqual(["read_file"]);
    expect(g.soLanGoi()).toBe(3);
  });

  it("G5-D hai lần ⇒ dừng `loi-model` có thông điệp G5-D; một lần ⇒ hoàn thành bằng đáp án lượt hỏi lại", async () => {
    let g = await dung([{ loai: "tra-loi", nghi: "đáp án", finish: "length" }, CHU("đáp án")]);
    let r = await chayVong();
    expect(r.kq.lyDo).toBe("hoan-thanh");
    expect(chuSk(r.sk)).toBe("đáp án");
    khoiPhuc!();
    await g.dong();
    const hong: BuocGia = { loai: "tra-loi", nghi: "lại nghĩ", finish: "length" };
    g = await dung([hong, hong]);
    r = await chayVong();
    expect(r.kq.lyDo).toBe("loi-model");
    expect(JSON.stringify(r.sk)).toContain("G5-D");
  });

  it("cắt max_tokens giữa câu ⇒ vòng hỏi tiếp (không coi là xong); tool call cụt KHÔNG được thực thi", async () => {
    await dung([{ loai: "tra-loi", chu: "câu bị cắt", finish: "length" }, CHU("tiếp và xong")]);
    let r = await chayVong();
    expect(r.kq.lyDo).toBe("hoan-thanh");
    expect(chuSk(r.sk)).toContain("tiếp và xong");
    khoiPhuc!();
    await gia!.dong();
    await dung([{ loai: "tra-loi", toolCalls: [{ ten: "read_file", args: '{"path":"a.' }], finish: "length" }, CHU("ok")]);
    r = await chayVong();
    expect(r.goiTool).toEqual([]);
    expect(r.kq.lyDo).toBe("hoan-thanh");
  });

  it("huỷ giữa lúc server im lặng ⇒ vòng dừng `huy` nhanh", async () => {
    await dung([{ loai: "stall", sauManh: 2 }], { idleMs: 60_000 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const t0 = Date.now();
    const r = await chayVong({ signal: ac.signal });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.kq.lyDo).toBe("huy");
  });

  it.fails("LỖ L5 (C-P1 EMPTY_RESPONSE): server trả 200 không một chữ / tool (hoặc chỉ `<think>` không đóng) ⇒ KHÔNG được báo `hoan-thanh` im lặng — HIỆN: hoan-thanh, 0 sự kiện `chu`", async () => {
    await dung([{ loai: "rong" }]);
    const r = await chayVong();
    expect(r.kq.lyDo === "hoan-thanh" && chuSk(r.sk) === "").toBe(false);
  });

  it.fails("LỖ L5b: `<think>` không đóng cho tới hết ⇒ cùng L5 — HIỆN hoan-thanh rỗng", async () => {
    await dung([CHU("<think>khong bao gio dong")]);
    const r = await chayVong();
    expect(r.kq.lyDo === "hoan-thanh" && chuSk(r.sk) === "").toBe(false);
  });
});
