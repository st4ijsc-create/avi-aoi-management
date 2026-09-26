/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI: `\b` (word boundary của JS) ĐỨNG CẠNH CHỮ TIẾNG VIỆT CÓ DẤU ⇒ MÃ CHẾT.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * JavaScript định nghĩa "ký tự từ" là `[A-Za-z0-9_]`. Mọi chữ cái tiếng Việt có dấu
 * (`đ ă â ê ô ơ ư à á ả ã ạ …`) **KHÔNG** thuộc tập đó. Hệ quả cơ học:
 *
 *   • `\b` đứng **TRƯỚC** một nhánh mở đầu bằng chữ có dấu ⇒ **KHÔNG BAO GIỜ KHỚP**
 *     (dấu cách và `đ` đều là non-word ⇒ không tồn tại biên giữa chúng).
 *   • `\b` đứng **SAU** một nhánh kết thúc bằng chữ có dấu ⇒ cũng không bao giờ khớp.
 *
 * Bằng chứng chạy thật (không phải suy luận):
 *   /\b(đặt|cập nhật)/.test("hay đặt ngưỡng")    → false   ← MÃ CHẾT
 *   /\b(chưa xác nhận)/.test("lo chưa xác nhận") → true    ← chạy, vì `c` là ASCII
 *
 * ⇒ Trong một nhà máy Việt Nam, người dùng gõ **tiếng Việt** thì bộ lọc chết, gõ **tiếng Anh**
 *   thì chạy. Mỗi ca dưới đây đều đi kèm một **ĐỐI CHỨNG DƯƠNG** là nhánh ASCII-đầu tương
 *   đương — để chứng minh cái hỏng là **biên từ**, không phải "chưa hỗ trợ cụm đó".
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ NHÓM F LÀ LƯỚI THẬT — BỐN NHÓM ĐẦU CHỈ LÀ MẪU.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Một danh sách 25 nhánh viết tay **luôn có nhánh thứ 26**. Nhóm F không liệt kê nhánh nào: nó
 * **phân tích lại chính mã nguồn** `intentClassifier.ts`, đếm **MỌI** biên từ trong **MỌI** regex
 * và bắt lỗi ở nhánh chưa ai nghĩ tới. Nó còn tự **kiểm định thiết bị đo** (F-1) — vì một bộ phân
 * tích im lặng bỏ sót thì cổng vẫn xanh mà lỗ vẫn mở.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import "./index"; // đăng ký toàn bộ tool registry (side-effect)
import { classifyToolIntent, extractArgsForTool } from "./intentClassifier";

const A = (t: string, q: string) => extractArgsForTool(t, q);

