/**
 * ★★★ doc 79 (2026-08-21) — **SỬA THEO KHỐI: hợp đồng khối, nhập nhằng fail-closed, đường lùi,
 * và — quan trọng nhất — CÂU NGƯỜI DÙNG GÕ THẬT PHẢI TỚI ĐƯỢC ĐƯỜNG KHỐI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BÀI HỌC ĐÃ CẮN HAI LƯỢT LIÊN TIẾP, VÀ §9 LÀ CHỖ NÓ THÀNH LƯỚI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai lượt liền nhau cùng một hình dạng: dựng xong · lưới xanh · đột biến đỏ · **live không chạy**
 * (ngữ cảnh mã 101 ca; lô nhiều tệp 16 đột biến). Gốc rễ chung KHÔNG phải "thiếu ca" mà là **ĐẦU
 * VÀO CỦA CA ĐÃ ĐƯỢC DỌN SẴN**: lưới chứng minh *"tool làm đúng KHI ĐƯỢC GỌI"*, không bao giờ
 * chứng minh *"câu người dùng gõ thật SẼ TỚI ĐƯỢC tool"*.
 *
 * ⇒ Ở đây hai mệnh đề được TÁCH ra, và cả hai đều có mặt:
 *   • §1–§3 · §8  — mệnh đề THỨ NHẤT, trên **hàm THUẦN** (không mock gì cả): hợp đồng khối, phép
 *     áp khối, ba cái trần, và điểm neo băm chống TOCTOU trên **repo git THẬT**.
 *   • §4–§7 · §9  — mệnh đề THỨ HAI: chạy `streamAnswer` qua **đúng chuỗi định tuyến**, trong
 *     **đúng hình dạng phiên live** (một dự án được chọn bằng `projectId` ⇒ `AI_REPO_SANDBOX_ROOTS`,
 *     đường dẫn TƯƠNG ĐỐI theo gốc dự án), với câu chữ người dùng thật sự gõ.
 *
 * ⚠ `sandbox-projects/**` là ĐỀ THI: mọi ca chỉ ĐỌC, và `bamDeThi()` khẳng định 0 byte đổi.
 * ⚠ KHÔNG gọi model thật: `generateTextStream` bị chặn ở tầng thấp nhất (`aiGgufEngine`).
 * ⚠ KHÔNG chạm CSDL thật: `../db/connection` bị chặn.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const h = vi.hoisted(() => ({
  manh: [] as string[],
  /** MỌI system prompt đã gửi lên model — phân biệt persona KHỐI với persona CHÉP-CẢ-TỆP. */
  moiHeThong: [] as string[],
  /** MỌI prompt đã gửi lên model — số phần tử = số lượt gọi model (đường lùi ⇒ 2). */
  moiPrompt: [] as string[],
  /** MỌI `maxTokens` đã xin — trần RA của đường khối phải là hằng, không phụ thuộc kích thước tệp. */
  moiMaxTokens: [] as number[],
  /** Mọi quyết định đi qua `executeDecision`. */
  quyetDinh: [] as Array<{ tool: string | null; args: Record<string, unknown> }>,
  /** Hàng đợi đầu ra model, MỘT phần tử cho MỖI lượt gọi. Rỗng ⇒ mọi lượt dùng `manh`. */
  hangDoi: [] as string[][],
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
    h.moiHeThong.push(String(opt?.systemPrompt ?? ""));
    h.moiPrompt.push(String(opt?.prompt ?? ""));
    h.moiMaxTokens.push(Number(opt?.maxTokens ?? 0));
    const ra = h.hangDoi.length > 0 ? (h.hangDoi.shift() ?? []) : h.manh;
    for (const m of ra) yield { type: "token", token: m };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: ra.length };
  },
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({ insert: () => ({ values: async () => undefined }) })),
}));

/**
 * ⚠ MOCK **BỘ PHẬN**: `read_file`/`list_files` chạy THẬT (hộp cát + RBAC + byte thật trên đĩa) — đó
 * là điều kiện để mệnh đề *"`original` gửi đi là byte TRÊN ĐĨA"* có nghĩa. Chỉ tool GHI bị chặn ở
 * cửa HITL để lưới không cần bảng `ai_pending_actions`.
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
            preview: { entityType: "repo_file", entityName: "", changes: [], warnings: [], humanSummary: "" },
          },
        };
      }
      return that.executeDecision(d, ctx);
    },
  };
});

import { streamAnswer, type StreamEvent } from "./aiLocalKnowledgeService";
import {
  apDungKhoiSua,
  bocKhoiSua,
  chepCaTepDuocKhong,
  dongBoXuongDong,
  personaSuaTep,
  personaSuaTepKhoi,
  promptSuaTep,
  promptSuaTepKhoi,
  tranTokenChoTep,
  KY_TU_MOI_TOKEN_RA,
  MOC_DONG,
  MOC_MO,
  MOC_NGAN,
  TRAN_KY_TU_TEP_SUA,
  TRAN_TOKEN_KHOI_SUA,
  TRAN_TOKEN_RA_TOI_DA,
  type KhoiSua,
} from "./aiCodingAgent";
import { kiemNganSachNguCanh, serverSlotContextTokens } from "./aiLlamaServerClient";
import { computeHunkPlan, planStats } from "../../client/src/lib/diffHunks";
import { phanQuyet } from "./aiLocalTools/writeHandlers/applyDiff";
import { CODING_TOOL_NAMES, CODING_LOOP_TOOL_NAMES, locQuyetDinhLLMLapTrinh } from "./aiLocalTools/intentClassifier";
import { AUTONOMY_INELIGIBLE } from "./ai/autonomyPolicy";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TIỆN ÍCH DÙNG CHUNG
// ════════════════════════════════════════════════════════════════════════════════════════════════
/** Dựng một khối `SEARCH/REPLACE` đúng khuôn — dùng cho MỌI ca giả lập đầu ra model. */
function khoi(truoc: string, sau: string): string {
  return [MOC_MO, truoc, MOC_NGAN, sau, MOC_DONG].join("\n");
}

let idPhien = 9000;
/** Vai `admin` vì `read_file` cưỡng chế `ai_repo_read/canView` THẬT (RBAC KHÔNG bị mock). */
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

function ghiNhan(ten: string): Array<Record<string, unknown>> {
  return h.quyetDinh.filter((q) => q.tool === ten).map((q) => q.args);
}

/**
 * ★★★ THƯỚC CỦA MỆNH ĐỀ "DIFF SẠCH" — và nó là **CHÍNH cái thước người duyệt nhìn**.
 *
 * ⚠ Cố ý KHÔNG viết một phép so dòng thứ hai ở đây. Thẻ duyệt (`HunkDiffView`) dựng khối bằng
 *   `computeHunkPlan(original, modified)`; đo bằng một thước khác là đo một thứ khác thứ người
 *   duyệt thấy — đúng lớp lỗi "cái được đo không phải cái đang hỏng".
 */
