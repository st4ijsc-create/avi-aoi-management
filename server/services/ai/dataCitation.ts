/**
 * ★★★ TRÍCH DẪN **NGUỒN DỮ LIỆU** — để một CON SỐ trong câu trả lời truy ngược được
 * về HÀNG NÀO TRONG DB.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LỖ ĐANG VÁ
 * ══════════════════════════════════════════════════════════════════════════════
 * `KbCitation` (aiLocalKnowledgeService.ts) chỉ mô tả **chunk markdown**:
 * `sourcePath`/`title`/`score`. Còn `toolResult` — thứ DUY NHẤT mang số liệu sống
 * từ DB vào câu trả lời — **CHƯA BAO GIỜ được chuyển thành citation**. Hệ quả đo
 * được: một câu trả lời dạng *"hôm nay 128 NG trên máy M-01"* không có bất kỳ
 * đường nào truy ngược về bảng/bộ lọc/khoảng thời gian đã sinh ra con số ấy.
 * Và cơ chế chống bịa số hiện chỉ là **câu chữ trong prompt** ("Không bịa số liệu");
 * `generationGuard` bắt lặp thoái hoá, KHÔNG bắt số sai.
 *
 * Module này là LÁ: **không import gì**, không chạm DB, thuần và kiểm được.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 HAI LUẬT AN TOÀN — ĐỌC TRƯỚC KHI SỬA
 * ══════════════════════════════════════════════════════════════════════════════
 * ① **KHÔNG RÒ DỮ LIỆU.** Citation chỉ mang **siêu dữ liệu** (bảng · bộ lọc · số
 *    hàng · khoảng thời gian). KHÔNG một hàng nào, KHÔNG một ô giá trị nào của
 *    `data` được sao vào đây. `buildDataCitation` không hề đọc *giá trị* trong
 *    `data` — nó chỉ ĐẾM (xem `demSoHang`).
 *
 * ② **KHÔNG RÒ SỰ TỒN TẠI (RBAC).** Đây là cái bẫy thật, và nó KHÔNG hiển nhiên:
 *    khi RBAC từ chối, read tool **VẪN trả về một `ToolResult` bình thường** —
 *    `type` và `title` GIỐNG HỆT lượt thành công, `data` được điền bằng hình dạng
 *    rỗng — và thứ **DUY NHẤT** phân biệt là `note === "PERMISSION_DENIED"`
 *    (`server/services/aiLocalTools/readToolRbac.ts:80-93` — `ketQuaTuChoi`).
 *    ⇒ Một bộ dựng citation chỉ nhìn `type` sẽ vui vẻ phát ra
 *      *"nguồn: bảng `api_keys`, bộ lọc role=admin"* cho đúng người **vừa bị từ
 *      chối đọc bảng đó** — tức tiết lộ sự tồn tại của dữ liệu họ không có quyền xem.
 *    ⇒ LUẬT: **`note` có mặt ⇒ KHÔNG citation, chấm hết.** Không chỉ riêng
 *      `PERMISSION_DENIED`: `DB_UNAVAILABLE`/`NOT_FOUND`/`QUERY_ERROR`/`MISSING_ARGS`
 *      cũng đi cùng một `data` rỗng — không có hàng nào để mà truy ngược, nên trích
 *      dẫn chúng vừa vô nghĩa vừa mở lại đúng kênh rò trên. Một `note` mới do tool
 *      khác thêm về sau sẽ **tự động fail-closed** theo luật này.
 *    ⚠ Vì citation chỉ sinh ra từ một `toolResult` mà người dùng **ĐÃ được phép**
 *      nhận, nó không bao giờ tiết lộ thêm một bit nào so với chính câu trả lời.
 *      Nó là *hoá đơn* của dữ liệu đã giao, không phải một đường đọc thứ hai.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO KHOÁ THEO **TÊN TOOL**, KHÔNG PHẢI `ToolResult.type`
 * ══════════════════════════════════════════════════════════════════════════════
 * `type` KHÔNG định danh được nguồn: **cả 8 tool lập trình** cùng trả
 * `type: "action_result"` (`readToolsProgramming.ts:84`), và `line_insight` /
 * `correlation_insight` không mang tên tool. Khoá theo `type` là khoá theo một
 * định danh **không phân biệt được** — đúng lớp lỗi "thước đo một hình dạng không
 * tồn tại". Tên tool là thứ duy nhất 1-1 với truy vấn thật.
 */

