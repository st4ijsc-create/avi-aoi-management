/**
 * ★★★ RÒ BÍ MẬT RA TRÌNH DUYỆT QUA SSE — `server/routes/aiStreamingApi.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ MỐI NGUY CÓ THẬT, ĐO ĐƯỢC — KHÔNG PHẢI GIẢ THUYẾT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba tuyến SSE của file này ghi thẳng `JSON.stringify(chunk)` do model sinh ra ra trình duyệt.
 * Mọi consumer streaming KHÁC của repo đã có `StreamingSecretRedactor` (`aiLocalKnowledgeService`
 * ops-chat · `aiProviderRouter.generateNarrativeStream` · `openaiGateway` /v1) — ba tuyến này là
 * **ngoại lệ duy nhất**, và nay chúng mang chữ từ model 30B qua `llama-server`.
 *
 * VÌ SAO PHẢI CHE **XUYÊN CHUNK**, KHÔNG CHỈ CHE TỪNG CHUNK: một khoá `sk-…` bị chẻ đôi qua hai
 * sự kiện SSE (hai mảnh TCP) thì mỗi nửa trông vô hại; lọc từng chunk độc lập **không bắt được**.
 * `StreamingSecretRedactor` sinh ra để giữ trạng thái qua ranh giới chunk — xem
 * `aiLlamaServerClient.stream.test.ts` §"che bí mật XUYÊN MẢNH TCP".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN ĐƯỜNG RÒ ĐƯỢC CANH (đọc mã, không đọc brief) — cả bốn đều ĐI TỚI TRÌNH DUYỆT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. ô `token` của chunk `{type:"token"}` — đường chính, và là đường DUY NHẤT bị chẻ qua chunk.
 *  2. ô `fullText` của chunk `{type:"done"}` — ⚠ đường này **hoàn tác** cả lượt che ở (1):
 *     `useAIStream.ts:94` đọc `chunk.fullText ?? fullText`, nghĩa là chữ cuối cùng hiển thị cho
 *     người dùng lấy từ `fullText` NGUYÊN VĂN chứ không phải từ chuỗi token đã che.
 *  3. ô `error` của chunk `{type:"error"}` do engine sinh (chuỗi kết nối, đường dẫn, khoá).
 *  4. `err.message` ở khối `catch` — cả nhánh SSE (`res.write`) lẫn nhánh `res.status(500).json`.
 *     Đây là chỗ dễ bỏ sót nhất vì nó "chỉ là thông báo lỗi".
 *
 * ⚠ §5 là lưới **LƯỢNG TỪ trên MÃ NGUỒN** (AST, không phải văn bản): *∀ lượt ghi nội dung động ra
 *   `res` trong file này đều đi qua MỘT chủ duy nhất có che*. Thêm tuyến thứ tư mà quên che ⇒ ĐỎ.
 *   Repo này đã dính lớp lỗi "lưới liệt kê tay bỏ sót phần tử N+1" **17 lần** — một lưới liệt kê
 *   ba tuyến sẽ mù đúng vào tuyến thứ tư.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// ─── Bộ điều khiển luồng giả (mock) ────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  luong: {
    generate: null as null | (() => AsyncGenerator<unknown>),
    chat: null as null | (() => AsyncGenerator<unknown>),
    narrative: null as null | (() => AsyncGenerator<unknown>),
  },
  ggufNem: null as null | (() => never),
}));

vi.mock("./_xacThucRest", () => ({
  thuXacThucRest: async () => ({ ok: true, user: { id: 1, email: "t@t.vn" } }),
  thanTuChoiRest: () => ({ error: "Unauthorized", code: "AUTH_REQUIRED" }),
}));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: async () => {
    if (h.ggufNem) h.ggufNem();
    return true;
  },
  generateTextStream: () => h.luong.generate!(),
  chatCompletionStream: () => h.luong.chat!(),
}));

vi.mock("../services/aiProviderRouter", () => ({
  generateNarrativeStream: () => h.luong.narrative!(),
}));

import { registerAiStreamingRoutes } from "./aiStreamingApi";

// ─── Hạ tầng ────────────────────────────────────────────────────────────────────────────────

const BI_MAT = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; // 39 ký tự, khớp mẫu `api_key`
const CHUOI_KET_NOI = "postgres://aoi:sieu-mat-khau@10.0.0.7:5434/aoi_management";
const KHOA_PEM =
  "-----BEGIN RSA PRIVATE KEY-----\n" +
  "MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL\n" +
  "MNOPQRSTUVWXYZ0987654321zyxwvutsrqponmlkjihgfedcba1234567890abcd\n" +
  "-----END RSA PRIVATE KEY-----";

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

beforeEach(() => {
  h.luong.generate = null;
  h.luong.chat = null;
  h.luong.narrative = null;
  h.ggufNem = null;
});

interface KetQuaSSE {
  /** Toàn bộ byte thân phản hồi — ĐÚNG cái trình duyệt nhận được. */
  tho: string;
  /** Các chunk JSON đã tách khỏi khung `data: …`. */
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
      /* mảnh hỏng — giữ nguyên trong `tho` để khẳng định vẫn soi được */
    }
  }
  const chuNoiLai = suKien
    .filter((s) => s.type === "token")
    .map((s) => String(s.token ?? ""))
    .join("");
  return { tho, suKien, chuNoiLai, status: res.status };
}

