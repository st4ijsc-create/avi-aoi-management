import { generateText, isGgufAvailable, type GgufGenerateResult } from "./aiGgufEngine";
// doc69 Giai đoạn 4/Wave 3 D4 — specialist→action HITL bridge allow-list (see the
// block near the end of this file for the full rationale).
import { RCA_SUGGESTED_ACTION_TOOLS, ensureRcaToolsRegistered } from "./ai/rcaActionSuggester";
import type { RepoContextResult } from "./ai/repoContextService";

export type SpecialistAgentId =
  | "data-analyst"
  | "backend-engineer"
  | "frontend-engineer"
  | "qa-optimizer";

export interface SpecialistAgentInfo {
  id: SpecialistAgentId;
  name: string;
  role: string;
  focus: string[];
  outputContract: string[];
}

export interface RunSpecialistAgentInput {
  agentId: SpecialistAgentId;
  objective: string;
  moduleName?: string;
  currentBehavior?: string;
  desiredBehavior?: string;
  techStack?: string[];
  codeSnippet?: string;
  errorLogs?: string;
  constraints?: string[];
  acceptanceCriteria?: string[];
  files?: string[];
  language?: "vi" | "en";
  modelId?: string;
  /** Wave 1 — ngữ cảnh repo đã nạp sẵn (nội dung file thật + phụ thuộc + RAG). */
  repoContext?: RepoContextResult;
}

export interface SpecialistAgentRunResult {
  agent: SpecialistAgentInfo;
  modelId: string;
  output: {
    summary: string;
    diagnosis: string[];
    actionPlan: string[];
    patchHints: string[];
    testPlan: string[];
    optimizationIdeas: string[];
    risks: string[];
    reportTemplate: string[];
  };
  rawText: string;
  metrics: Pick<GgufGenerateResult, "tokensGenerated" | "tokensPrompt" | "totalTimeMs" | "tokensPerSecond">;
}

export interface RunSpecialistWorkflowInput extends Omit<RunSpecialistAgentInput, "agentId"> {
  includeBackend?: boolean;
  includeFrontend?: boolean;
  includeQa?: boolean;
}

export interface SpecialistWorkflowStepResult {
  stepOrder: number;
  agentId: SpecialistAgentId;
  result: SpecialistAgentRunResult;
}

export interface SpecialistWorkflowResult {
  orderedAgents: SpecialistAgentId[];
  steps: SpecialistWorkflowStepResult[];
  finalSummary: string;
}

const SPECIALIST_AGENTS: Record<SpecialistAgentId, SpecialistAgentInfo> = {
  "data-analyst": {
    id: "data-analyst",
    name: "Data Insight Agent",
    role: "AI Agent chuyen phan tich du lieu module va toi uu KPI",
    focus: [
      "tim pattern bat thuong va root-cause",
      "de xuat metric dashboard thuc dung",
      "uu tien khuyen nghi co the do luong",
    ],
    outputContract: [
      "summary",
      "diagnosis",
      "actionPlan",
      "optimizationIdeas",
      "risks",
    ],
  },
  "backend-engineer": {
    id: "backend-engineer",
    name: "Backend Refactor Agent",
    role: "AI Agent chuyen thiet ke moi, nang cap, tim va sua loi backend",
    focus: [
      "API contract, transaction, retry, error handling",
      "hieu nang truy van, cache, queue, scheduler",
      "bao toan backward compatibility",
    ],
    outputContract: [
      "summary",
      "diagnosis",
      "actionPlan",
      "patchHints",
      "testPlan",
      "risks",
    ],
  },
  "frontend-engineer": {
    id: "frontend-engineer",
    name: "Frontend UX Agent",
    role: "AI Agent chuyen redesign frontend, cai tien UX va sua bug giao dien",
    focus: [
      "luong nguoi dung, kha nang mo rong component",
      "state management va network state",
      "hieu nang render, accessibility, i18n",
    ],
    outputContract: [
      "summary",
      "diagnosis",
      "actionPlan",
      "patchHints",
      "testPlan",
      "optimizationIdeas",
    ],
  },
  "qa-optimizer": {
    id: "qa-optimizer",
    name: "QA Test Strategist Agent",
    role: "AI Agent chuyen kiem thu, lap test plan, va bao cao toi uu module",
    focus: [
      "test matrix unit-integration-e2e",
      "thiet ke testcase bien, negative path, race condition",
      "bao cao QA va de xuat cai tien uu tien cao",
    ],
    outputContract: [
      "summary",
      "diagnosis",
      "testPlan",
      "actionPlan",
      "reportTemplate",
      "risks",
    ],
  },
};

const JSON_OUTPUT_SCHEMA = `{
  "summary": "string",
  "diagnosis": ["string"],
  "actionPlan": ["string"],
  "patchHints": ["string"],
  "testPlan": ["string"],
  "optimizationIdeas": ["string"],
  "risks": ["string"],
  "reportTemplate": ["string"]
}`;