/**
 * Hình dạng TỐI THIỂU mà module này cần từ một `ToolResult`. Khai cấu trúc (thay vì
 * `import type` từ `aiLocalTools`) để module ở lại LÁ tuyệt đối: không kéo theo
 * side-effect đăng ký tool, kiểm được mà không dựng cả tầng DB.
 */
export interface ToolResultLike {
  type?: string;
  title?: string;
  data?: unknown;
  textSummary?: string;
  note?: string;
}

/** Trích dẫn một NGUỒN DỮ LIỆU (khác hẳn `KbCitation` — vốn là chunk tài liệu). */
export interface KbDataCitation {
  /** Phân biệt tuyệt đối với citation tài liệu ở mọi tầng tiêu thụ. */
  kind: "data";
  /** Tên tool ĐÃ CHẠY (định danh 1-1 với truy vấn). */
  tool: string;
  /** `ToolResult.type` — loại kết quả. Giữ để quan sát, KHÔNG dùng làm khoá. */
  dataset: string;
  /**
   * Bảng Postgres VẬT LÝ. `null` khi chưa kiểm chứng được — **thà nói "không biết"
   * còn hơn đoán một cái tên bảng**, vì một tên bảng bịa trong hoá đơn truy xuất
   * chính là lỗi mà module này sinh ra để vá.
   */
  table: string | null;
  /** Bộ lọc THỰC SỰ đã áp (từ args của tool), đã lọc sạch. */
  filters: Record<string, string | number | boolean>;
  /** Số hàng đứng sau câu trả lời; `null` khi không xác định được. */
  rowCount: number | null;
  /** Con số `rowCount` ở trên tự nó đến từ đâu (siêu-truy-ngược). */
  rowCountBasis: "array" | "single_object" | `field:${string}` | null;
  /** Khoảng thời gian đã quét; `null` khi truy vấn không giới hạn theo thời gian. */
  timeRange: { from?: string; to?: string; days?: number } | null;
}

/**
 * Tên tool → bảng Postgres CHÍNH.
 *
 * ⚠ Danh sách này là **DANH SÁCH ĐÃ KIỂM CHỨNG**, không phải danh sách mong muốn.
 * Mỗi tên bảng ở cột phải đã được đối chiếu với `pgTable("…")` thật trong
 * `drizzle/schema/**` (347 bảng), và ca `dataCitation.test.ts`
 * *"mọi tên bảng đã khai phải TỒN TẠI trong schema"* đọc lại schema từ đĩa ở mỗi
 * lần chạy để cái map này **không trôi thành hư cấu** khi ai đó đổi tên bảng.
 *
 * ⚠ Tool KHÔNG có mặt ở đây ⇒ `table: null` (trung thực), citation vẫn phát ra với
 *   `dataset`/`filters`/`rowCount`. Cố ý BỎ TRỐNG:
 *   • tool đọc NHIỀU bảng ngang nhau (`list_active_alerts` = alert_history +
 *     predictive_alerts; `analytics_defect_pareto` đổi bảng theo `groupBy`),
 *   • tool KHÔNG đọc DB (8 tool lập trình, `calc`, `get_vram_state`).
 *   Khai bừa một "bảng chính" cho những ca ấy là nói dối có thẩm quyền.
 */