/** Ba tuyến — cùng một bảng, để mọi ca đều chạy trên CẢ BA (không viết tay ba lần). */
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

/** Sinh một generator phát đúng các mảnh chữ đã cho rồi đóng bằng chunk `done`. */
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

/** Chẻ một chuỗi tại vị trí `i` — nửa đầu ở sự kiện SSE này, nửa sau ở sự kiện kế. */
function cheDoi(chuoi: string, i: number): string[] {
  return ["Khoá của bạn là ", chuoi.slice(0, i), chuoi.slice(i), " — giữ kín nhé."];
}

/** Khẳng định: không một mảnh dài nào của bí mật lọt ra, và chữ lành lặn vẫn còn. */
function khongLotRa(kq: KetQuaSSE, biMat: string): void {
  expect(kq.tho).not.toContain(biMat);
  expect(kq.chuNoiLai).not.toContain(biMat);
  // Không chỉ "thiếu nguyên văn" — cấm cả MẢNH DÀI (chống ca vá kiểu cắt một ký tự).
  const dai = Math.min(20, biMat.length - 1);
  expect(kq.tho).not.toContain(biMat.slice(0, dai));
  expect(kq.tho).not.toContain(biMat.slice(-dai));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — bí mật CHẺ ĐÔI qua hai sự kiện SSE (mối nguy XUYÊN CHUNK)", () => {
  // Chẻ ở NHIỀU vị trí byte, không chỉ một điểm may mắn: đầu tiền tố, giữa tiền tố, ngay sau
  // tiền tố, giữa thân, và sát ký tự cuối.
  const VI_TRI = [1, 2, 3, 4, 12, 20, 30, BI_MAT.length - 1];

  for (const t of TUYEN) {
    for (const i of VI_TRI) {
      it(`${t.ten}: chẻ tại byte ${i} — bí mật KHÔNG ra được trình duyệt`, async () => {
        t.dat(luongTuManh(cheDoi(BI_MAT, i)));
        const kq = await goiSSE(t.duong, t.than);
        expect(kq.status).toBe(200);
        khongLotRa(kq, BI_MAT);
        expect(kq.tho).toContain("[REDACTED_SECRET]");
        // Bộ che KHÔNG được ăn mất câu trả lời lành lặn.
        expect(kq.chuNoiLai).toContain("Khoá của bạn là ");
        expect(kq.chuNoiLai).toContain("giữ kín nhé.");
      });
    }

    it(`${t.ten}: chẻ TỪNG KÝ TỰ MỘT (mảnh 1 byte) — trường hợp khắc nghiệt nhất`, async () => {
      const manh = ["Khoá: ", ...BI_MAT.split(""), " xong."];
      t.dat(luongTuManh(manh));
      const kq = await goiSSE(t.duong, t.than);
      khongLotRa(kq, BI_MAT);
      expect(kq.tho).toContain("[REDACTED_SECRET]");
      expect(kq.chuNoiLai).toContain("xong.");
    });

    it(`${t.ten}: bí mật DÀI (khoá PEM) trải nhiều chunk hơn cửa sổ giữ 32 ký tự`, async () => {
      // Mẫu cửa sổ CỐ ĐỊNH sẽ thua ca này: dấu mở `-----BEGIN` trôi khỏi cửa sổ trước khi
      // `-----END` tới. Chỉ bộ che GIỮ TRẠNG THÁI mới bắt được.
      const manh = KHOA_PEM.match(/[\s\S]{1,7}/g) ?? [];
      t.dat(luongTuManh(["Đây là khoá:\n", ...manh, "\nhết."]));
      const kq = await goiSSE(t.duong, t.than);
      expect(kq.tho).not.toContain("MIIEpAIBAAKCAQEA");
      expect(kq.tho).not.toContain("-----BEGIN RSA PRIVATE KEY-----");
      expect(kq.tho).toContain("[REDACTED_SECRET]");
    });

    it(`${t.ten}: chuỗi kết nối có mật khẩu, chẻ ngay giữa mật khẩu`, async () => {
      const i = CHUOI_KET_NOI.indexOf("sieu-mat-khau") + 4;
      t.dat(luongTuManh(cheDoi(CHUOI_KET_NOI, i)));
      const kq = await goiSSE(t.duong, t.than);
      expect(kq.tho).not.toContain("sieu-mat-khau");
      expect(kq.tho).toContain("[REDACTED_SECRET]");
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — ô `fullText` của chunk `done` (đường HOÀN TÁC lượt che ở §1)", () => {
  for (const t of TUYEN) {
    it(`${t.ten}: fullText nguyên văn KHÔNG được ra — client đọc chính ô này`, async () => {
      // Token đã che rồi, nhưng `useAIStream` lấy `chunk.fullText ?? fullText` làm kết quả
      // cuối ⇒ nếu `fullText` không che thì lượt che ở §1 vô nghĩa.
      t.dat(luongTuManh(cheDoi(BI_MAT, 12), `Khoá của bạn là ${BI_MAT} — giữ kín nhé.`));
      const kq = await goiSSE(t.duong, t.than);
      const done = kq.suKien.find((s) => s.type === "done");
      expect(done).toBeTruthy();
      expect(String(done!.fullText ?? "")).not.toContain(BI_MAT);
      khongLotRa(kq, BI_MAT);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — ĐƯỜNG LỖI (chỗ dễ bỏ sót nhất vì 'chỉ là thông báo lỗi')", () => {
  for (const t of TUYEN) {
    it(`${t.ten}: chunk {type:"error"} do engine sinh — chuỗi kết nối bị che`, async () => {
      t.dat(async function* () {
        yield { type: "token", token: "đang chạy…" };
        yield { type: "error", error: `ECONNREFUSED khi nối ${CHUOI_KET_NOI}` };
      });
      const kq = await goiSSE(t.duong, t.than);
      expect(kq.tho).not.toContain("sieu-mat-khau");
      expect(kq.tho).not.toContain(CHUOI_KET_NOI);
      expect(kq.tho).toContain("[REDACTED_SECRET]");
      expect(kq.tho).toContain("ECONNREFUSED"); // câu lỗi vẫn còn nghĩa
    });

    it(`${t.ten}: NÉM giữa chừng sau khi đã gửi header — err.message bị che`, async () => {
      t.dat(async function* () {
        yield { type: "token", token: "bắt đầu…" };
        throw new Error(`nạp cấu hình hỏng: ${BI_MAT}`);
      });
      const kq = await goiSSE(t.duong, t.than);
      const loi = kq.suKien.find((s) => s.type === "error");
      expect(loi, `phải có sự kiện error; thân=${kq.tho}`).toBeTruthy();
      expect(String(loi!.error ?? "")).not.toContain(BI_MAT);
      expect(String(loi!.error ?? "")).toContain("[REDACTED_SECRET]");
      khongLotRa(kq, BI_MAT);
    });
  }

  it("generate: NÉM TRƯỚC khi gửi header — thân JSON 500 cũng phải che", async () => {
    h.ggufNem = () => {
      throw new Error(`engine chết: ${CHUOI_KET_NOI}`);
    };
    const res = await fetch(`${goc}/api/ai/stream/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "chào" }),
    });
    expect(res.status).toBe(500);
    const tho = await res.text();
    expect(tho).not.toContain("sieu-mat-khau");
    expect(tho).toContain("[REDACTED_SECRET]");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — XẢ bộ đệm: bộ che KHÔNG được nuốt ký tự cuối câu trả lời", () => {
  for (const t of TUYEN) {
    it(`${t.ten}: chữ sạch ra ĐỦ TỪNG KÝ TỰ, kể cả đuôi nằm trong bộ đệm`, async () => {
      // `StreamingSecretRedactor` giữ lại 32 ký tự cuối để bắt bí mật chẻ đôi. Không gọi
      // `flush()` khi kết thúc ⇒ 32 ký tự cuối BIẾN MẤT. Câu dưới dài 41 ký tự nên đuôi chắc
      // chắn còn nằm trong bộ đệm khi luồng kết thúc.
      const cau = "Kết quả kiểm tra tấm số 7: ĐẠT, 0 lỗi.";
      const manh = cau.match(/[\s\S]{1,3}/g) ?? [];
      t.dat(luongTuManh(manh));
      const kq = await goiSSE(t.duong, t.than);
      expect(kq.chuNoiLai).toBe(cau);

      // ⚠ ĐÚNG THỨ TỰ, không chỉ đúng nội dung: phần giữ phải ra TRƯỚC chunk `done`. Client coi
      // `done` là dấu chấm hết (`useAIStream` gán `result` rồi thôi cập nhật `streamingText`) —
      // xả SAU `done` thì đuôi câu tới nơi mà không còn ai đọc.
      const iDone = kq.suKien.findIndex((s) => s.type === "done");
      const iTokenCuoi = kq.suKien.map((s) => s.type).lastIndexOf("token");
      expect(iDone).toBeGreaterThanOrEqual(0);
      expect(iTokenCuoi).toBeLessThan(iDone);
    });

    it(`${t.ten}: luồng đứt KHÔNG có chunk 'done' — phần giữ vẫn phải xả ra`, async () => {
      const cau = "Câu trả lời ngắn không có done.";
      t.dat(async function* () {
        for (const m of cau.match(/[\s\S]{1,4}/g) ?? []) yield { type: "token", token: m };
      });
      const kq = await goiSSE(t.duong, t.than);
      expect(kq.chuNoiLai).toBe(cau);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §5 — LƯỢNG TỪ TRÊN MÃ NGUỒN (AST). Đọc trên CÂY, không trên VĂN BẢN: một chú thích
//      `// đã che` KHÔNG được tính là bằng chứng (bài học I-2 của repo).
// ═══════════════════════════════════════════════════════════════════════════════════════════

const DUONG_FILE = fileURLToPath(new URL("./aiStreamingApi.ts", import.meta.url));
const MA_NGUON = readFileSync(DUONG_FILE, "utf8");

/** Chủ DUY NHẤT được phép ghi nội dung ĐỘNG ra `res` trong file này. */
const CHU_PHAT = "OngPhatSSE";
/** Chủ DUY NHẤT được phép chạm `.message` của một lỗi. */
const CHU_LOI = "chuoiLoiAn";

interface ViPham {
  readonly dong: number;
  readonly ma: string;
}

function cay(duong: string, ma: string): ts.SourceFile {
  return ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
}

function diKhap(n: ts.Node, f: (x: ts.Node) => void): void {
  f(n);
  n.forEachChild((c) => diKhap(c, f));
}

function trongLop(n: ts.Node, ten: string): boolean {
  for (let p: ts.Node | undefined = n; p; p = p.parent) {
    if (ts.isClassDeclaration(p) && p.name?.text === ten) return true;
  }
  return false;
}

function trongHam(n: ts.Node, ten: string): boolean {
  for (let p: ts.Node | undefined = n; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name?.text === ten) return true;
  }
  return false;
}

function viTri(sf: ts.SourceFile, n: ts.Node): ViPham {
  const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
  return { dong: line + 1, ma: n.getText(sf).slice(0, 120) };
}

/** Lượt ghi ra `res` (`res.write` / `this.res.write`). */
function laGhiRes(c: ts.CallExpression): boolean {
  const e = c.expression;
  if (!ts.isPropertyAccessExpression(e) || e.name.text !== "write") return false;
  const g = e.expression;
  if (ts.isIdentifier(g)) return g.text === "res";
  if (ts.isPropertyAccessExpression(g)) return g.name.text === "res";
  return false;
}

/** Đối số TĨNH = chuỗi hằng (`"data: [DONE]\n\n"`) — không mang nội dung do model sinh. */
function doiSoTinh(a: ts.Expression | undefined): boolean {
  return !!a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a));
}

/** ∀ lượt ghi ĐỘNG ra `res` phải nằm trong chủ phát. */
function quetGhiTho(duong: string, ma: string): { viPham: ViPham[]; soTrongChu: number } {
  const sf = cay(duong, ma);
  const viPham: ViPham[] = [];
  let soTrongChu = 0;
  diKhap(sf, (n) => {
    if (!ts.isCallExpression(n) || !laGhiRes(n)) return;
    if (trongLop(n, CHU_PHAT)) {
      soTrongChu++;
      return;
    }
    if (doiSoTinh(n.arguments[0])) return;
    viPham.push(viTri(sf, n));
  });
  return { viPham, soTrongChu };
}

/** ∀ tuyến mở SSE (`text/event-stream`) phải dựng một chủ phát. */
function quetTuyenThieuChu(duong: string, ma: string): { viPham: ViPham[]; soTuyen: number } {
  const sf = cay(duong, ma);
  const viPham: ViPham[] = [];
  let soTuyen = 0;
  diKhap(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const e = n.expression;
    if (!ts.isPropertyAccessExpression(e)) return;
    if (!["post", "get", "put", "all"].includes(e.name.text)) return;
    const than = n.arguments[n.arguments.length - 1];
    if (!than) return;
    let laSSE = false;
    let coChu = false;
    diKhap(than, (x) => {
      if (ts.isStringLiteral(x) && x.text.includes("text/event-stream")) laSSE = true;
      if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === CHU_PHAT) coChu = true;
    });
    if (!laSSE) return;
    soTuyen++;
    if (!coChu) viPham.push(viTri(sf, n));
  });
  return { viPham, soTuyen };
}

/** ∀ lượt chạm `.message` của lỗi phải nằm trong chủ lỗi. */
function quetMessageTho(duong: string, ma: string): ViPham[] {
  const sf = cay(duong, ma);
  const viPham: ViPham[] = [];
  diKhap(sf, (n) => {
    if (!ts.isPropertyAccessExpression(n) || n.name.text !== "message") return;
    if (trongHam(n, CHU_LOI)) return;
    viPham.push(viTri(sf, n));
  });
  return viPham;
}

/** Nguồn TỔNG HỢP: một tuyến SSE thứ tư viết đúng kiểu ba tuyến gốc — quên che. */
const NGUON_TUYEN_THU_TU = `
import type express from "express";
export function dangKy(app: express.Express) {
  app.post("/api/ai/stream/tuyen-thu-tu", async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    try {
      for await (const chunk of luong()) {
        res.write(\`data: \${JSON.stringify(chunk)}\\n\\n\`);
      }
      res.write("data: [DONE]\\n\\n");
      res.end();
    } catch (err: any) {
      res.write(\`data: \${JSON.stringify({ type: "error", error: err.message })}\\n\\n\`);
      res.end();
    }
  });
}
`;

describe("§5 — LƯỢNG TỪ: mọi lượt ghi nội dung do model sinh đều đi qua bộ che", () => {
  it("∀ lượt `res.write` ĐỘNG trong aiStreamingApi.ts nằm trong chủ phát duy nhất", () => {
    const { viPham, soTrongChu } = quetGhiTho(DUONG_FILE, MA_NGUON);
    expect(
      viPham,
      `Ghi THÔ ra trình duyệt (không qua ${CHU_PHAT}):\n` +
        viPham.map((v) => `  dòng ${v.dong}: ${v.ma}`).join("\n"),
    ).toEqual([]);
    // Chống lưới rỗng: chủ phát PHẢI thật sự có ghi (nếu không, ca trên xanh một cách tầm thường).
    expect(soTrongChu).toBeGreaterThanOrEqual(1);
  });

  it("∀ tuyến mở `text/event-stream` đều dựng một chủ phát", () => {
    const { viPham, soTuyen } = quetTuyenThieuChu(DUONG_FILE, MA_NGUON);
    expect(
      viPham,
      `Tuyến SSE KHÔNG dựng ${CHU_PHAT}:\n` + viPham.map((v) => `  dòng ${v.dong}: ${v.ma}`).join("\n"),
    ).toEqual([]);
    expect(soTuyen).toBe(3); // đếm được ba tuyến — lưới không quét vào chỗ trống
  });

  it("∀ lượt chạm `err.message` nằm trong chủ lỗi duy nhất", () => {
    const viPham = quetMessageTho(DUONG_FILE, MA_NGUON);
    expect(
      viPham,
      `\`.message\` THÔ ngoài ${CHU_LOI}:\n` + viPham.map((v) => `  dòng ${v.dong}: ${v.ma}`).join("\n"),
    ).toEqual([]);
  });

  it("CẦU CHÌ — lưới ĐỎ được: tuyến SSE thứ tư quên che bị cả ba phép quét bắt", () => {
    const d = "tong-hop.ts";
    expect(quetGhiTho(d, NGUON_TUYEN_THU_TU).viPham.length).toBeGreaterThanOrEqual(2);
    expect(quetTuyenThieuChu(d, NGUON_TUYEN_THU_TU).viPham.length).toBe(1);
    expect(quetMessageTho(d, NGUON_TUYEN_THU_TU).length).toBeGreaterThanOrEqual(1);
  });

  it("CẦU CHÌ — chú thích KHÔNG phải bằng chứng", () => {
    const nguon = NGUON_TUYEN_THU_TU.replace(
      "res.write(`data:",
      "// đã che bằng StreamingSecretRedactor rồi nhé\n        res.write(`data:",
    );
    expect(quetGhiTho("tong-hop-2.ts", nguon).viPham.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — ĐỘ MƯỢT: bộ che giữ trạng thái KHÔNG được biến streaming thành phát-theo-khối", () => {
  const HOLD = 32; // STREAM_NORMAL_TAIL_HOLD trong aiSafety.ts

  for (const t of TUYEN) {
    it(`${t.ten}: 100 mảnh vào ⇒ chữ chảy ra liên tục, độ trễ chặn bởi ${HOLD} ký tự`, async () => {
      const manh = Array.from({ length: 100 }, (_, i) => `m${String(i).padStart(3, "0")} `); // 5 ký tự/mảnh
      t.dat(luongTuManh(manh));
      const kq = await goiSSE(t.duong, t.than);

      const suKienToken = kq.suKien.filter((s) => s.type === "token");
      // Nếu bộ che giữ hết rồi mới nhả một cục, số sự kiện sẽ tụt về ~1.
      expect(suKienToken.length).toBeGreaterThanOrEqual(90);
      // Không mảnh nào bị phình thành "cục" — dấu hiệu của phát-theo-khối.
      const daiNhat = Math.max(...suKienToken.map((s) => String(s.token ?? "").length));
      expect(daiNhat).toBeLessThanOrEqual(HOLD + 5);
      // Chữ ra ĐỦ.
      expect(kq.chuNoiLai).toBe(manh.join(""));
    });
  }

  it("chi phí thời gian: 2.000 mảnh chữ sạch xử lý dưới 1 giây", async () => {
    const manh = Array.from({ length: 2000 }, (_, i) => `tok${i} `);
    h.luong.generate = luongTuManh(manh);
    const t0 = Date.now();
    const kq = await goiSSE("/api/ai/stream/generate", { prompt: "chào" });
    const ms = Date.now() - t0;
    expect(kq.chuNoiLai).toBe(manh.join(""));
    expect(ms).toBeLessThan(1000);
  });
});
