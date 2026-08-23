/**
 * ★★★ 2026-08-23 · MỤC 0.2 — **TUYẾN SSE `/api/ai/local-kb/stream` KHÔNG ĐƯỢC NUỐT SỰ KIỆN.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * SỰ VIỆC ĐO ĐƯỢC, KHÔNG PHẢI LO XA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Thanh tiến độ *"vòng đọc mã"* (`tool_loop`) có **năm** chặng, và bốn chặng ĐỀU LÀNH: service
 * phát · hook `useKbChatStream` phân giải · trang đăng ký `onToolLoop` · trang vẽ. Chặng thứ năm —
 * `switch` chuyển tiếp ở tuyến này — có đúng **6 `case`** và **không có `tool_loop`**. Hệ quả với
 * người dùng: một vòng lặp tool trần **180 s** chạy trong im lặng tuyệt đối.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI PHÉP ĐO ĐỘC LẬP — VÀ VÌ SAO MỘT CÁI THÔI THÌ TỰ THOẢ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §A **KIỂM KÊ**: đếm MỌI loại sự kiện `streamAnswer` có thể phát (đọc trên MÃ của service, qua
 *    `yield {type:"…"` và `type: "…"` trong các hàm dựng sự kiện) rồi đối chiếu với tập `case`
 *    của tuyến. Nó bắt được **cả những loại chưa ai nghĩ tới** — kể cả loại mọc thêm ngày mai.
 *    Nhưng một mình nó mù trước câu hỏi *"case ấy có gửi ĐÚNG ô không?"*.
 * §B **ĐƯỜNG THẬT**: dựng một `app` giả, cho `streamAnswer` phát một `tool_loop` THẬT, rồi đọc
 *    những dòng `data:` đã ghi ra socket. Nó bắt được lỗi "có `case` mà quên ô `round`".
 *    Nhưng một mình nó mù trước một loại sự kiện thứ chín chưa ai viết ca cho.
 * ⇒ Hai cái bù đúng chỗ mù của nhau. Bỏ một cái là để lại một nửa lỗ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── Mảnh sự kiện mà `streamAnswer` giả sẽ phát trong §B ──
const h = vi.hoisted(() => ({
  sukien: [] as Array<Record<string, unknown>>,
}));

vi.mock("../services/aiLocalKnowledgeService", async (goc) => {
  const that = await goc<typeof import("../services/aiLocalKnowledgeService")>();
  return {
    ...that,
    streamAnswer: async function* () {
      for (const e of h.sukien) yield e as any;
    },
  };
});

vi.mock("./_xacThucRest", async (goc) => {
  const that = await goc<typeof import("./_xacThucRest")>();
  return {
    ...that,
    thuXacThucRest: async () => ({ ok: true, user: { id: 7, role: "admin", name: "T" } }),
  };
});

import { registerAiLocalKnowledgeRoutes } from "./aiLocalKnowledgeApi";

const DUONG_TUYEN = path.resolve(process.cwd(), "server/routes/aiLocalKnowledgeApi.ts");
const DUONG_SERVICE = path.resolve(process.cwd(), "server/services/aiLocalKnowledgeService.ts");

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §A — KIỂM KÊ: mọi loại sự kiện service phát ĐỀU có một `case` ở tuyến
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Đọc tập `case "x":` **bên trong `switch (evt.type)`** của tuyến — không phải mọi `case` trong file
 * (file còn `switch` khác). Cắt theo `indexOf`/`slice`, KHÔNG regex đa dòng: tệp là CRLF và một
 * mẫu `[\s\S]*?` bắc qua nhiều dòng đã cắn nhiều agent ở repo này.
 */
function caseCuaTuyen(src: string): Set<string> {
  const moc = src.indexOf("for await (const evt of streamAnswer(");
  expect(moc, "không tìm thấy vòng chuyển tiếp SSE — lưới này đang đo sai file").toBeGreaterThan(0);
  const het = src.indexOf("if (!closed) {", moc);
  expect(het).toBeGreaterThan(moc);
  const than = src.slice(moc, het);
  const ra = new Set<string>();
  for (const m of than.matchAll(/case "([a-z_]+)":/g)) ra.add(m[1]!);
  return ra;
}

/**
 * Mọi loại sự kiện `StreamEvent` mà service **có thể phát**, đọc từ khai báo kiểu hợp
 * (`export type StreamEvent = | { type: "x"; … }`). Đọc TỪ KIỂU chứ không từ các điểm `yield` rải
 * rác: kiểu là hợp đồng, và nó liệt kê được trọn vẹn; đếm `yield` thì một điểm phát mới nằm trong
 * một hàm phụ sẽ trốn thoát.
 */
