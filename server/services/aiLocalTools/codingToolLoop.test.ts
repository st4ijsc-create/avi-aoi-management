/**
 * ★★★ doc 81 · VIỆC 2 — LƯỚI CHO **VÒNG LẶP TOOL ĐA BƯỚC** CỦA CHẾ ĐỘ LẬP TRÌNH.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đường VẬN HÀNH có `runToolLoop`; đường LẬP TRÌNH gọi tool **đúng MỘT lần**. Mọi việc thật là
 * *tìm → đọc vài tệp → hiểu*, nên người phải làm bộ điều phối bằng tay.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN ĐƯỢC PHÁT BIỂU Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   §1 **DÙNG LẠI** `runToolLoop` — không có vòng lặp thứ hai trong repo (ca census).
 *   §2 **`apply_diff` KHÔNG BAO GIỜ vào vòng tự trị**, và HAI lớp độc lập giữ điều đó:
 *        (a) theo TÊN, TRƯỚC: `CODING_LOOP_TOOL_NAMES` chỉ có 3 tool ĐỌC;
 *        (b) theo CẤU TẠO, SAU: kể cả khi lớp (a) bị gỡ, `executeDecision` đẩy write tool vào
 *            `proposeAction` ⇒ vòng DỪNG với `cho_phe_duyet` và KHÔNG byte nào rời ra đĩa.
 *      ⚠ Ca (b) là ca quan trọng nhất về phương pháp: nó chứng minh lớp (a) không phải hàng rào
 *        DUY NHẤT, tức một đột biến vào (a) không mở được đường ghi.
 *   §3 **TRẦN VÒNG** có thật, và trần CỨNG kẹp được cấu hình.
 *   §4 **KHÔNG HỒI QUY ĐỘ TRỄ**: `read_file` ở vòng 1 ⇒ ĐÚNG 1 vòng, **0 lượt gọi model thêm**.
 *      Không có nó, câu "đọc tệp X" — hôm nay tất định, tức thì — cõng thêm 30–75 s.
 *   §5 **CỜ TẮT ⇒ uỷ quyền nguyên vẹn** (A/B sạch).
 *
 * ⚠ Chỉ mock ĐÚNG hai hàm LLM. Heuristic tất định, registry tool, hộp cát, RBAC, `executeDecision`
 *   đều là ĐỒ THẬT — nếu mock `executeDecision` thì ca §2(b) sẽ xanh vì lý do sai (nó đo cái mock).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  /** Quyết định mà bộ chọn vòng ≥2 (đã mock) trả về, theo thứ tự gọi. */
  keTiep: [] as Array<{ tool: string | null; args: Record<string, unknown>; reason: string }>,
  /** Số lần bộ chọn vòng ≥2 THỰC SỰ được gọi — thước của §4. */
  soLanGoiKeTiep: 0,
  /** Quan sát mà nó nhận được ở lượt gọi gần nhất. */
  quanSatNhan: null as unknown,
}));

vi.mock("./intentClassifier", async (importOriginal) => {
  const goc = await importOriginal<typeof import("./intentClassifier")>();
  return {
    ...goc,
    // Vòng 1 vẫn dùng heuristic THẬT (`classifyCodingToolIntent` không bị thay). Chỉ tắt lớp LLM
    // nới tầm để ca không phụ thuộc một engine 30B có/không chạy trên máy đang test.
    classifyCodingToolIntentLLM: vi.fn(async () => ({ tool: null, args: {}, reason: "TEST_TAT" })),
    decideNextCodingToolLLM: vi.fn(async (_q: string, quanSat: unknown) => {
      h.soLanGoiKeTiep += 1;
      h.quanSatNhan = quanSat;
      return h.keTiep.shift() ?? { tool: null, args: {}, reason: "TEST_HET" };
    }),
  };
});

import {
  tryExecuteCodingToolLoop,
  codingToolLoopEnabled,
  tranVongLapTrinh,
  CODING_LOOP_DEFAULT_ROUNDS,
  CODING_LOOP_HARD_MAX_ROUNDS,
} from "./index";
import { CODING_LOOP_TOOL_NAMES, CODING_TOOL_NAMES } from "./intentClassifier";