function stringifyList(values?: string[]): string {
  if (!values || values.length === 0) return "(none)";
  return values.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

/**
 * Wave 1 FF-A — bóc fence markdown quanh khối JSON.
 *
 * FIX-ROUND 1 (CRITICAL-1) — bản trước cắt bỏ VÔ ĐIỀU KIỆN tại fence kế tiếp
 * BẤT KỲ ở ĐÂU trong chuỗi, kể cả khi đó là ``` ``` ``` HỢP LỆ nằm bên trong
 * một giá trị chuỗi (vd `patchHints` gợi ý dán một đoạn code kèm ```ts...```
 * để minh hoạ — hoàn toàn bình thường với vai trò backend-engineer). Kết quả:
 * JSON hợp lệ, đủ 8 khoá bị cắt cụt ngay tại dấu ``` đó, làm rỗng mọi khoá
 * phía sau — tái hiện chính xác bug "No content" mà FF-A tồn tại để sửa.
 *
 * Sửa: CHỈ bóc khi toàn bộ chuỗi ĐƯỢC BỌC bởi fence — bắt đầu bằng ```` ``` ````
 * (và bóc luôn fence kết thúc nếu có). Không đụng tới bất kỳ ``` nào nằm giữa
 * nội dung — đúng hành vi gốc trước Wave 1 FF-A. Đường JSON.parse chặt chẽ
 * KHÔNG được phép làm hỏng đầu vào hợp lệ, dù mức độ nào.
 *
 * Trường hợp model tự "reset" giữa chừng (chèn ``` json giữa dòng rồi bắt đầu
 * lại một object mới) giờ không cần xử lý riêng ở đây nữa: nó chỉ xảy ra khi
 * JSON đã hỏng (object đầu bị cắt dở) ⇒ rơi thẳng vào salvageAgentSections,
 * nơi việc tìm khoá đã nhận biết cấu trúc (structure-aware) tự nhiên chỉ lấy
 * đúng khối của object ĐẦU TIÊN — xem test #4 trong
 * aiSpecialistAgentService.parse.test.ts (không có xử lý fence riêng nào mà
 * vẫn xanh).
 */
function sanitizeJsonBlock(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const withoutStart = trimmed.replace(/^```[a-zA-Z]*\n?/, "");
  return withoutStart.replace(/\n?```$/, "").trim();
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Wave 1 FF-A fix-round 2 — chuẩn hoá một object JSON đã phân tích (kết quả
 * `JSON.parse` chặt chẽ) thành đúng hình dạng `SpecialistAgentRunResult["output"]`.
 * Tách ra khỏi `parseAgentOutput`'s nhánh chặt chẽ để giữ hàm đó ngắn gọn.
 *
 * FIX-ROUND 4 — round 2 từng dùng chung hàm này cho cả nhánh `generateJSON`
 * (grammar-constrained); nhánh đó đã bị BỎ (xem doc comment `runSpecialistAgent`
 * — làm hỏng nội dung, đo được trên live). Hàm này giờ CHỈ còn một nơi gọi:
 * `parseAgentOutput`'s nhánh `JSON.parse` chặt chẽ.
 *
 * `rawFallbackSummary` chỉ được dùng khi `summary` không phải chuỗi.
 */
function normalizeAgentOutput(
  parsed: unknown,
  rawFallbackSummary: string,
): SpecialistAgentRunResult["output"] {
  const obj = parsed as Record<string, unknown> | null | undefined;
  return {
    summary: typeof obj?.summary === "string" ? obj.summary.trim() : rawFallbackSummary,
    diagnosis: ensureStringArray(obj?.diagnosis),
    actionPlan: ensureStringArray(obj?.actionPlan),
    patchHints: ensureStringArray(obj?.patchHints),
    testPlan: ensureStringArray(obj?.testPlan),
    optimizationIdeas: ensureStringArray(obj?.optimizationIdeas),
    risks: ensureStringArray(obj?.risks),
    reportTemplate: ensureStringArray(obj?.reportTemplate),
  };
}

const AGENT_OUTPUT_KEYS = [
  "summary",
  "diagnosis",
  "actionPlan",
  "patchHints",
  "testPlan",
  "optimizationIdeas",
  "risks",
  "reportTemplate",
] as const;

function isKnownAgentOutputKey(value: string): value is (typeof AGENT_OUTPUT_KEYS)[number] {
  return (AGENT_OUTPUT_KEYS as readonly string[]).includes(value);
}

/** Vớt 1 chuỗi JSON bắt đầu tại `startQuoteIdx` (trỏ vào dấu `"` mở). Trả
 *  `null` nếu KHÔNG tìm được dấu đóng (chuỗi bị cắt dở giữa chừng — không
 *  vớt phần tử dang dở). Trả kèm `endIdx` (vị trí NGAY SAU dấu `"` đóng, hoặc
 *  hết văn bản nếu cắt dở) để gọi tiếp tìm phần tử/khoá kế tiếp. */
function extractQuotedStringAt(text: string, startQuoteIdx: number): { value: string | null; endIdx: number } {
  let escaped = false;
  for (let i = startQuoteIdx + 1; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      const raw = text.slice(startQuoteIdx, i + 1);
      try {
        return { value: JSON.parse(raw) as string, endIdx: i + 1 };
      } catch {
        return { value: text.slice(startQuoteIdx + 1, i), endIdx: i + 1 };
      }
    }
  }
  return { value: null, endIdx: text.length };
}

/**
 * FIX-ROUND 1 (CRITICAL-2) — vớt các phần tử chuỗi của một mảng bắt đầu tại
 * `text[pos]==='['`. Khác bản trước ở chỗ NHẬN BIẾT NGỮ CẢNH: nếu trong lúc
 * quét gặp một chuỗi TRÙNG TÊN một trong 8 khoá đã biết và ngay sau đó (bỏ
 * qua khoảng trắng) là dấu `:`, đó là dấu hiệu mảng này đã bị cắt dở và văn
 * bản đã lạc sang KHOÁ TIẾP THEO — dừng lại NGAY, không vớt chuỗi đó làm phần
 * tử, và không tiêu thụ nó (để vòng quét ngoài đọc lại đúng vị trí đó làm
 * ứng viên khoá kế tiếp). Đây là cơ chế khiến trường hợp "model tự reset giữa
 * dòng rồi bắt đầu object mới" không cần xử lý fence riêng nữa — mảng bị cắt
 * của object thứ nhất không còn "ăn lẹm" nội dung của object thứ hai.
 *
 * Trả về vị trí NGAY SAU khi xử lý xong (ghi vào `cursor.pos`) — sau dấu `]`
 * nếu đóng đúng, hoặc tại vị trí dừng (cắt dở / gặp khoá kế) nếu không.
 */
function salvageStringArrayAt(text: string, cursor: { pos: number }): string[] {
  cursor.pos += 1; // bỏ qua dấu '[' mở
  const elements: string[] = [];

  while (cursor.pos < text.length) {
    const ch = text[cursor.pos];

    if (/\s/.test(ch!)) {
      cursor.pos += 1;
      continue;
    }
    if (ch === "]") {
      cursor.pos += 1;
      return elements;
    }
    if (ch === ",") {
      cursor.pos += 1;
      continue;
    }
    if (ch === '"') {
      const probe = extractQuotedStringAt(text, cursor.pos);
      if (probe.value === null) {
        // Phần tử cuối bị cắt dở tới hết văn bản ⇒ bỏ, dừng ở đây.
        cursor.pos = probe.endIdx;
        return elements;
      }
      if (isKnownAgentOutputKey(probe.value)) {
        let after = probe.endIdx;
        while (after < text.length && /\s/.test(text[after]!)) after += 1;
        if (text[after] === ":") {
          // Trông giống khoá kế tiếp bắt đầu ⇒ coi mảng đã hết (bị cắt dở).
          // KHÔNG tiêu thụ chuỗi này — cursor.pos giữ nguyên tại dấu '"'.
          return elements;
        }
      }
      cursor.pos = probe.endIdx;
      const trimmed = probe.value.trim();
      if (trimmed) elements.push(trimmed);
      continue;
    }
    // Ký tự lạ (backtick fence, dấu ngoặc lồng, ký tự trần...) trong mảng
    // hỏng ⇒ bỏ qua từng ký tự, khoan dung với rác.
    cursor.pos += 1;
  }

  return elements; // hết văn bản mà chưa gặp ']' ⇒ mảng bị cắt dở
}

/**
 * Wave 1 FF-A — vớt từng khối từ JSON hỏng/bị cắt.
 *
 * FIX-ROUND 1 (CRITICAL-2) — bản trước tìm khoá bằng `regex.exec(rawText)`,
 * tức là khớp bất kỳ vị trí VĂN BẢN nào chứa `"khoá":`, KỂ CẢ khi nó nằm bên
 * trong giá trị chuỗi của một khoá KHÁC (vd `"summary"` chứa nguyên văn
 * `"risks": [...]` như một phần lời văn/ví dụ). Kết quả: nội dung bịa ra từ
 * bên trong `summary` bị hiển thị dưới mục Risks như thể model viết ra, còn
 * mảng `risks` THẬT ở cuối bị bỏ qua vì "đã tìm thấy" (dù là giả) trước đó.
 *
 * Sửa: quét MỘT LƯỢT DUY NHẤT từ đầu tới cuối `rawText`, tự làm bộ mã hoá
 * (tokenizer) khoan dung: gặp `"`, thử đọc trọn một chuỗi JSON (tôn trọng
 * escape `\"` — dùng lại `extractQuotedStringAt`, hàm quét-nhận-biết-chuỗi đã
 * được xác nhận đúng ở review trước). Chuỗi đọc được CHỈ được coi là một
 * "khoá thật" khi (a) nội dung trùng đúng tên 1 trong 8 khoá đã biết VÀ (b)
 * ngay sau đó (bỏ qua khoảng trắng) là dấu `:` — một chuỗi trùng tên khoá
 * nhưng không theo sau bởi `:` (vd nằm giữa câu văn, hoặc là phần tử mảng)
 * KHÔNG được coi là khoá. Nhờ luôn dùng đúng cơ chế đọc-chuỗi-tôn-trọng-escape
 * để NUỐT TRỌN mỗi giá trị chuỗi trước khi tiếp tục quét, một khoá giả nằm
 * bên trong chuỗi của khoá khác (kể cả khi được escape đúng `\"khoá\"`) không
 * bao giờ được vòng quét ngoài nhìn thấy như một token độc lập — nó bị "nuốt"
 * làm nội dung của khoá bao ngoài. Chỉ khi chuỗi bao ngoài dùng dấu `"` KHÔNG
 * escape để "đóng sớm" (như trong dữ liệu hỏng thật) thì phần còn lại mới
 * được quét tiếp như các token độc lập — và ngay cả khi đó, khoá giả kiểu
 * `"risks": [...]` được nhúng vẫn không đứng MỘT MÌNH ở vị trí "vừa đóng
 * chuỗi xong" theo đúng cấu trúc `"key":` liền mạch trong mọi trường hợp đã
 * kiểm — xem 3 test probe (a)/(b)/(c) trong
 * aiSpecialistAgentService.parse.test.ts.
 *
 * Khoá lặp lại (kể cả khoá THẬT xuất hiện 2 lần) ⇒ chỉ lần đầu được ghi nhận
 * (giữ nguyên luật cũ) — các lần sau vẫn được quét qua (để con trỏ đi đúng)
 * nhưng không ghi đè.
 *
 * Trả về phần đọc được; khoá nào không vớt được thì VẮNG MẶT trong kết quả
 * (không bịa nội dung). Không bao giờ ném — kể cả với đầu vào rỗng/không phải
 * chuỗi, chuỗi cắt dở giữa chừng, hay ngoặc không cân.
 */
export function salvageAgentSections(rawText: string): Partial<SpecialistAgentRunResult["output"]> {
  if (!rawText || typeof rawText !== "string") return {};

  const result: Partial<SpecialistAgentRunResult["output"]> = {};
  const cursor = { pos: 0 };

  while (cursor.pos < rawText.length) {
    const ch = rawText[cursor.pos];
    if (ch !== '"') {
      cursor.pos += 1;
      continue;
    }

    const probe = extractQuotedStringAt(rawText, cursor.pos);
    if (probe.value === null) {
      // Chuỗi cuối văn bản bị cắt dở — không còn gì để quét tiếp, thoát vòng lặp.
      cursor.pos = probe.endIdx;
      continue;
    }
    if (!isKnownAgentOutputKey(probe.value)) {
      // Chuỗi bất kỳ không khớp tên khoá nào ⇒ không phải khoá (giá trị của
      // khoá khác, hoặc phần tử mảng) — bỏ qua, quét tiếp NGAY SAU chuỗi đó.
      cursor.pos = probe.endIdx;
      continue;
    }

    let afterKey = probe.endIdx;
    while (afterKey < rawText.length && /\s/.test(rawText[afterKey]!)) afterKey += 1;
    if (rawText[afterKey] !== ":") {
      // Trùng tên khoá nhưng KHÔNG theo sau bởi ':' ⇒ chỉ là một chuỗi trùng
      // tên tình cờ (vd phần tử mảng có nội dung trùng tên khoá), không phải
      // một khoá thật theo cấu trúc.
      cursor.pos = probe.endIdx;
      continue;
    }

    // Đây LÀ một khoá thật theo cấu trúc (không chỉ trùng văn bản).
    const key = probe.value;
    cursor.pos = afterKey + 1;
    while (cursor.pos < rawText.length && /\s/.test(rawText[cursor.pos]!)) cursor.pos += 1;

    const valueChar = rawText[cursor.pos];
    if (valueChar === '"') {
      const valueProbe = extractQuotedStringAt(rawText, cursor.pos);
      cursor.pos = valueProbe.endIdx;
      if (valueProbe.value !== null && valueProbe.value.trim() && !(key in result)) {
        (result as Record<string, unknown>)[key] = valueProbe.value.trim();
      }
    } else if (valueChar === "[") {
      const arr = salvageStringArrayAt(rawText, cursor);
      if (arr.length > 0 && !(key in result)) {
        (result as Record<string, unknown>)[key] = arr;
      }
    }
    // Kiểu khác (number/null/object/thiếu) ⇒ ngoài hợp đồng schema, bỏ qua —
    // không di chuyển cursor đặc biệt, vòng lặp ngoài tiếp tục quét từng ký
    // tự từ vị trí hiện tại (không bao giờ kẹt: mỗi nhánh của vòng lặp luôn
    // tiến ít nhất 1 ký tự).
  }

  return result;
}

/**
 * Wave 1 FF-A — mặc định 1400. Cho phép cấu hình qua env.
 *
 * FIX-ROUND 3 — hoàn 1400 (round 1 từng nâng lên 3000; round 2 giữ 3000 với
 * lý do khác — xem lịch sử bên dưới). Số 1400 này KHÔNG phải phỏng đoán, mà
 * là mức ĐO ĐƯỢC TRỰC TIẾP trên live, đối chứng 3 lượt chạy CÙNG một request:
 *
 *   | phiên | maxTokens | đường          | kết quả thật               |
 *   |-------|-----------|----------------|-----------------------------|
 *   | #1    | 1400      | generateText   | nội dung tiếng Việt MẠCH LẠC, đúng file thật, chỉ bị CẮT NGANG |
 *   | #3    | 3000      | generateText   | thoái hoá (lặp từ/trộn ngôn ngữ) |
 *   | #4    | 3000      | generateJSON+grammar | thoái hoá GIỐNG HỆT — summary 20953 ký tự toàn `"result result result…"`, KHÔNG một ký tự JSON nào, cả 7 mảng rỗng |
 *
 * Kết luận rút ra từ phiên #4: đây CHƯA BAO GIỜ là vấn đề định dạng. Model
 * sinh nội dung tốt trong khoảng ~1400 token ĐẦU rồi rơi vào VÒNG LẶP LẶP TỪ
 * (repetition loop) — một hiện tượng suy biến ở TẦNG SAMPLING, không phải cú
 * pháp. Grammar (round 2) chỉ ép CẤU TRÚC, không ép NỘI DUNG — nó chấp nhận
 * `"summary": "result result result..."` là một chuỗi hợp lệ theo schema.
 * Nâng trần lên 3000 vì vậy là một BƯỚC LÙI RÒNG: nó biến "tốt nhưng bị cắt
 * ngang" (round 1, có thể vớt tiếp bằng salvage) thành "rác sạch cú pháp"
 * (round 2, không gì vớt được vì rác không có cấu trúc). 1400 là mức trần cao
 * nhất được XÁC NHẬN còn mạch lạc — không phải một con số ước lượng ngân sách
 * schema như round 2 từng lập luận (ước lượng đó SAI vì giả định model không
 * suy biến trong phạm vi đó, giả định này bị chính phiên #4 bác bỏ).
 *
 * Hệ quả CHỦ Ý chấp nhận ở 1400: JSON có thể bị cắt ngang giữa cấu trúc
 * (đúng bug gốc mà fix-round 1 mô tả) — đó là lý do `salvageAgentSections`
 * VẪN PHẢI giữ nguyên làm lưới an toàn (không xoá, không được xoá).
 *
 * FIX-ROUND 4 — đường `generateJSON` nhắc ở đoạn trên (round 2) đã bị BỎ HẲN
 * (xem doc comment của `runSpecialistAgent`): live measurement round 4 (phiên
 * #5, cùng code round 3 — grammar chính, 1400) cho thấy grammar không hề ngăn
 * được thoái hoá (schema chỉ ép cấu trúc, không ép nội dung), và khi nó ném
 * rồi rơi về `generateText` fallback, NỘI DUNG của lượt fallback đó CŨNG ra
 * rác — trong khi chính phiên #1 (code gốc, generateText MỘT LƯỢT DUY NHẤT,
 * không có bước generateJSON nào trước đó) cho nội dung mạch lạc. `runSpecialistAgent`
 * giờ chỉ còn ĐÚNG MỘT lượt `generateText` — không còn kịch bản "2 lượt
 * inference cho 1 lượt giao việc" mà round 3 từng cảnh báo.
 */
export function specialistMaxTokens(): number {
  const raw = Number(process.env.AI_SPECIALIST_MAX_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1400;
}

/**
 * Ưu tiên: (1) JSON.parse chặt chẽ thành công ⇒ dùng nguyên như cũ (hành vi
 * giữ nguyên byte-for-byte cho đầu vào hợp lệ). (2) Thất bại ⇒ vớt bằng
 * `salvageAgentSections`; nếu vớt được ít nhất một khối MẢNG không rỗng, dùng
 * kết quả vớt (summary lấy từ khoá `summary` vớt được, nếu không có thì mới
 * dùng rawText thô). (3) Vớt cũng không ra khối mảng nào ⇒ giữ đúng fallback
 * cũ (summary = rawText thô, mọi mảng rỗng) — không dùng một mình summary đã
 * vớt (chưa đủ "vớt được gì" theo đúng nghĩa của bug này).
 */
export function parseAgentOutput(rawText: string): SpecialistAgentRunResult["output"] {
  const fallback = {
    summary: rawText.trim(),
    diagnosis: [],
    actionPlan: [],
    patchHints: [],
    testPlan: [],
    optimizationIdeas: [],
    risks: [],
    reportTemplate: [],
  };

  try {
    const parsed = JSON.parse(sanitizeJsonBlock(rawText));
    return normalizeAgentOutput(parsed, fallback.summary);
  } catch {
    const salvaged = salvageAgentSections(sanitizeJsonBlock(rawText));
    const hasSalvagedArray = (
      [
        "diagnosis",
        "actionPlan",
        "patchHints",
        "testPlan",
        "optimizationIdeas",
        "risks",
        "reportTemplate",
      ] as const
    ).some((key) => Array.isArray(salvaged[key]) && (salvaged[key] as string[]).length > 0);

    if (!hasSalvagedArray) return fallback;

    return {
      summary: salvaged.summary ?? fallback.summary,
      diagnosis: salvaged.diagnosis ?? [],
      actionPlan: salvaged.actionPlan ?? [],
      patchHints: salvaged.patchHints ?? [],
      testPlan: salvaged.testPlan ?? [],
      optimizationIdeas: salvaged.optimizationIdeas ?? [],
      risks: salvaged.risks ?? [],
      reportTemplate: salvaged.reportTemplate ?? [],
    };
  }
}

function buildSystemPrompt(agent: SpecialistAgentInfo, language: "vi" | "en"): string {
  const languageRule =
    language === "vi"
      ? "Tra loi bang tieng Viet, ngan gon, chinh xac, uu tien hanh dong co the thuc hien ngay."
      : "Answer in English, concise and practical, with implementation-ready guidance.";

  return [
    `You are ${agent.name}.`,
    `Role: ${agent.role}.`,
    "You are working in a manufacturing quality software monorepo.",
    "Always give structured engineering output and avoid generic advice.",
    "Prioritize bug prevention, measurable impact, and maintainability.",
    languageRule,
    "Return strict JSON only with this schema:",
    JSON_OUTPUT_SCHEMA,
  ].join("\n");
}

/**
 * Wave 1 — dựng khối ngữ cảnh repo cho prompt. Trả chuỗi rỗng khi không có
 * repoContext, để prompt giữ NGUYÊN hành vi cũ (không đổi một byte).
 */
function buildRepoContextBlock(ctx?: RepoContextResult): string {
  if (!ctx) return "";
  const parts: string[] = [];

  if (ctx.files.length > 0) {
    const bodies = ctx.files.map((f) =>
      [
        `--- FILE CONTENT: ${f.path}${f.truncated ? " (truncated — only the first part is shown)" : ""}${f.redacted ? " (secrets redacted)" : ""} ---`,
        f.content,
      ].join("\n"),
    );
    parts.push(bodies.join("\n\n"));
  }

  if (ctx.skipped.length > 0) {
    parts.push(
      `Files NOT loaded (do not assume their content):\n${ctx.skipped
        .map((s) => `- ${s.path} (${s.reason})`)
        .join("\n")}`,
    );
  }

  if (ctx.dependencies.length > 0) {
    parts.push(`Files imported by the above:\n${ctx.dependencies.map((d) => `- ${d}`).join("\n")}`);
  }

  if (ctx.ragSnippets.length > 0) {
    parts.push(
      `Related context from the knowledge base:\n${ctx.ragSnippets
        .map((s) => `- (${s.sourcePath}) ${s.text}`)
        .join("\n")}`,
    );
  }

  return parts.join("\n\n");
}

function buildUserPrompt(input: RunSpecialistAgentInput): string {
  const repoBlock = buildRepoContextBlock(input.repoContext);
  return [
    `Objective: ${input.objective}`,
    `Module: ${input.moduleName ?? "(not specified)"}`,
    `Current behavior: ${input.currentBehavior ?? "(not specified)"}`,
    `Desired behavior: ${input.desiredBehavior ?? "(not specified)"}`,
    `Tech stack:\n${stringifyList(input.techStack)}`,
    `Constraints:\n${stringifyList(input.constraints)}`,
    `Acceptance criteria:\n${stringifyList(input.acceptanceCriteria)}`,
    `Related files:\n${stringifyList(input.files)}`,
    `Error logs:\n${input.errorLogs ?? "(none)"}`,
    "Code snippet:",
    input.codeSnippet ?? "(none)",
    ...(repoBlock ? [repoBlock] : []),
    "Focus your recommendations on this exact context only.",
  ].join("\n\n");
}

export function listSpecialistAgents(): SpecialistAgentInfo[] {
  return Object.values(SPECIALIST_AGENTS);
}

export function buildWorkflowAgentOrder(input: RunSpecialistWorkflowInput): SpecialistAgentId[] {
  const includeBackend = input.includeBackend !== false;
  const includeFrontend = input.includeFrontend !== false;
  const includeQa = input.includeQa !== false;

  const order: SpecialistAgentId[] = ["data-analyst"];
  if (includeBackend) order.push("backend-engineer");
  if (includeFrontend) order.push("frontend-engineer");
  if (includeQa) order.push("qa-optimizer");

  return order;
}

function buildWorkflowObjective(
  baseObjective: string,
  currentAgentId: SpecialistAgentId,
  previousSteps: SpecialistWorkflowStepResult[],
): string {
  if (previousSteps.length === 0) return baseObjective;

  const summaries = previousSteps
    .map((step) => `- ${step.agentId}: ${step.result.output.summary}`)
    .join("\n");

  return [
    baseObjective,
    "Use the previous specialist outputs below as mandatory context:",
    summaries,
    `Now focus on your role as ${currentAgentId} and provide an executable plan.`,
  ].join("\n\n");
}

export async function runSpecialistWorkflowChain(
  input: RunSpecialistWorkflowInput,
): Promise<SpecialistWorkflowResult> {
  const orderedAgents = buildWorkflowAgentOrder(input);
  const steps: SpecialistWorkflowStepResult[] = [];

  for (let i = 0; i < orderedAgents.length; i++) {
    const agentId = orderedAgents[i];
    const stepResult = await runSpecialistAgent({
      ...input,
      agentId,
      objective: buildWorkflowObjective(input.objective, agentId, steps),
    });

    steps.push({
      stepOrder: i + 1,
      agentId,
      result: stepResult,
    });
  }

  const finalSummary = steps[steps.length - 1]?.result.output.summary ?? "";
  return {
    orderedAgents,
    steps,
    finalSummary,
  };
}

/**
 * Wave 1 FF-A fix-round 4 — QUAY VỀ một lượt `generateText({..., jsonMode:
 * true})` duy nhất, ĐÚNG như trước fix-round 2. Round 2 từng chuyển đường
 * CHÍNH sang `generateJSON` (grammar-constrained/GBNF) với giả thuyết
 * "jsonMode không ràng buộc gì ⇒ đó là nguyên nhân model thoái hoá". Live
 * measurement round 4 (phiên #5, cùng code round 3 — grammar chính, 1400)
 * BÁC BỎ giả thuyết đó theo hướng khác hẳn dự đoán: `generateJSON` KHÔNG
 * NGĂN được thoái hoá (schema chỉ ép cấu trúc, không ép nội dung — model vẫn
 * nhồi được `"summary": "result result result..."` vào một chuỗi hợp lệ), và
 * khi nó ném ("Grammar produced invalid JSON") rồi rơi về `generateText`
 * fallback, NỘI DUNG của lượt fallback đó cũng RA RÁC — trong khi phiên #1
 * (code GỐC, y hệt bản khôi phục ở đây: generateText+jsonMode một lượt, 1400,
 * KHÔNG có bước generateJSON nào trước đó) cho nội dung tiếng Việt MẠCH LẠC,
 * chỉ bị CẮT NGANG ở định dạng. So sánh táo-với-táo: FF-A (bản grammar) làm
 * HỎNG chính thứ quan trọng hơn (nội dung) trong khi sửa thứ ít quan trọng
 * hơn (định dạng) — đó là một hồi quy, phải bỏ.
 *
 * KHÔNG xoá lưới an toàn: `salvageAgentSections`/`sanitizeJsonBlock` vẫn y
 * nguyên (đã qua re-review đối kháng 26/26 probe) — đây chính xác là công cụ
 * sửa đúng vấn đề THẬT của phiên #1 (nội dung tốt, định dạng vỡ): `parseAgentOutput`
 * vẫn ưu tiên `JSON.parse` chặt chẽ, sa lưới sang `salvageAgentSections` khi
 * JSON bị cắt ngang bởi `maxTokens`=1400 — đúng kịch bản của phiên #1.
 */
export async function runSpecialistAgent(input: RunSpecialistAgentInput): Promise<SpecialistAgentRunResult> {
  const available = await isGgufAvailable();
  if (!available) {
    throw new Error("GGUF engine is not available. Ensure node-llama-cpp is installed and configured.");
  }

  const agent = SPECIALIST_AGENTS[input.agentId];
  if (!agent) {
    throw new Error(`Unknown specialist agent: ${input.agentId}`);
  }

  const result = await generateText(
    {
      systemPrompt: buildSystemPrompt(agent, input.language ?? "vi"),
      prompt: buildUserPrompt(input),
      maxTokens: specialistMaxTokens(),
      temperature: 0.25,
      topP: 0.9,
      repeatPenalty: 1.1,
      jsonMode: true,
      language: input.language ?? "vi",
    },
    input.modelId,
  );

  return {
    agent,
    modelId: result.modelId,
    output: parseAgentOutput(result.text),
    rawText: result.text,
    metrics: {
      tokensGenerated: result.tokensGenerated,
      tokensPrompt: result.tokensPrompt,
      totalTimeMs: result.totalTimeMs,
      tokensPerSecond: result.tokensPerSecond,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Audit Presets
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleAuditPreset {
  id: string;
  label: string;
  description: string;
  moduleName: string;
  files: string[];
  techStack: string[];
  objective: string;
  constraints: string[];
  includeBackend: boolean;
  includeFrontend: boolean;
  includeQa: boolean;
}

const MODULE_AUDIT_PRESETS: Record<string, ModuleAuditPreset> = {
  "ai-chat": {
    id: "ai-chat",
    label: "AI Chat Module",
    description: "Audit toàn diện AI Chat: bảo mật IDOR, inference hiệu năng, UX conversation flow",
    moduleName: "ai-chat",
    files: [
      "server/routers/aiChatRouter.ts",
      "server/db/aiChat.ts",
      "client/src/pages/ai-chat.tsx",
    ],
    techStack: ["tRPC", "node-llama-cpp", "React 19", "Drizzle ORM", "PostgreSQL"],
    objective:
      "Audit module AI Chat: tìm lỗi bảo mật (IDOR, injection), hiệu năng inference GGUF, UX conversation flow, và đề xuất cải tiến cụ thể.",
    constraints: [
      "Không thay đổi database schema hiện có",
      "Phải backward-compatible với API hiện tại",
      "Context window GGUF tối đa 4096 token",
    ],
    includeBackend: true,
    includeFrontend: true,
    includeQa: true,
  },
  "ai-inspection-analytics": {
    id: "ai-inspection-analytics",
    label: "Inspection Analytics AI",
    description: "Audit analytics: enum correctness, SQL query hiệu năng, KPI accuracy",
    moduleName: "ai-inspection-analytics",
    files: [
      "server/services/aiInspectionAnalytics.ts",
      "server/routers/aiInspectionRouter.ts",
    ],
    techStack: ["PostgreSQL", "Drizzle ORM", "tRPC", "node-llama-cpp"],
    objective:
      "Audit module AI Inspection Analytics: kiểm tra enum OK/NG vs PASS/FAIL, tối ưu query SQL, độ chính xác phân tích xu hướng lỗi, và đề xuất KPI mới phù hợp sản xuất.",
    constraints: [
      "Enum chuẩn là OK/NG, cần backward-compatible với PASS/FAIL legacy",
      "Không break existing chart/report API",
    ],
    includeBackend: true,
    includeFrontend: false,
    includeQa: true,
  },
  "ai-analysis-hub": {
    id: "ai-analysis-hub",
    label: "AI Analysis Hub",
    description: "Audit vision + embedding + similarity search hub",
    moduleName: "ai-analysis-hub",
    files: [
      "server/routers/aiAnalysisHubRouter.ts",
      "server/services/aiGgufEngine.ts",
      "server/services/aiImageEmbedding.ts",
    ],
    techStack: ["node-llama-cpp", "GGUF", "tRPC", "Sharp", "PostgreSQL"],
    objective:
      "Audit AI Analysis Hub: bảo mật path traversal, hiệu năng embedding pipeline, logic similarity search pgvector, và mở rộng vision analysis capability.",
    constraints: [
      "Image path phải confined trong uploads/",
      "GPU layers có thể thay đổi theo hardware environment",
    ],
    includeBackend: true,
    includeFrontend: false,
    includeQa: true,
  },
  "ai-vision-language": {
    id: "ai-vision-language",
    label: "Vision Language Module",
    description: "Audit VLM router: path security, multimodal pipeline, error handling",
    moduleName: "ai-vision-language",
    files: [
      "server/routers/aiVisionLanguageRouter.ts",
      "server/services/aiVisionLanguage.ts",
      "server/utils/safeImagePath.ts",
    ],
    techStack: ["node-llama-cpp", "LLaVA/Qwen-VL GGUF", "tRPC", "Sharp"],
    objective:
      "Audit module Vision Language: kiểm tra path traversal protection, multimodal prompt engineering, xử lý lỗi ảnh corrupted, và tối ưu inference latency.",
    constraints: [
      "Image path phải validated và confined trong uploads/",
      "Chỉ hỗ trợ định dạng JPEG/PNG/WEBP",
    ],
    includeBackend: true,
    includeFrontend: false,
    includeQa: true,
  },
  "ai-specialist-agent": {
    id: "ai-specialist-agent",
    label: "Specialist Agent System",
    description: "Self-audit hệ thống multi-agent workflow chain",
    moduleName: "ai-specialist-agent",
    files: [
      "server/services/aiSpecialistAgentService.ts",
      "server/routers/aiSpecialistAgentRouter.ts",
      "server/db/aiSpecialist.ts",
      "drizzle/schema/ai.ts",
    ],
    techStack: ["node-llama-cpp", "GGUF", "tRPC", "Drizzle ORM", "PostgreSQL"],
    objective:
      "Self-audit hệ thống Specialist Agent: session ownership enforcement, workflow chain reliability, token efficiency, schema chuẩn hoá JSON output, và cải tiến output quality.",
    constraints: [
      "Session phải enforce userId ownership ở mọi query",
      "Output JSON phải parseable kể cả khi model trả về markdown code block",
    ],
    includeBackend: true,
    includeFrontend: false,
    includeQa: true,
  },
};

export function listModuleAuditPresets(): ModuleAuditPreset[] {
  return Object.values(MODULE_AUDIT_PRESETS);
}

export function getModuleAuditPreset(id: string): ModuleAuditPreset | undefined {
  return MODULE_AUDIT_PRESETS[id];
}

// ─────────────────────────────────────────────────────────────────────────────
// Specialist → Action HITL Bridge (doc69 Giai đoạn 4 / Wave 3, D4)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `SpecialistAgentRunResult.output.actionPlan` is advisory TEXT with NO trusted
 * entity context to safely auto-build tool args from (unlike
 * server/services/ai/rcaActionSuggester.ts, which is always scoped to one already-
 * verified machine via `SuggestActionsContext.machineId`). A data-analyst/backend/
 * frontend/qa-optimizer run only carries `moduleName`/`files`/`techStack` — nothing
 * this module can trust as a real machineId, so it deliberately does NOT attempt to
 * parse/guess a {tool,args} mapping out of the recommendation text — doing so would
 * mean FABRICATING an entity reference, which the brief explicitly forbids.
 *
 * Instead, the router endpoint (aiSpecialistAgentRouter.proposeRecommendationAsAction)
 * requires the CALLER (a human reviewing the actionPlan item) to supply the concrete
 * `{tool, args}` it maps to. This module's job is only to restrict `tool` to a small,
 * explicit allow-list of SAFE, non-actuation write-tools an engineering recommendation
 * could honestly justify (analysis/request writes — never machine actuation, quality
 * disposition, or a spec/limit change). That allow-list is intentionally the exact
 * same 3 tools rcaActionSuggester.ts is permitted to suggest — both bridges are
 * constrained to "advisory-write" tools for the identical reason — so it is reused
 * directly rather than duplicated (a single place to extend/audit the allow-list).
 * The router re-validates `args` against the tool's OWN zod schema (mirrors
 * aiCopilotRouter.proposeSuggestedAction) before ever calling
 * aiCopilotActions.proposeAction — never fabricated, never auto-executed (propose-
 * only; a human must still confirm via the EXISTING confirmAction flow). A
 * recommendation whose tool/args don't validate is REJECTED and stays advisory-only
 * text — never silently coerced.
 */
export const SPECIALIST_BRIDGE_TOOLS = RCA_SUGGESTED_ACTION_TOOLS;
export type SpecialistBridgeTool = (typeof SPECIALIST_BRIDGE_TOOLS)[number];

/** Idempotent (delegates to rcaActionSuggester's own registration guard) — ensures
 *  the allow-listed write-tools are registered before the router validates a
 *  candidate mapping. Re-exported so the router only needs to import from this
 *  service module, not reach into server/services/ai/rcaActionSuggester.ts directly. */
export const ensureSpecialistBridgeToolsRegistered: () => Promise<void> = ensureRcaToolsRegistered;
