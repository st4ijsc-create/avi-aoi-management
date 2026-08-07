/**
 * ★★★ Pha 6 Task 3 (F2) — **MỌI TOOL CHỌN ĐƯỢC THEO TRIGGER PHẢI CÓ ĐƯỜNG LẤY THAM SỐ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY **KHÔNG** LIỆT KÊ TÁM CÁI TÊN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nợ F2 sinh ra vì `extractArgsForTool` là **một danh sách**: 41 nhãn `case`, và nhóm
 * `readToolsProgramming` (8 tool) là **phần tử thứ N+1** không ai nhớ thêm. Viết một lưới liệt kê
 * đúng 8 cái tên ấy chỉ dời danh sách sang chỗ khác — tool thứ 9 vẫn lọt y hệt.
 * Lớp lỗi *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"* đã tái diễn **MƯỜI BA** lần trong chuỗi
 * pha, và **lời giải mỗi lần là ĐẢO LƯỢNG TỪ** — phát biểu **cái nó PHẢI LÀ**, suy đối tượng ra từ
 * **một nguồn có đo**, không phải từ một danh sách chép tay.
 *
 * Nên luật ở đây là:
 *
 *   ***MỌI tool mà `findToolByTriggers` CÓ THỂ trả về thì hoặc `extractArgsForTool` có một nhánh
 *   riêng cho nó, hoặc schema của nó chấp nhận `{}`.***
 *
 * Hai vế đều **đo được, không khai báo lại**:
 *   • *"có thể được trả về"* ⇒ **chính vị từ** `chonDuocTheoTrigger()` mà `findToolByTriggers` dùng
 *     (không phải bản sao thứ hai — hai bản sao trùng hôm nay sẽ lệch ngày mai);
 *   • *"có nhánh riêng"* ⇒ `hasArgExtractionPath()`, **chạy chính bộ điều phối** `switch`;
 *   • *"chấp nhận `{}`"* ⇒ `tool.parameters.safeParse({})` — schema tự nói.
 * Đối tượng bị canh là `listTools()` — **sổ đăng ký lúc chạy**. Một tool mới đăng ký ở **bất kỳ
 * file nào** tự đưa mình vào lượng từ, không cần ai nhớ cập nhật gì.
 *
 * ⚠⚠ **CẦU CHÌ CHỐNG "VÁ BẰNG CÁCH LÀM LUẬT RỖNG"**: ai đóng luật bằng cách trả `{}` ở nhánh
 * `default` sẽ làm ca *"một tên KHÔNG TỒN TẠI phải trả `false`"* ĐỎ. Và hai ca *"vế nào cũng có
 * người dùng thật"* bắt lượt làm một trong hai vế thành chân lý rỗng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "./index"; // side-effect: đăng ký toàn bộ tool (đây là nguồn đo)
import * as progMod from "./readToolsProgramming";
import { listTools, getTool, type Tool } from "./toolRegistry";
import { chonDuocTheoTrigger, classifyToolIntent, extractArgsForTool, hasArgExtractionPath } from "./intentClassifier";

/** Ô bắt buộc của một tool — hỏi **chính schema**, không chép tay. */
function oBatBuoc(tool: Tool<any, any>): string[] {
  const r = tool.parameters.safeParse({});
  if (r.success) return [];
  return [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "")).filter((s) => s !== ""))].sort();
}

function nhanRong(tool: Tool<any, any>): boolean {
  return tool.parameters.safeParse({}).success;
}

const MOI_TOOL = listTools();
const CHON_DUOC = MOI_TOOL.filter(chonDuocTheoTrigger);
const KHONG_CHON_DUOC = MOI_TOOL.filter((t) => !chonDuocTheoTrigger(t));