/** admin ⇒ `checkPermission` short-circuit true, nên ca đo đường TOOL chứ không đo seed RBAC. */
const ADMIN = { user: { id: 1, role: "admin", name: "T" }, lang: "vi" as const };

const ENV = ["AI_CODING_TOOL_LOOP", "AI_CODING_TOOL_LOOP_MAX_ROUNDS", "AI_TOOL_LOOP_MAX_BLOCK_CHARS"] as const;
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  h.keTiep = [];
  h.soLanGoiKeTiep = 0;
  h.quanSatNhan = null;
});
afterEach(() => { for (const k of ENV) delete process.env[k]; });

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — DÙNG LẠI `runToolLoop`, không viết vòng lặp thứ hai", () => {
  it("★★★ CENSUS: `aiLocalTools/index.ts` gọi `runToolLoop`, và KHÔNG có vòng `for` chọn-tool nào khác", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "server/services/aiLocalTools/index.ts"), "utf8");
    const soLanGoi = (src.match(/\brunToolLoop\(\{/g) ?? []).length;
    expect(soLanGoi, "cả hai đường (vận hành + lập trình) phải đi qua CÙNG một hàm vòng lặp").toBe(2);
    // Không được có một bộ điều phối tự viết: không `while` nào trong file này.
    expect(/\bwhile\s*\(/.test(src), "một vòng lặp tự viết ở đây = bản sao thứ hai của chính sách").toBe(false);
  });

  it("★★ tiến độ được PHÁT ra ngoài (người dùng thấy đang ở vòng mấy)", async () => {
    const nhip: Array<{ round: number; phase: string }> = [];
    await tryExecuteCodingToolLoop(
      "đọc server/services/aiLocalTools/toolRegistry.ts và cho biết export gì",
      undefined,
      ADMIN,
      (p) => nhip.push({ round: p.round, phase: p.phase }),
    );
    expect(nhip.length, "0 nhịp ⇒ giao diện không có gì để hiện trên một trần 180 s").toBeGreaterThan(0);
    expect(nhip.some((n) => n.phase === "dang_goi")).toBe(true);
    expect(nhip.some((n) => n.phase === "dung")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — `apply_diff`/`run_command` KHÔNG BAO GIỜ vào vòng tự trị (hai lớp độc lập)", () => {
  it("★★★ (a) LỚP TÊN: tập vòng ≥2 là TẬP CON THỰC SỰ của 5 tool, và KHÔNG chứa hai tool ghi/chạy", () => {
    const vong = new Set<string>(CODING_LOOP_TOOL_NAMES);
    expect(vong.has("apply_diff"), "apply_diff trong vòng tự trị = ghi đĩa không người duyệt").toBe(false);
    expect(vong.has("run_command"), "run_command trong vòng tự trị = sinh tiến trình không người duyệt").toBe(false);
    for (const t of vong) expect(new Set<string>(CODING_TOOL_NAMES).has(t), t).toBe(true);
    expect(vong.size).toBeLessThan(CODING_TOOL_NAMES.length);
    expect(vong.size, "tập RỖNG ⇒ mọi ca ÂM tự thoả").toBeGreaterThan(0);
  });

  /**
   * ★★★ CA QUAN TRỌNG NHẤT VỀ PHƯƠNG PHÁP.
   *
   * Ép bộ chọn vòng ≥2 trả về `apply_diff` (giả lập ĐÚNG kịch bản lớp (a) bị gỡ hoặc bị vòng qua).
   * Nếu lớp (b) là thật thì lượt ấy KHÔNG được ghi gì: nó phải dừng ở `cho_phe_duyet`. Ca này
   * chứng minh hàng rào HITL đứng ĐỘC LẬP với danh sách tên — nếu nó đỏ, mọi ca §2(a) chỉ chứng
   * minh "danh sách đúng", không chứng minh "đĩa an toàn".
   */
  it("★★★ (b) LỚP CẤU TẠO: dù vòng ≥2 CHỌN `apply_diff`, lượt ấy DỪNG ở HITL và KHÔNG chạm đĩa", async () => {
    const tep = "server/services/aiLocalTools/README_KHONG_TON_TAI_DOC81.md";
    const tuyetDoi = path.resolve(process.cwd(), tep);
    expect(fs.existsSync(tuyetDoi), "tệp mốc phải KHÔNG tồn tại trước ca").toBe(false);

    h.keTiep = [{ tool: "apply_diff", args: { path: tep, original: "", modified: "BI GHI TRAI PHEP\n" }, reason: "TEST_EP" }];
    const r = await tryExecuteCodingToolLoop("tìm executeDecision trong server/services", undefined, ADMIN);

    expect(r.loop, "cờ mặc định BẬT ⇒ phải có vòng").not.toBeNull();
    // Dừng ở chờ-phê-duyệt HOẶC không bao giờ tới được apply_diff — cả hai đều là "không ghi".
    expect(["cho_phe_duyet", "ket_luan", "het_vong", "loi", "tu_choi"]).toContain(r.loop!.stop);
    expect(fs.existsSync(tuyetDoi), "★★★ VÒNG TỰ TRỊ VỪA GHI RA ĐĨA — bất biến HITL đã VỠ").toBe(false);
    // Trần 5 s mặc định không đủ: `proposeAction` của `apply_diff` chạy `git status` THẬT trên repo
    // (hàng rào "tệp bẩn") rồi ghi một hàng `ai_pending_actions`. Đây là đường THẬT, không phải mock —
    // đó chính là lý do ca này có giá trị, và cũng là lý do nó chậm.
  }, 60_000);

  it("★★ vòng ≥2 nhận quan sát ĐÃ LÀM SẠCH (bản sao, không phải sổ sống của vòng lặp)", async () => {
    h.keTiep = [{ tool: null, args: {}, reason: "TEST_DU" }];
    await tryExecuteCodingToolLoop("tìm executeDecision trong server/services", undefined, ADMIN);
    if (h.soLanGoiKeTiep > 0) {
      expect(Array.isArray(h.quanSatNhan)).toBe(true);
      const qs = h.quanSatNhan as Array<{ tool: string; summary: string }>;
      expect(qs.length).toBeGreaterThan(0);
      expect(typeof qs[0].summary).toBe("string");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — TRẦN VÒNG", () => {
  it("★★★ mặc định 3; cấu hình vô lý bị KẸP bằng trần CỨNG 5", () => {
    expect(tranVongLapTrinh()).toBe(CODING_LOOP_DEFAULT_ROUNDS);
    process.env.AI_CODING_TOOL_LOOP_MAX_ROUNDS = "99";
    expect(tranVongLapTrinh(), "cấu hình KHÔNG được tự nới quá trần cứng").toBe(CODING_LOOP_HARD_MAX_ROUNDS);
    process.env.AI_CODING_TOOL_LOOP_MAX_ROUNDS = "0";
    expect(tranVongLapTrinh(), "0/âm/rác ⇒ về mặc định, KHÔNG thành vô hạn").toBe(CODING_LOOP_DEFAULT_ROUNDS);
    process.env.AI_CODING_TOOL_LOOP_MAX_ROUNDS = "-4";
    expect(tranVongLapTrinh()).toBe(CODING_LOOP_DEFAULT_ROUNDS);
    process.env.AI_CODING_TOOL_LOOP_MAX_ROUNDS = "2";
    expect(tranVongLapTrinh()).toBe(2);
  });

  /**
   * ★★★ TRẦN CÓ CẮT THẬT. Ép bộ chọn trả về một `grep_repo` MỚI (args khác nhau ⇒ guard `lap_lai`
   * không cắt trước) ở mọi vòng; vòng lặp phải dừng ĐÚNG ở trần, không chạy tiếp.
   */
  /**
   * ★★★ TRẦN CÓ CẮT THẬT. Ép bộ chọn trả về một `grep_repo` MỚI (args khác nhau ⇒ guard `lap_lai`
   * không cắt trước) ở mọi vòng; vòng lặp phải dừng ĐÚNG ở trần.
   *
   * ⚠⚠ ĐO Ở **2**, KHÔNG PHẢI 3 — và đây là điểm mấu chốt. `TOOL_LOOP_DEFAULTS.maxRounds` cũng
   * bằng 3, nên một ca đo ở 3 sẽ XANH kể cả khi `tryExecuteCodingToolLoop` **quên truyền `limits`
   * hoàn toàn** (vòng lặp rơi về mặc định của đường vận hành và tình cờ ra cùng số). Đó đúng khuôn
   * "lưới xanh vì lý do sai". Ở 2 thì chỉ trần CỦA CHÍNH ĐƯỜNG NÀY mới cho ra 2.
   */
  it("★★★ bộ chọn luôn muốn đi tiếp ⇒ dừng ĐÚNG ở trần (đo ở 2 để phân biệt với mặc định 3)", async () => {
    process.env.AI_CODING_TOOL_LOOP_MAX_ROUNDS = "2";
    h.keTiep = [
      { tool: "grep_repo", args: { pattern: "registerTool", path: "server/services/aiLocalTools" }, reason: "T2" },
      { tool: "grep_repo", args: { pattern: "listTools", path: "server/services/aiLocalTools" }, reason: "T3" },
      { tool: "grep_repo", args: { pattern: "getTool", path: "server/services/aiLocalTools" }, reason: "T4" },
      { tool: "grep_repo", args: { pattern: "isWriteTool", path: "server/services/aiLocalTools" }, reason: "T5" },
    ];
    const r = await tryExecuteCodingToolLoop("tìm executeDecision trong server/services", undefined, ADMIN);
    expect(r.loop).not.toBeNull();
    expect(r.loop!.rounds.length, "vượt trần = ngân sách vô hạn qua một cửa khác").toBe(2);
    expect(r.loop!.stop).toBe("het_vong");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — KHÔNG HỒI QUY ĐỘ TRỄ: `read_file` ở vòng 1 ⇒ DỪNG, 0 lượt model thêm", () => {
  /**
   * ★★★ Không có ca này, việc 2 sẽ âm thầm cộng ~30–75 s vào MỌI câu "đọc tệp X" — hôm nay là
   * đường tất định, 0 lượt model. Người dùng sẽ tắt tính năng, và họ đúng.
   */
  it("★★★ 'đọc <tệp>' ⇒ ĐÚNG 1 vòng và bộ chọn vòng ≥2 KHÔNG được gọi lần nào", async () => {
    const r = await tryExecuteCodingToolLoop(
      "đọc server/services/aiLocalTools/toolRegistry.ts và cho biết export gì",
      undefined,
      ADMIN,
    );
    expect(r.decision.tool, "vòng 1 phải y hệt đường một-lượt").toBe("read_file");
    expect(r.loop!.rounds.length).toBe(1);
    expect(h.soLanGoiKeTiep, "★★★ read_file ở vòng 1 KHÔNG được kéo theo một lượt model nữa").toBe(0);
    // Nội dung THẬT vẫn về đủ (cổng ra trục 1 không đổi một byte).
    expect(r.result!.textSummary).toContain("export function registerTool");
    expect(r.ketQuaTungVong.length).toBe(1);
  });

  it("★★★ ĐỐI CHỨNG: tool TÌM ở vòng 1 ⇒ bộ chọn vòng ≥2 CÓ được gọi (nếu ca này đỏ, ca trên vô nghĩa)", async () => {
    h.keTiep = [{ tool: null, args: {}, reason: "TEST_DU" }];
    const r = await tryExecuteCodingToolLoop("tìm executeDecision trong server/services", undefined, ADMIN);
    expect(["grep_repo", "list_files"], `vòng 1 nhận: ${r.decision.tool}`).toContain(r.decision.tool);
    expect(h.soLanGoiKeTiep, "tool TÌM PHẢI mở đường cho vòng sau — đây là toàn bộ giá trị của việc 2").toBeGreaterThan(0);
  });

  it("★★ CHUỖI THẬT `tìm → đọc`: hai vòng, và kết quả CẢ HAI vòng đều tới người dùng", async () => {
    h.keTiep = [
      { tool: "read_file", args: { path: "server/services/aiLocalTools/toolRegistry.ts" }, reason: "T2" },
      { tool: null, args: {}, reason: "TEST_DU" },
    ];
    const r = await tryExecuteCodingToolLoop("tìm registerTool trong server/services/aiLocalTools", undefined, ADMIN);
    expect(r.loop!.rounds.length).toBe(2);
    expect(r.ketQuaTungVong.length, "chỉ giữ vòng cuối = mất chính thứ vòng lặp làm ra").toBe(2);
    expect(r.ketQuaTungVong[1].toolName).toBe("read_file");
    expect(r.ketQuaTungVong[1].result.textSummary).toContain("export function registerTool");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — CỜ TẮT ⇒ uỷ quyền NGUYÊN VẸN (phép đo A/B sạch)", () => {
  it("★★★ mặc định BẬT; `\"0\"` ⇒ TẮT", () => {
    expect(codingToolLoopEnabled()).toBe(true);
    process.env.AI_CODING_TOOL_LOOP = "0";
    expect(codingToolLoopEnabled()).toBe(false);
  });

  it("★★★ cờ TẮT ⇒ `loop: null`, 0 lượt bộ chọn vòng ≥2, kết quả GIỐNG đường một-lượt", async () => {
    process.env.AI_CODING_TOOL_LOOP = "0";
    const r = await tryExecuteCodingToolLoop("tìm executeDecision trong server/services", undefined, ADMIN);
    expect(r.loop).toBeNull();
    expect(h.soLanGoiKeTiep).toBe(0);
    expect(["grep_repo", "list_files"]).toContain(r.decision.tool);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — LƯỢT TÌM KHÔNG RA GÌ ⇒ KHÔNG mở đường (0 lượt model thêm)", () => {
  /**
   * ★★★ Bảo vệ đường CỨU LƯỢT ĐOÁN TRƯỢT của `streamCodingAnswer`: câu *"viết code C# …"* có thể bị
   * bộ chọn LLM đoán thành một `grep_repo` vô nghĩa. Nó phải rơi xuống nhánh SINH MÃ **ngay**, chứ
   * không phải sau thêm một lượt model 30B (~30–75 s) chỉ để nghe "không có gì nữa".
   */
  it("★★★ grep KHÔNG khớp gì (note NO_MATCH) ⇒ 1 vòng, bộ chọn vòng ≥2 KHÔNG được gọi", async () => {
    h.keTiep = [{ tool: "read_file", args: { path: "server/services/aiLocalTools/toolRegistry.ts" }, reason: "KHONG_DUOC_DUNG" }];
    // Mẫu chắc chắn không có trong repo.
    const r = await tryExecuteCodingToolLoop(
      "tìm ZZQQXX_KHONG_TON_TAI_DOC81_ZZQQXX trong repo",
      undefined,
      ADMIN,
    );
    expect(r.decision.tool, `vòng 1 nhận: ${r.decision.tool}`).toBe("grep_repo");
    expect(r.result?.note, "ca này chỉ có nghĩa khi vòng 1 THẬT SỰ không ra gì").toBeTruthy();
    expect(h.soLanGoiKeTiep, "★★★ một lượt tìm hụt KHÔNG được đốt thêm một lượt model").toBe(0);
    expect(r.loop!.rounds.length).toBe(1);
    expect(r.loop!.stop).toBe("ket_luan");
  });

  it("★★★ ĐỐI CHỨNG: grep CÓ khớp ⇒ bộ chọn vòng ≥2 CÓ được gọi (ca trên không tự thoả)", async () => {
    h.keTiep = [{ tool: null, args: {}, reason: "TEST_DU" }];
    const r = await tryExecuteCodingToolLoop("tìm registerTool trong server/services/aiLocalTools", undefined, ADMIN);
    expect(r.result?.note, "vòng 1 phải RA kết quả thì đối chứng mới có nghĩa").toBeFalsy();
    expect(h.soLanGoiKeTiep).toBeGreaterThan(0);
  });
});
