/**
 * ★★★ doc 79 (2026-08-20) — **TẠO TỆP MỚI + SỬA NHIỀU TỆP: cổng ra đầu–cuối của ĐỊNH TUYẾN.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY KHÔNG PHẢI MỘT BẢN SAO CỦA `applyDiffBatch.census.test.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai lưới trả lời hai câu hỏi KHÁC NHAU, và bài học đắt nhất của doc 79 là chúng phải TÁCH:
 *
 *   • `applyDiffBatch.census.test.ts` hỏi *"TOOL có ghi đúng không?"* — repo git THẬT, đĩa THẬT.
 *   • File này hỏi *"CÂU HỎI CỦA NGƯỜI DÙNG có tới được tool không?"* — và đó chính là chỗ hỏng:
 *     `apply_diff` **đã** hỗ trợ tạo tệp từ 2026-08-19 (`{path, original:"", modified}` là hợp đồng
 *     hợp lệ, có băm neo), nhưng `laYDinhSuaTep` **không có động từ `tao`** nên câu *"tạo file mới
 *     src/utils/date.ts"* rơi xuống đường ĐỌC và trả *"không tìm thấy tệp"*. Tool đúng, đường sai.
 *     Một lưới chỉ đo tool sẽ XANH suốt trong khi tính năng KHÔNG dùng được — đúng lớp lỗi đã làm
 *     trục 1 (D) "101 ca xanh mà không chạy live".
 *
 * ⚠ `sandbox-projects/**` là ĐỀ THI: lưới này chỉ ĐỌC nó và **khẳng định nó KHÔNG đổi một byte**.
 * ⚠ KHÔNG gọi model thật: `generateTextStream` bị chặn ở tầng thấp nhất (`aiGgufEngine`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const h = vi.hoisted(() => ({
  manh: [] as string[],
  systemPromptNhan: "" as string,
  promptNhan: "" as string,
  /** MỌI prompt đã gửi lên model trong lượt — lô nhiều tệp phải có N prompt, không phải 1. */
  moiPrompt: [] as string[],
  /** Mọi quyết định đi qua `executeDecision` — bản kiểm đếm của mọi §. */
  quyetDinh: [] as Array<{ tool: string | null; args: Record<string, unknown> }>,
  llmDoanTool: null as { tool: string; args: Record<string, unknown> } | null,
  /**
   * ★ HÀNG ĐỢI đầu ra model, MỘT phần tử cho MỖI lượt gọi. Rỗng ⇒ mọi lượt dùng `manh`.
   * Cần cho ca "tệp 2 không đổi": hai lượt gọi phải trả HAI thứ khác nhau.
   */
  hangDoi: [] as string[][],
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
    h.moiPrompt.push(h.promptNhan);
    const ra = h.hangDoi.length > 0 ? (h.hangDoi.shift() ?? []) : h.manh;
    for (const m of ra) yield { type: "token", token: m };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: ra.length };
  },
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => ({ insert: () => ({ values: async () => undefined }) })),
}));

/**
 * ⚠ MOCK **BỘ PHẬN**: `read_file`/`list_files` chạy THẬT (hộp cát + RBAC + byte thật trên đĩa) —
 * đó là điều kiện để mệnh đề *"`original` gửi đi là byte TRÊN ĐĨA"* có nghĩa. Chỉ hai tool GHI bị
 * chặn ở cửa HITL để lưới không cần bảng `ai_pending_actions`.
 *
 * ⚠⚠ CA (v) — BỎ HITL ⇒ ĐỎ: mock này **không** chặn `apply_diff*` ở tầng registry mà ở tầng
 * `executeDecision`, tức đúng CỬA mà mọi `kind:"write"` phải đi qua. §8 khẳng định lượt ghi luôn ra
 * `pendingAction` và **không bao giờ** ra `result`; ai gỡ HITL (cho write tool chạy thẳng) sẽ làm
 * `pendingAction` biến mất và §4/§8 ĐỎ.
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

import { streamAnswer, laYDinhTaoTep, laYDinhSuaTep, type StreamEvent } from "./aiLocalKnowledgeService";
import { chuanHoaTepMoi, dongBoXuongDong } from "./aiCodingAgent";
import {
  trichMoiDuongDanRepo,
  locQuyetDinhLLMLapTrinh,
  CODING_TOOL_NAMES,
  CODING_LOOP_TOOL_NAMES,
} from "./aiLocalTools/intentClassifier";

const TEP_A = "sandbox-projects/csharp-demo/src/Calculator.cs";
const TEP_B = "sandbox-projects/csharp-demo/tests/CalculatorTests.cs";
/** Tệp CHƯA TỒN TẠI — không lượt nào trong file này được tạo nó (apply_diff dừng ở HITL). */
const TEP_MOI = "sandbox-projects/csharp-demo/src/ChuaTonTai_LuoiTest.cs";

const MA_MOI = ["```csharp", "namespace CalculatorDemo;", "public static class NgayThang { }", "```", "", "- Tệp tiện ích."].join("\n");

let idPhien = 7000;
/**
 * ⚠ Vai `admin` vì `read_file` cưỡng chế `ai_repo_read/canView` THẬT qua `checkPermission` (đúng
 * như ta muốn — RBAC không bị mock). Lưới này đo ĐỊNH TUYẾN, không đo RBAC; RBAC có lưới riêng
 * (`readToolRbac`), và `applyDiff.census.test.ts` §0 canh `requiredPermission` của cửa ghi.
 */
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

function bamCay(): string {
  const g = createHash("sha256");
  for (const rel of [TEP_A, TEP_B]) g.update(fs.readFileSync(path.resolve(process.cwd(), rel)));
  g.update(String(fs.existsSync(path.resolve(process.cwd(), TEP_MOI))));
  return g.digest("hex");
}

