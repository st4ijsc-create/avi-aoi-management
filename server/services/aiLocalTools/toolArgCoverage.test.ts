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
import { chonDuocTheoTrigger, classifyToolIntent, extractArgsForTool, hasArgExtractionPath, kindFromLabel } from "./intentClassifier";

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

/**
 * ★★★ I-1 — tool **CẦN THAM SỐ**: `safeParse({})` hỏng ⇔ *"tool này CHẾT nếu không ai điền"*.
 * Tập này **suy ra từ schema**, không liệt kê tên; nó là đối tượng của luật mạnh bên dưới.
 */
const CAN_THAM_SO = CHON_DUOC.filter((t) => !t.parameters.safeParse({}).success);

/**
 * Một câu hỏi NGƯỜI DÙNG THẬT có thể gõ, **mang đủ dữ liệu** cho từng tool cần tham số.
 * ⚠ Bảng này bị ca *"PHỦ HẾT"* cưỡng chế **theo cả hai chiều** — thiếu một tool là ĐỎ, thừa một
 * mục cũng ĐỎ. Nó là **đầu vào** của luật, không phải định nghĩa của lượng từ.
 */
const CAU_HOI_THAM_SO: Record<string, string> = {
  analytics_pdm_forecast: "dự báo hỏng máy AOI-01",
  analyze_line_bottleneck: "dự báo nút thắt chuyền L01 trong 7 ngày",
  calc: "tính 2+3*4 bằng bao nhiêu",
  compile_program: "biên dịch chương trình st sau: ```VAR x : BOOL; END_VAR```",
  correlate_process_quality: "tương quan torque với NG ở công đoạn function",
  generate_program: "viết chương trình gcode cắt một hình vuông 10mm",
  get_device_health: "sức khỏe máy AOI-01 trong 7 ngày",
  get_line_balance: "cân bằng chuyền L01 hôm nay",
  get_lot_status: "lô L20260505-001 thế nào",
  get_machine_process_result: "kết quả công đoạn của máy AOI-01 hôm nay",
  get_ot_telemetry_latest: "đọc tag máy AOI-01",
  get_process_metric_trend: "xu hướng torque máy SCR-01 7 ngày",
  lookup_error_code: "mã lỗi AL.E6 của servo là gì",
  read_project_file: "đọc file main.st",
  retrieve_programming_kb: "tra cứu tài liệu hãng về lệnh MOVJ của robot",
  simulate_program: "mô phỏng chương trình gcode: ```G01 X1 Y2```",
  syntax_check_program: "kiểm tra cú pháp gcode này: ```G01 X10 Y20 F100```",
};

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

  it("★★★ I-1 — PHỦ HẾT: MỌI tool CẦN THAM SỐ phải có một câu hỏi trong bảng (bảng do SCHEMA quyết)", () => {
    /**
     * ⚠ Tập đối tượng **suy ra từ schema**: `!safeParse({}).success` ⇔ *"tool này chết nếu không ai
     * điền tham số"*. Không liệt kê tên, không liệt kê ô. Một tool mới cần tham số ⇒ bảng thiếu một
     * mục ⇒ ĐỎ; một tool nới schema thành không-bắt-buộc ⇒ bảng thừa một mục ⇒ ĐỎ.
     */
    expect(CAN_THAM_SO.length, "không tool nào cần tham số — bộ lọc theo schema đã hỏng?").toBeGreaterThanOrEqual(15);
    const thieu = CAN_THAM_SO.map((t) => t.name).filter((n) => !CAU_HOI_THAM_SO[n]);
    expect(thieu.join(", "), "tool CẦN THAM SỐ mà KHÔNG có câu hỏi chứng minh nó lấy được tham số").toBe("");
    const du = Object.keys(CAU_HOI_THAM_SO).filter((n) => !CAN_THAM_SO.some((t) => t.name === n));
    expect(du.join(", "), "bảng có mục không còn ứng với tool CẦN THAM SỐ nào").toBe("");
  });

  it("★★★ I-1 — LUẬT MẠNH: đường lấy tham số phải SINH RA object THOẢ `safeParse` của chính schema nó", () => {
    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ⚠⚠⚠ VÌ SAO LUẬT NÀY PHẢI CÓ: LUẬT TRƯỚC CHỈ HỎI *"CÓ `case` KHÔNG"*, KHÔNG HỎI *"`case`
     * LÀM GÌ"* — VÀ NGƯỜI REVIEW TÌM RA MỘT LỖ **CÒN SỐNG** ĐÚNG Ở ĐÓ.
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Đột biến của họ: **giữ nguyên** `case "get_device_health"` nhưng **thôi điền ô bắt buộc**
     * `machineCode`. Tool chết **đúng lớp lỗi F2** (mọi câu NL ⇒ `INVALID_ARGS`), mà **toàn bộ cổng
     * 12 đường vẫn 106 file / 1802 ca XANH**. Phạm vi ≥6 tool.
     * ⚠ Cầu chì `default: return {}` **không** bắt được lớp này: nó canh **đường mặc định**, còn
     * đây là một `case` **RỖNG RUỘT** — có mặt, chạy, và trả về thứ vô dụng.
     * ⇒ Luật phải hỏi **KẾT QUẢ**, và trọng tài là **chính schema của tool** (`safeParse`), không
     * phải một danh sách ô do tay người viết ra.
     */
    for (const t of CAN_THAM_SO) {
      const q = CAU_HOI_THAM_SO[t.name]!;
      const args = extractArgsForTool(t.name, q);
      const r = t.parameters.safeParse(args);
      expect(
        r.success,
        `${t.name}: đường lấy tham số sinh ra ${JSON.stringify(args)} — KHÔNG qua nổi schema của chính nó` +
          (r.success ? "" : ` (thiếu/sai: ${r.error.issues.map((i) => i.path.join(".") || "<root>").join(", ")})`) +
          `\n  câu hỏi: ${JSON.stringify(q)}`,
      ).toBe(true);
      // …và nó phải điền THẬT, không phải qua được nhờ schema rỗng.
      expect(Object.keys(args).length, `${t.name}: sinh ra object RỖNG mà vẫn qua schema?`).toBeGreaterThan(0);
    }
  });

  it("★★★ RR-1 — LUẬT KHỐI MÃ: token đầu là NHÃN ⇔ `kindFromLabel` nhận ra nó (∀ token × ∀ dấu tách)", () => {
    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ⚠⚠⚠ CA NÀY THAY MỘT LƯỚI ĐÃ **KHOÁ ĐÚNG CÁI VỪA SỬA** — LỚP LỖI, KHÔNG PHẢI MỘT CON BUG.
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Bản I-1b liệt kê **ba hình dạng fence** — đúng ba hình dạng bản vá làm đúng. Người review
     * dựng **sáu**, và **bốn** trong đó sai với **cổng XANH 100%**:
     *   ```` ```gcode G01 X10``` ````   ⇒ `code = "gcode G01 X10"`  (nhãn LỌT VÀO MÃ)
     *   ```` ```st VAR x : BOOL;``` ```` ⇒ `code = "st VAR x : BOOL;"`
     *   ```` ```VAR⏎ x : BOOL;``` ````   ⇒ **VẪN CỤT** (`VAR` một mình dòng đầu = **chuẩn ST**)
     *   ```` ```G01⏎X10 Y20``` ````      ⇒ **VẪN CỤT**
     * ⇒ Lưới liệt kê hình dạng **xác nhận bản vá**, không canh bất biến. Bảng nào cũng có hình
     *   dạng thứ N+1 (lớp lỗi đã tái diễn **mười ba** lần).
     *
     * Nên ca này **không liệt kê hình dạng**. Nó lấy một **kho token đầu** rồi hỏi **CHÍNH
     * `kindFromLabel()` của sản phẩm** token ấy có phải nhãn không, và chỉ khẳng định **HỆ QUẢ**:
     *
     *   nhãn  ⇒ `code` = thân **BỎ token đầu**, và `kind` = **đúng cái `kindFromLabel` trả**;
     *   không ⇒ `code` = **TOÀN BỘ** thân, **không mất chữ nào**.
     *
     * Đổi `KIND_HINTS` ⇒ sản phẩm và lưới đổi **cùng lúc**; không có bản sao thứ hai để lệch.
     */
    const KIND_CODE_TOOLS = NHOM.filter((t) => {
      const o = oBatBuoc(t);
      return o.includes("kind") && o.includes("code");
    });
    expect(KIND_CODE_TOOLS.length, "không tool nào nhận `kind`+`code` — bộ lọc theo schema đã hỏng?").toBeGreaterThanOrEqual(3);

    /** Kho token đầu: nửa là **tên ngôn ngữ**, nửa là **dòng lệnh thật**. Ai là nhãn thì hỏi sản phẩm. */
    const TOKEN = ["gcode", "st", "ld", "pou", "zmotion", "mitsubishi", "tmscript", "G01", "VAR", "N10", "PROGRAM", "MOVJ", "M30", "FUNCTION_BLOCK", "X10"];
    /** Dấu tách giữa token đầu và phần còn lại — **cả hai** phải cho cùng một kết quả. */
    const TACH = [" ", "\n", "\r\n", "  ", " \n"];
    const PHAN_CON_LAI = "X10 Y20 F100";

    let nhan = 0;
    let khongNhan = 0;
    for (const t of KIND_CODE_TOOLS) {
      for (const tok of TOKEN) {
        const laNhan = kindFromLabel(tok); // ← NGUỒN DUY NHẤT, hỏi chính sản phẩm
        for (const sep of TACH) {
          const q = `kiểm tra chương trình này: \`\`\`${tok}${sep}${PHAN_CON_LAI}\`\`\``;
          const args = extractArgsForTool(t.name, q);
          if (laNhan) {
            nhan++;
            expect(args.code, `${t.name} [${JSON.stringify(tok + sep)}]: NHÃN phải bị bóc khỏi mã`).toBe(PHAN_CON_LAI);
            expect(args.kind, `${t.name} [${tok}]: kind phải đúng cái \`kindFromLabel\` trả`).toBe(laNhan);
          } else {
            khongNhan++;
            expect(
              args.code,
              `${t.name} [${JSON.stringify(tok + sep)}]: KHÔNG phải nhãn ⇒ mã phải NGUYÊN VẸN, không mất token đầu`,
            ).toBe(`${tok}${sep}${PHAN_CON_LAI}`.trim());
          }
        }
      }
    }
    // Cầu chì: cả hai nhánh phải có mẫu thật, nếu không luật chỉ đúng một nửa mà vẫn xanh.
    expect(nhan, "không token nào được nhận là nhãn ⇒ nhánh 'nhãn' là chân lý rỗng").toBeGreaterThanOrEqual(30);
    expect(khongNhan, "không token nào bị coi là mã ⇒ nhánh 'không nhãn' là chân lý rỗng").toBeGreaterThanOrEqual(30);
  });

  it("★★★ RR-2 — MỌI giá trị CHUỖI bộ trích sinh ra phải TRUY được về câu hỏi (không hằng số)", () => {
    /**
     * ⚠⚠ Đột biến của người review gán **hằng** cho `retrieve_programming_kb.query`,
     * `lookup_error_code.code` và `generate_program.request` ⇒ **toàn cổng 1814/1814 XANH**. Gốc:
     * docstring I-1b tự phát biểu luật **quá hẹp** (*"ô nào chở mã nguồn"*) nên ba ô **chở câu
     * hỏi** rơi ra ngoài lượng từ.
     * ⇒ Luật rộng ra và neo vào một sự thật **kiểm được**: mọi ô chuỗi **tự do** (không phải
     *   `z.enum`) phải mang một chuỗi **có mặt trong câu hỏi**. Một hằng số bịa không có mặt ⇒ ĐỎ.
     * ⚠ Ô `z.enum` (như `kind`) được loại **bằng cách hỏi schema**, không bằng cách đọc tên ô.
     */
    const laEnum = (o: unknown): boolean => {
      let n: unknown = o;
      for (let i = 0; i < 8 && n !== null && n !== undefined; i++) {
        if (Array.isArray((n as { options?: unknown }).options)) return true;
        n = (n as { _def?: { innerType?: unknown } })._def?.innerType;
      }
      return false;
    };
    let daKiem = 0;
    for (const t of NHOM) {
      const q = CAU_HOI_THAM_SO[t.name];
      if (!q) continue;
      const shape = (t.parameters as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      const args = extractArgsForTool(t.name, q);
      for (const [o, v] of Object.entries(args)) {
        if (typeof v !== "string" || v.length < 2) continue;
        if (laEnum(shape[o])) continue; // ô enum: giá trị là TỪ VỰNG của schema, không phải của câu hỏi
        daKiem++;
        expect(
          q.includes(v),
          `${t.name}.${o} = ${JSON.stringify(v.slice(0, 60))} KHÔNG có trong câu hỏi ⇒ nó là một HẰNG SỐ bịa, ` +
            `không phải thứ người dùng nói`,
        ).toBe(true);
      }
    }
    expect(daKiem, "không ô chuỗi tự do nào được kiểm ⇒ luật là chân lý rỗng").toBeGreaterThanOrEqual(6);
  });

  it("★★ RR-4 — `lookup_error_code` KHÔNG nuốt MÃ MÁY (và vẫn lấy đúng mã lỗi thật)", () => {
    /** ⚠ Cả hai chiều: loại đúng thứ phải loại, **và** không loại nhầm mã lỗi thật. */
    for (const q of ["mã lỗi của máy AOI-01", "báo lỗi ở máy SCR-01", "alarm máy AVI-12"]) {
      expect(extractArgsForTool("lookup_error_code", q).code, `"${q}": mã MÁY không phải mã lỗi`).toBeUndefined();
    }
    for (const [q, code] of [
      ["mã lỗi AL.E6 của servo là gì", "AL.E6"],
      ["tra error code F0301", "F0301"],
      ["mã lỗi ER-12 trên drive", "ER-12"],
      ["báo lỗi ở máy AOI-01, mã E7", "E7"],
    ] as const) {
      expect(extractArgsForTool("lookup_error_code", q).code, `"${q}"`).toBe(code);
    }
    // …và mã LÔ vẫn không bị cắt thành mã lỗi (vá của lượt trước không bị phá).
    expect(extractArgsForTool("lookup_error_code", "báo lỗi lô L20260505-001").code).toBeUndefined();
  });

  it("★★★ I-1b — KHOÁ **GIÁ TRỊ** của `code`: `safeParse` xanh KHÔNG có nghĩa là mã ĐÚNG", () => {
    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ⚠⚠⚠ CA NÀY SINH RA TỪ MỘT ĐỘT BIẾN **KHÔNG BỊ BẮT** (N4), VÀ ĐÓ LÀ BÀI HỌC CỦA NÓ.
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Luật I-1 hỏi *"đường lấy tham số có sinh ra object THOẢ schema không"*. Nhưng
     * `code: z.string().min(1)` **thoả** với **bất kỳ** chuỗi không rỗng — kể cả một đoạn mã **đã
     * bị cắt mất dòng đầu**. Đột biến trả `CODE_FENCE_LABELED` về dạng xuống-dòng-tuỳ-chọn (đúng
     * con bug thật đã có trong bản đầu của Task 3) ⇒ ```` ```G01 X1 Y2``` ```` giao cho bộ biên
     * dịch `X1 Y2` — **mất lệnh `G01`** — và **26/26 ca vẫn XANH**.
     * ⇒ *"`safeParse` xanh"* là một khẳng định về **hình dạng**, không phải về **nội dung**. Ô nào
     *   chở **mã nguồn của người dùng** thì phải có một ca khoá **giá trị**.
     *
     * ⚠ Đối tượng suy ra từ **schema** (`kind` + `code` cùng bắt buộc), không liệt kê tên tool.
     */
    const KIND_CODE = NHOM.filter((t) => {
      const o = oBatBuoc(t);
      return o.includes("kind") && o.includes("code");
    });
    expect(KIND_CODE.length, "không tool nào nhận `kind`+`code` — bộ lọc theo schema đã hỏng?").toBeGreaterThanOrEqual(3);

    for (const t of KIND_CODE) {
      // (a) khối VIẾT LIỀN — KHÔNG có nhãn ⇒ **toàn bộ thân là mã**, không mất chữ nào.
      const lien = extractArgsForTool(t.name, "kiểm tra cú pháp gcode này: ```G01 X10 Y20 F100```");
      expect(lien.code, `${t.name}: khối viết liền bị CỤT — nhãn nuốt mất dòng lệnh đầu`).toBe("G01 X10 Y20 F100");
      expect(lien.kind, `${t.name}: kind lấy từ câu chữ`).toBe("gcode");

      // (b) khối CÓ NHÃN trên dòng riêng ⇒ nhãn ra `kind`, thân ra `code` (không dính nhãn).
      const conhan = extractArgsForTool(t.name, "kiểm tra chương trình này:\n```gcode\nG01 X10\nG02 Y20\n```");
      expect(conhan.code, `${t.name}: khối có nhãn phải giữ NGUYÊN thân`).toBe("G01 X10\nG02 Y20");
      expect(conhan.kind).toBe("gcode");

      // (c) nhãn KHÔNG phải ngôn ngữ (một từ của mã) vẫn không được nuốt mất dòng đầu.
      const stLien = extractArgsForTool(t.name, "biên dịch chương trình st sau: ```VAR x : BOOL; END_VAR```");
      expect(stLien.code, `${t.name}: 'VAR' là MÃ, không phải nhãn ngôn ngữ`).toBe("VAR x : BOOL; END_VAR");
    }
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

  it("★★★ I-2 — ∀ trigger của MỌI tool khác: một câu nghiệp vụ dựng từ nó KHÔNG được rơi vào `calc`", () => {
    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ⚠⚠⚠ VÌ SAO ĐẢO LƯỢNG TỪ Ở ĐÂY: BẢN ĐẦU LÀ MỘT **LIỆT KÊ 12 CÂU MỐC**, VÀ NÓ ĐÃ BỎ SÓT.
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Người review đo **9/14** câu nghiệp vụ bị `calc` cướp; tôi đo lại bằng bộ của mình: **6/24**.
     * Cả hai bộ đều là **danh sách**, và lớp *"danh sách nào cũng có phần tử thứ N+1"* đã tái diễn
     * **mười ba** lần. ⇒ Nguồn câu hỏi phải là **một nguồn có đo**: **chính bảng `triggers`** mà
     * mọi tool tự khai trong sổ đăng ký. Thêm một tool ⇒ trigger của nó tự vào lượng từ.
     *
     * Mỗi trigger sinh ra bốn câu mang **đúng hình dạng đã làm vỡ bản đầu**: mã máy `AOI-01`, mã lô
     * `L20260505-001`, mã chuyền `L-01`, đơn vị `mm/s` — tất cả đều chứa `-` hoặc `/`.
     * ⚠ Trigger của **chính `calc`** bị loại: chúng là của nó, không phải "câu nghiệp vụ".
     */
    const CALC = getTool("calc");
    expect(CALC, "phải có tool `calc` thì ca này mới có nghĩa").toBeTruthy();
    const cuaCalc = new Set(CALC!.triggers.map((t) => t.toLowerCase()));
    const khuon = (g: string) => [
      `tính ${g} máy AOI-01`,
      `${g} của lô L20260505-001 bằng bao nhiêu`,
      `tính ${g} chuyền L-01 trong 7 ngày`,
      `tính ${g} 5 mm/s`,
    ];
    const cuop: string[] = [];
    let soCau = 0;
    for (const t of CHON_DUOC) {
      if (t.name === "calc") continue;
      for (const g of t.triggers) {
        if (cuaCalc.has(g.toLowerCase())) continue;
        for (const q of khuon(g)) {
          soCau++;
          if (classifyToolIntent(q).tool === "calc") cuop.push(`${t.name} :: ${q}`);
        }
      }
    }
    // Cầu chì: 0 câu ⇒ mọi khẳng định trên là chân lý rỗng.
    expect(soCau, "không dựng được câu nào từ trigger — sổ đăng ký/ triggers đã hỏng?").toBeGreaterThanOrEqual(800);
    expect(
      cuop.slice(0, 20).join("\n"),
      `${cuop.length}/${soCau} câu nghiệp vụ bị \`calc\` CƯỚP — người dùng nhận thẻ báo lỗi thay vì câu trả lời`,
    ).toBe("");
  });

  it("★★ ĐỐI CHỨNG DƯƠNG cho I-2 — biểu thức số học THẬT vẫn vào `calc` (siết không được siết chết)", () => {
    /** ⚠ Thiếu ca này thì "chặn hết mọi thứ vào calc" cũng xanh ở ca trên. */
    for (const [q, bt] of [
      ["tính 2+3*4 bằng bao nhiêu", "2+3*4"],
      ["tính (2+3)*4", "(2+3)*4"],
      ["tính giúp tôi sqrt(16)", "sqrt(16)"],
      ["tính 100/7", "100/7"],
      ["tính 12.5 * 8", "12.5 * 8"],
      ["tính 2 * pi", "2 * pi"],
      ["tính max(3, 7) + 1", "max(3, 7) + 1"],
    ] as const) {
      const d = classifyToolIntent(q);
      expect(d.tool, `"${q}" phải vào calc`).toBe("calc");
      expect(d.args).toMatchObject({ expression: bt });
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