export const TOOL_PRIMARY_TABLE: Readonly<Record<string, string>> = Object.freeze({
  get_today_stats: "product_inspections",
  get_lot_status: "production_orders",
  get_machine_status: "machines",
  get_defect_trend: "product_inspections",
  get_top_defects: "measurement_results",
  get_factory_stats: "daily_statistics",
  get_ng_compare: "daily_statistics",
  get_oee: "oee_metrics",
  get_model_metrics: "product_inspections",
  get_machine_process_result: "process_results",
  get_packaging_throughput: "process_results",
  get_ot_telemetry_latest: "ot_telemetry",
  correlate_process_quality: "process_results",
  get_fleet_process_summary: "process_results",
  analytics_query_oee: "oee_metrics",
  analytics_query_yield: "product_inspections",
  analytics_spc_status: "product_inspections",
  analytics_forecast_series: "product_inspections",
  list_work_orders: "maintenance_work_orders",
  list_thresholds: "measurement_point_defs",
  list_recipes: "machine_recipes",
  list_products: "product_models",
  get_rca_history: "root_cause_analysis",
  list_users_by_role: "users",
  list_api_keys: "api_keys",
  get_change_history: "audit_logs",
  get_machine_health: "machine_health_history",
  list_anomalies: "predictive_alerts",
  trace_genealogy: "genealogy_chain",
  get_energy_metrics: "energy_readings",
});

/**
 * Khoá args KHÔNG BAO GIỜ được vào `filters`.
 * `__authCtx` là DANH TÍNH PHIÊN (id + role người dùng thật, do `argsWithAuthCtx`
 * tiêm vào — `toolRegistry.ts`), KHÔNG phải bộ lọc: đưa nó vào hoá đơn là vừa rò
 * danh tính vừa mô tả sai truy vấn.
 */
const KHOA_CAM = new Set(["__authCtx", "password", "token", "secret", "apiKey", "api_key", "key"]);

/** Khoá args mang nghĩa THỜI GIAN (rút ra `timeRange`, không lặp lại ở `filters`). */
const KHOA_THOI_GIAN = new Set(["from", "to", "startDate", "endDate", "since", "until", "days", "windowDays", "period"]);

const MAX_GIA_TRI = 64;
const MAX_SO_LOC = 12;

function lamSachGiaTri(v: unknown): string | number | boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    return s.length > MAX_GIA_TRI ? `${s.slice(0, MAX_GIA_TRI)}…` : s;
  }
  return null; // object/array/null/undefined → KHÔNG sao chép cấu trúc vào hoá đơn
}

/** Bộ lọc = args thật, trừ khoá cấm, trừ khoá thời gian, chỉ giá trị vô hướng. */
export function rutBoLoc(args: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!args || typeof args !== "object" || Array.isArray(args)) return out;
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (KHOA_CAM.has(k) || KHOA_THOI_GIAN.has(k)) continue;
    if (Object.keys(out).length >= MAX_SO_LOC) break;
    const clean = lamSachGiaTri(v);
    if (clean !== null) out[k] = clean;
  }
  return out;
}

/** Khoảng thời gian THẬT của truy vấn, rút từ args. `null` khi không có. */
export function rutKhoangThoiGian(args: unknown): KbDataCitation["timeRange"] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const a = args as Record<string, unknown>;
  const out: { from?: string; to?: string; days?: number } = {};
  const from = a.from ?? a.startDate ?? a.since;
  const to = a.to ?? a.endDate ?? a.until;
  const days = a.days ?? a.windowDays;
  if (typeof from === "string" && from.trim()) out.from = from.trim().slice(0, 32);
  if (typeof to === "string" && to.trim()) out.to = to.trim().slice(0, 32);
  if (typeof days === "number" && Number.isFinite(days)) out.days = days;
  else if (typeof days === "string" && Number.isFinite(Number(days))) out.days = Number(days);
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * ĐẾM số hàng — **bảo thủ có chủ đích**.
 * Chỉ đếm cái ĐẾM ĐƯỢC: `data` là mảng ⇒ độ dài; `data` là object có ĐÚNG MỘT ô
 * kiểu mảng ⇒ độ dài ô đó; `data` là object không có ô mảng nào ⇒ 1 bản ghi.
 * Mọi ca còn lại ⇒ `null` (*"không xác định"*).
 * ⚠ CỐ Ý KHÔNG đọc các ô tên `total`/`count`: chúng thường là TỔNG NGHIỆP VỤ (tổng
 *   sản lượng, tổng NG), không phải số hàng. Lấy chúng làm "số hàng" là bịa ra một
 *   con số truy-ngược nghe rất thật — đúng lớp lỗi module này đang vá.
 * ⚠ KHÔNG đọc GIÁ TRỊ nào bên trong: chỉ `Array.isArray` và `.length`.
 */
