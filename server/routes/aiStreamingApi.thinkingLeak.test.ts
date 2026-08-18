/**
 * ★★★ RÒ CHUỖI SUY LUẬN RA TRÌNH DUYỆT QUA SSE — `server/routes/aiStreamingApi.ts` (G5-C).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỖ ĐÃ ĐO ĐƯỢC TRÊN MÃ TRƯỚC BẢN VÁ — KHÔNG PHẢI GIẢ THUYẾT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * G5-B **dựng** `StreamingThinkingStripper` nhưng **chưa nối** vào ống SSE, và tự khai điều đó:
 * *"hiện nó là NĂNG LỰC ĐÃ CÓ LƯỚI, chưa phải hàng rào đang sống"*. Ba tuyến `/api/ai/stream/*`
 * đẩy nguyên văn `<think>…</think>` của model tới `useAIStream` ⇒ người vận hành đọc được nội tâm
 * model giữa câu trả lời.
 *
 * Lưới này song sinh với `aiStreamingApi.secretLeak.test.ts` — CÙNG hạ tầng, CÙNG ba tuyến, để
 * hai mối nguy được canh bằng một khuôn, không hai khuôn trôi khỏi nhau.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ HAI Ô, KHÔNG PHẢI MỘT (đúng bài học của lưới bí mật)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. ô `token` — chuỗi mảnh; thẻ bị **chẻ đôi qua hai sự kiện SSE** ⇒ cần bộ cắt GIỮ TRẠNG THÁI.
 *   2. ô `fullText` của chunk `done` — `client/src/hooks/useAIStream.ts:94` đọc
 *      `chunk.fullText ?? fullText`, tức chữ NGƯỜI DÙNG THẤY lấy từ ô này. Cắt token mà bỏ
 *      `fullText` = **cắt xong rồi tự dán lại**.
 *
 * ⚠ §5 THỨ TỰ: cắt thẻ TRƯỚC, che bí mật SAU — xem lý do đầy đủ ở
 *   `server/services/aiLocalKnowledge.thinkingLeak.test.ts` §5 (cắt thẻ là phép XOÁ nên nó NỐI
 *   hai nửa một bí mật vốn bị khối `<think>` tách rời ⇒ bộ canh nội dung phải đứng CUỐI).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  luong: {
    generate: null as null | (() => AsyncGenerator<unknown>),
    chat: null as null | (() => AsyncGenerator<unknown>),
    narrative: null as null | (() => AsyncGenerator<unknown>),
  },
}));

vi.mock("./_xacThucRest", () => ({
  thuXacThucRest: async () => ({ ok: true, user: { id: 1, email: "t@t.vn" } }),
  thanTuChoiRest: () => ({ error: "Unauthorized", code: "AUTH_REQUIRED" }),
}));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: async () => true,
  generateTextStream: () => h.luong.generate!(),
  chatCompletionStream: () => h.luong.chat!(),
}));

vi.mock("../services/aiProviderRouter", () => ({
  generateNarrativeStream: () => h.luong.narrative!(),
}));

import { registerAiStreamingRoutes } from "./aiStreamingApi";

const NOI_TAM = "Người dùng hỏi về lô 7. Ta chưa có số liệu, cứ đoán 98% cho chắc.";
const CAU_TRA_LOI = "Tỉ lệ ĐẠT của lô 7 là 96,4% theo báo cáo ca sáng.";

let may: Server;
let goc: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerAiStreamingRoutes(app);
  may = createServer(app);
  await new Promise<void>((r) => may.listen(0, "127.0.0.1", r));
  goc = `http://127.0.0.1:${(may.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => may.close(() => r()));
});

const ENV_KEYS = ["AI_THINKING_TAGS", "AI_THINKING_STARTS_OPEN"] as const;

beforeEach(() => {
  h.luong.generate = null;
  h.luong.chat = null;
  h.luong.narrative = null;
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

interface KetQuaSSE {
  tho: string;
  suKien: Array<Record<string, unknown>>;
  /** Chữ người dùng THẤY = nối mọi ô `token` (giống `useAIStream`). */
  chuNoiLai: string;
  status: number;
}