function loaiSuKienCuaService(src: string): Set<string> {
  const { than } = khoiKieuStreamEvent(src);
  const ra = new Set<string>();
  for (const m of than.matchAll(/\{\s*type:\s*"([a-z_]+)"/g)) ra.add(m[1]!);
  return ra;
}

/** Khối khai báo kiểu `StreamEvent`, cắt bằng `indexOf`/`slice` (CRLF-an toàn). */
function khoiKieuStreamEvent(src: string): { dau: number; cuoi: number; than: string } {
  const dau = src.indexOf("export type StreamEvent =");
  expect(dau, "không tìm thấy khai báo StreamEvent").toBeGreaterThan(0);
  // Khối kết thúc ở dấu `;` đứng một mình đầu dòng — hợp kiểu này kết bằng `};` hoặc `;`.
  const cuoi = src.indexOf("\n\n", src.indexOf("type: \"done\"", dau));
  expect(cuoi).toBeGreaterThan(dau);
  return { dau, cuoi, than: src.slice(dau, cuoi) };
}

/**
 * ★★★ **SỐ ĐIỂM PHÁT THẬT của một loại sự kiện** = số lần `type: "x"` xuất hiện trong service TRỪ
 * những lần nằm trong chính khai báo kiểu.
 *
 * ⚠⚠ Vì sao cần con số này chứ không chỉ cần danh sách kiểu: hợp `StreamEvent` có những nhánh
 *   **khai để dành** (`agent_plan`, `agent_step` — chú thích ngay tại chỗ nói *"forward-compat; the
 *   primary wiring is via the tRPC aiAgent router"*), tức **0 điểm phát**. Đòi tuyến chuyển tiếp
 *   một loại chưa ai phát là bắt nó viết mã chết, và một lưới đỏ vì lý do sai thì sẽ bị ai đó tắt.
 * ⇒ Luật đúng, phát biểu được: **một nhánh kiểu thì HOẶC được tuyến chuyển tiếp, HOẶC chứng minh
 *   được là chưa từng được phát.** Ngày ai đó phát `agent_plan`, con số này thành ≥1 và lưới ĐỎ.
 */
function soDiemPhat(src: string, loai: string): number {
  const { dau, cuoi } = khoiKieuStreamEvent(src);
  const mau = new RegExp(`type:\\s*"${loai}"`, "g");
  const tong = [...src.matchAll(mau)].length;
  const trongKhai = [...src.slice(dau, cuoi).matchAll(mau)].length;
  return tong - trongKhai;
}

describe("§A — KIỂM KÊ: tuyến chuyển tiếp ĐỦ mọi loại sự kiện service phát", () => {
  const srcTuyen = fs.readFileSync(DUONG_TUYEN, "utf8");
  const srcService = fs.readFileSync(DUONG_SERVICE, "utf8");

  it("★★★ `tool_loop` CÓ trong danh sách `case` của tuyến (đây là ô đã đứt)", () => {
    expect(caseCuaTuyen(srcTuyen)).toContain("tool_loop");
  });

  it("★★★ MỌI nhánh kiểu HOẶC được chuyển tiếp, HOẶC chứng minh được là chưa từng được phát", () => {
    const phat = loaiSuKienCuaService(srcService);
    const chuyen = caseCuaTuyen(srcTuyen);
    // Phép đo phải TỰ CHỨNG MINH nó không rỗng — một `Set` rỗng thoả mọi mệnh đề "mọi phần tử…".
    expect(phat.size, "đọc được 0 loại sự kiện ⇒ lưới đang tự thoả").toBeGreaterThanOrEqual(6);
    const thieu = [...phat].filter((t) => !chuyen.has(t) && soDiemPhat(srcService, t) > 0);
    expect(thieu, `sự kiện service PHÁT THẬT mà tuyến KHÔNG chuyển tiếp: ${thieu.join(", ")}`).toEqual([]);
  });

  /**
   * ★★ **PHÁT HIỆN PHỤ, ĐƯỢC GHIM LẠI CHỨ KHÔNG GIẤU ĐI.** Hai nhánh kiểu này có **0 điểm phát**
   * trong toàn service — chúng là mã CHẾT ở đường SSE (chú thích tại chỗ khai là "forward-compat").
   * Ghim con số 0 vào lưới để ngày ai đó bắt đầu phát chúng, lưới trên ĐỎ và tuyến buộc phải mọc
   * thêm `case` — thay vì im lặng nuốt mất chúng đúng như `tool_loop` đã bị nuốt.
   */
  it("★★ nhánh KHAI ĐỂ DÀNH (`agent_plan`/`agent_step`) đúng là 0 điểm phát", () => {
    expect(soDiemPhat(srcService, "agent_plan")).toBe(0);
    expect(soDiemPhat(srcService, "agent_step")).toBe(0);
  });

  it("★★★ ĐỐI CHỨNG — phép đo ĐỎ ĐƯỢC: bỏ `tool_loop` khỏi bản đọc ⇒ phát hiện ngay", () => {
    const phat = loaiSuKienCuaService(srcService);
    const chuyenThieu = new Set([...caseCuaTuyen(srcTuyen)].filter((t) => t !== "tool_loop"));
    const thieu = [...phat].filter((t) => !chuyenThieu.has(t) && soDiemPhat(srcService, t) > 0);
    expect(thieu).toContain("tool_loop");
  });

  it("★★ `tool_loop` có ≥2 điểm phát THẬT trong service (không phải một nhánh để dành)", () => {
    expect(soDiemPhat(srcService, "tool_loop")).toBeGreaterThanOrEqual(2);
  });

  it("★★ tuyến KHÔNG có `default:` chuyển tiếp (danh sách TRẮNG là quyết định có chủ ý)", () => {
    const moc = srcTuyen.indexOf("for await (const evt of streamAnswer(");
    const het = srcTuyen.indexOf("if (!closed) {", moc);
    expect(srcTuyen.slice(moc, het)).not.toContain("default:");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// §B — ĐƯỜNG THẬT: sự kiện đi hết từ service ra socket
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** `express.Express` tối giản: chỉ nhớ handler của `POST /api/ai/local-kb/stream`. */
function appGia() {
  const tuyen = new Map<string, (req: any, res: any) => Promise<void> | void>();
  const app: any = {
    post: (p: string, ...fns: any[]) => tuyen.set(p, fns[fns.length - 1]),
    get: () => {},
    put: () => {},
    delete: () => {},
    use: () => {},
  };
  return { app, tuyen };
}

/** `res` tối giản: gom mọi mảnh `write` để đọc lại dòng `data:`. */
function resGia() {
  const manh: string[] = [];
  const res: any = {
    destroyed: false,
    headersSent: false,
    status: () => res,
    setHeader: () => res,
    flushHeaders: () => {},
    write: (s: string) => {
      manh.push(s);
      return true;
    },
    json: (o: unknown) => {
      manh.push(JSON.stringify(o));
      return res;
    },
    end: () => {},
  };
  return { res, manh };
}

function reqGia(body: Record<string, unknown>) {
  const nghe = new Map<string, () => void>();
  return {
    body,
    headers: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    on: (ev: string, fn: () => void) => nghe.set(ev, fn),
    __dong: () => nghe.get("close")?.(),
  } as any;
}

/** Mọi khung `data: {...}` đã ghi ra socket, đã phân giải JSON. */
function khungSSE(manh: string[]): Array<Record<string, any>> {
  return manh
    .join("")
    .split("\n\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("data: "))
    .map((s) => JSON.parse(s.slice(6)));
}

describe("§B — ĐƯỜNG THẬT: `tool_loop` đi từ service ra tới socket, đủ ô", () => {
  beforeEach(() => {
    h.sukien = [];
  });

  async function chay(sukien: Array<Record<string, unknown>>) {
    h.sukien = sukien;
    const { app, tuyen } = appGia();
    registerAiLocalKnowledgeRoutes(app);
    const handler = tuyen.get("/api/ai/local-kb/stream");
    expect(handler, "tuyến chưa được đăng ký").toBeTruthy();
    const { res, manh } = resGia();
    await handler!(reqGia({ question: "vòng lặp tool", context: { codingMode: true } }), res);
    return khungSSE(manh);
  }

  it("★★★ khung `tool_loop` CÓ MẶT và mang đủ `round`/`phase`/`toolName`/`elapsedMs`", async () => {
    const khung = await chay([
      { type: "meta", intent: "general", language: "vi", confidence: 1, citations: [] },
      { type: "tool_loop", round: 2, phase: "dang_goi", toolName: "grep_repo", elapsedMs: 1234 },
      { type: "done", provider: "tool", cached: false, followUpSuggestions: [], answer: "xong" },
    ]);
    const tl = khung.find((k) => k.type === "tool_loop");
    expect(tl, "sự kiện tiến độ bị NUỐT ở tầng HTTP — đúng lỗi mục 0.2").toBeTruthy();
    expect(tl!.round).toBe(2);
    expect(tl!.phase).toBe("dang_goi");
    expect(tl!.toolName).toBe("grep_repo");
    expect(tl!.elapsedMs).toBe(1234);
  });

  it("★★★ `phase:\"dung\"` mang theo LÝ DO dừng (`stop`) — im lặng về lý do là nói dối", async () => {
    const khung = await chay([
      { type: "tool_loop", round: 3, phase: "dung", toolName: null, elapsedMs: 9, stop: "het_vong" },
      { type: "done", provider: "tool", cached: false, followUpSuggestions: [], answer: "" },
    ]);
    const tl = khung.find((k) => k.type === "tool_loop");
    expect(tl!.stop).toBe("het_vong");
  });

  it("★★ vắng `stop` ⇒ ô ấy BỊ BỎ HẲN, không gửi `null` (hook khai `stop?: string`)", async () => {
    const khung = await chay([
      { type: "tool_loop", round: 1, phase: "xong", toolName: "read_file", elapsedMs: 5 },
      { type: "done", provider: "tool", cached: false, followUpSuggestions: [], answer: "" },
    ]);
    const tl = khung.find((k) => k.type === "tool_loop")!;
    expect(Object.prototype.hasOwnProperty.call(tl, "stop")).toBe(false);
  });

  it("★★ ĐỐI CHỨNG — lượt KHÔNG có `tool_loop` thì không khung nào bịa ra nó", async () => {
    const khung = await chay([
      { type: "token", token: "chào" },
      { type: "done", provider: "tool", cached: false, followUpSuggestions: [], answer: "chào" },
    ]);
    expect(khung.some((k) => k.type === "tool_loop")).toBe(false);
    expect(khung.some((k) => k.type === "token")).toBe(true);
  });
});