export function demSoHang(data: unknown): { rowCount: number | null; basis: KbDataCitation["rowCountBasis"] } {
  if (Array.isArray(data)) return { rowCount: data.length, basis: "array" };
  if (data && typeof data === "object") {
    const arrayKeys = Object.entries(data as Record<string, unknown>).filter(([, v]) => Array.isArray(v));
    if (arrayKeys.length === 1) {
      const [k, v] = arrayKeys[0];
      return { rowCount: (v as unknown[]).length, basis: `field:${k}` };
    }
    if (arrayKeys.length === 0) return { rowCount: 1, basis: "single_object" };
  }
  return { rowCount: null, basis: null };
}

/**
 * Dựng trích dẫn nguồn dữ liệu từ một lượt chạy tool.
 * Trả `null` — KHÔNG trích dẫn — khi:
 *   • không có tên tool hoặc không có kết quả,
 *   • **`note` có mặt** (từ chối RBAC / DB lỗi / rỗng — xem luật ② ở đầu file).
 */
export function buildDataCitation(
  toolName: string | null | undefined,
  result: ToolResultLike | null | undefined,
  args?: unknown,
): KbDataCitation | null {
  if (!toolName || !result) return null;
  // 🔴 FAIL-CLOSED. Đây là dòng giữ luật ②; xoá nó là mở lại kênh rò RBAC.
  if (result.note != null && String(result.note).trim() !== "") return null;

  const { rowCount, basis } = demSoHang(result.data);
  return {
    kind: "data",
    tool: toolName,
    dataset: result.type ?? "unknown",
    table: TOOL_PRIMARY_TABLE[toolName] ?? null,
    filters: rutBoLoc(args),
    rowCount,
    rowCountBasis: basis,
    timeRange: rutKhoangThoiGian(args),
  };
}

/** Một dòng người đọc được — dùng cho phần chân câu trả lời. */
export function moTaTrichDanDuLieu(c: KbDataCitation, lang: "vi" | "en" | "zh" = "vi"): string {
  const nhan = lang === "en" ? "Data source" : lang === "zh" ? "数据来源" : "Nguồn số liệu";
  const nhanHang = lang === "en" ? "rows" : lang === "zh" ? "行" : "hàng";
  const parts: string[] = [c.table ? `\`${c.table}\`` : `\`${c.dataset}\` (${c.tool})`];
  const loc = Object.entries(c.filters).map(([k, v]) => `${k}=${v}`);
  if (loc.length) parts.push(loc.join(", "));
  if (c.timeRange) {
    const tr = c.timeRange;
    parts.push(tr.days != null ? `${tr.days}d` : [tr.from, tr.to].filter(Boolean).join("→"));
  }
  if (c.rowCount != null) parts.push(`${c.rowCount} ${nhanHang}`);
  return `${nhan}: ${parts.join(" · ")}`;
}

/**
 * Nối dòng nguồn số liệu vào CUỐI câu trả lời.
 *
 * ⚠ VÌ SAO PHẢI NỐI VÀO CHUỖI, KHÔNG CHỈ THÊM MỘT Ô DTO. Client hiện chỉ render
 * `answer` và mảng `citations` (`AIChatPage.tsx:626`) — một trường DTO mới mà không
 * ai vẽ ra là **một cải tiến VÔ HÌNH**, đúng cái bẫy đã ghi ở G2-C. Ô DTO
 * (`dataCitations`) vẫn có, cho tầng lập trình; dòng chữ này là cho NGƯỜI ĐỌC.
 *
 * ⚠ CỐ Ý **KHÔNG** nhét vào mảng `citations`: FE gắn nhãn xuất xứ theo `origin` và
 *   mặc định về *"Kho hệ thống"* — một hàng DB đeo nhãn "kho tài liệu hệ thống" là
 *   một lời khai SAI ngay trên chính cái nhãn truy xuất nguồn gốc.
 */