function dienDiff(original: string, modified: string): { khoi: number; them: number; xoa: number; oversize: boolean } {
  const p = computeHunkPlan(original, modified, { matchEol: true });
  const s = planStats(p);
  return { khoi: p.hunks.length, them: s.added, xoa: s.removed, oversize: p.oversize };
}

const ENV = [
  "AI_CODING_GEN",
  "AI_CODING_EDIT",
  "AI_CODING_EDIT_HUNKS",
  "AI_CODING_REPO_CONTEXT",
  "AI_REPO_SANDBOX_ROOTS",
  "AI_REPO_SANDBOX_ROOT",
] as const;

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.AI_CODING_REPO_CONTEXT = "0";
  h.manh = [];
  h.moiHeThong = [];
  h.moiPrompt = [];
  h.moiMaxTokens = [];
  h.quyetDinh = [];
  h.hangDoi = [];
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — `bocKhoiSua`: hợp đồng khối, và ĐẦU RA BỊ CẮT là một quan sát chứ không phải im lặng", () => {
  it("★★★ một khối đúng khuôn ⇒ tách đúng neo và đoạn thay", () => {
    const r = bocKhoiSua(`Tôi sẽ đổi phép chia.\n\n${khoi("  return a / b;", "  if (b == 0) throw;\n  return a / b;")}\n\n- xong`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.khoi).toEqual<KhoiSua[]>([
      { truoc: "  return a / b;", sau: "  if (b == 0) throw;\n  return a / b;" },
    ]);
  });

  it("★★★ NHIỀU khối trong một câu trả lời ⇒ giữ ĐÚNG THỨ TỰ (thứ tự có tải trọng: áp tuần tự)", () => {
    const r = bocKhoiSua(`${khoi("A", "A1")}\n${khoi("B", "B1")}\n${khoi("C", "C1")}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.khoi.map((k) => k.truoc)).toEqual(["A", "B", "C"]);
  });

  it("★★ khối bọc trong rào ``` vẫn bóc được (model rất hay bọc) — rào nằm NGOÀI khối", () => {
    const r = bocKhoiSua("```\n" + khoi("x", "y") + "\n```");
    expect(r.ok).toBe(true);
  });

  it("★★ nhận theo HÌNH DẠNG, không theo danh sách trắng chuỗi: 3 hay 9 dấu mốc đều được", () => {
    const r = bocKhoiSua("<<< SEARCH\nx\n===\ny\n>>>>>>>>> REPLACE");
    expect(r.ok, "một danh sách trắng đếm đúng 7 dấu sẽ ĐỎ ở đây — và hỏng IM LẶNG ở live").toBe(true);
  });

  /**
   * ★★★ ĐÂY LÀ MÃ QUAN TRỌNG NHẤT CỦA §1. Trần token RA cắt ngang đầu ra model, và triệu chứng là
   * một khối mở mà không bao giờ đóng. Phân biệt được nó với "model không hiểu" là điều kiện để câu
   * trả lời cho người dùng nói đúng nguyên nhân.
   */
  it("★★★ đầu ra bị CẮT giữa chừng ⇒ `KHOI_CUT`, KHÔNG phải một khối trông-hợp-lệ", () => {
    const r = bocKhoiSua(`${MOC_MO}\nreturn a / b;\n${MOC_NGAN}\nif (b == 0)`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("KHOI_CUT");
  });

  it("★★★ khối 1 CỤT rồi khối 2 mở ra ⇒ vẫn `KHOI_CUT` (không ghép râu ông nọ cằm bà kia)", () => {
    const r = bocKhoiSua(`${MOC_MO}\nA\n${MOC_NGAN}\nA1\n${MOC_MO}\nB\n${MOC_NGAN}\nB1\n${MOC_DONG}`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma, "một regex lười sẽ ghép dòng ngăn của khối 1 với dòng đóng của khối 2").toBe("KHOI_CUT");
  });

  it("★★★ HAI dòng ngăn trong một khối ⇒ `KHOI_MO_HO` — TỪ CHỐI thay vì lấy cái đầu tiên", () => {
    const r = bocKhoiSua(`${MOC_MO}\nA\n${MOC_NGAN}\nB\n${MOC_NGAN}\nC\n${MOC_DONG}`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("KHOI_MO_HO");
  });

  it("★★ thiếu hẳn dòng ngăn ⇒ `KHOI_MO_HO`", () => {
    const r = bocKhoiSua(`${MOC_MO}\nA\n${MOC_DONG}`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("KHOI_MO_HO");
  });

  it("★★★ neo RỖNG ⇒ `NEO_RONG` (một neo rỗng 'khớp' ở mọi vị trí)", () => {
    const r = bocKhoiSua(`${MOC_MO}\n${MOC_NGAN}\nx\n${MOC_DONG}`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("NEO_RONG");
  });

  it("★★ model trả lời bằng văn xuôi / chép cả tệp ⇒ `KHONG_CO_KHOI`", () => {
    expect(bocKhoiSua("```ts\nexport const a = 1;\n```").ok).toBe(false);
    const r = bocKhoiSua("Tôi nghĩ bạn nên thêm một phép kiểm.");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("KHONG_CO_KHOI");
  });

  it("★★ CRLF trong đầu ra model KHÔNG làm hỏng phép bóc", () => {
    const r = bocKhoiSua(khoi("A", "B").replace(/\n/g, "\r\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.khoi[0], "dấu \\r phải bị chuẩn hoá, nếu không neo sẽ không bao giờ khớp").toEqual({ truoc: "A", sau: "B" });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — `apDungKhoiSua`: NHẬP NHẰNG LÀ MỘT LỜI TỪ CHỐI, KHÔNG PHẢI MỘT PHÉP ĐOÁN", () => {
  const TEP = ["function a() {", "  return 1;", "}", "", "function b() {", "  return 2;", "}", ""].join("\n");

  it("★★★ neo DUY NHẤT ⇒ áp đúng chỗ ấy, phần còn lại không đổi một ký tự", () => {
    const r = apDungKhoiSua(TEP, [{ truoc: "  return 1;", sau: "  return 11;" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ketQua).toBe(TEP.replace("  return 1;", "  return 11;"));
    expect(dienDiff(TEP, r.ketQua), "diff SẠCH: đúng MỘT khối, +1 −1").toEqual({ khoi: 1, them: 1, xoa: 1, oversize: false });
  });

  /** ⚠⚠ (i) của cổng ra — mệnh đề số một của cả mục này. */
  it("★★★ (i) neo xuất hiện **≥2 lần** ⇒ `NEO_NHIEU_CHO`, KHÔNG áp gì cả", () => {
    const r = apDungKhoiSua(TEP, [{ truoc: "}", sau: "} // x" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("NEO_NHIEU_CHO");
    expect(r.chiTiet).toContain("2 chỗ");
  });

  /** ⚠⚠ (ii) của cổng ra — và nó KHÔNG được im lặng. */
  it("★★★ (ii) neo xuất hiện **0 lần** ⇒ `NEO_KHONG_THAY`, có nêu đích danh neo", () => {
    const r = apDungKhoiSua(TEP, [{ truoc: "  return 999;", sau: "x" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("NEO_KHONG_THAY");
    expect(r.chiTiet, "câu từ chối phải nói NÓ TỪ CHỐI CÁI GÌ").toContain("return 999;");
  });

  it("★★★ hai lần khớp CHỒNG LẤN vẫn là '≥2 chỗ' ⇒ vẫn từ chối (phép đếm không nuốt ca chồng lấn)", () => {
    const r = apDungKhoiSua("aaaa", [{ truoc: "aa", sau: "b" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("NEO_NHIEU_CHO");
  });

  it("★★★ NHIỀU khối áp TUẦN TỰ trên nội dung ĐANG BIẾN ĐỔI", () => {
    const r = apDungKhoiSua(TEP, [
      { truoc: "  return 1;", sau: "  return 11;" },
      { truoc: "  return 2;", sau: "  return 22;" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ketQua).toContain("return 11;");
    expect(r.ketQua).toContain("return 22;");
    expect(dienDiff(TEP, r.ketQua)).toEqual({ khoi: 2, them: 2, xoa: 2, oversize: false });
  });

  it("★★★ hai khối CHỒNG LẤN ⇒ khối sau mất neo ⇒ TỪ CHỐI (không đẻ ra kết quả phụ thuộc thứ tự âm thầm)", () => {
    const r = apDungKhoiSua(TEP, [
      { truoc: "function a() {\n  return 1;", sau: "function a() {\n  return 111;" },
      { truoc: "  return 1;", sau: "  return 2;" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("NEO_KHONG_THAY");
    expect(r.chiTiet).toContain("#2");
  });

  it("★★ đoạn thay RỖNG là hợp lệ — đó là một lượt XOÁ", () => {
    const r = apDungKhoiSua(TEP, [{ truoc: "  return 1;\n", sau: "" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ketQua).not.toContain("return 1;");
  });

  it("★★★ áp xong mà tệp KHÔNG đổi ⇒ `KHOI_KHONG_DOI` (không đề xuất một lượt ghi rỗng)", () => {
    const r = apDungKhoiSua(TEP, [{ truoc: "  return 1;", sau: "  return 1;" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("KHOI_KHONG_DOI");
  });

  // ── PHÉP NỚI MỘT TRỤC ──────────────────────────────────────────────────────────────────────────
  /**
   * ★★★ Lớp lỗi CÓ THẬT của model 30B: nó bỏ khoảng trắng CUỐI dòng khi chép lại một neo NHIỀU
   * DÒNG. Không nới trục này thì gần như mọi lượt sửa một tệp có dấu cách thừa đều rơi xuống
   * đường lùi (tốn thêm ~30 s model mỗi lượt).
   *
   * ⚠ Ca một-dòng KHÔNG chứng minh được điều này: phép so khớp CHÍNH là **chuỗi con**, nên
   *   `"const a = 1;"` vẫn nằm gọn trong `"const a = 1;   "`. Neo phải có ≥2 dòng thì khoảng
   *   trắng cuối dòng mới thật sự chắn đường — đó là lý do dữ liệu ca này có ba dòng.
   */
  it("★★★ model bỏ khoảng trắng CUỐI dòng GIỮA một neo nhiều dòng ⇒ vẫn khớp", () => {
    const goc = "if (a) {   \n  b();\n}\nsau();\n";
    const r = apDungKhoiSua(goc, [{ truoc: "if (a) {\n  b();\n}", sau: "if (a) {\n  c();\n}" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ketQua).toBe("if (a) {\n  c();\n}\nsau();\n");
    expect(r.soNoiLong, "phải khai ra rằng lượt này dùng phép nới").toBe(1);
  });

  it("★★★ phép nới KHÔNG nới điều kiện DUY NHẤT: nới xong trùng 2 chỗ ⇒ vẫn TỪ CHỐI", () => {
    // CẢ HAI chỗ đều có khoảng trắng thừa ⇒ khớp CHÍNH = 0 ⇒ phép nới được gọi, và nới ra 2 chỗ.
    const goc = "if (a) {   \n  b();\n}\nif (a) {  \n  b();\n}\n";
    const r = apDungKhoiSua(goc, [{ truoc: "if (a) {\n  b();\n}", sau: "x" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma, "nới ra 2 chỗ ⇒ vẫn phải từ chối; phép nới KHÔNG mua thêm quyền đoán").toBe("NEO_NHIEU_CHO");
  });

  /**
   * ★★★ CHỐNG NỚI QUÁ TAY — thụt ĐẦU dòng là NGỮ NGHĨA (Python/YAML/Makefile). Nới nó là cho phép
   * neo trượt sang một khối lệnh khác, tức đúng thứ cả mục này sinh ra để chặn.
   *
   * ⚠ Phân biệt hai chuyện khác nhau, và ca này chỉ nói về chuyện THỨ HAI:
   *   • phép so khớp CHÍNH là **chuỗi con** — một neo không thụt đầu dòng vẫn khớp bên trong một
   *     dòng có thụt, và khi ấy nó thay đúng chuỗi con ấy (phần thụt giữ nguyên). An toàn, vì
   *     điều kiện DUY NHẤT vẫn được đếm trên cả tệp.
   *   • phép NỚI (theo dòng) thì **đòi thụt đầu dòng khớp từng ký tự** — đó là chỗ neo có thể
   *     trượt sang khối lệnh khác nếu nới, nên không nới.
   */
  it("★★★ phép NỚI đòi thụt ĐẦU dòng khớp — nới đúng MỘT trục, không hai", () => {
    const goc = "    if (a) {   \n      b();\n    }\n";
    const r = apDungKhoiSua(goc, [{ truoc: "if (a) {\n  b();\n}", sau: "x" }]);
    expect(r.ok, "thụt lệch ⇒ KHÔNG được coi là khớp").toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("NEO_KHONG_THAY");
  });

  it("★★ phép so khớp CHÍNH là chuỗi con ⇒ giữ nguyên phần thụt đầu dòng khi thay", () => {
    const r = apDungKhoiSua("    const a = 1;\n", [{ truoc: "const a = 1;", sau: "const a = 2;" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ketQua, "thụt đầu dòng KHÔNG bị nuốt").toBe("    const a = 2;\n");
    expect(r.soNoiLong, "khớp CHÍNH ⇒ không dùng tới phép nới").toBe(0);
  });

  it("★★ neo rỗng lọt tới đây (không qua bộ bóc) vẫn bị chặn", () => {
    const r = apDungKhoiSua(TEP, [{ truoc: "", sau: "x" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("NEO_RONG");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ §3 — BA CÁI TRẦN, VÀ CÁI NHỎ NHẤT CHƯA TỪNG CÓ MẶT TRONG PHÉP ĐỐI CHIẾU NÀO
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Lượt đối chiếu trước so `TRAN_KY_TU_TEP_SUA` (60.000) với ngân sách VÀO (~57.000) rồi kết luận
 * "giữ nguyên 60.000". Kết luận ấy đúng cho HAI trần được so, và **bỏ sót trần thứ ba**: ngân sách
 * **RA**. `tranTokenChoTep` bị kẹp ở `TRAN_TOKEN_RA_TOI_DA = 12.000`, mà chép lại một tệp `n` ký tự
 * cần `n / 2,6` token ⇒ chép được **chỉ khi n ≤ 31.200**. Mọi tệp trong dải 31.200…60.000 lọt hai
 * trần trên và hỏng ở trần này, MỖI LẦN.
 */
describe("§3 — ba cái trần, đo bằng chính hàm sản phẩm (không xấp xỉ thứ hai)", () => {
  it("★★★ T3 — trần RA: `chepCaTepDuocKhong` lật đúng ở 31.200 ⇄ 31.201", () => {
    expect(chepCaTepDuocKhong(31_200)).toBe(true);
    expect(chepCaTepDuocKhong(31_201)).toBe(false);
    expect(TRAN_TOKEN_RA_TOI_DA * KY_TU_MOI_TOKEN_RA, "31.200 là TÍCH, không phải một số gõ tay").toBe(31_200);
  });

  it("★★★ T3 nằm THẤP HƠN HẲN T1 — tức 60.000 chưa bao giờ là trần thật của đường chép-cả-tệp", () => {
    expect(chepCaTepDuocKhong(TRAN_KY_TU_TEP_SUA)).toBe(false);
    expect(tranTokenChoTep(TRAN_KY_TU_TEP_SUA)).toBe(TRAN_TOKEN_RA_TOI_DA);
    expect(
      Math.ceil(TRAN_KY_TU_TEP_SUA / KY_TU_MOI_TOKEN_RA),
      "một tệp 60.000 ký tự cần ~23.077 token ra, mà trần là 12.000 ⇒ CỤT",
    ).toBeGreaterThan(TRAN_TOKEN_RA_TOI_DA);
  });

  /**
   * ★★★ CA TỰ HIỆU CHỈNH — nó KHÔNG gõ vào một con số điểm hoà nào. Nó khẳng định một QUAN HỆ:
   * ở đúng trần T1, prompt của đường KHỐI lọt ngân sách còn prompt của đường CHÉP-CẢ-TỆP thì không.
   * Ai đổi persona, đổi trần, hay đổi `serverSlotContextTokens()` sẽ thấy ca này đỏ — thay vì thấy
   * một hằng số cũ vẫn xanh trong khi quan hệ đã đảo.
   */
  it("★★★ T2 — ở đúng 60.000 ký tự: đường KHỐI LỌT ngân sách, đường CHÉP-CẢ-TỆP thì KHÔNG", () => {
    const noiDung = "x".repeat(TRAN_KY_TU_TEP_SUA);
    const yeuCau = "sửa hàm Divide để ném ArgumentException khi chia cho 0";
    const duong = "server/services/x.ts";
    for (const lang of ["vi", "en", "zh"] as const) {
      const cu = kiemNganSachNguCanh({
        systemPrompt: personaSuaTep(lang, ""),
        prompt: promptSuaTep(duong, noiDung, yeuCau, lang, ""),
        maxTokens: tranTokenChoTep(noiDung.length),
      });
      const moi = kiemNganSachNguCanh({
        systemPrompt: personaSuaTepKhoi(lang, ""),
        prompt: promptSuaTepKhoi(duong, noiDung, yeuCau, lang, ""),
        maxTokens: TRAN_TOKEN_KHOI_SUA,
      });
      expect(cu.vua, `[${lang}] đường cũ phải VƯỢT ngân sách ở 60.000`).toBe(false);
      expect(moi.vua, `[${lang}] đường khối phải LỌT ngân sách ở 60.000`).toBe(true);
    }
    expect(serverSlotContextTokens()).toBeGreaterThan(0);
  });

  it("★★ trần RA của đường khối là HẰNG — không phình theo kích thước tệp", () => {
    expect(TRAN_TOKEN_KHOI_SUA).toBeLessThan(TRAN_TOKEN_RA_TOI_DA);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §4–§8 — REPO GIT THẬT DỰNG TẠM (hàng rào "tệp bẩn" hỏi `git status` THẬT)
// ════════════════════════════════════════════════════════════════════════════════════════════════
let REPO = "";
const ID_TAM = "tam";
/** ~40.000 ký tự: LỌT T1 (60.000) và T2, nhưng VƯỢT T3 (31.200) ⇒ trước lượt này KHÔNG sửa được. */
const R_LON = "src/lon.ts";
/** Tệp nhỏ — còn đường lùi. */
const R_NHO = "src/nho.ts";

function git(...args: string[]): string {
  return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
}
function ghiCommit(rel: string, noiDung: string): void {
  const abs = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, noiDung);
  git("add", "--", rel);
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", `add ${rel}`);
}
function docDia(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

/** Thân tệp lớn: mỗi hàm là DUY NHẤT (để neo của ca có nghĩa), tổng > 31.200 ký tự. */
function thanTepLon(): string {
  const d: string[] = ["// tệp lớn dựng cho lưới — mỗi hàm là duy nhất", ""];
  for (let i = 0; i < 700; i++) {
    d.push(`export function ham${i}(x: number): number {`, `  return x * ${i} + ${i};`, "}", "");
  }
  d.push("export const DAU_MOC_CUOI = 'moc-cuoi';", "");
  return d.join("\n");
}

beforeAll(() => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "khoi-sua-")));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // ⚠ Windows: mặc định `core.autocrlf=true` làm `git checkout --` trả về CRLF trong khi ta ghi LF
  //   ⇒ ca TOCTOU sẽ đỏ vì kiểu xuống dòng, không vì băm. Ghim để repo tạm là TẤT ĐỊNH.
  git("config", "core.autocrlf", "false");
  ghiCommit(R_LON, thanTepLon());
  ghiCommit(R_NHO, "export function cong(a: number, b: number) {\n  return a + b;\n}\n");
});

afterAll(() => {
  try {
    fs.rmSync(REPO, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function trongRepoTam(q: string) {
  process.env.AI_REPO_SANDBOX_ROOTS = `${ID_TAM}=Du an tam|${REPO}`;
  return chay(q, admin(), { projectId: ID_TAM });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — (iv) TỆP LỚN HƠN TRẦN CŨ **NAY SỬA ĐƯỢC**, và trước thì không", () => {
  it("★★★ tệp lớn thật sự nằm trong dải chỉ đường KHỐI với tới được", () => {
    const n = docDia(R_LON).length;
    expect(n, "phải VƯỢT T3 — tức đường chép-cả-tệp không chở nổi").toBeGreaterThan(31_200);
    expect(n, "và vẫn LỌT T1 — tức bộ lọc thô không phải bên từ chối").toBeLessThan(TRAN_KY_TU_TEP_SUA);
    expect(chepCaTepDuocKhong(n)).toBe(false);
  });

  it("★★★ câu sửa trên tệp lớn ⇒ ĐỀ XUẤT apply_diff, `original` = byte ĐĨA, `modified` khác đúng 1 dòng", async () => {
    const dia = docDia(R_LON);
    h.manh = [`Đổi hàm 123.\n\n${khoi("  return x * 123 + 123;", "  return x * 123 + 1230;")}\n\n- xong`];
    const r = await trongRepoTam(`sửa ${R_LON}: hàm ham123 phải cộng 1230 thay vì 123`);

    const ad = ghiNhan("apply_diff");
    expect(ad.length, "một tệp ⇒ đúng một apply_diff").toBe(1);
    expect(ad[0]!.original, "neo băm là byte TRÊN ĐĨA, không phải bản model chép lại").toBe(dia);
    expect(String(ad[0]!.modified)).toBe(dia.replace("  return x * 123 + 123;", "  return x * 123 + 1230;"));
    expect(dienDiff(String(ad[0]!.original), String(ad[0]!.modified)), "DIFF SẠCH trên tệp 2.800 dòng").toEqual({ khoi: 1, them: 1, xoa: 1, oversize: false });
    expect(r.events.some((e) => e.type === "pending_action"), "HITL nguyên vẹn").toBe(true);
  });

  it("★★★ MỘT lượt gọi model, và trần RA là HẰNG — không phình theo tệp 40k", async () => {
    h.manh = [khoi("  return x * 7 + 7;", "  return x * 7 + 70;")];
    await trongRepoTam(`sửa ${R_LON}: đổi ham7`);
    expect(h.moiPrompt.length, "không cần đường lùi ⇒ đúng một lượt").toBe(1);
    expect(h.moiMaxTokens[0]).toBe(TRAN_TOKEN_KHOI_SUA);
    expect(
      h.moiMaxTokens[0],
      "nếu ai nối lại `tranTokenChoTep(n)` thì con số này nhảy lên 12.000 và tệp lại bị cắt cụt",
    ).not.toBe(tranTokenChoTep(docDia(R_LON).length));
  });

  it("★★★ persona gửi lên model là persona KHỐI, KHÔNG phải persona chép-cả-tệp", async () => {
    h.manh = [khoi("  return x * 9 + 9;", "  return x * 9 + 90;")];
    await trongRepoTam(`sửa ${R_LON}: đổi ham9`);
    expect(h.moiHeThong[0]).toContain(MOC_MO);
    expect(h.moiHeThong[0]).not.toContain("TOÀN BỘ nội dung tệp SAU KHI SỬA");
    expect(h.moiPrompt[0], "nội dung tệp VẪN đi trọn vào prompt — cắt là cắt chiều RA").toContain("DAU_MOC_CUOI");
  });

  it("★★ cờ `AI_CODING_EDIT_HUNKS=0` ⇒ quay về hành vi CŨ y nguyên (và tệp lớn lại hỏng như cũ)", async () => {
    process.env.AI_CODING_EDIT_HUNKS = "0";
    h.manh = ["```ts\nexport const x = 1;\n```"];
    await trongRepoTam(`sửa ${R_NHO}: đổi tên hàm cong thành tong`);
    expect(h.moiHeThong[0]).toContain("TOÀN BỘ nội dung tệp SAU KHI SỬA");
    expect(h.moiHeThong[0]).not.toContain(MOC_MO);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — (i) NEO TRÙNG NHIỀU CHỖ ⇒ TỪ CHỐI, và KHÔNG đề xuất ghi", () => {
  it("★★★ neo `}` trùng 700+ chỗ ⇒ 0 apply_diff, câu trả lời nêu rõ lý do", async () => {
    h.manh = [`${khoi("}", "} // đã sửa")}`];
    const r = await trongRepoTam(`sửa ${R_LON}: thêm chú thích sau mỗi dấu đóng ngoặc`);
    expect(ghiNhan("apply_diff").length, "đoán 'chắc là cái đầu tiên' = ghi đè nhầm chỗ trong im lặng").toBe(0);
    expect(ghiNhan("apply_diff_batch").length).toBe(0);
    expect(r.chu).toContain("trùng ở NHIỀU CHỖ");
    expect(r.chu, "phải nói RÕ nó từ chối cái gì").toContain("KHÔNG đề xuất ghi");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — (ii)+(v) NEO KHÔNG THẤY ⇒ nói thật, và ĐƯỜNG LÙI chạy thật cho tệp đủ nhỏ", () => {
  it("★★★ tệp NHỎ: khối hỏng ⇒ lùi về chép-cả-tệp ⇒ VẪN có đề xuất ghi (KHÔNG trả rỗng)", async () => {
    const dia = docDia(R_NHO);
    h.hangDoi = [
      [khoi("  return a - b;", "  return a + b + 1;")], // neo KHÔNG có trong tệp
      ["```ts\nexport function tong(a: number, b: number) {\n  return a + b;\n}\n```"],
    ];
    const r = await trongRepoTam(`sửa ${R_NHO}: đổi tên hàm cong thành tong`);

    expect(h.moiPrompt.length, "đúng HAI lượt model: khối rồi mới lùi").toBe(2);
    expect(h.moiHeThong[0]).toContain(MOC_MO);
    expect(h.moiHeThong[1], "lượt hai phải là persona CHÉP CẢ TỆP").toContain("TOÀN BỘ nội dung tệp SAU KHI SỬA");

    const ad = ghiNhan("apply_diff");
    expect(ad.length, "đường lùi phải RA ĐƯỢC một đề xuất — không được trả số không").toBe(1);
    expect(ad[0]!.original).toBe(dia);
    expect(String(ad[0]!.modified)).toContain("export function tong");
    expect(r.chu, "phải KHAI ra rằng đang lùi, chứ không im lặng").toContain("đang thử lại theo đường đó");
  });

  it("★★★ chữ của lượt khối hỏng KHÔNG bị đánh rơi — người dùng đã đọc nó rồi", async () => {
    h.hangDoi = [
      [`Tôi định đổi chỗ này.\n${khoi("  return a - b;", "x")}`],
      ["```ts\nexport function tong(a: number, b: number) {\n  return a + b;\n}\n```"],
    ];
    const r = await trongRepoTam(`sửa ${R_NHO}: đổi tên hàm cong thành tong`);
    const done = r.done as any;
    expect(String(done?.answer)).toContain("Tôi định đổi chỗ này.");
    expect(String(done?.answer)).toContain("export function tong");
  });

  /** ⚠⚠ (v) — đường lùi KHÔNG TỒN TẠI ở tệp lớn, và khi ấy phải TỪ CHỐI TO TIẾNG, không trả rỗng. */
  it("★★★ tệp LỚN: khối hỏng ⇒ **không lùi**, chỉ MỘT lượt model, và câu trả lời KHÔNG rỗng", async () => {
    h.manh = [khoi("  return x * 999999 + 1;", "x")];
    const r = await trongRepoTam(`sửa ${R_LON}: đổi ham999999`);

    expect(h.moiPrompt.length, "lùi ở tệp này chỉ đẻ ra một bản chép CỤT ⇒ không lùi").toBe(1);
    expect(ghiNhan("apply_diff").length).toBe(0);
    expect(r.chu).toContain("KHÔNG tìm thấy đoạn neo");
    expect(r.chu).toContain("KHÔNG có đường lùi");
    expect(String((r.done as any)?.answer).trim().length, "hôm qua chỗ này là ~45 giây rồi số không").toBeGreaterThan(50);
  });

  /**
   * ★★★ RANH GIỚI GIỮA "KHỐI HỎNG" VÀ "KHÔNG CÓ GÌ ĐỂ ÁP" — trộn hai cái này lại là đốt thêm một
   * lượt model 30B (~30 s) để hỏi lại đúng câu model vừa trả lời xong.
   */
  it("★★★ khối áp SẠCH nhưng không đổi gì ⇒ 'không đổi', **KHÔNG** lùi (không tốn lượt model thứ hai)", async () => {
    h.manh = [khoi("  return a + b;", "  return a + b;")];
    const r = await trongRepoTam(`sửa ${R_NHO}: đổi thứ tự cộng`);
    expect(h.moiPrompt.length, "đây KHÔNG phải khối hỏng ⇒ không có đường lùi nào được chạy").toBe(1);
    expect(ghiNhan("apply_diff").length, "không đề xuất một lượt ghi rỗng").toBe(0);
    expect(r.chu).toContain("GIỐNG HỆT");
    expect(r.chu, "và KHÔNG được nói là khối hỏng").not.toContain("KHÔNG tìm thấy đoạn neo");
  });

  it("★★★ đầu ra model bị CẮT ở tệp lớn ⇒ nói ĐÚNG nguyên nhân (trần token), không đổ tại người dùng", async () => {
    h.manh = [`${MOC_MO}\n  return x * 5 + 5;\n${MOC_NGAN}\n  return x * 5`];
    const r = await trongRepoTam(`sửa ${R_LON}: đổi ham5`);
    expect(r.chu).toContain("CẮT giữa chừng");
    expect(r.chu).toContain("trần token");
    expect(ghiNhan("apply_diff").length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§7 — (iii) BĂM CHỐNG TOCTOU: neo đến từ ĐĨA, và được so LẠI", () => {
  /**
   * ⚠ Ca này gọi thẳng `phanQuyet` — cùng hàm mà `preview` (lúc đề xuất) và `execute` (lúc người
   * bấm duyệt) đều gọi. Đó là toàn bộ ý nghĩa của hàng rào: **một** phép phán quyết, chạy HAI LẦN.
   */
  it("★★★ tệp SẠCH + `original` = byte đĩa ⇒ QUA; đĩa đổi dưới chân ⇒ `BASE_MISMATCH`", async () => {
    const dia = docDia(R_NHO);
    const arg = { path: R_NHO, original: dia, modified: `${dia}// them\n` };

    const luc0 = await phanQuyet(arg, REPO);
    expect(luc0.ok, "lúc ĐỀ XUẤT: tệp sạch, băm khớp").toBe(true);

    // …người dùng đang cân nhắc thì tệp đổi dưới chân (biên tập tay / một tiến trình khác).
    fs.writeFileSync(path.join(REPO, R_NHO), `${dia}// ai đó vừa sửa tay\n`);
    const luc1 = await phanQuyet(arg, REPO);
    expect(luc1.ok, "lúc XÁC NHẬN: phải TỪ CHỐI").toBe(false);
    if (luc1.ok) return;
    expect(luc1.ma, "hàng rào băm đứng TRƯỚC cả hàng rào tệp bẩn").toBe("BASE_MISMATCH");

    fs.writeFileSync(path.join(REPO, R_NHO), dia);
    expect(docDia(R_NHO), "trả đề về đúng byte cũ cho các ca sau").toBe(dia);
  });

  it("★★★ MỖI TỆP MỘT BĂM RIÊNG: neo của tệp A không bao giờ mở được cửa cho tệp B", async () => {
    const kq = await phanQuyet({ path: R_NHO, original: docDia(R_LON), modified: "x" }, REPO);
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("BASE_MISMATCH");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ §8 — CÂU NGƯỜI DÙNG GÕ THẬT, TRONG ĐÚNG HÌNH DẠNG PHIÊN LIVE
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠⚠ MỆNH ĐỀ THỨ HAI — thứ hai lượt trước KHÔNG phát biểu được, và vì thế cả hai lượt ấy dựng xong
 * mà live không chạy. Đầu vào của mọi ca dưới đây là **văn bản đã đi qua bàn phím thật** (nguyên văn
 * câu ở phiên nghiệm thu 2026-08-21 + các cách gõ tự nhiên vi/en/zh), chạy qua **đúng chuỗi định
 * tuyến**, trong **đúng hình dạng phiên live**: dự án "Demo Csharp" được chọn bằng `projectId`
 * (⇒ `AI_REPO_SANDBOX_ROOTS`), đường dẫn TƯƠNG ĐỐI theo gốc dự án, tệp CRLF thật trên đĩa thật.
 *
 * ⚠ Và neo của khối được lấy TỪ BYTE THẬT của tệp lúc chạy, không phải một chuỗi tác giả gõ sẵn —
 *   một neo gõ sẵn là một đầu vào ĐÃ DỌN, tức đúng cái bẫy vừa nêu.
 */
describe("§8 — CÂU THẬT phải tới được ĐƯỜNG KHỐI (không chỉ tới được tool)", () => {
  const GOC_DEMO = path.resolve(process.cwd(), "sandbox-projects", "csharp-demo");
  const ID_DEMO = "csharpdemo";
  const R_CALC = "src/Calculator.cs";
  const R_STR = "src/StringUtils.cs";

  function bamDeThi(): string {
    const g = createHash("sha256");
    for (const rel of [R_CALC, R_STR]) g.update(fs.readFileSync(path.join(GOC_DEMO, rel)));
    return g.digest("hex");
  }
  function diaDemo(rel: string): string {
    return fs.readFileSync(path.join(GOC_DEMO, rel), "utf8");
  }
  function trongDemo(q: string) {
    process.env.AI_REPO_SANDBOX_ROOTS = `${ID_DEMO}=Demo Csharp|${GOC_DEMO}`;
    return chay(q, admin(), { projectId: ID_DEMO });
  }

  it("★★★ đề thi đúng là tệp CRLF — nếu không, mọi ca dưới đây mất trục CRLF", () => {
    expect(diaDemo(R_CALC)).toContain("\r\n");
  });

  /**
   * ★★★ CA TRUNG TÂM. Nguyên văn hình dạng câu người dùng gõ (động từ sửa + đường dẫn tương đối +
   * dấu hai chấm + mệnh lệnh), model trả về ĐÚNG MỘT khối vài dòng — và hệ phải cho ra một
   * `apply_diff` mà `original` là **1.134 byte trên đĩa** trong khi model chưa từng chép lại chúng.
   */
  it("★★★ câu live ⇒ đường KHỐI ⇒ `original` = byte đĩa (model KHÔNG hề chép lại tệp)", async () => {
    const truoc = bamDeThi();
    const dia = diaDemo(R_CALC);
    /**
     * ⚠⚠ NEO PHẢI NHIỀU DÒNG — và đây là một bài học của CHÍNH lượt này, bắt được bằng đột biến.
     *
     * Bản đầu của ca này dùng neo MỘT DÒNG (`return a / b;`). Với neo một dòng, phép chuẩn hoá
     * CRLF→LF **không có tác dụng gì**: chuỗi ấy nằm gọn trong một dòng nên nó khớp tệp CRLF y hệt
     * khớp tệp LF. Hệ quả: đột biến *"bỏ chuẩn hoá CRLF"* **SỐNG SÓT** trên một lưới đang tự nhận
     * là đo CRLF. Neo bắc qua ranh giới dòng mới làm phép chuẩn hoá trở thành thứ chịu tải.
     */
    const neo = ["    {", "        return a / b;", "    }"].join("\n");
    expect(neo, "neo MỘT DÒNG không đo được CRLF — xem khối ⚠⚠ ngay trên").toContain("\n");
    expect(dia.replace(/\r\n/g, "\n")).toContain(neo);
    const thay = [
      "    {",
      "        if (b == 0) throw new ArgumentException(\"Không chia được cho 0\");",
      "        return a / b;",
      "    }",
    ].join("\n");
    h.manh = [`Tôi thêm phép kiểm mẫu số.\n\n${khoi(neo, thay)}\n\n- Ném ArgumentException khi b = 0.`];

    const r = await trongDemo(`sửa ${R_CALC}: Divide phải ném ArgumentException khi chia cho 0`);

    const ad = ghiNhan("apply_diff");
    expect(ad.length, "câu thật phải TỚI ĐƯỢC apply_diff").toBe(1);
    expect(ad[0]!.original, "neo băm là byte TRÊN ĐĨA").toBe(dia);
    expect(h.moiHeThong[0], "và nó phải đi ĐƯỜNG KHỐI, không phải đường chép-cả-tệp").toContain(MOC_MO);

    const moi = String(ad[0]!.modified);
    expect(moi, "CRLF của tệp phải được giữ — nếu không, diff hoá thành TOÀN TỆP").toContain("\r\n");
    expect(
      moi.split("\n").slice(0, -1).every((l) => l.endsWith("\r")),
      "KHÔNG được trộn LF của model vào giữa một tệp CRLF",
    ).toBe(true);
    expect(moi).toContain("ArgumentException");
    expect(dienDiff(dia, moi), "DIFF SẠCH: MỘT khối, CHÈN đúng một dòng, xoá 0").toEqual({
      khoi: 1,
      them: 1,
      xoa: 0,
      oversize: false,
    });
    expect(r.events.some((e) => e.type === "pending_action")).toBe(true);
    expect(bamDeThi(), "đề thi KHÔNG đổi một byte").toBe(truoc);
  });

  /**
   * ★★★ SO SÁNH TRỰC DIỆN — cùng câu, cùng ý định, hai chế độ. Đây là chỗ mệnh đề "diff sạch" trở
   * thành một con số chứ không phải một lời khen: bản chép tay của model lệch một dòng chú thích là
   * người duyệt phải đọc thêm một dòng nhiễu; ở tệp 1.500 dòng thì "thêm một dòng" là cả tệp.
   */
  it("★★★ ĐO đối chứng: đường KHỐI cho diff 1 dòng, đường CHÉP-CẢ-TỆP cho diff nhiễu", async () => {
    const dia = diaDemo(R_CALC);
    const neo = ["    {", "        return a / b;", "    }"].join("\n");
    const thay = ["    {", "        if (b == 0) throw new ArgumentException(\"x\");", "        return a / b;", "    }"].join("\n");

    h.manh = [khoi(neo, thay)];
    await trongDemo(`sửa ${R_CALC}: Divide ném ArgumentException khi chia 0`);
    const khoiDiff = dienDiff(dia, String(ghiNhan("apply_diff")[0]!.modified));

    // Cùng kết quả mong muốn, nhưng model chép lại cả tệp và — như 30B vẫn làm — gõ lệch một chỗ.
    h.quyetDinh = [];
    h.moiHeThong = [];
    h.moiPrompt = [];
    process.env.AI_CODING_EDIT_HUNKS = "0";
    const chepTay = dia
      .replace(/\r\n/g, "\n")
      .replace(neo, thay)
      .replace("/// <summary>", "///<summary>") // một ký tự lệch, rất thật
      .replace("public int Add(int a, int b) => a + b;", "public int Add(int a, int b) => a+b;");
    h.manh = ["```csharp\n" + chepTay + "\n```"];
    await trongDemo(`sửa ${R_CALC}: Divide ném ArgumentException khi chia 0`);
    const chepDiff = dienDiff(dia, String(ghiNhan("apply_diff")[0]!.modified));

    expect(khoiDiff.khoi, "đường khối: ĐÚNG MỘT khối để người duyệt đọc").toBe(1);
    expect(
      chepDiff.khoi,
      "mỗi ký tự model gõ lệch là MỘT KHỐI NỮA người duyệt phải đọc — và họ không phân biệt được khối nào là việc họ xin",
    ).toBeGreaterThan(khoiDiff.khoi);
    expect(chepDiff.them + chepDiff.xoa).toBeGreaterThan(khoiDiff.them + khoiDiff.xoa);
  });

  /** ★★ Các cách gõ tự nhiên khác của CÙNG một ý định — tất cả phải đi cùng một đường. */
  const bienThe: Array<[string, string]> = [
    ["dấu hai chấm (vi)", `sửa ${R_CALC}: thêm kiểm tra chia 0`],
    ["không dấu câu (vi)", `sửa ${R_CALC} để Divide ném ArgumentException khi chia 0`],
    ["động từ 'cập nhật' (vi)", `cập nhật ${R_CALC} — chặn mẫu số bằng 0`],
    ["tiếng Việt KHÔNG DẤU", `sua ${R_CALC}: them kiem tra chia 0`],
    ["colon (en)", `edit ${R_CALC}: throw ArgumentException on divide by zero`],
    ["fix (en)", `fix ${R_CALC} so that Divide throws when b is 0`],
    ["toàn rộng (zh)", `修改 ${R_CALC}：除数为 0 时抛出 ArgumentException`],
  ];
  for (const [ten, q] of bienThe) {
    it(`★★★ biến thể "${ten}" ⇒ tới ĐƯỜNG KHỐI với đúng byte đĩa`, async () => {
      const dia = diaDemo(R_CALC);
      h.manh = [khoi("        return a / b;", "        return a / b; // x")];
      await trongDemo(q);
      expect(h.moiHeThong[0], `"${q}" phải đi đường khối`).toContain(MOC_MO);
      const ad = ghiNhan("apply_diff");
      expect(ad.length, `"${q}" phải ra đúng một đề xuất`).toBe(1);
      expect(ad[0]!.original).toBe(dia);
      expect(dienDiff(dia, String(ad[0]!.modified)).khoi).toBe(1);
    });
  }

  it("★★★ NHIỀU TỆP một lượt: mỗi tệp một lượt khối RIÊNG, MỘT thẻ duyệt, N băm neo RIÊNG", async () => {
    const truoc = bamDeThi();
    const dCalc = diaDemo(R_CALC);
    const dStr = diaDemo(R_STR);
    h.hangDoi = [
      [khoi("public class Calculator", "// Dự án thử AI local\npublic class Calculator")],
      [khoi("    public static class StringUtils", "    // Dự án thử AI local\n    public static class StringUtils")],
    ];
    await trongDemo(`sửa ${R_CALC} và ${R_STR}: thêm dòng chú thích \`// Dự án thử AI local\` lên đầu mỗi tệp`);

    const lo = ghiNhan("apply_diff_batch");
    expect(lo.length, "MỘT thẻ duyệt cho cả lô").toBe(1);
    const files = lo[0]!.files as Array<{ path: string; original: string; modified: string }>;
    expect(files.map((f) => f.path)).toEqual([R_CALC, R_STR]);
    expect(files[0]!.original).toBe(dCalc);
    expect(files[1]!.original).toBe(dStr);
    expect(files[0]!.original, "hai tệp ⇒ hai neo KHÁC nhau").not.toBe(files[1]!.original);
    for (const f of files) expect(dienDiff(f.original, f.modified).khoi, `${f.path} phải là diff SẠCH`).toBe(1);
    expect(h.moiPrompt.length, "N tệp ⇒ N lượt model RIÊNG (không nhồi vào một prompt)").toBe(2);
    expect(bamDeThi()).toBe(truoc);
  });

  it("★★★ một tệp trong lô có neo TRÙNG ⇒ CẢ LÔ dừng, 0 đề xuất ghi", async () => {
    const truoc = bamDeThi();
    h.hangDoi = [
      [khoi("public class Calculator", "// ok\npublic class Calculator")],
      [khoi("{", "{ // x")], // `{` trùng RẤT nhiều chỗ trong StringUtils.cs
    ];
    await trongDemo(`sửa ${R_CALC} và ${R_STR}: thêm chú thích lên đầu`);
    expect(ghiNhan("apply_diff").length).toBe(0);
    expect(ghiNhan("apply_diff_batch").length).toBe(0);
    expect(bamDeThi()).toBe(truoc);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§9 — BẤT BIẾN KHÔNG ĐƯỢC ĐỘNG TỚI: HITL · tự trị · danh sách tool · cửa ghi", () => {
  /**
   * ★★★ Hợp đồng khối cố ý KHÔNG đẻ ra tool mới. Ca này phát biểu điều đó thành một con số: sau
   * lượt này vẫn đúng HAI tool ghi của tác nhân lập trình, không hơn.
   */
  it("★★★ KHÔNG có tool ghi MỚI — hợp đồng khối là chuyện của PROMPT, không của sổ đăng ký", () => {
    expect(AUTONOMY_INELIGIBLE.has("apply_diff")).toBe(true);
    expect(AUTONOMY_INELIGIBLE.has("apply_diff_batch")).toBe(true);
    expect(CODING_TOOL_NAMES).not.toContain("apply_diff_batch");
    expect(CODING_LOOP_TOOL_NAMES).not.toContain("apply_diff");
    expect(CODING_LOOP_TOOL_NAMES).not.toContain("apply_diff_batch");
  });

  it("★★★ bộ chọn LLM vẫn KHÔNG khởi xướng được lượt ghi nào (neo của nó luôn là phỏng đoán)", () => {
    for (const t of ["apply_diff", "apply_diff_batch"]) {
      const q = locQuyetDinhLLMLapTrinh({ tool: t, args: { path: "src/x.ts", original: "", modified: "y" } } as any);
      expect(q.tool, `${t} do LLM đề xuất phải bị vô hiệu`).toBeNull();
    }
  });

  it("★★★ mọi lượt ghi ra `pending_action`, KHÔNG BAO GIỜ ra `result`", async () => {
    h.manh = [khoi("  return a + b;", "  return b + a;")];
    const r = await trongRepoTam(`sửa ${R_NHO}: đổi thứ tự cộng`);
    expect(r.events.filter((e) => e.type === "pending_action").length).toBe(1);
    expect(r.events.some((e) => e.type === "tool" && (e as any).toolName === "apply_diff")).toBe(false);
  });

  it("★★ cờ `AI_CODING_EDIT=0` ⇒ KHÔNG đường ghi nào chạy, kể cả đường khối", async () => {
    process.env.AI_CODING_EDIT = "0";
    h.manh = [khoi("  return a + b;", "  return b + a;")];
    await trongRepoTam(`sửa ${R_NHO}: đổi thứ tự cộng`);
    expect(ghiNhan("apply_diff").length).toBe(0);
    expect(h.moiPrompt.length, "không gọi model lượt sửa nào").toBe(0);
  });

  it("★★★ HỘP CÁT không bị đường khối nới một byte: đường thoát vẫn bị chặn TRƯỚC khi gọi model", async () => {
    for (const p of ["../ngoai.ts", "src/../../ngoai.ts", ".env", "node_modules/x/index.js"]) {
      h.quyetDinh = [];
      h.moiPrompt = [];
      h.manh = [khoi("a", "b")];
      await trongRepoTam(`sửa ${p}: đổi gì đó`);
      expect(ghiNhan("apply_diff").length, `${p} phải bị từ chối`).toBe(0);
      /**
       * ⚠ Mệnh đề phải là *"không lượt SỬA nào khởi động"*, KHÔNG phải *"0 lượt model"*: `.env`
       *   trần không được bộ trích nhận là đường dẫn nên câu rơi xuống nhánh SINH MÃ — một lượt
       *   gọi model hoàn toàn hợp lệ, và persona của nó KHÔNG phải persona khối.
       */
      expect(
        h.moiHeThong.every((s) => !s.includes(MOC_MO)),
        `${p}: KHÔNG được có lượt SỬA nào (persona khối phải vắng mặt)`,
      ).toBe(true);
    }
  });

  it("★★ `dongBoXuongDong` vẫn là bên quyết định kiểu xuống dòng (khối chỉ so trên bản LF)", () => {
    expect(dongBoXuongDong("a\r\nb\r\n", "a\nc\n")).toBe("a\r\nc\r\n");
  });
});