describe("★★★ F2 — luật: MỌI tool chọn được theo trigger phải với tới được (đảo lượng từ)", () => {
  it("★★★ cầu chì — sổ đăng ký không rỗng và phép lọc không nuốt cả sổ", () => {
    // 0 tool ⇒ mọi khẳng định dưới là chân lý rỗng. Ba con số này chỉ là SÀN, không phải ghim:
    // thêm tool là chuyện bình thường; **mất** tool mới là chuyện phải nói ra.
    expect(MOI_TOOL.length, "sổ đăng ký rỗng — `import ./index` đã hỏng?").toBeGreaterThanOrEqual(70);
    expect(CHON_DUOC.length, "không tool nào chọn được theo trigger — vị từ đã hỏng?").toBeGreaterThanOrEqual(40);
    expect(
      KHONG_CHON_DUOC.length,
      "phép lọc không loại ai ⇒ nó không phải một phép lọc, và luật dưới đây đang canh sai tập",
    ).toBeGreaterThanOrEqual(20);
    // …và phép lọc phải loại ĐÚNG thứ nó nói là loại.
    expect(KHONG_CHON_DUOC.every((t) => t.kind === "write" || t.kind === "client")).toBe(true);
    expect(CHON_DUOC.every((t) => t.kind !== "write" && t.kind !== "client")).toBe(true);
  });

  it("★★★ cầu chì — một tên KHÔNG TỒN TẠI phải KHÔNG có đường lấy tham số", () => {
    /**
     * ⚠⚠⚠ Đây là ca giữ cho luật chính **không rỗng hoá được**. Cách "vá" rẻ nhất cho luật chính
     * là trả `{}` ở nhánh `default` — làm thế thì mọi tên đều "có đường", luật thành chân lý rỗng,
     * và tool thứ 9 lại chết im lặng y như 8 cái trước. Ca này ĐỎ ngay lượt ấy.
     */
    for (const ten of ["", "khong_ton_tai_tool", "get_lot_status_", "__proto__", "toString", "constructor"]) {
      expect(hasArgExtractionPath(ten), `"${ten}" không phải một tool ⇒ phải KHÔNG có đường`).toBe(false);
    }
  });

  it("★★★ LUẬT — ∀ tool chọn được theo trigger: có nhánh lấy tham số HOẶC schema nhận `{}`", () => {
    const vipham = CHON_DUOC.filter((t) => !hasArgExtractionPath(t.name) && !nhanRong(t)).map(
      (t) => `${t.name} (bắt buộc: ${oBatBuoc(t).join(", ") || "—"})`,
    );
    expect(
      vipham.join("\n"),
      "tool này CHỌN ĐƯỢC bằng câu hỏi ngôn ngữ tự nhiên nhưng KHÔNG BAO GIỜ nhận đủ tham số ⇒ " +
        "`extractArgsForTool` trả `{}` ⇒ `safeParse` hỏng ⇒ `INVALID_ARGS` ⇒ tool CHẾT trên đường Agent",
    ).toBe("");
  });

  it("★★★ CẢ HAI VẾ đều có người dùng thật (không vế nào là chân lý rỗng)", () => {
    // Vế 1: tool cần tham số, sống được **nhờ** có nhánh riêng.
    const nhoVe1 = CHON_DUOC.filter((t) => hasArgExtractionPath(t.name) && !nhanRong(t));
    // Vế 2: tool **không** có nhánh riêng, sống được **nhờ** schema nhận `{}` (vd `get_vram_state`).
    const nhoVe2 = CHON_DUOC.filter((t) => !hasArgExtractionPath(t.name) && nhanRong(t));
    expect(nhoVe1.length, "không tool nào cần vế 'có nhánh riêng' ⇒ vế ấy là trang trí").toBeGreaterThanOrEqual(5);
    expect(nhoVe2.length, "không tool nào cần vế 'nhận {}' ⇒ vế ấy là trang trí").toBeGreaterThanOrEqual(1);
  });

  it("★★ KHÔNG nhãn `case` nào trỏ tới một tool KHÔNG TỒN TẠI (nhánh chết = một lượt đổi tên bị bỏ quên)", () => {
    /**
     * ⚠ Ca này hỏi **NGUỒN THỨ HAI**: nhãn `case` đọc thẳng từ mã nguồn, đối chiếu với (a) sổ đăng
     * ký lúc chạy và (b) `hasArgExtractionPath()`. Hai nguồn phải nói **cùng một chuyện** — nếu
     * lệch thì hoặc có nhánh chết (tool đã đổi tên/bị gỡ), hoặc cái sentinel đã hỏng.
     */
    const nguon = readFileSync(fileURLToPath(new URL("./intentClassifier.ts", import.meta.url)), "utf8");
    const nhan = [...new Set([...nguon.matchAll(/case\s+"([A-Za-z0-9_]+)"/g)].map((m) => m[1]!))].sort();
    expect(nhan.length, "không rút được nhãn `case` nào — bộ điều phối đã đổi hình dạng?").toBeGreaterThanOrEqual(41);

    const ten = new Set(MOI_TOOL.map((t) => t.name));
    expect(nhan.filter((n) => !ten.has(n)).join(", "), "nhãn `case` không ứng với tool đã đăng ký nào").toBe("");
    expect(
      nhan.filter((n) => !hasArgExtractionPath(n)).join(", "),
      "mã nguồn có nhãn `case` mà `hasArgExtractionPath` lại nói KHÔNG ⇒ sentinel đã hỏng",
    ).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Nhóm `readToolsProgramming` — với tới được bằng CÂU HỎI NGÔN NGỮ TỰ NHIÊN
// ════════════════════════════════════════════════════════════════════════════

/**
 * Đối tượng của khối này suy ra từ **chính module** `readToolsProgramming.ts` (mọi export có hình
 * dạng `Tool`), **không** từ một danh sách tên. Thêm một tool thứ 9 vào module ấy ⇒ nó tự vào
 * lượng từ ⇒ bảng câu hỏi dưới đây thiếu một mục ⇒ **ĐỎ**.
 */
const NHOM: Tool<any, any>[] = Object.values(progMod).filter((v): v is Tool<any, any> => {
  const t = v as Partial<Tool<any, any>> | undefined;
  return !!t && typeof t === "object" && typeof t.name === "string" && !!t.parameters && Array.isArray(t.triggers);
});

/** Câu hỏi NGƯỜI DÙNG THẬT có thể gõ — mỗi tool một câu. Bảng phải PHỦ HẾT `NHOM` (ca đầu tiên). */
const CAU_HOI: Record<string, string> = {
  retrieve_programming_kb: "tra cứu tài liệu hãng về lệnh MOVJ của robot",
  lookup_error_code: "mã lỗi AL.E6 của servo là gì",
  syntax_check_program: "kiểm tra cú pháp gcode này: ```G01 X10 Y20 F100```",
  compile_program: "biên dịch chương trình st sau: ```VAR x : BOOL; END_VAR```",
  simulate_program: "mô phỏng chương trình gcode: ```G01 X1 Y2```",
  generate_program: "viết chương trình gcode cắt một hình vuông 10mm",
  calc: "tính 2+3*4 bằng bao nhiêu",
  read_project_file: "đọc file main.st",
};

describe("★★★ F2 — 8 tool `readToolsProgramming` với tới được từ đường Agent NGÔN NGỮ TỰ NHIÊN", () => {
  it("★★★ cầu chì + PHỦ HẾT — mọi tool của module đều đã đăng ký VÀ có một câu hỏi trong bảng", () => {
    expect(NHOM.length, "không đọc được tool nào từ `readToolsProgramming` — bộ lọc đã hỏng?").toBeGreaterThanOrEqual(8);
    for (const t of NHOM) {
      expect(getTool(t.name), `${t.name} phải nằm trong sổ đăng ký lúc chạy`).toBe(t);
    }
    const thieuCauHoi = NHOM.map((t) => t.name).filter((n) => !CAU_HOI[n]);
    expect(
      thieuCauHoi.join(", "),
      "một tool của module KHÔNG có câu hỏi NL để chứng minh nó với tới được — thêm câu hỏi, đừng xoá tool khỏi lượng từ",
    ).toBe("");
    const duCauHoi = Object.keys(CAU_HOI).filter((n) => !NHOM.some((t) => t.name === n));
    expect(duCauHoi.join(", "), "bảng câu hỏi có mục không còn tương ứng tool nào").toBe("");
  });

  it("★★★ ∀ tool trong nhóm: một câu tiếng Việt ⇒ CHỌN ĐÚNG TOOL **VÀ** NHẬN ĐỦ THAM SỐ BẮT BUỘC", () => {
    for (const t of NHOM) {
      const q = CAU_HOI[t.name]!;
      const d = classifyToolIntent(q);
      expect(d.tool, `"${q}" phải chọn ${t.name} (đang: ${d.tool} / ${String(d.reason).slice(0, 60)})`).toBe(t.name);
      expect(d.reason, `${t.name} phải tới nơi bằng bộ phân loại HEURISTIC (không LLM, không đường tắt)`).toBe(
        "HEURISTIC_MATCH",
      );
      // Ô bắt buộc suy ra từ **schema**, không chép tay.
      for (const o of oBatBuoc(t)) {
        expect(Object.hasOwn(d.args, o), `${t.name}: thiếu tham số bắt buộc "${o}" trong ${JSON.stringify(d.args)}`).toBe(
          true,
        );
      }
      expect(t.parameters.safeParse(d.args).success, `${t.name}: args không qua nổi schema của chính nó`).toBe(true);
    }
  });

  it("★★★ ∀ tool: KHÔNG bộ trích nào đặt ô `lang` (ô ấy có MỘT người chủ — `argsWithAuthCtx`)", () => {
    /**
     * ⚠⚠ C-1 của Pha 4: `retrieve_programming_kb`/`lookup_error_code` có ô **trùng tên** `lang`
     * mà thực chất là **BỘ LỌC KHO TÀI LIỆU** (`z.string().max(16)`, không phải enum ba ngôn ngữ).
     * Điền bừa nó ⇒ RAG rơi từ 91.678 xuống 237 chunk, **im lặng**, và 28/28 ca cũ vẫn xanh.
     * ⇒ Luật: **không bộ trích nào của bất kỳ tool nào được đặt `lang`.** Ngôn ngữ phiên đi vào ở
     * đúng một chỗ, và chỗ ấy **chứng minh kiểu của ô** trước khi đụng vào.
     */
    const cauHoiDaNgonNgu = [
      "trả lời bằng tiếng Anh: tra cứu tài liệu hãng về servo",
      "answer in english please, read file main.st",
      "用中文回答：读取文件 main.st",
      "mã lỗi AL.E6 tiếng Trung",
      "tính 2+3*4 in english",
    ];
    for (const t of CHON_DUOC) {
      for (const q of cauHoiDaNgonNgu) {
        const args = extractArgsForTool(t.name, q);
        expect(Object.hasOwn(args, "lang"), `${t.name} đặt ô \`lang\` cho câu hỏi ${JSON.stringify(q)}`).toBe(false);
      }
    }
  });

  it("★★ KHÔNG BẮT NHẦM — 41 nhánh có sẵn giữ NGUYÊN hành vi trên các câu hỏi mốc", () => {
    /**
     * ⚠ Bản vá F2 tách `get_today_stats` khỏi nhánh `default` và thêm 8 nhánh mới. Ca này khoá
     * rằng nó **không** kéo theo một lượt đổi định tuyến nào ở các đường đã có.
     */
    const moc: [string, string][] = [
      ["hôm nay sản lượng thế nào", "get_today_stats"],
      ["OEE máy AOI-01 7 ngày", "get_oee"],
      ["top 5 lỗi tuần này", "analytics_defect_pareto"],
      ["máy nào đang offline", "get_machine_status"],
      ["lô L20260505-001 thế nào", "get_lot_status"],
      ["xu hướng torque máy SCR-01 7 ngày", "get_process_metric_trend"],
      ["tương quan torque với NG", "correlate_process_quality"],
      ["còn bao nhiêu vram", "get_vram_state"],
      ["tính tỉ lệ NG hôm nay", "get_today_stats"],
    ];
    for (const [q, mong] of moc) {
      expect(classifyToolIntent(q).tool, `"${q}" phải vẫn là ${mong}`).toBe(mong);
    }
    // `get_today_stats` vẫn nhận `{}` — nhánh của nó là một câu trả lời ĐẦY ĐỦ, không phải `default`.
    expect(hasArgExtractionPath("get_today_stats")).toBe(true);
    expect(extractArgsForTool("get_today_stats", "hôm nay thế nào")).toEqual({});
  });
});