const ENV = ["AI_CODING_GEN", "AI_CODING_EDIT", "AI_CODING_REPO_CONTEXT", "AI_REPO_SANDBOX_ROOTS"] as const;

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  // Ngữ cảnh mã (trục 1 D) đi qua tầng truy hồi thật ⇒ chậm và không tất định. Nó KHÔNG liên quan
  // tới đường sửa/tạo tệp (doc 79 (D) cố ý không nối nó vào đường SỬA), nên tắt cho tất định.
  process.env.AI_CODING_REPO_CONTEXT = "0";
  h.manh = [];
  h.systemPromptNhan = "";
  h.promptNhan = "";
  h.moiPrompt = [];
  h.quyetDinh = [];
  h.llmDoanTool = null;
  h.hangDoi = [];
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — `laYDinhTaoTep`: nhận diện ý định TẠO ở vi/en/zh (hàm THUẦN, không mock)", () => {
  const co = [
    "tạo file mới src/utils/date.ts",
    "tạo một file src/utils/date.ts để format ngày",
    "khởi tạo file cấu hình config/app.json",
    "thêm file helper shared/x.ts",
    "viết file mới server/a.ts",
    "create a new file src/utils/date.ts",
    "create file src/a.ts that formats dates",
    "add a new module src/b.ts",
    "generate a component client/src/C.tsx",
    "创建一个文件 src/a.ts",
    "新建文件 src/b.ts",
    "新增模块 src/c.ts",
  ];
  for (const q of co) it(`★★ "${q}" ⇒ Ý ĐỊNH TẠO`, () => expect(laYDinhTaoTep(q)).toBe(true));

  /**
   * ⚠⚠ CA ÂM QUAN TRỌNG HƠN CA DƯƠNG Ở ĐÂY. Nhận nhầm SỬA thành TẠO nghĩa là gửi `original:""`
   * cho một tệp đang có nội dung — tức đề xuất **xoá sạch tệp rồi ghi đè**.
   */
  const khong = [
    "đọc server/routers.ts và cho biết export gì",
    "sửa src/Calculator.cs để Divide ném ArgumentException",
    "xem file src/a.ts",                       // `file` có, động từ TẠO không có
    "tao nhã quá",                              // `tao` trần — KHÔNG được khớp
    "viết lại hàm Divide trong src/a.ts",      // `viet lai` là SỬA, không phải TẠO
    "OEE hôm nay của line 2 bao nhiêu",
    "máy nào đang offline",
    "cập nhật src/a.ts cho đúng chuẩn",
  ];
  for (const q of khong) it(`★★★ "${q}" ⇒ KHÔNG phải ý định TẠO`, () => expect(laYDinhTaoTep(q)).toBe(false));

  it("★★★ VÙNG CHỒNG LẤN được nhận ra, KHÔNG bị giấu: 'thêm file …' khớp CẢ HAI vị từ", () => {
    const q = "thêm file helper shared/x.ts";
    expect(laYDinhTaoTep(q)).toBe(true);
    expect(laYDinhSuaTep(q), "`them` nằm trong CẢ hai danh sách — nên ĐĨA phải là bên phán quyết").toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — `trichMoiDuongDanRepo`: MỌI đường dẫn, đúng thứ tự, khử trùng lặp (hàm THUẦN)", () => {
  it("★★★ hai tệp trong một câu ⇒ hai đường dẫn, đúng thứ tự", () => {
    expect(trichMoiDuongDanRepo("sửa server/a.ts và client/src/b.tsx cho khớp nhau")).toEqual([
      "server/a.ts",
      "client/src/b.tsx",
    ]);
  });

  it("★★ dấu phẩy/nháy/ngoặc đều tách được", () => {
    expect(trichMoiDuongDanRepo("đổi tên hàm ở `server/a.ts`, `server/b.ts` (và shared/c.ts)")).toEqual([
      "server/a.ts",
      "server/b.ts",
      "shared/c.ts",
    ]);
  });

  it("★★★ trùng lặp bị khử — một tệp nhắc hai lần KHÔNG thành hai mục (lô sẽ từ chối trùng)", () => {
    expect(trichMoiDuongDanRepo("sửa server/a.ts rồi kiểm server/a.ts lại")).toEqual(["server/a.ts"]);
  });

  it("★★★ trả NGUYÊN VĂN đường xấu — hộp cát mới là bên TỪ CHỐI, không phải bộ trích", () => {
    expect(trichMoiDuongDanRepo("sửa ../ngoai.ts và server/khoa.pem")).toEqual(["../ngoai.ts", "server/khoa.pem"]);
  });

  /**
   * ⚠⚠ SỰ THẬT ĐO ĐƯỢC, ghi lại để người sau không tưởng nhầm đây là một hàng rào:
   * `.env` TRẦN **không** khớp `REPO_PATH_REGEX` (mẫu đòi ít nhất một ký tự trước dấu chấm cuối),
   * nên nó không bao giờ trở thành ứng viên của đường sửa/tạo. Đó là một **sự trùng hợp của mẫu
   * nhận diện**, KHÔNG phải một phép chặn: hàng rào thật với `.env*` nằm ở `phanQuyetDuongDan`
   * (`DENIED_SECRET`), và nó được đo trên TOOL ở `applyDiff.census.test.ts` §F +
   * `applyDiffBatch.census.test.ts` §D. Đừng bao giờ dựa vào dòng này để kết luận `.env` an toàn.
   */
  it("★★ `.env` trần KHÔNG được bộ trích nhận (trùng hợp của mẫu, KHÔNG phải hàng rào)", () => {
    expect(trichMoiDuongDanRepo("sửa .env và server/a.ts")).toEqual(["server/a.ts"]);
    expect(trichMoiDuongDanRepo("sửa config.env"), "có tiền tố ⇒ NHẬN, để hộp cát từ chối").toEqual(["config.env"]);
  });

  it("★ một tệp ⇒ một mục (đường nhiều tệp KHÔNG kích hoạt)", () => {
    expect(trichMoiDuongDanRepo("sửa server/a.ts").length).toBe(1);
  });

  it("★ không tệp nào ⇒ mảng rỗng", () => {
    expect(trichMoiDuongDanRepo("viết code C# cho chat LAN")).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — `chuanHoaTepMoi`: vì sao lượt TẠO KHÔNG dùng được `dongBoXuongDong`", () => {
  it("★★★ ĐO SỰ KHÁC BIỆT: `dongBoXuongDong('', x)` CẮT dòng cuối; `chuanHoaTepMoi` GIỮ", () => {
    const x = "export const A = 1;\n";
    expect(
      dongBoXuongDong("", x),
      "hàm suy-từ-gốc áp lên một lượt KHÔNG CÓ GỐC ⇒ tệp mới mất newline cuối, im lặng",
    ).toBe("export const A = 1;");
    expect(chuanHoaTepMoi(x)).toBe("export const A = 1;\n");
  });

  it("★★ CRLF của model bị đưa về LF, và đúng MỘT dòng trống cuối", () => {
    expect(chuanHoaTepMoi("a\r\nb\r\n\r\n\r\n")).toBe("a\nb\n");
    expect(chuanHoaTepMoi("a\nb")).toBe("a\nb\n");
  });

  it("★ nội dung rỗng vẫn rỗng (không đẻ ra một tệp chỉ có newline)", () => {
    expect(chuanHoaTepMoi("")).toBe("");
    expect(chuanHoaTepMoi("   \n\n ")).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — TẠO TỆP MỚI: câu của brief đi tới `apply_diff` với `original` RỖNG", () => {
  it("★★★ 'tạo file mới …' ⇒ ĐỀ XUẤT apply_diff, `original` === '' , đĩa KHÔNG đổi", async () => {
    const truoc = bamCay();
    h.manh = [MA_MOI];
    const r = await chay(`tạo file mới ${TEP_MOI} chứa một class tiện ích ngày tháng`, admin());

    const ad = h.quyetDinh.filter((q) => q.tool === "apply_diff");
    expect(ad.length, "phải có ĐÚNG một lượt đề xuất ghi").toBe(1);
    expect(ad[0]!.args.path).toBe(TEP_MOI);
    expect(ad[0]!.args.original, "TẠO ⇒ original phải RỖNG (băm neo là băm(''))").toBe("");
    expect(String(ad[0]!.args.modified)).toContain("class NgayThang");
    expect(String(ad[0]!.args.modified).endsWith("\n"), "tệp mới phải kết thúc bằng newline").toBe(true);

    // HITL: ra `pending_action`, KHÔNG có `result` ghi thẳng.
    expect(r.events.some((e) => e.type === "pending_action")).toBe(true);
    expect(bamCay(), "chưa ai bấm duyệt ⇒ đĩa NGUYÊN VẸN").toBe(truoc);
    expect(fs.existsSync(path.resolve(process.cwd(), TEP_MOI))).toBe(false);
  });

  it("★★★ persona là TẠO TỆP MỚI, và prompt KHÔNG có khối 'NỘI DUNG HIỆN TẠI'", async () => {
    h.manh = [MA_MOI];
    await chay(`tạo file mới ${TEP_MOI} chứa một class tiện ích`, admin());
    expect(h.systemPromptNhan).toContain("TẠO MỘT TỆP MỚI");
    expect(h.systemPromptNhan, "dặn model giữ nguyên thứ KHÔNG có là mời nó bịa").not.toContain("GIỮ NGUYÊN từng ký tự");
    expect(h.promptNhan).toContain("Tệp MỚI cần tạo");
    expect(h.promptNhan, "không có nội dung hiện tại nào để chở").not.toContain("NỘI DUNG HIỆN TẠI");
  });

  it("★★ model trả khối RỖNG ⇒ KHÔNG đề xuất ghi (không tạo tệp rỗng)", async () => {
    h.manh = ["```csharp\n\n```"];
    const r = await chay(`tạo file mới ${TEP_MOI} chứa gì đó`, admin());
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff")).toBe(false);
    expect(r.chu).toContain("nội dung RỖNG");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — (i) TẠO trên tệp ĐÃ TỒN TẠI ⇒ BỊ CHẶN, không ghi đè im lặng", () => {
  it("★★★ 'tạo file mới <tệp đã có>' ⇒ TỪ CHỐI, KHÔNG gọi model, KHÔNG đề xuất ghi", async () => {
    const truoc = bamCay();
    h.manh = [MA_MOI];
    const r = await chay(`tạo file mới ${TEP_A} chứa một class tiện ích`, admin());

    expect(r.chu, "phải nói thẳng tệp đã tồn tại").toContain("ĐÃ TỒN TẠI");
    expect(
      h.quyetDinh.some((q) => q.tool === "apply_diff" || q.tool === "apply_diff_batch"),
      "một lượt 'tạo' trên tệp có sẵn KHÔNG được biến thành một đề xuất ghi đè",
    ).toBe(false);
    expect(h.moiPrompt.length, "không gọi model — quyết định được bằng ĐĨA").toBe(0);
    expect(bamCay()).toBe(truoc);
  });

  it("★★★ CHỐNG VÁ QUÁ TAY — câu vừa TẠO vừa SỬA trên tệp đã có ⇒ vẫn đi đường SỬA (không chặn nhầm)", async () => {
    h.manh = [MA_MOI];
    await chay(`thêm file helper và sửa ${TEP_A} để Divide ném lỗi`, admin());
    const ad = h.quyetDinh.filter((q) => q.tool === "apply_diff");
    expect(ad.length, "đây là một lượt SỬA hợp lệ, không được biến thành lời từ chối").toBe(1);
    expect(ad[0]!.args.original, "SỬA ⇒ original là byte THẬT trên đĩa, không rỗng").not.toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — tệp KHÔNG có + KHÔNG xin tạo ⇒ hành vi CŨ y nguyên, cộng một câu chỉ đường", () => {
  it("★★★ 'đọc <tệp chưa có>' ⇒ vẫn NOT_FOUND, KHÔNG gọi model, KHÔNG đề xuất ghi", async () => {
    h.manh = [MA_MOI];
    const r = await chay(`sửa ${TEP_MOI} cho gọn`, admin());
    expect(r.chu).toContain("Không có tệp");
    expect(r.chu, "trước lượt này TẠO là bất khả ⇒ người dùng cần biết nay nó khả thi").toContain("tạo file mới");
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff")).toBe(false);
    expect(h.moiPrompt.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§7 — (iii) HỘP CÁT trên đường TẠO: tệp mới KHÔNG phải một lỗ nới hộp cát", () => {
  /**
   * ⚠⚠ Đây là mệnh đề về ĐỊNH TUYẾN: mọi lượt TẠO đều đi qua `read_file` TRƯỚC (để chứng minh tệp
   * chưa tồn tại), nên chính sách đường dẫn của hộp cát chặn TRƯỚC KHI model được gọi. Mệnh đề về
   * TOOL (`apply_diff` tự chặn lần nữa) nằm ở `applyDiff.census.test.ts` §F và
   * `applyDiffBatch.census.test.ts` §D — hai hàng rào ĐỘC LẬP, đo ở hai chỗ.
   */
  const xau: Array<[string, string, string]> = [
    ["đuôi ngoài danh sách trắng", "sandbox-projects/anh-moi.png", "Phần mở rộng"],
    ["đường `..`", "../ngoai-moi.ts", "TỪ CHỐI"],
    ["thư mục cấm", "node_modules/moi/index.ts", "loại trừ"],
    ["tệp bí mật (khoá riêng)", "server/khoa-moi.pem", "CẤM"],
  ];
  for (const [ten, p, chua] of xau) {
    it(`★★★ TẠO "${p}" (${ten}) ⇒ hộp cát TỪ CHỐI, KHÔNG gọi model, KHÔNG đề xuất ghi`, async () => {
      h.manh = [MA_MOI];
      const r = await chay(`tạo file mới ${p} với nội dung gì đó`, admin());
      expect(r.chu).toContain(chua);
      expect(h.quyetDinh.some((q) => q.tool === "apply_diff" || q.tool === "apply_diff_batch")).toBe(false);
      expect(h.moiPrompt.length, "không một token nào được đốt cho một đường bị cấm").toBe(0);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§8 — SỬA NHIỀU TỆP: N lượt model, MỘT thẻ duyệt, N băm neo RIÊNG", () => {
  it("★★★ hai tệp ⇒ ĐÚNG MỘT `apply_diff_batch`, mỗi mục `original` = byte THẬT của CHÍNH tệp đó", async () => {
    const truoc = bamCay();
    h.manh = [MA_MOI];
    const r = await chay(`sửa ${TEP_A} và ${TEP_B} để đổi tên hàm Divide thành Chia`, admin());

    const lo = h.quyetDinh.filter((q) => q.tool === "apply_diff_batch");
    expect(lo.length, "MỘT thẻ duyệt cho cả lô — đó là toàn bộ điểm của đường này").toBe(1);
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff").length, "KHÔNG đề xuất lẻ song song").toBe(0);

    const files = lo[0]!.args.files as Array<{ path: string; original: string; modified: string }>;
    expect(files.map((f) => f.path)).toEqual([TEP_A, TEP_B]);
    for (const f of files) {
      const dia = fs.readFileSync(path.resolve(process.cwd(), f.path), "utf8");
      expect(f.original, `original của ${f.path} phải là byte TRÊN ĐĨA, không phải model tự nhớ`).toBe(dia);
    }
    expect(
      files[0]!.original,
      "hai tệp KHÁC nhau ⇒ hai neo KHÁC nhau; giống nhau nghĩa là một neo dùng chung",
    ).not.toBe(files[1]!.original);

    expect(r.events.some((e) => e.type === "pending_action")).toBe(true);
    expect(bamCay(), "chưa ai bấm duyệt ⇒ đĩa NGUYÊN VẸN").toBe(truoc);
  });

  it("★★★ NGÂN SÁCH TOKEN: model được gọi MỘT TỆP MỘT LƯỢT (không nhồi N tệp vào một prompt)", async () => {
    h.manh = [MA_MOI];
    await chay(`sửa ${TEP_A} và ${TEP_B} để đổi tên hàm Divide thành Chia`, admin());
    expect(h.moiPrompt.length, "hai tệp ⇒ hai lượt gọi model, mỗi lượt cân ngân sách RIÊNG").toBe(2);
    const [p1, p2] = h.moiPrompt;
    /**
     * ⚠ Khẳng định trên **NỘI DUNG**, không trên đường dẫn: prompt nào cũng chở câu hỏi của người
     * dùng, mà câu hỏi ấy nêu CẢ HAI tên tệp. Một ca khẳng định `p1` không chứa chuỗi `TEP_B` sẽ
     * ĐỎ vì lý do SAI (nó đo câu hỏi, không đo ngân sách). Thứ đắt token là NỘI DUNG TỆP.
     */
    const dauAnA = "DỰ ÁN THỬ để kiểm chứng AI local code được C#"; // chỉ có trong Calculator.cs
    const dauAnB = "Add_HaiSoDuong"; // chỉ có trong CalculatorTests.cs
    expect(p1).toContain(dauAnA);
    expect(p1, "nội dung tệp 2 lọt vào prompt tệp 1 = đúng cách làm vượt trần slot 32.768").not.toContain(dauAnB);
    expect(p2).toContain(dauAnB);
    expect(p2).not.toContain(dauAnA);
  });

  it("★★★ MỘT thẻ tool tổng (không N thẻ) — `streamTool` của client là một ô GHI ĐÈ", async () => {
    h.manh = [MA_MOI];
    const r = await chay(`sửa ${TEP_A} và ${TEP_B} để đổi tên hàm Divide thành Chia`, admin());
    const the = r.events.filter((e) => e.type === "tool");
    expect(the.length, "N thẻ ⇒ người dùng chỉ thấy thẻ CUỐI ⇒ N−1 tệp thành nguồn ẩn").toBe(1);
    const ts = String((the[0] as any).toolResult?.textSummary ?? "");
    expect(ts).toContain(TEP_A);
    expect(ts).toContain(TEP_B);
  });

  it("★★★ DỪNG Ở TỆP ĐỎ ĐẦU TIÊN: một tệp trong lô không đọc được ⇒ KHÔNG đề xuất gì cả", async () => {
    const truoc = bamCay();
    h.manh = [MA_MOI];
    const r = await chay(`sửa ${TEP_A} và ${TEP_MOI} để đổi tên hàm Divide thành Chia`, admin());
    expect(r.chu).toContain("CẢ LÔ dừng");
    expect(
      h.quyetDinh.some((q) => q.tool === "apply_diff" || q.tool === "apply_diff_batch"),
      "sửa 1/2 nơi là một cây mã hỏng — thà không đề xuất gì",
    ).toBe(false);
    expect(bamCay()).toBe(truoc);
  });

  it("★★ TRẦN SỐ TỆP nói thẳng con số, KHÔNG âm thầm cắt danh sách người dùng gõ", async () => {
    h.manh = [MA_MOI];
    const ds = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"].map((x) => `server/${x}`);
    const r = await chay(`sửa ${ds.join(" và ")} cho đồng bộ`, admin());
    expect(r.chu).toContain("tối đa");
    expect(r.chu).toContain("7");
    expect(h.moiPrompt.length, "chặn TRƯỚC khi đốt một lượt model nào").toBe(0);
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff_batch")).toBe(false);
  });

  it("★★★ MỘT tệp đổi trong lô hai tệp ⇒ dùng `apply_diff` (thẻ diff giàu hơn), KHÔNG dùng lô", async () => {
    // Lượt 2 của model trả lại NGUYÊN nội dung tệp B ⇒ B "không đổi" ⇒ chỉ còn A có thay đổi.
    const LF = String.fromCharCode(10);
    const noiDungB = fs
      .readFileSync(path.resolve(process.cwd(), TEP_B), "utf8")
      .split(String.fromCharCode(13, 10))
      .join(LF)
      .replace(new RegExp(`${LF}+$`), "");
    h.hangDoi = [[MA_MOI], [`\`\`\`csharp${LF}${noiDungB}${LF}\`\`\``]];
    await chay(`sửa ${TEP_A} và ${TEP_B} để đổi tên hàm Divide thành Chia`, admin());
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff").length, "một tệp ⇒ apply_diff").toBe(1);
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff_batch").length, "không dựng lô một mục").toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§9 — (iv) BỘ CHỌN LLM KHÔNG ĐƯỢC KHỞI XƯỚNG TOOL GHI MỚI (hai lớp độc lập)", () => {
  it("★★★ lớp 1 — `apply_diff_batch` KHÔNG có trong `CODING_TOOL_NAMES` ⇒ hậu-lọc chặn", () => {
    expect([...CODING_TOOL_NAMES]).not.toContain("apply_diff_batch");
  });

  it("★★★ lớp 2 — `locQuyetDinhLLMLapTrinh` vô hiệu hoá quyết định `apply_diff_batch`", () => {
    const d = locQuyetDinhLLMLapTrinh({
      tool: "apply_diff_batch",
      args: { files: [{ path: "server/a.ts", original: "bia", modified: "bia2" }] },
      reason: "LLM_OK",
    });
    expect(d.tool, "LLM không đọc tệp ⇒ mọi `original` của nó là phỏng đoán").toBeNull();
    expect(d.reason).toBe("CODING_LLM_KHONG_KHOI_XUONG_GHI");
    expect(d.args).toEqual({});
  });

  it("★★★ CHỐNG VÁ QUÁ TAY — ba tool ĐỌC vẫn đi qua nguyên vẹn", () => {
    for (const t of ["read_file", "list_files", "grep_repo"] as const) {
      const d = locQuyetDinhLLMLapTrinh({ tool: t, args: { path: "server/a.ts" }, reason: "LLM_OK" });
      expect(d.tool, `${t} không phải tool ghi — không được chặn`).toBe(t);
    }
  });

  it("★★★ VÒNG TOOL ≥2 (nội dung tệp lái quyết định) KHÔNG thấy tool ghi lô", () => {
    expect([...CODING_LOOP_TOOL_NAMES]).not.toContain("apply_diff_batch");
    expect([...CODING_LOOP_TOOL_NAMES]).not.toContain("apply_diff");
    expect([...CODING_LOOP_TOOL_NAMES]).not.toContain("run_command");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§10 — (v) HITL: mọi lượt ghi ra `pending_action`, KHÔNG BAO GIỜ ra `result`", () => {
  it("★★★ TẠO một tệp ⇒ pending_action, không result", async () => {
    h.manh = [MA_MOI];
    const r = await chay(`tạo file mới ${TEP_MOI} chứa một class`, admin());
    const pa = r.events.filter((e) => e.type === "pending_action");
    expect(pa.length).toBe(1);
    expect((pa[0] as any).toolName).toBe("apply_diff");
  });

  it("★★★ LÔ nhiều tệp ⇒ pending_action, không result", async () => {
    h.manh = [MA_MOI];
    const r = await chay(`sửa ${TEP_A} và ${TEP_B} để đổi tên hàm Divide thành Chia`, admin());
    const pa = r.events.filter((e) => e.type === "pending_action");
    expect(pa.length).toBe(1);
    expect((pa[0] as any).toolName).toBe("apply_diff_batch");
  });

  it("★★ cờ `AI_CODING_EDIT=0` ⇒ KHÔNG có đường ghi nào chạy (cả tạo lẫn lô)", async () => {
    process.env.AI_CODING_EDIT = "0";
    h.manh = [MA_MOI];
    const r = await chay(`tạo file mới ${TEP_MOI} chứa một class`, admin());
    expect(h.quyetDinh.some((q) => q.tool === "apply_diff" || q.tool === "apply_diff_batch")).toBe(false);
    expect(r.chu).not.toContain("[HITL]");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ §11 — NGUYÊN VĂN CÂU NGƯỜI DÙNG ĐÃ GÕ TRÊN TRÌNH DUYỆT
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠⚠ VÌ SAO §11 TỒN TẠI TRONG KHI §8 ĐÃ XANH — ĐÂY LÀ BÀI HỌC ĐẮT NHẤT CỦA HAI LƯỢT LIÊN TIẾP.
 *
 * Hai lượt liền nhau cùng dính MỘT hình dạng lỗi: tính năng dựng xong, lưới xanh, đột biến đỏ —
 * **mà live không chạy**. Lần một: `codingRepoContext` (101 ca xanh, 9 đột biến đỏ, ngữ cảnh không
 * bao giờ được giao). Lần hai: `apply_diff_batch` (16 đột biến đỏ, census riêng, **`grep -ci
 * "apply_diff_batch"` trên log máy chủ = 0** — chưa từng ai gọi tới nó).
 *
 * Gốc rễ chung KHÔNG phải "thiếu ca". Nó là **ĐẦU VÀO CỦA CA ĐÃ ĐƯỢC DỌN SẴN**. §8 chạy đúng chuỗi
 * định tuyến thật, nhưng câu nó đưa vào là câu **tôi tự viết cho lưới**:
 *
 *     "sửa <A> và <B> để đổi tên hàm Divide thành Chia"          ← câu của LƯỚI, xanh
 *     "sửa <A> và <B>: thêm dòng chú thích ... lên đầu mỗi tệp"   ← câu của NGƯỜI, hỏng
 *
 * Khác nhau đúng **một dấu hai chấm**. `REPO_PATH_REGEX` kết thúc bằng một danh sách TRẮNG dấu câu
 * không có `:` ⇒ đường dẫn thứ hai bị bỏ ⇒ điều kiện `≥2` của đường LÔ không thoả ⇒ toàn bộ
 * `apply_diff_batch` thành mã chết. Một lưới chỉ chứa câu do chính tác giả dọn sẵn là một lưới
 * **TỰ THOẢ**: nó chứng minh "tool làm đúng KHI ĐƯỢC GỌI", chứ không bao giờ chứng minh
 * "câu người dùng gõ thật SẼ TỚI ĐƯỢC tool". Hai mệnh đề khác nhau, và chỉ mệnh đề thứ hai là thứ
 * người dùng trả tiền.
 *
 * ⇒ §11 phát biểu **mệnh đề thứ hai**, và dữ liệu ca của nó là **văn bản đã đi qua bàn phím thật**:
 *   nguyên văn câu ở phiên nghiệm thu 2026-08-21, cộng các biến thể tự nhiên vi/en/zh. Ai sửa
 *   `REPO_PATH_REGEX` hẹp lại một lần nữa sẽ thấy §11 đỏ **trước khi** người dùng thấy nó hỏng.
 *
 * ⚠ Và §11 dựng lại đúng HÌNH DẠNG PHIÊN LIVE, không chỉ câu chữ: một **dự án được chọn**
 *   (`projectId` ⇒ `AI_REPO_SANDBOX_ROOTS`) + đường dẫn **tương đối theo gốc dự án** (`src/…`).
 *   §8 dùng đường repo đầy đủ và không có `projectId` — tức nó cũng không đi qua đoạn phân giải gốc
 *   mà người dùng thật luôn đi qua.
 * ⚠ `sandbox-projects/**` là ĐỀ THI: mọi ca ở đây chỉ ĐỌC, và `bamCay()` khẳng định 0 byte đổi.
 */
describe("§11 — CÂU THẬT CỦA NGƯỜI DÙNG PHẢI TỚI ĐƯỢC `apply_diff_batch`", () => {
  /** Gốc dự án "Demo Csharp" — đúng thứ người dùng chọn ở bộ chọn dự án trước khi gõ câu hỏi. */
  const GOC_DU_AN = path.resolve(process.cwd(), "sandbox-projects", "csharp-demo");
  const ID_DU_AN = "csharpdemo";
  /** Đường dẫn TƯƠNG ĐỐI theo gốc dự án — đúng thứ người dùng gõ khi đã chọn dự án. */
  const R_CALC = "src/Calculator.cs";
  const R_TEST = "tests/CalculatorTests.cs";
  /** Tệp người dùng nêu trong câu live nhưng KHÔNG có trong đề thi (họ tạo nó ở một lượt khác). */
  const R_CHUA_CO = "src/StringUtils.cs";

  /** Nguyên văn, ký tự một ký tự, câu đã gõ trên `/ai-coding-workspace` phiên 2026-08-21. */
  const CAU_LIVE =
    "sửa src/Calculator.cs và src/StringUtils.cs: thêm dòng chú thích `// Dự án thử AI local` lên đầu mỗi tệp";

  beforeEach(() => {
    process.env.AI_REPO_SANDBOX_ROOTS = `${ID_DU_AN}=Demo Csharp|${GOC_DU_AN}`;
  });

  const trongDuAn = (q: string) => chay(q, admin(), { projectId: ID_DU_AN });

  /**
   * ⚠ Ca RẺ NHẤT và cũng là ca bắt được lỗi live: bộ trích là một hàm THUẦN, nên nó nêu đích danh
   * dấu câu gây hỏng mà không cần cả chuỗi định tuyến. Bản trước trả `["src/Calculator.cs"]`.
   */
  it("★★★ NGUYÊN VĂN câu live ⇒ bộ trích thấy ĐỦ HAI đường dẫn (bản trước chỉ thấy MỘT)", () => {
    expect(trichMoiDuongDanRepo(CAU_LIVE)).toEqual([R_CALC, R_CHUA_CO]);
  });

  /**
   * ★★★ ĐÂY LÀ CA TÁI HIỆN ĐÚNG PHIÊN LIVE, và nó khẳng định hai điều NGƯỢC hẳn hành vi cũ:
   *   • hệ ĐỌC cả hai tệp (tức đã vào đường LÔ), thay vì đọc đúng tệp đầu;
   *   • và vì tệp thứ hai chưa tồn tại ⇒ **KHÔNG đề xuất ghi nào cả** — thay vì lặng lẽ đề xuất
   *     ghi đè MỘT tệp rồi để tệp còn lại y nguyên, đúng thứ đã đo được trên trình duyệt
   *     (`Calculator.cs` có chú thích, `StringUtils.cs` không, `grep -c` = 1 và 0).
   * Một lượt sửa "một nửa" im lặng là chế độ hỏng tệ hơn hẳn một lời từ chối to tiếng.
   */
  it("★★★ NGUYÊN VĂN câu live qua ĐÚNG chuỗi định tuyến ⇒ đi đường LÔ, và TỪ CHỐI cả lô", async () => {
    const truoc = bamCay();
    h.manh = [MA_MOI];
    const r = await trongDuAn(CAU_LIVE);

    const daDoc = h.quyetDinh.filter((q) => q.tool === "read_file").map((q) => String(q.args.path));
    expect(daDoc, "cả hai đường dẫn phải được ĐỌC ⇒ chứng minh đã vào vòng lặp của đường LÔ").toContain(R_CALC);
    expect(daDoc).toContain(R_CHUA_CO);

    expect(
      h.quyetDinh.some((q) => q.tool === "apply_diff"),
      "bản trước đề xuất ghi ĐÈ đúng Calculator.cs rồi bỏ quên tệp kia — chính là lỗi live",
    ).toBe(false);
    expect(r.chu).toContain("CẢ LÔ dừng");
    expect(r.chu).toContain(R_CHUA_CO);
    expect(bamCay(), "đề thi KHÔNG đổi một byte").toBe(truoc);
  });

  /**
   * ★★★ MỆNH ĐỀ CHÍNH: cùng HÌNH DẠNG CÂU của người dùng (hai đường dẫn ngăn bởi `và`, rồi **dấu
   * hai chấm**, rồi mệnh lệnh), nhưng cả hai tệp đều CÓ THẬT ⇒ phải ra ĐÚNG MỘT `apply_diff_batch`
   * mang ĐỦ HAI đường dẫn và HAI băm neo khác nhau.
   *
   * ⚠ Vì sao không dùng thẳng `CAU_LIVE`: `src/StringUtils.cs` không có trong đề thi, và tạo nó ra
   *   sẽ sửa đề thi. Ca trên đã khẳng định phần "tới được đường LÔ" cho nguyên văn; ca này khẳng
   *   định phần "tới được TOOL với đủ hai tệp". Cộng lại mới là mệnh đề đầy đủ.
   */
  it("★★★ hai tệp CÓ THẬT + đúng dấu câu của người dùng ⇒ MỘT `apply_diff_batch`, ĐỦ hai đường", async () => {
    const truoc = bamCay();
    h.manh = [MA_MOI];
    const r = await trongDuAn(
      `sửa ${R_CALC} và ${R_TEST}: thêm dòng chú thích \`// Dự án thử AI local\` lên đầu mỗi tệp`,
    );

    const lo = h.quyetDinh.filter((q) => q.tool === "apply_diff_batch");
    expect(lo.length, "MỘT thẻ duyệt cho cả lô").toBe(1);
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff").length, "KHÔNG đề xuất lẻ song song").toBe(0);

    const files = lo[0]!.args.files as Array<{ path: string; original: string; modified: string }>;
    expect(files.map((f) => f.path)).toEqual([R_CALC, R_TEST]);
    for (const f of files) {
      const dia = fs.readFileSync(path.resolve(GOC_DU_AN, f.path), "utf8");
      expect(f.original, `original của ${f.path} phải là byte TRÊN ĐĨA`).toBe(dia);
    }
    expect(files[0]!.original, "hai tệp khác nhau ⇒ hai neo khác nhau").not.toBe(files[1]!.original);
    expect(r.events.some((e) => e.type === "pending_action")).toBe(true);
    expect(bamCay()).toBe(truoc);
  });

  /**
   * ★★ Các cách gõ tự nhiên khác của CÙNG một ý định. Mỗi dòng là một dấu câu mà danh sách trắng cũ
   * không có (`:` `：` `?` `.`) hoặc có (`,` `;`) — trộn lẫn cố ý để ca này vẫn có nghĩa nếu ai đó
   * đổi cách hiện thực hậu tố.
   */
  const bienThe: Array<[string, string]> = [
    ["dấu hai chấm (vi)", `sửa ${R_CALC} và ${R_TEST}: thêm chú thích lên đầu`],
    ["dấu phẩy (vi)", `sửa ${R_CALC} và ${R_TEST}, thêm chú thích lên đầu`],
    ["dấu chấm hỏi (vi)", `sửa giúp tôi ${R_CALC} và ${R_TEST}?`],
    ["liệt kê sau dấu hai chấm (vi)", `sửa hai tệp sau: ${R_CALC}, ${R_TEST} — thêm chú thích`],
    ["dấu chấm câu cuối (vi)", `cập nhật ${R_CALC} và ${R_TEST}.`],
    ["dấu chấm phẩy (vi)", `cập nhật ${R_CALC}; ${R_TEST}: đổi tên hàm`],
    ["colon (en)", `edit ${R_CALC} and ${R_TEST}: add a header comment`],
    ["dash (en)", `update ${R_CALC} and ${R_TEST} — add a header comment`],
    ["dấu hai chấm toàn rộng (zh)", `修改 ${R_CALC} 和 ${R_TEST}：添加文件头注释`],
  ];
  for (const [ten, q] of bienThe) {
    it(`★★★ biến thể "${ten}" ⇒ tới được \`apply_diff_batch\` với ĐỦ hai đường`, async () => {
      h.manh = [MA_MOI];
      await trongDuAn(q);
      const lo = h.quyetDinh.filter((x) => x.tool === "apply_diff_batch");
      expect(lo.length, `"${q}" phải ra đúng một lô`).toBe(1);
      const files = lo[0]!.args.files as Array<{ path: string }>;
      expect(files.map((f) => f.path)).toEqual([R_CALC, R_TEST]);
    });
  }

  /**
   * ⚠⚠ CHỐNG VÁ QUÁ TAY — đường MỘT TỆP đang chạy ĐÚNG trên live (thẻ duyệt của `Calculator.cs`
   * hiện ra và bấm duyệt thì ghi thật). Nó KHÔNG được đổi hành vi vì bản vá này.
   */
  it("★★★ MỘT đường dẫn (kèm dấu hai chấm) ⇒ vẫn `apply_diff` một tệp, KHÔNG dựng lô", async () => {
    h.manh = [MA_MOI];
    const r = await trongDuAn(`sửa ${R_CALC}: thêm dòng chú thích lên đầu tệp`);
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff").length).toBe(1);
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff_batch").length, "một đường ⇒ không có lô").toBe(0);
    /**
     * ⚠⚠ ĐẾM TOOL LÀ CHƯA ĐỦ để chống vá quá tay: nếu ai hạ điều kiện đường LÔ xuống `≥1`, câu một
     * tệp vẫn ra `apply_diff` (lô một mục tự thu về `apply_diff`) — cổng vẫn xanh trong khi người
     * dùng MẤT thẻ `read_file` thật (đường LÔ cố ý tắt `phatTheTool` và tự dựng một thẻ TỔNG).
     * ⇒ Khẳng định vào ĐÚNG thứ đổi: thẻ tool của lượt một tệp phải là kết quả `read_file` THẬT
     *   (có `content`), không phải thẻ tổng `{files:[…]}` do đường LÔ dựng.
     */
    const the = r.events.filter((e) => e.type === "tool");
    expect(the.length, "đường một tệp phát đúng một thẻ read_file").toBe(1);
    const data = (the[0] as any).toolResult?.data as Record<string, unknown> | undefined;
    expect(typeof data?.content, "thẻ phải là kết quả read_file THẬT, không phải thẻ tổng của lô").toBe("string");
    expect(data?.files, "có `files` nghĩa là câu một tệp đã bị đẩy sang đường LÔ").toBeUndefined();
  });

  it("★★★ MỘT đường dẫn, KHÔNG dấu câu lạ ⇒ y hệt hành vi cũ", async () => {
    h.manh = [MA_MOI];
    await trongDuAn(`sửa ${R_CALC} để Divide ném ArgumentException khi chia 0`);
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff").length).toBe(1);
    expect(h.quyetDinh.filter((q) => q.tool === "apply_diff_batch").length).toBe(0);
  });

  /**
   * ★★★ Ý ĐỊNH **TẠO** VỚI ≥2 ĐƯỜNG DẪN — quyết định đã chốt: **đi đường LÔ y như SỬA.**
   * Lý do: `apply_diff_batch` nhận `original` RỖNG cho một mục là hợp đồng hợp lệ và có băm neo
   * (băm("")), nên tạo N tệp trong MỘT lượt duyệt không cần một bề mặt thứ hai. Cái phân xử
   * TẠO-hay-SỬA vẫn là **ĐĨA**, xét RIÊNG cho từng tệp trong lô.
   */
  it("★★★ TẠO nhiều tệp mới ⇒ MỘT lô, MỌI mục `original` RỖNG, KHÔNG tệp nào bị tạo", async () => {
    const A = "src/ChuaTonTai_LuoiA.cs";
    const B = "src/ChuaTonTai_LuoiB.cs";
    h.manh = [MA_MOI];
    await trongDuAn(`tạo file mới ${A} và ${B} chứa class tiện ích`);

    const lo = h.quyetDinh.filter((q) => q.tool === "apply_diff_batch");
    expect(lo.length).toBe(1);
    const files = lo[0]!.args.files as Array<{ path: string; original: string }>;
    expect(files.map((f) => f.path)).toEqual([A, B]);
    for (const f of files) expect(f.original, "TẠO ⇒ băm neo là băm('')").toBe("");
    for (const p of [A, B]) expect(fs.existsSync(path.resolve(GOC_DU_AN, p)), "HITL chưa ai bấm").toBe(false);
  });

  /**
   * ★★★ CA **TRỘN** — một tệp TẠO MỚI, một tệp SỬA, trong cùng một câu. Quyết định đã chốt: **hợp
   * lệ, một lô duy nhất**, và mỗi mục tự lấy neo của mình từ ĐĨA (`""` cho tệp chưa có, byte thật
   * cho tệp đã có). Không có "chế độ lô" riêng cho tạo và cho sửa — chỉ có một lô, N phán quyết.
   *
   * ⚠ Chiều nguy hiểm đã được đóng ở chỗ khác và §5 canh: câu **CHỈ** nói TẠO mà tệp ĐÃ CÓ thì bị
   *   từ chối tường minh, chứ không âm thầm thành ghi đè.
   */
  it("★★★ TRỘN tạo-mới + sửa trong một câu ⇒ MỘT lô, neo RỖNG cho tệp mới, byte THẬT cho tệp cũ", async () => {
    const MOI = "src/ChuaTonTai_LuoiTron.cs";
    h.manh = [MA_MOI];
    await trongDuAn(`tạo file mới ${MOI} và sửa ${R_CALC} cho gọn`);

    const lo = h.quyetDinh.filter((q) => q.tool === "apply_diff_batch");
    expect(lo.length).toBe(1);
    const files = lo[0]!.args.files as Array<{ path: string; original: string }>;
    expect(files.map((f) => f.path)).toEqual([MOI, R_CALC]);
    expect(files[0]!.original, "tệp CHƯA CÓ ⇒ neo rỗng").toBe("");
    expect(files[1]!.original, "tệp ĐÃ CÓ ⇒ neo là byte trên đĩa").toBe(
      fs.readFileSync(path.resolve(GOC_DU_AN, R_CALC), "utf8"),
    );
    expect(fs.existsSync(path.resolve(GOC_DU_AN, MOI))).toBe(false);
  });

  /**
   * ⚠ HITL không được nới ra vì đường này: lô đi qua `executeDecision` ⇒ `proposeAction` ⇒ NGƯỜI
   *   BẤM. Ca này canh đúng cửa ấy trên chính câu của người dùng.
   */
  it("★★★ HITL nguyên vẹn trên câu thật: ra `pending_action`, KHÔNG ra `result`", async () => {
    h.manh = [MA_MOI];
    const r = await trongDuAn(`sửa ${R_CALC} và ${R_TEST}: thêm chú thích lên đầu`);
    const pa = r.events.filter((e) => e.type === "pending_action");
    expect(pa.length).toBe(1);
    expect((pa[0] as any).toolName).toBe("apply_diff_batch");
    expect(r.events.some((e) => e.type === "tool" && (e as any).toolName === "apply_diff_batch")).toBe(false);
  });
});