// ═══════════════════════════════════════════════════════════════════════════════════════════
// NHÓM A — `extractArgsForTool`: tham số RƠI MẤT khi người dùng gõ tiếng Việt
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("A — biên từ giết bộ trích tham số (đối chứng: nhánh ASCII-đầu vẫn chạy)", () => {
  it("list_work_orders: 'đang làm' phải ra status=in_progress (như 'in progress')", () => {
    expect(A("list_work_orders", "công việc đang làm trên máy AOI-01").status).toBe("in_progress");
    // ĐỐI CHỨNG DƯƠNG — nhánh tiếng Anh vốn đã chạy, không được hỏng đi.
    expect(A("list_work_orders", "công việc in progress trên máy AOI-01").status).toBe("in_progress");
  });

  it("list_work_orders: 'đang xử lý' phải ra status=in_progress", () => {
    expect(A("list_work_orders", "công việc đang xử lý trên máy AOI-01").status).toBe("in_progress");
  });

  it("list_work_orders: 'đang mở' phải ra status=open (như 'open')", () => {
    expect(A("list_work_orders", "work order đang mở").status).toBe("open");
    expect(A("list_work_orders", "work order open").status).toBe("open");
  });

  it("list_work_orders: 'đã xong' phải ra status=done (như 'hoàn thành')", () => {
    expect(A("list_work_orders", "work order đã xong").status).toBe("done");
    expect(A("list_work_orders", "work order hoàn thành").status).toBe("done");
  });

  it("list_active_alerts: 'đã xác nhận' phải ra acknowledged=true (như 'chưa xác nhận'→false)", () => {
    expect(A("list_active_alerts", "cảnh báo đã xác nhận").acknowledged).toBe(true);
    expect(A("list_active_alerts", "cảnh báo đã ack").acknowledged).toBe(true);
    // ĐỐI CHỨNG DƯƠNG — `chưa` bắt đầu bằng `c` (ASCII) nên nhánh này VỐN ĐÃ chạy.
    expect(A("list_active_alerts", "cảnh báo chưa xác nhận").acknowledged).toBe(false);
  });

  it("list_api_keys: 'đang hoạt động' phải ra active=true (như 'còn hiệu lực')", () => {
    expect(A("list_api_keys", "api key đang hoạt động").active).toBe(true);
    expect(A("list_api_keys", "api key còn hiệu lực").active).toBe(true);
  });

  it("get_change_history: 'đối tượng X' phải ra entityType=X (như 'entity X')", () => {
    expect(A("get_change_history", "lịch sử thay đổi đối tượng machine").entityType).toBe("machine");
    expect(A("get_change_history", "lịch sử thay đổi entity machine").entityType).toBe("machine");
  });

  it("get_fleet_process_summary: 'điểm keo' phải ra deviceClass=automation (như 'bắt vít')", () => {
    expect(A("get_fleet_process_summary", "tổng hợp công đoạn điểm keo toàn nhà máy").deviceClass).toBe("automation");
    expect(A("get_fleet_process_summary", "tổng hợp công đoạn bắt vít toàn nhà máy").deviceClass).toBe("automation");
  });

  it("calc: từ đệm lịch sự kết thúc bằng dấu ('hộ','thử','chị','nhé') phải được cắt như 'giúp'", () => {
    // Không cắt được ⇒ chuỗi còn chữ có dấu ⇒ chốt THUẦN-ASCII loại luôn ⇒ `calc` chết.
    expect(A("calc", "tính hộ 2+3").expression).toBe("2+3");
    expect(A("calc", "tính thử 12*7").expression).toBe("12*7");
    expect(A("calc", "tính chị 5*6").expression).toBe("5*6");
    expect(A("calc", "tính nhé 5*6").expression).toBe("5*6");
    // ĐỐI CHỨNG DƯƠNG — `giúp` kết thúc bằng `p` (ASCII) nên vốn đã cắt được.
    expect(A("calc", "tính giúp 2+3").expression).toBe("2+3");
    expect(A("calc", "tính 2+3").expression).toBe("2+3");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// NHÓM B — `classifyToolIntent`: ĐỊNH TUYẾN SAI TOOL (hậu quả nặng nhất)
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("B — biên từ giết cổng định tuyến ⇒ CHỌN NHẦM TOOL", () => {
  it("'đặt giới hạn spec …' phải là set_spec_limits, KHÔNG phải một tool đọc", () => {
    // ⚠ Câu này cố ý KHÔNG có dấu `=`, để nhánh dự phòng `\b(usl|lsl)\b…=` không che lỗi.
    const d = classifyToolIntent("đặt giới hạn spec cho điểm đo #12 USL 10.5 LSL 9.5");
    expect(d.tool).toBe("set_spec_limits");
    expect((d.args as Record<string, unknown>).measurementPointDefId).toBe(12);
    // ĐỐI CHỨNG DƯƠNG — `cập nhật` bắt đầu bằng `c` (ASCII) nên vốn đã chạy.
    const ctrl = classifyToolIntent("cập nhật giới hạn spec cho điểm đo #12 USL 10.5 LSL 9.5");
    expect(ctrl.tool).toBe("set_spec_limits");
  });

  it("'điểm nóng lỗi' phải là analytics_defect_heatmap_summary (như 'heatmap')", () => {
    expect(classifyToolIntent("cho tôi xem điểm nóng lỗi 7 ngày qua").tool).toBe(
      "analytics_defect_heatmap_summary",
    );
    expect(classifyToolIntent("cho tôi xem heatmap lỗi 7 ngày qua").tool).toBe(
      "analytics_defect_heatmap_summary",
    );
  });

  it("'X ảnh hưởng đến NG' phải là correlate_process_quality (như 'tương quan')", () => {
    const d = classifyToolIntent("torque ảnh hưởng đến NG ở công đoạn sau không");
    expect(d.tool).toBe("correlate_process_quality");
    expect((d.args as Record<string, unknown>).upstreamStepType).toBe("torque");
    expect(classifyToolIntent("tương quan torque với NG ở công đoạn sau").tool).toBe(
      "correlate_process_quality",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// NHÓM C — cổng chuyên dụng KHÔNG nổ, câu vẫn "trúng tool" nhờ chấm điểm trigger vớt.
// `reason` là thứ DUY NHẤT phân biệt được — và nó nằm trong `ToolDecision` công khai.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("C — cổng chuyên dụng chết ÂM THẦM (trigger vớt nên tool vẫn đúng)", () => {
  it("'hiệu suất tổng thể' phải đi qua cổng OEE_SHORTCUT (như 'oee')", () => {
    expect(classifyToolIntent("hiệu suất tổng thể của dây chuyền ra sao").reason).toBe("OEE_SHORTCUT");
    expect(classifyToolIntent("oee của dây chuyền ra sao").reason).toBe("OEE_SHORTCUT");
  });

  it("'thời gian chu kỳ' phải đi qua cổng PROCESS_TREND_SHORTCUT (như 'torque')", () => {
    const d = classifyToolIntent("xu hướng thời gian chu kỳ máy SCR-01");
    expect(d.reason).toBe("PROCESS_TREND_SHORTCUT");
    expect((d.args as Record<string, unknown>).metricKey).toBe("cycleTimeMs");
    expect(classifyToolIntent("xu hướng torque máy SCR-01").reason).toBe("PROCESS_TREND_SHORTCUT");
  });

  it("'đóng gói' phải đi qua cổng PACKAGING_SHORTCUT (như 'packaging')", () => {
    expect(classifyToolIntent("tình hình đóng gói hôm nay thế nào").reason).toBe("PACKAGING_SHORTCUT");
    expect(classifyToolIntent("tình hình packaging hôm nay thế nào").reason).toBe("PACKAGING_SHORTCUT");
  });

  it("'đọc tag' phải đi qua cổng TELEMETRY_SHORTCUT (như 'telemetry')", () => {
    expect(classifyToolIntent("đọc tag máy PLC-01").reason).toBe("TELEMETRY_SHORTCUT");
    expect(classifyToolIntent("telemetry máy PLC-01").reason).toBe("TELEMETRY_SHORTCUT");
  });

  it("get_machine_status: 'đang offline' vẫn phải ra onlyOffline=true", () => {
    expect(A("get_machine_status", "máy nào đang offline").onlyOffline).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// NHÓM D — câu HỎI LẠI (clarifyMessage) im lặng biến mất
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("D — gợi ý hỏi lại chết ⇒ người dùng nhận về sự im lặng", () => {
  it("'thiết bị' phải sinh câu hỏi lại về MÁY (như 'máy')", () => {
    const d = classifyToolIntent("thiết bị đó đang ra sao");
    expect(d.tool).toBeNull();
    expect(d.reason).toBe("NO_TRIGGER_MATCH");
    expect(d.clarifyMessage).toBeTruthy();
    // ĐỐI CHỨNG DƯƠNG
    expect(classifyToolIntent("máy đó đang ra sao").clarifyMessage).toBeTruthy();
  });

  it("'lô' (không có dấu cách theo sau) phải sinh câu hỏi lại về LÔ (như 'pmo')", () => {
    const d = classifyToolIntent("cho tôi biết về lô");
    expect(d.tool).toBeNull();
    expect(d.clarifyMessage).toBeTruthy();
    expect(classifyToolIntent("cho tôi biết về pmo").clarifyMessage).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// NHÓM E — CHỐNG "VÁ QUÁ TAY": xoá `\b` sẽ làm khớp GIỮA TỪ. Các ca này phải mãi ĐỎ nếu ai
// sửa bằng cách bỏ biên thay vì thay biên.
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ ĐO ĐÚNG THỨ ĐỊNH ĐO: `.tool` KHÔNG dùng được ở đây. Bộ chấm điểm trigger
 * (`findToolByTriggers`) so khớp bằng `norm.includes(trigger)` — một phép **chuỗi con
 * KHÔNG CÓ BIÊN**, nên `"moment"` vẫn trúng trigger `"mom"` và trả về `get_ng_compare`
 * **dù regex đã từ chối đúng**. Đó là một lớp lỗi KHÁC (đo được ở đây, nằm ngoài phạm vi
 * task này — xem báo cáo). Thứ phát biểu được về BIÊN REGEX là `reason`: cổng regex trả
 * `*_SHORTCUT`, đường trigger trả `HEURISTIC_MATCH`.
 */
describe("E — biên phải CHẶT: không được khớp giữa từ", () => {
  it("`mom` không được khớp trong 'moment' (cổng PERIOD_COMPARE không được nổ)", () => {
    expect(classifyToolIntent("moment nào máy cũng chạy tốt").reason).not.toBe("PERIOD_COMPARE_SHORTCUT");
    // ĐỐI CHỨNG DƯƠNG — `mom` đứng RỜI thì cổng phải nổ (nếu không, ca trên đúng một cách rỗng).
    expect(classifyToolIntent("NG mom thế nào").reason).toBe("PERIOD_COMPARE_SHORTCUT");
    expect(classifyToolIntent("NG tháng này so với tháng trước").reason).toBe("PERIOD_COMPARE_SHORTCUT");
  });

  it("`wow` không được khớp trong 'wowzer'", () => {
    expect(classifyToolIntent("wowzer machine").reason).not.toBe("PERIOD_COMPARE_SHORTCUT");
    expect(classifyToolIntent("NG wow thế nào").reason).toBe("PERIOD_COMPARE_SHORTCUT");
  });

  it("`pdm` không được khớp trong 'pdmx'", () => {
    expect(classifyToolIntent("pdmx là gì").reason).not.toBe("PDM_FORECAST_SHORTCUT");
    expect(classifyToolIntent("pdm cho máy AOI-01").reason).toBe("PDM_FORECAST_SHORTCUT");
  });

  it("`ld` (ladder) không được khớp trong 'old'", () => {
    expect(A("generate_program", "viết lại đoạn old style cho tôi").kind).not.toBe("iec61131-ld");
    // ĐỐI CHỨNG DƯƠNG — `ladder` đứng rời thì phải nhận ra.
    expect(A("generate_program", "viết chương trình ladder cho băng tải").kind).toBe("iec61131-ld");
  });

  it("`mô-?men` giữ nguyên hành vi cả hai cách viết", () => {
    expect(classifyToolIntent("xu hướng mô-men máy SCR-01").reason).toBe("PROCESS_TREND_SHORTCUT");
    expect(classifyToolIntent("xu hướng mômen máy SCR-01").reason).toBe("PROCESS_TREND_SHORTCUT");
  });

  it("`đóng gói` không được khớp trong một từ dài hơn liền mạch", () => {
    // "đóng gói" nằm trong "đóng gói" thật thì khớp; "đóng gói" bị dính chữ số phía sau thì KHÔNG.
    expect(classifyToolIntent("tình hình đóng gói hôm nay thế nào").reason).toBe("PACKAGING_SHORTCUT");
    // `2` là ký tự-từ ⇒ mép phải phải CHẶN (đúng như `\b` cũ đã chặn).
    expect(classifyToolIntent("mã đóng gói2 là gì").reason).not.toBe("PACKAGING_SHORTCUT");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// NHÓM F — LƯỢNG TỪ TRÊN CHÍNH MÃ NGUỒN. Không liệt kê nhánh nào; đọc file và tự suy ra.
// ═══════════════════════════════════════════════════════════════════════════════════════════

const SUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "intentClassifier.ts");
const BS = String.fromCharCode(92); // ký tự `\` — viết gián tiếp để không tự escape nhầm
const WORD_ASCII = /[A-Za-z0-9_]/;

/** Tách một thân regex theo dấu `|` ở MỨC NGOÀI CÙNG (không cắt trong `(...)` hay `[...]`). */
function splitAlts(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inClass = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === BS) { cur += c + (s[i + 1] ?? ""); i++; continue; }
    if (inClass) { cur += c; if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; cur += c; continue; }
    if (c === "(") { depth++; cur += c; continue; }
    if (c === ")") { depth--; cur += c; continue; }
    if (c === "|" && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

interface Atom {
  raw: string;
  chars?: Set<string>;
  special?: string;
  cls?: string;
  group?: string;
  lookaround?: boolean;
  anchor?: boolean;
  optional: boolean;
}

/** Bẻ một nhánh regex thành các nguyên tử, giữ nguyên văn (`raw`) để ghép lại được. */
function atoms(s: string): Atom[] {
  const res: Atom[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    let a: Omit<Atom, "raw" | "optional">;
    let len = 1;
    if (c === BS) {
      const n = s[i + 1] ?? "";
      len = 2;
      a = "sSdDwWbB".includes(n) ? { special: n } : { chars: new Set([n]) };
    } else if (c === "[") {
      let j = i + 1;
      let cls = "";
      if (s[j] === "^") { cls += "^"; j++; }
      while (j < s.length && s[j] !== "]") {
        if (s[j] === BS) { cls += s[j]! + (s[j + 1] ?? ""); j += 2; } else { cls += s[j]!; j++; }
      }
      len = j - i + 1;
      a = { cls };
    } else if (c === "(") {
      let depth = 0;
      let j = i;
      let inC = false;
      for (; j < s.length; j++) {
        const d = s[j]!;
        if (d === BS) { j++; continue; }
        if (inC) { if (d === "]") inC = false; continue; }
        if (d === "[") { inC = true; continue; }
        if (d === "(") depth++;
        else if (d === ")") { depth--; if (depth === 0) break; }
      }
      const inner = s.slice(i + 1, j);
      len = j - i + 1;
      const look = /^\?(?:=|!|<=|<!)/.test(inner);
      const body = inner.replace(/^\?:/, "").replace(/^\?<[A-Za-z_$][\w$]*>/, "").replace(/^\?(?:=|!|<=|<!)/, "");
      a = { group: body, lookaround: look };
    } else if (c === "^" || c === "$") {
      a = { anchor: true };
    } else {
      a = { chars: new Set([c]) };
    }
    let k = i + len;
    let q = "";
    if (k < s.length && "*+?{".includes(s[k]!)) {
      if (s[k] === "{") {
        const e = s.indexOf("}", k);
        if (e > 0) { q = s.slice(k, e + 1); k = e + 1; }
      } else { q = s[k]!; k++; }
      if (k < s.length && s[k] === "?") { q += "?"; k++; }
    }
    res.push({ ...a, raw: s.slice(i, k), optional: q.startsWith("*") || q.startsWith("?") || /^\{0\b/.test(q) });
    i = k;
  }
  return res;
}

const SPACEY = "SPACE";
const WORDY = "WORD";

/** Tập ký tự CÓ THỂ đứng ở mép (`first`/`last`) của một nhánh regex. */
function edgeChars(branch: string, side: "first" | "last"): string[] {
  let list = atoms(branch);
  if (side === "last") list = [...list].reverse();
  const out = new Set<string>();
  for (const a of list) {
    if (a.anchor || a.special === "b" || a.special === "B" || a.lookaround) continue; // rộng 0
    if (a.group !== undefined) {
      for (const alt of splitAlts(a.group)) for (const ch of edgeChars(alt, side)) out.add(ch);
    } else if (a.special) {
      out.add(a.special === "s" ? SPACEY : WORDY);
    } else if (a.cls !== undefined) {
      out.add("CLASS" + a.cls);
    } else if (a.chars) {
      for (const ch of a.chars) out.add(ch);
    }
    if (!a.optional) break;
  }
  return [...out];
}

/** `true` khi ký tự mép này CÓ THỂ là ký tự-từ theo định nghĩa của JS (`[A-Za-z0-9_]`). */
function canBeWordChar(ch: string): boolean {
  if (ch === SPACEY) return false;
  if (ch === WORDY) return true;
  if (ch.startsWith("CLASS")) {
    const cls = ch.slice(5); // ⚠ "CLASS" dài 5 — cắt 6 sẽ NUỐT dấu `^`, biến `[^>]` thành `[>]`
    if (cls.startsWith("^")) return true; // lớp phủ định gần như luôn chứa ký tự-từ
    return /[A-Za-z0-9_]/.test(cls.replace(/\\s/g, ""));
  }
  return WORD_ASCII.test(ch);
}

/**
 * ★ `\b` khớp khi **ĐÚNG MỘT** trong hai bên là ký tự-từ. Nên một mép non-word CHƯA đủ để kết
 * luận chết: nếu **phía đối diện** cấp một ký tự-từ thì biên vẫn thành lập (`(\w*)\b\s*$` —
 * hoàn toàn hợp lệ). Chỉ khi phía đối diện **cũng không** cấp được ký tự-từ — hoặc nó là **mép
 * của mẫu**, tức ký tự đến từ văn bản người dùng, mà ở đầu/cuối một TỪ tự nhiên đó là dấu cách —
 * thì nhánh mới thực sự không bao giờ khớp.
 */
function otherSideSuppliesWordChar(text: string, edge: "first" | "last"): boolean {
  if (!text) return false;
  return edgeChars(text, edge).some(canBeWordChar);
}

interface DeadBranch { side: "TRÁI" | "PHẢI"; branch: string }

/**
 * Quét một thân regex: trả về (a) mọi nhánh CHẾT cạnh `\b`, (b) số `\b` đã thăm.
 * ⚠ Đệ quy vào nhóm con — `\b` nằm trong `(...)` (ví dụ `\bmom\b` lồng trong một nhánh)
 *   phải được thăm y hệt `\b` ở mức ngoài.
 */
function scanSource(src: string): { dead: DeadBranch[]; visited: number } {
  const dead: DeadBranch[] = [];
  let visited = 0;

  const walk = (s: string) => {
    for (const alt of splitAlts(s)) {
      const list = atoms(alt);
      list.forEach((a, i) => {
        if (a.group !== undefined) walk(a.group);
        if (a.special !== "b") return;
        visited++;
        const after = list.slice(i + 1).map((x) => x.raw).join("");
        const before = list.slice(0, i).map((x) => x.raw).join("");
        for (const [side, text, edge, other, otherEdge] of [
          ["TRÁI", after, "first", before, "last"],
          ["PHẢI", before, "last", after, "first"],
        ] as const) {
          if (!text) continue;
          if (otherSideSuppliesWordChar(other, otherEdge)) continue; // biên do phía kia gánh
          const seq = atoms(text);
          const anchorAtom = edge === "first" ? seq[0] : seq[seq.length - 1];
          if (!anchorAtom) continue;
          if (anchorAtom.lookaround) continue; // rộng 0 ⇒ không có ký tự mép
          const branches =
            anchorAtom.group !== undefined && !anchorAtom.optional
              ? splitAlts(anchorAtom.group)
              : [text];
          for (const b of branches) {
            if (!b) continue;
            const chars = edgeChars(b, edge);
            if (chars.length > 0 && !chars.some(canBeWordChar)) {
              dead.push({ side, branch: b.length > 70 ? b.slice(0, 70) + "…" : b });
            }
          }
        }
      });
    }
  };

  walk(src);
  return { dead, visited };
}

/** Mọi regex literal trong file, kèm số dòng. (Đã kiểm: file này không có literal nhiều dòng.) */
function regexLiterals(source: string): { line: number; src: string; flags: string; text: string }[] {
  const out: { line: number; src: string; flags: string; text: string }[] = [];
  source.split(/\r?\n/).forEach((raw, idx) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(raw)) return; // dòng chú thích
    const re = /\/((?:[^/\\[\n]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/([gimsuy]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) out.push({ line: idx + 1, src: m[1]!, flags: m[2]!, text: raw.trim() });
  });
  return out;
}

describe("F — LƯỢNG TỪ: không một biên từ nào trong intentClassifier.ts được đứng cạnh chữ có dấu", () => {
  const source = fs.readFileSync(SUT_PATH, "utf8");
  const literals = regexLiterals(source);

  it("F-1 — KIỂM ĐỊNH THIẾT BỊ ĐO: bộ phân tích phải bắt đúng ca xấu và tha đúng ca tốt", () => {
    // Ca XẤU — phải bị bắt (nếu không, cả nhóm F là một tờ giấy chứng nhận vô can).
    const bad = [
      BS + "b(đặt|set)",                                    // trái chết ở `đặt`
      "(oee|hiệu" + BS + "s*suất" + BS + "s*tổng" + BS + "s*thể)" + BS + "b", // phải chết ở `thể`
      BS + "b(lô|lot)" + BS + "b",                          // phải chết ở `lô`
      "(?:giúp|hộ)" + BS + "b",                             // phải chết ở `hộ`
      BS + "b(đang" + BS + "s*mở)" + BS + "b",              // chết CẢ HAI đầu
    ];
    for (const b of bad) {
      expect(scanSource(b).dead.length, "phải bắt được: " + b).toBeGreaterThan(0);
    }
    // Ca TỐT — không được báo động giả.
    // ⚠⚠ Hai ca cuối là HAI KHUYẾT TẬT THẬT của chính bộ phân tích này, do lượt quét toàn
    //    `server/` phát hiện (nó báo động giả ở `mtconnectClient.ts` và `robotTmAdapter.ts`).
    //    Giữ chúng ở đây để khuyết tật không quay lại — thiết bị đo cũng phải được đo.
    const good = [
      BS + "bmom" + BS + "b",
      "[A-Za-z_][A-Za-z0-9_]{2,}" + BS + "b(?!" + BS + "s*" + BS + "()",  // lookahead: rộng 0
      BS + "b(?:po|lệnh|lot|lô|order)" + BS + "s*([A-Z0-9][A-Z0-9_-]{2,30})" + BS + "b",
      BS + "b(cân" + BS + "s*bằng" + BS + "s*(chuyền|line)|nghẽn)" + BS + "b",
      "(" + BS + "d{1,2})" + BS + "s*(?:ngày|days?)" + BS + "b",
      BS + "b(tháng" + BS + "s*này|" + BS + "bmom" + BS + "b)" + BS + "b",
      "<Device" + BS + "b([^>]*)>",                       // lớp PHỦ ĐỊNH `[^>]` chứa ký tự-từ
      BS + "b([A-Za-z_]" + BS + "w*)" + BS + "b" + BS + "s*$", // biên do phía TRÁI (`\w`) gánh
    ];
    for (const g of good) {
      expect(scanSource(g).dead, "không được báo động giả: " + g).toEqual([]);
    }
    // Bộ phân tích phải THẤY biên lồng trong nhóm con (nếu không, nó mù đúng chỗ nguy hiểm).
    expect(scanSource(BS + "b(a|" + BS + "bmom" + BS + "b)" + BS + "b").visited).toBe(4);
  });

  it("F-2 — TÍNH ĐẦY ĐỦ: mọi `\\b` trong mã đều được bộ phân tích thăm (không sót regex nào)", () => {
    const inCode = source
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .reduce((n, l) => n + l.split(BS + "b").length - 1, 0);
    const visited = literals.reduce((n, l) => n + scanSource(l.src).visited, 0);
    expect(visited, `đếm trong văn bản=${inCode} nhưng bộ phân tích chỉ thăm=${visited}`).toBe(inCode);
  });

  it("F-3 — KHÔNG regex nào còn nhánh CHẾT cạnh biên từ", () => {
    const bad = literals
      .map((l) => ({ ...l, dead: scanSource(l.src).dead }))
      .filter((l) => l.dead.length > 0);
    const report = bad
      .map((l) => `  dòng ${l.line}: ${l.src}\n` + l.dead.map((d) => `     ↳ [chết mép ${d.side}] «${d.branch}»`).join("\n"))
      .join("\n");
    expect(bad.length, "\n" + report + "\n").toBe(0);
  });

  it("F-4 — mọi regex dùng `\\p{…}` PHẢI có cờ `u` (không có `u` thì `\\p` chỉ là chữ `p` — sai IM LẶNG)", () => {
    const missing = literals.filter((l) => l.src.includes(BS + "p{") && !l.flags.includes("u"));
    expect(missing.map((l) => `dòng ${l.line}: ${l.text}`)).toEqual([]);
  });

  it("F-5 — cầu chì: nhóm F chạy trên một tập KHÁC RỖNG", () => {
    expect(literals.length).toBeGreaterThan(50);
  });
});