async function goiSSE(duong: string, than: unknown): Promise<KetQuaSSE> {
  const res = await fetch(`${goc}${duong}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(than),
  });
  const tho = await res.text();
  const suKien: Array<Record<string, unknown>> = [];
  for (const dong of tho.split("\n")) {
    if (!dong.startsWith("data: ")) continue;
    const d = dong.slice(6).trim();
    if (d === "[DONE]" || !d) continue;
    try {
      suKien.push(JSON.parse(d));
    } catch {
      /* giữ trong `tho` */
    }
  }
  const chuNoiLai = suKien
    .filter((s) => s.type === "token")
    .map((s) => String(s.token ?? ""))
    .join("");
  return { tho, suKien, chuNoiLai, status: res.status };
}

const TUYEN = [
  {
    ten: "generate",
    duong: "/api/ai/stream/generate",
    than: { prompt: "chào" },
    dat: (g: () => AsyncGenerator<unknown>) => {
      h.luong.generate = g;
    },
  },
  {
    ten: "chat",
    duong: "/api/ai/stream/chat",
    than: { messages: [{ role: "user", content: "chào" }] },
    dat: (g: () => AsyncGenerator<unknown>) => {
      h.luong.chat = g;
    },
  },
  {
    ten: "narrative",
    duong: "/api/ai/stream/narrative",
    than: { prompt: "chào" },
    dat: (g: () => AsyncGenerator<unknown>) => {
      h.luong.narrative = g;
    },
  },
] as const;

function luongTuManh(manh: string[], fullText?: string) {
  return async function* () {
    for (const m of manh) yield { type: "token", token: m };
    yield {
      type: "done",
      fullText: fullText ?? manh.join(""),
      tokensGenerated: manh.length,
      totalTimeMs: 1,
      modelId: "test-model",
    };
  };
}

/** Không một dấu vết nào của khối suy luận được ra khỏi máy chủ — soi cả THÂN BYTE THÔ. */
function khongConSuyLuan(kq: KetQuaSSE): void {
  expect(kq.tho).not.toContain(NOI_TAM);
  expect(kq.tho).not.toContain("cứ đoán 98%");
  expect(kq.tho).not.toContain("<think>");
  expect(kq.tho).not.toContain("</think>");
  expect(kq.chuNoiLai).not.toContain(NOI_TAM);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — khối <think> trong ô `token`", () => {
  for (const t of TUYEN) {
    it(`${t.ten}: khối gọn trong MỘT chunk không ra trình duyệt`, async () => {
      t.dat(luongTuManh([`<think>${NOI_TAM}</think>`, CAU_TRA_LOI]));
      const kq = await goiSSE(t.duong, t.than);
      expect(kq.status).toBe(200);
      khongConSuyLuan(kq);
      expect(kq.chuNoiLai).toContain("96,4%");
    });

    it(`${t.ten}: ★ thẻ CHẺ ĐÔI qua hai sự kiện SSE — phép cắt một-lượt MÙ ca này`, async () => {
      t.dat(luongTuManh(["Trả lời: <thi", "nk>", NOI_TAM, "</th", "ink>", CAU_TRA_LOI]));
      const kq = await goiSSE(t.duong, t.than);
      khongConSuyLuan(kq);
      expect(kq.chuNoiLai).toContain("Trả lời: ");
      expect(kq.chuNoiLai).toContain("96,4%");
    });

    it(`${t.ten}: ★ chẻ TỪNG KÝ TỰ MỘT`, async () => {
      const tho = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;
      t.dat(luongTuManh(tho.split("")));
      const kq = await goiSSE(t.duong, t.than);
      khongConSuyLuan(kq);
      expect(kq.chuNoiLai).toContain("96,4%");
    });

    it(`${t.ten}: thẻ mở KHÔNG BAO GIỜ đóng ⇒ không xả ra lúc kết thúc luồng`, async () => {
      t.dat(luongTuManh([CAU_TRA_LOI, "<think>", NOI_TAM]));
      const kq = await goiSSE(t.duong, t.than);
      khongConSuyLuan(kq);
      expect(kq.chuNoiLai).toContain("96,4%");
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — ô `fullText` của chunk `done` (đường HOÀN TÁC lượt cắt ở §1)", () => {
  for (const t of TUYEN) {
    it(`${t.ten}: fullText nguyên văn KHÔNG được ra — client đọc chính ô này`, async () => {
      const tho = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;
      t.dat(luongTuManh([`<think>${NOI_TAM}</think>`, CAU_TRA_LOI], tho));
      const kq = await goiSSE(t.duong, t.than);
      const done = kq.suKien.find((s) => s.type === "done");
      expect(done).toBeTruthy();
      expect(String(done!.fullText ?? "")).not.toContain(NOI_TAM);
      expect(String(done!.fullText ?? "")).toContain("96,4%");
      khongConSuyLuan(kq);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — chat template MỞ SẴN khối suy luận (startInsideThinking)", () => {
  for (const t of TUYEN) {
    it(`${t.ten}: ★ đầu ra bắt đầu NGAY TRONG khối, thẻ đầu tiên là thẻ ĐÓNG`, async () => {
      process.env.AI_THINKING_STARTS_OPEN = "1";
      t.dat(luongTuManh([NOI_TAM, "</think>", CAU_TRA_LOI]));
      const kq = await goiSSE(t.duong, t.than);
      khongConSuyLuan(kq);
      expect(kq.chuNoiLai).toContain("96,4%");
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — tập thẻ khai báo được (AI_THINKING_TAGS) có hiệu lực trên tuyến sống", () => {
  it("generate: <phan_tich_noi_bo> khai trong env bị cắt", async () => {
    process.env.AI_THINKING_TAGS = "phan_tich_noi_bo";
    h.luong.generate = luongTuManh(["<phan_tich_noi_bo>", NOI_TAM, "</phan_tich_noi_bo>", CAU_TRA_LOI]);
    const kq = await goiSSE("/api/ai/stream/generate", { prompt: "chào" });
    expect(kq.tho).not.toContain(NOI_TAM);
    expect(kq.tho).not.toContain("phan_tich_noi_bo");
    expect(kq.chuNoiLai).toContain("96,4%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — TỔ HỢP: bí mật bị khối <think> chẻ đôi (ca PHÂN BIỆT thứ tự hai bộ lọc)", () => {
  const NUA_DAU = "sk-ABCDEFGH";
  const NUA_SAU = "IJKLMNOPQRSTUVWX";
  const KHOA_NOI = NUA_DAU + NUA_SAU;

  for (const t of TUYEN) {
    it(`${t.ten}: ★ cắt thẻ TRƯỚC ⇒ bộ che thấy khoá HOÀN CHỈNH (đảo thứ tự ⇒ ca này ĐỎ)`, async () => {
      t.dat(luongTuManh(["Khoá: ", NUA_DAU, `<think>${NOI_TAM}</think>`, NUA_SAU, " — hết."]));
      const kq = await goiSSE(t.duong, t.than);
      khongConSuyLuan(kq);
      expect(kq.tho).not.toContain(KHOA_NOI);
      expect(kq.tho).toContain("[REDACTED_SECRET]");
      expect(kq.chuNoiLai).toContain("Khoá: ");
      expect(kq.chuNoiLai).toContain("hết.");
    });
  }

  it("generate: ca trên + chẻ TỪNG KÝ TỰ (thẻ và bí mật cùng bị chẻ, chồng lên nhau)", async () => {
    const tho = `Khoá: ${NUA_DAU}<think>${NOI_TAM}</think>${NUA_SAU} — hết.`;
    h.luong.generate = luongTuManh(tho.split(""), tho);
    const kq = await goiSSE("/api/ai/stream/generate", { prompt: "chào" });
    khongConSuyLuan(kq);
    expect(kq.tho).not.toContain(KHOA_NOI);
    expect(kq.tho).toContain("[REDACTED_SECRET]");
  });

  it("generate: bí mật nằm TRỌN trong khối suy luận ⇒ biến mất cùng khối", async () => {
    const BI_MAT = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    h.luong.generate = luongTuManh([`<think>Khoá thật là ${BI_MAT}.</think>`, CAU_TRA_LOI]);
    const kq = await goiSSE("/api/ai/stream/generate", { prompt: "chào" });
    expect(kq.tho).not.toContain(BI_MAT);
    expect(kq.tho).not.toContain("Khoá thật là");
    expect(kq.chuNoiLai.trim()).toBe(CAU_TRA_LOI);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — KHÔNG NUỐT KÝ TỰ · ĐỘ MƯỢT (chuẩn ngang bộ che bí mật)", () => {
  const HOLD = 32; // STREAM_NORMAL_TAIL_HOLD của bộ che — trần độ trễ của cả CHUỖI hai bộ lọc

  for (const t of TUYEN) {
    it(`${t.ten}: chữ sạch ra ĐỦ TỪNG KÝ TỰ (chẻ 1 byte/mảnh), kể cả đuôi trong bộ đệm`, async () => {
      const cau = "Kết quả kiểm tra tấm số 7: ĐẠT, 0 lỗi. Máy sẵn sàng chạy lô kế tiếp.";
      t.dat(luongTuManh(cau.split("")));
      const kq = await goiSSE(t.duong, t.than);
      expect(kq.chuNoiLai).toBe(cau);

      // Phần giữ phải ra TRƯỚC chunk `done` — client coi `done` là dấu chấm hết.
      const iDone = kq.suKien.findIndex((s) => s.type === "done");
      const iTokenCuoi = kq.suKien.map((s) => s.type).lastIndexOf("token");
      expect(iDone).toBeGreaterThanOrEqual(0);
      expect(iTokenCuoi).toBeLessThan(iDone);
    });

    it(`${t.ten}: dấu "<" bình thường KHÔNG bị giữ lại vô cớ`, async () => {
      const cau = "Ngưỡng: a < b, tỉ lệ < 0.5% và 3<4 thì máy vẫn ĐẠT.";
      t.dat(luongTuManh(cau.match(/[\s\S]{1,3}/g) ?? []));
      const kq = await goiSSE(t.duong, t.than);
      expect(kq.chuNoiLai).toBe(cau);
    });

    it(`${t.ten}: luồng đứt KHÔNG có chunk 'done' — phần giữ vẫn phải xả ra`, async () => {
      const cau = "Câu trả lời ngắn không có done.";
      t.dat(async function* () {
        for (const m of cau.match(/[\s\S]{1,4}/g) ?? []) yield { type: "token", token: m };
      });
      const kq = await goiSSE(t.duong, t.than);
      expect(kq.chuNoiLai).toBe(cau);
    });

    it(`${t.ten}: 100 mảnh vào ⇒ chữ chảy liên tục, KHÔNG gom thành khối`, async () => {
      const manh = Array.from({ length: 100 }, (_, i) => `m${String(i).padStart(3, "0")} `);
      t.dat(luongTuManh(manh));
      const kq = await goiSSE(t.duong, t.than);

      const suKienToken = kq.suKien.filter((s) => s.type === "token");
      expect(suKienToken.length).toBeGreaterThanOrEqual(90);
      const daiNhat = Math.max(...suKienToken.map((s) => String(s.token ?? "").length));
      expect(daiNhat).toBeLessThanOrEqual(HOLD + 5);
      expect(kq.chuNoiLai).toBe(manh.join(""));
    });
  }

  it("chi phí thời gian: 2.000 mảnh chữ sạch qua CẢ HAI bộ lọc dưới 1 giây", async () => {
    const manh = Array.from({ length: 2000 }, (_, i) => `tok${i} `);
    h.luong.generate = luongTuManh(manh);
    const t0 = Date.now();
    const kq = await goiSSE("/api/ai/stream/generate", { prompt: "chào" });
    const ms = Date.now() - t0;
    expect(kq.chuNoiLai).toBe(manh.join(""));
    expect(ms).toBeLessThan(1000);
  });
});