export function themChanNguonSoLieu(answer: string, c: KbDataCitation | null, lang: "vi" | "en" | "zh" = "vi"): string {
  if (!c || !answer) return answer;
  const dong = moTaTrichDanDuLieu(c, lang);
  if (answer.includes(dong)) return answer; // bất biến: nối hai lần vẫn ra một dòng
  return `${answer.trimEnd()}\n\n_${dong}_`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ĐỐI CHIẾU SỐ TRONG CÂU TRẢ LỜI VỚI `toolResult`
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ⚠⚠ CHỈ ĐÁNH DẤU — **KHÔNG CHẶN CÂU TRẢ LỜI**. Một con số hợp lệ có thể là số
 * DẪN XUẤT (tổng, hiệu, phần trăm, trung bình) không hề xuất hiện nguyên văn trong
 * `data`; chặn theo tín hiệu này sẽ giết những câu trả lời ĐÚNG. Đầu ra là một phép
 * ĐO để báo cáo, không phải một cái cổng.
 *
 * Một số được coi là CÓ NGUỒN khi nó xuất hiện trong `toolResult.data` **hoặc**
 * trong `toolResult.textSummary`. `textSummary` được tính là nguồn hợp lệ vì chính
 * nó là khối được nhồi vào prompt: số model chép lại từ đó **đúng là** số của DB,
 * đi qua một bước tóm tắt do TOOL viết (không phải do model bịa).
 */
export interface NumberReconciliation {
  /** Tổng số token số ĐÃ XÉT trong câu trả lời (mẫu số của phép đo). */
  checked: number;
  /** Số token tìm được nguồn. */
  supported: number;
  /** Các token KHÔNG tìm được nguồn (đã khử trùng lặp, tối đa 20). */
  unsupported: number[];
  /** supported / checked; `null` khi mẫu số = 0 (KHÔNG quy ước thành 1). */
  accuracy: number | null;
}

/** Bỏ dấu phân cách hàng nghìn rồi parse. Hỗ trợ cả "1.234,5" (vi) và "1,234.5" (en). */
function doiSo(raw: string): number | null {
  let s = raw.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // vi
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ""); // en
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * ★ TOKENIZER **DÙNG CHUNG** cho CẢ HAI phía (dữ liệu nguồn và câu trả lời).
 *
 * ⚠⚠ ĐỐI XỨNG LÀ BẤT BIẾN SỐNG CÒN, và bản đầu của tôi đã VI PHẠM nó — phép đo
 * `dataCitationAccuracy.test.ts` bắt được: phía nguồn quét bằng `-?\d…` nên `"M-01"`
 * cho ra **−1**, còn phía câu trả lời quét bằng `\d…` nên cho ra **1**. Hai đầu đọc
 * CÙNG một chuỗi ra HAI con số khác nhau ⇒ một câu trả lời chép NGUYÊN VĂN
 * `textSummary` vẫn bị gắn cờ "không có nguồn". Hai bộ quét riêng là cơ chế đẻ ra
 * lớp lỗi ấy ⇒ nay chỉ còn MỘT hàm, dùng cho cả hai phía. Đừng tách lại.
 *
 * Hai luật:
 *  ① **Mã định danh `CHỮ-SỐ` (`M-01`, `LINE-2`, `SMT-3`) bị che trước khi quét.**
 *    Phần số trong đó là TÊN, không phải trị đo — và dấu `-` ở đó không phải dấu âm.
 *  ② Sau khi che, `-` đứng trước chữ số MỚI được coi là dấu âm (nhiệt độ, độ lệch…).
 */
function trichSo(text: string): number[] {
  const cheDinhDanh = text.replace(/[A-Za-z][A-Za-z0-9]*-\d+/g, " ");
  const out: number[] = [];
  for (const m of cheDinhDanh.matchAll(/-?\d[\d.,]*/g)) {
    const n = doiSo(m[0]);
    if (n !== null) out.push(n);
  }
  return out;
}

/** Mọi số xuất hiện trong một cấu trúc bất kỳ (đệ quy, có chặn độ sâu/kích thước). */
function gomSoTuDuLieu(v: unknown, nhan: Set<number>, sau = 0): void {
  if (sau > 8 || nhan.size > 5000) return;
  if (typeof v === "number") {
    if (Number.isFinite(v)) nhan.add(v);
    return;
  }
  if (typeof v === "string") {
    for (const n of trichSo(v)) nhan.add(n);
    return;
  }
  if (Array.isArray(v)) {
    for (const item of v) gomSoTuDuLieu(item, nhan, sau + 1);
    return;
  }
  if (v && typeof v === "object") {
    for (const item of Object.values(v as Record<string, unknown>)) gomSoTuDuLieu(item, nhan, sau + 1);
  }
}

/** Số trong câu trả lời có khớp một số nguồn không (kể cả khi nguồn được làm tròn). */
function coNguon(x: number, nguon: Set<number>): boolean {
  if (nguon.has(x)) return true;
  // Số thập phân trong câu trả lời thường là bản LÀM TRÒN của số gốc (12.3 ⇐ 12.34).
  const chuSo = (String(x).split(".")[1] ?? "").length;
  const eps = chuSo > 0 ? 0.5 * Math.pow(10, -chuSo) : 0.5;
  for (const g of nguon) {
    if (Math.abs(g - x) < eps) return true;
    // …và phần trăm viết ở hai thang (0.87 ⇄ 87).
    if (Math.abs(g * 100 - x) < eps || Math.abs(g / 100 - x) < eps) return true;
  }
  return false;
}

/**
 * Đếm xem bao nhiêu con số trong `answer` truy ngược được về `toolResult`.
 *
 * ⚠ LOẠI TRỪ CÓ CHỦ ĐÍCH (nếu không, mẫu số đầy rác và tỷ lệ đo được vô nghĩa):
 *   • số thứ tự đầu dòng danh sách markdown (`1.` `2)`) — cấu trúc, không phải dữ liệu,
 *   • số nằm trong ngày/giờ ISO (`2026-08-16`, `14:30`) — siêu dữ liệu thời gian,
 *   • số 0 và 1 trần — quá phổ biến để mang thông tin.
 */
export function reconcileAnswerNumbers(answer: string, result: ToolResultLike | null | undefined): NumberReconciliation {
  if (!answer || !result) return { checked: 0, supported: 0, unsupported: [], accuracy: null };

  const nguon = new Set<number>();
  gomSoTuDuLieu(result.data, nguon);
  gomSoTuDuLieu(result.textSummary ?? "", nguon);

  // Che các vùng KHÔNG phải dữ liệu trước khi quét, để chúng không vào mẫu số.
  const sach = answer
    .replace(/\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/g, " ") // ngày/giờ ISO
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, " ") // giờ
    .replace(/^[ \t]*\d+[.)]\s/gm, " "); // đánh số đầu dòng

  let checked = 0;
  let supported = 0;
  const thieu = new Set<number>();
  // ⚠ CÙNG `trichSo` với phía nguồn — xem bất biến đối xứng ở header của hàm đó.
  for (const x of trichSo(sach)) {
    if (x === 0 || x === 1) continue;
    checked++;
    if (coNguon(x, nguon)) supported++;
    else if (thieu.size < 20) thieu.add(x);
  }
  return {
    checked,
    supported,
    unsupported: [...thieu],
    accuracy: checked > 0 ? supported / checked : null,
  };
}
