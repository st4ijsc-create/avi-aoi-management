/**
 * ★★★ LƯỢNG TỪ TRÊN MÃ NGUỒN: *∀ nơi tiêu thụ văn xuôi do model sinh ra đều đã được PHÂN LOẠI,
 * và mọi nơi tiêu thụ HIỂN THỊ CHO NGƯỜI đều đi qua bộ cắt chuỗi suy luận.*
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI — "caller MUST strip" đang là CHỮ SUÔNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `RouteDecision.thinking` (aiModelRouter.ts) mang một chú thích: *"The caller MUST pass the model
 * output through stripThinking()"*. Trước G5-C: **không một bên nào đọc cờ ấy**, và đường chat vận
 * hành chính không gọi `stripThinking` lần nào. Một chú thích không cưỡng chế được gì.
 *
 * Repo này đã dính lớp lỗi "lưới liệt kê tay bỏ sót phần tử N+1" **17 lần**. Một lưới liệt kê ba
 * bề mặt sẽ mù đúng vào bề mặt thứ tư. Nên lưới này KHÔNG liệt kê bề mặt: nó **PHÁT HIỆN** chúng
 * bằng AST trên toàn `server/**`, rồi đối chiếu với một **SỔ KHAI** bên dưới.
 *
 *   • Ai thêm một điểm gọi API sinh chữ mới ⇒ tập phát hiện ≠ sổ khai ⇒ **ĐỎ**, kể cả khi chưa ai
 *     viết ca test cho bề mặt ấy. Muốn xanh lại thì phải **khai** nó là hiển-thị hay nội-bộ.
 *   • Khai `noi:"tai_cho"` mà hàm bao KHÔNG hề chạm bộ cắt ⇒ **ĐỎ** (§2 đọc AST, không đọc lời khai).
 *   • Khai `noi:"xuoi_dong"` thì phải CHỈ ĐÍCH DANH bề mặt hạ nguồn, và bề mặt ấy phải thật sự
 *     `tai_cho` ⇒ không được viện dẫn một cái bóng.
 *   • Khai `noi:"chua"` (nợ) ⇒ đếm được, và tổng phải bằng **một SỐ ghim cứng**. Nợ mọc thêm ⇒ ĐỎ.
 *     Trả nợ xong phải HẠ số — cưỡng chế theo SỐ, đúng khuôn các pha VRAM đã dùng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ PHÁT HIỆN CỦA CHÍNH LƯỢT NÀY: "bề mặt thứ ba" hoá ra là BA MƯƠI điểm gọi / 19 file
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đếm tay trước khi quét: 2 đường (ops-chat, SSE) + 1 đã có (copilot). Quét AST ra **30 điểm
 * gọi** trên **19 file**, trong đó **12 bề mặt HIỂN THỊ vẫn chưa nối** sau lượt G5-C.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★ G5-E (2026-08-17) — TRẦN NỢ HIỂN THỊ 12 → **0**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cả 12 bề mặt ấy đã được nối, mỗi bề mặt có ca ĐỎ-trước chứng minh nó TỪNG rò (xem ba tệp lưới
 * hành vi liệt kê ngay trên khối 12 dòng bên dưới). Ba điều đáng ghi lại:
 *
 *  1. **`/v1` được quyết KHÁC**: nó là API tương thích OpenAI, client bên thứ ba đọc theo hợp
 *     đồng ⇒ nội tâm không bị BỎ mà chuyển sang ô chuẩn `reasoning_content`; riêng `/completions`
 *     (FIM) thì BỎ HẲN vì `text_completion` không có ô hợp lệ nào và chữ ấy chèn thẳng vào tệp mã.
 *  2. **`.trim()` của `stripThinking` là một thay đổi hành vi ẩn.** Năm bề mặt xưa nay KHÔNG trim
 *     (2 tRPC · /v1 chat · /v1 FIM · `runText`); dán thẳng `stripThinking().answer` vào đó sẽ nuốt
 *     thụt đầu dòng của một completion FIM — tức bản vá an toàn tự đẻ ra một lỗi dữ liệu. Cả năm
 *     chỗ dùng dạng "không cắt gì thì trả NGUYÊN VĂN" (`answer === raw.trim()` ⇒ trả `raw`).
 *  3. Nhóm KHÔNG-hiển-thị nay cũng có **số riêng** (`TRAN_NO_KHONG_HIEN_THI`) — xem lý do ở đó.
 * Trong đó có những chỗ không ai gọi là "bề mặt chat" nhưng chữ đi thẳng tới mắt người vận hành:
 * nội dung THÔNG BÁO (`notificationService`), câu CẢNH BÁO tỉ lệ NG (`ngRateAlertService`), lời
 * giải thích Pareto/downtime… Nếu roster mới đặt một model họ Qwen3.x làm **model mặc định**, mọi
 * điểm ấy đều có thể phát `<think>` — vì chúng gọi `generateText` KHÔNG ghim modelId.
 * Đó là lý do sổ khai này ghi cả nhóm nội-bộ chứ không lọc chúng ra khỏi tầm quét.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// ─── Vũ trụ quét ────────────────────────────────────────────────────────────────────────────
const GOC = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const THU_MUC_QUET = path.join(GOC, "server");

/** API sinh VĂN XUÔI của model. Không gồm embedding (vector, không phải chữ) hay phân loại JSON thuần. */
const API_SINH_CHU = new Set([
  "generateText",
  "generateTextStream",
  "chatCompletion",
  "chatCompletionStream",
  "generateFim",
  "generateNarrativeStream",
  "generateWithOllama",
  "generateWithOllamaStream",
]);

/** Ký hiệu chứng minh "đã đi qua bộ cắt". Đọc trên AST — một chú thích KHÔNG được tính. */
const KY_HIEU_CAT = new Set(["stripThinking", "StreamingThinkingStripper"]);

/**
 * ★★★ G5-E — VÁ MỘT ĐỘT BIẾN SỐNG SÓT (M18), bằng cách GHIM BẤT BIẾN chứ không thêm ca giả.
 *
 * Bảng đột biến của G5-E giết 17/18. Con sống sót:
 *
 *     - import { stripThinking } from "../ai/thinkingStrip";
 *     + const stripThinking = (t: string) => ({ answer: t, thinking: "", truncated: false });
 *
 * Một bộ cắt GIẢ, cùng tên, che mất bộ cắt thật — và §2 vẫn XANH. Vì sao: vị từ cũ đọc **TÊN ĐỊNH
 * DANH**, không đọc **cái tên ấy TRỎ VÀO ĐÂU**. Đây đúng lớp lỗi đã gặp nhiều lần trong repo:
 * *lưới xanh qua một cơ chế KHÁC với cơ chế nó tưởng đang canh*. (Lưới HÀNH VI
 * `thinkingSurfaces.wiring.test.ts` §7 vẫn bắt được con này — nên lỗ là ở §2, không phải ở hàng rào.)
 *
 * Bất biến ĐÚNG, ghim lại ở đây: ký hiệu ấy phải **đến từ module lá `ai/thinkingStrip`**, hoặc từ
 * `aiGgufEngine` (module re-export nguyên vẹn module lá — copilot lập trình lấy đường đó qua
 * `const { …, stripThinking } = await import("../aiGgufEngine")`). Cả hai dạng nhập đều được nhận;
 * một `const` cùng tên khai tại chỗ thì KHÔNG.
 */
const NGUON_BO_CAT = /(^|\/)ai\/thinkingStrip$|(^|\/)aiGgufEngine$/;

function laNguonBoCat(spec: string): boolean {
  return NGUON_BO_CAT.test(spec.replace(/\.(ts|js|mjs)$/, ""));
}

/** Chuỗi module của một `import(...)` động nằm bên trong `n` (nếu có). */
function moduleNhapDong(n: ts.Node): string | null {
  let ra: string | null = null;
  diKhap(n, (x) => {
    if (ra || !ts.isCallExpression(x)) return;
    if (x.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
    const a0 = x.arguments[0];
    if (a0 && ts.isStringLiteral(a0)) ra = a0.text;
  });
  return ra;
}

/**
 * Tên CỤC BỘ đang thật sự trỏ tới bộ cắt của module lá — qua `import {…} from "…"` TĨNH **hoặc**
 * `const {…} = await import("…")` ĐỘNG. Tên nào không nằm trong tập này thì §2 không công nhận,
 * dù nó được gõ y hệt `stripThinking`.
 */
function tenTroToiBoCat(sf: ts.SourceFile): Set<string> {
  const ra = new Set<string>();
  diKhap(sf, (n) => {
    // (a) import tĩnh
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && laNguonBoCat(n.moduleSpecifier.text)) {
      const b = n.importClause?.namedBindings;
      if (b && ts.isNamedImports(b)) {
        for (const e of b.elements) {
          if (KY_HIEU_CAT.has((e.propertyName ?? e.name).text)) ra.add(e.name.text);
        }
      }
      return;
    }
    // (b) `const { X: y } = await import("…")`
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
      const spec = moduleNhapDong(n.initializer);
      if (!spec || !laNguonBoCat(spec)) return;
      for (const e of n.name.elements) {
        const goc = e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName.text : ts.isIdentifier(e.name) ? e.name.text : "";
        if (KY_HIEU_CAT.has(goc) && ts.isIdentifier(e.name)) ra.add(e.name.text);
      }
    }
  });
  return ra;
}

interface DiemGoi {
  readonly tep: string;
  readonly ham: string;
  readonly goi: string;
  readonly dong: number;
}

function liet(duong: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(duong)) {
    const p = path.join(duong, ten);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (ten === "node_modules" || ten === "dist" || ten === ".git") continue;
      liet(p, ra);
    } else if (ten.endsWith(".ts") && !ten.endsWith(".test.ts") && !ten.endsWith(".d.ts")) {
      ra.push(p);
    }
  }
  return ra;
}

function cay(duong: string, ma: string): ts.SourceFile {
  return ts.createSourceFile(duong, ma, ts.ScriptTarget.Latest, true);
}

function diKhap(n: ts.Node, f: (x: ts.Node) => void): void {
  f(n);
  n.forEachChild((c) => diKhap(c, f));
}

/**
 * Bí danh cục bộ của một API sinh chữ: `const { generateTextStream: ggufStream } = await import(…)`.
 * Không xử lý bí danh ⇒ lưới mù đúng cái điểm gọi CHÍNH của ops-chat.
 */
function biDanh(sf: ts.SourceFile): Map<string, string> {
  const m = new Map<string, string>();
  diKhap(sf, (n) => {
    if (ts.isBindingElement(n) && n.propertyName && ts.isIdentifier(n.propertyName) && ts.isIdentifier(n.name)) {
      if (API_SINH_CHU.has(n.propertyName.text)) m.set(n.name.text, n.propertyName.text);
    }
    if (ts.isImportSpecifier(n) && n.propertyName && API_SINH_CHU.has(n.propertyName.text)) {
      m.set(n.name.text, n.propertyName.text);
    }
  });
  return m;
}

/** Hàm/khối bao gần nhất CÓ TÊN NÓI ĐƯỢC, kèm nút để quét bên trong. */
function hamBao(sf: ts.SourceFile, n: ts.Node): { ten: string; nut: ts.Node } {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) {
      return { ten: p.name.getText(sf), nut: p };
    }
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent) {
      const q = p.parent;
      if (ts.isVariableDeclaration(q) && ts.isIdentifier(q.name)) return { ten: q.name.text, nut: p };
      // Handler tuyến: `app.post("/api/…", async (req,res) => {…})` — tên nói được nhất là ĐƯỜNG.
      if (ts.isCallExpression(q) && ts.isPropertyAccessExpression(q.expression)) {
        const a0 = q.arguments[0];
        if (a0 && ts.isStringLiteral(a0)) return { ten: `${q.expression.name.text} ${a0.text}`, nut: p };
      }
      if (ts.isPropertyAssignment(q) && (ts.isIdentifier(q.name) || ts.isStringLiteral(q.name))) {
        return { ten: q.name.text, nut: p };
      }
    }
  }
  return { ten: "<module>", nut: sf };
}

/** Tên được KHAI BÁO ở phạm vi file (để đi một hop: hàm bao → ký hiệu cùng file → bộ cắt). */
function khaiBaoTrongFile(sf: ts.SourceFile): Map<string, ts.Node> {
  const m = new Map<string, ts.Node>();
  diKhap(sf, (n) => {
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) m.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) m.set(n.name.text, n.initializer);
  });
  return m;
}

function chuaKyHieuCat(n: ts.Node, tenHopLe: ReadonlySet<string>): boolean {
  if (tenHopLe.size === 0) return false; // không nhập bộ cắt từ module lá ⇒ mọi tên trùng là GIẢ
  let co = false;
  diKhap(n, (x) => {
    if (ts.isIdentifier(x) && tenHopLe.has(x.text)) co = true;
  });
  return co;
}

/** Hàm bao có bộ cắt — trực tiếp, HOẶC qua đúng MỘT hop tới ký hiệu khai báo cùng file. */
function hamCoBoCat(sf: ts.SourceFile, nut: ts.Node): boolean {
  const tenHopLe = tenTroToiBoCat(sf);
  if (chuaKyHieuCat(nut, tenHopLe)) return true;
  const khai = khaiBaoTrongFile(sf);
  let co = false;
  diKhap(nut, (x) => {
    if (co || !ts.isIdentifier(x)) return;
    const d = khai.get(x.text);
    if (d && d !== nut && chuaKyHieuCat(d, tenHopLe)) co = true;
  });
  return co;
}

/**
 * Điểm gọi API sinh chữ trong MỘT file.
 *
 * ⚠ QUY TẮC CẤU TẠO (không phải danh sách loại trừ viết tay): một lượt gọi tới hàm do **CHÍNH
 * file này khai báo** là *sáng tác nội bộ trong module*, không phải một **biên tiêu thụ**. Nhờ đó
 * `aiGgufEngine.ts` gọi `generateText` của chính nó, hay `answerQuestion` gọi `generateWithOllama`
 * cùng file, không sinh ra dòng sổ giả — trong khi biên THẬT (`generateWithOllama::generateText`,
 * nơi chữ rời module engine) vẫn nằm nguyên trong tầm quét.
 */
export function quetMotFile(duongTuongDoi: string, ma: string): DiemGoi[] {
  const sf = cay(duongTuongDoi, ma);
  const alias = biDanh(sf);
  const tuKhaiBao = new Set<string>();
  diKhap(sf, (n) => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && API_SINH_CHU.has(n.name.getText(sf))) {
      tuKhaiBao.add(n.name.getText(sf));
    }
  });

  const ra: DiemGoi[] = [];
  const thay = new Set<string>();
  diKhap(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const e = n.expression;
    if (!ts.isIdentifier(e)) return;
    const goi = API_SINH_CHU.has(e.text) ? e.text : alias.get(e.text);
    if (!goi) return;
    // Gọi hàm do CHÍNH file này khai báo ⇒ sáng tác nội bộ, không phải biên tiêu thụ.
    if (tuKhaiBao.has(goi)) return;
    const bao = hamBao(sf, n);
    const khoa = `${duongTuongDoi}::${bao.ten}::${goi}`;
    if (thay.has(khoa)) return;
    thay.add(khoa);
    ra.push({
      tep: duongTuongDoi,
      ham: bao.ten,
      goi,
      dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
    });
  });
  return ra;
}

/** Quét TOÀN BỘ `server/**` — đây là chỗ "N+1" bị chặn: không danh sách file nào được viết tay. */
function quetToanBo(): Array<DiemGoi & { sf: ts.SourceFile; nut: ts.Node }> {
  const ra: Array<DiemGoi & { sf: ts.SourceFile; nut: ts.Node }> = [];
  for (const tuyetDoi of liet(THU_MUC_QUET)) {
    const rel = path.relative(GOC, tuyetDoi).split(path.sep).join("/");
    const ma = readFileSync(tuyetDoi, "utf8");
    if (!/generate(Text|Fim|Narrative|WithOllama)|chatCompletion/.test(ma)) continue; // lọc rẻ
    const sf = cay(rel, ma);
    for (const d of quetMotFile(rel, ma)) {
      // Tìm lại nút hàm bao để §2 quét bên trong.
      let nut: ts.Node = sf;
      diKhap(sf, (n) => {
        if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return;
        const b = hamBao(sf, n);
        if (b.ten === d.ham) nut = b.nut;
      });
      ra.push({ ...d, sf, nut });
    }
  }
  return ra;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SỔ KHAI — mỗi dòng là một QUYẾT ĐỊNH có người chịu trách nhiệm, không phải một danh sách cho đủ.
// ═══════════════════════════════════════════════════════════════════════════════════════════

type CachNoi =
  /** Bộ cắt nằm NGAY trong hàm bao (hoặc ký hiệu cùng file mà hàm bao dùng). */
  | "tai_cho"
  /** Chữ chảy vào một bề mặt hạ nguồn ĐÃ cắt — phải chỉ đích danh, và bề mặt ấy phải `tai_cho`. */
  | "xuoi_dong"
  /** Chưa nối. NỢ ĐƯỢC KHAI, đếm được, có trần. */
  | "chua";

interface BeMat {
  readonly tep: string;
  readonly ham: string;
  readonly goi: string;
  /** Đầu ra có tới mắt người dùng dưới dạng VĂN XUÔI không? */
  readonly hienThi: boolean;
  readonly noi: CachNoi;
  /** Bắt buộc khi `noi==="xuoi_dong"`: khoá `tep::ham::goi` của bề mặt hạ nguồn. */
  readonly xuoiDongToi?: string;
  readonly ghiChu: string;
}

const SO_KHAI: readonly BeMat[] = [
  // ─── ĐÃ NỐI TẠI CHỖ trong lượt G5-C (7) ───
  {
    tep: "server/routes/aiStreamingApi.ts", ham: "post /api/ai/stream/generate", goi: "generateTextStream",
    hienThi: true, noi: "tai_cho",
    ghiChu: "SSE → useAIStream → bong bóng chat. Bộ cắt nằm trong `OngPhatSSE` (một hop từ handler).",
  },
  {
    tep: "server/routes/aiStreamingApi.ts", ham: "post /api/ai/stream/chat", goi: "chatCompletionStream",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Như trên, tuyến chat — cùng một `OngPhatSSE`, không đường phát thứ hai.",
  },
  {
    tep: "server/routes/aiStreamingApi.ts", ham: "post /api/ai/stream/narrative", goi: "generateNarrativeStream",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Như trên, tuyến narrative — cũng là hàng rào cuối cho `aiProviderRouter` ở hạ nguồn.",
  },
  {
    tep: "server/services/aiLocalKnowledgeService.ts", ham: "generateWithOllama", goi: "generateText",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Ops-chat KHÔNG streaming. `stripThinking` chạy TRƯỚC `plan.sanitizeOutput` (thứ tự có lý do đo được).",
  },
  {
    tep: "server/services/aiLocalKnowledgeService.ts", ham: "generateWithOllamaStream", goi: "generateTextStream",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Ops-chat streaming. `StreamingThinkingStripper` dựng NGOÀI mọi nhánh ⇒ không đường thoát nào đi vòng.",
  },
  {
    tep: "server/services/programming/aiProgrammingCopilot.ts", ham: "runCodeModel", goi: "chatCompletion",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Copilot lập trình — bề mặt DUY NHẤT đã cắt TRƯỚC G5-C (di sản G5-B).",
  },
  {
    tep: "server/services/programming/aiProgrammingCopilot.ts", ham: "completeInline", goi: "generateFim",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Ghost-text FIM trong IDE — đã cắt từ trước.",
  },

  // ─── ĐƯỢC CẮT Ở HẠ NGUỒN (1) ───
  {
    tep: "server/services/aiProviderRouter.ts", ham: "generateNarrativeStream", goi: "generateTextStream",
    hienThi: true, noi: "xuoi_dong",
    xuoiDongToi: "server/routes/aiStreamingApi.ts::post /api/ai/stream/narrative::generateNarrativeStream",
    ghiChu:
      "Không tự cắt: chữ của nó ra người dùng qua tuyến SSE narrative, nơi `OngPhatSSE` cắt. Khai " +
      "`xuoi_dong` thay vì `tai_cho` để lời khai đúng với mã — §3 kiểm tra bề mặt hạ nguồn có THẬT.",
  },

  // ═══ ĐÃ NỐI TẠI CHỖ trong lượt G5-E (12) — nợ hiển thị TRẢ HẾT ═══
  // Lưới hành vi: `server/routers/aiGgufRouter.thinkingLeak.test.ts` (2),
  //               `server/routes/openaiGateway.thinkingLeak.test.ts` (3),
  //               `server/services/ai/thinkingSurfaces.wiring.test.ts` (7).
  {
    tep: "server/routers/aiGgufRouter.ts", ham: "<module>", goi: "generateText",
    hienThi: true, noi: "tai_cho",
    ghiChu:
      "tRPC `aiGguf.generate` — playground/Vision-Lab. Cắt qua `catSuyLuanGiuBien` (giữ nguyên " +
      "khoảng trắng biên khi KHÔNG có gì bị cắt ⇒ no-op từng ký tự với roster hiện tại).",
  },
  {
    tep: "server/routers/aiGgufRouter.ts", ham: "<module>", goi: "chatCompletion",
    hienThi: true, noi: "tai_cho",
    ghiChu: "tRPC `aiGguf.chat` — cùng một `catSuyLuanGiuBien`, không đường trả thứ hai.",
  },
  {
    tep: "server/routes/openaiGateway.ts", ham: "post /chat/completions", goi: "chatCompletionStream",
    hienThi: true, noi: "tai_cho",
    ghiChu:
      "/v1 stream. `StreamingThinkingStripper` đứng TRƯỚC `StreamingSecretRedactor` trong chuỗi " +
      "(cả ở `push` lẫn lúc xả đuôi). Nội tâm ra ô RIÊNG `delta.reasoning_content` — QUYẾT ĐỊNH " +
      "G5-E: tách ô, KHÔNG dán inline; cờ `OPENAI_GATEWAY_REASONING_FIELD` chỉ tắt được Ô, không " +
      "bao giờ mở lại đường inline. Bộ cắt KHÔNG gắn cờ `AI_SAFETY_ENABLED` (gắn = dựng lại fail-open).",
  },
  {
    tep: "server/routes/openaiGateway.ts", ham: "post /chat/completions", goi: "chatCompletion",
    hienThi: true, noi: "tai_cho",
    ghiChu:
      "Nhánh không-streaming của cùng tuyến /v1: cắt TRƯỚC `plan.sanitizeOutput`; nội tâm sang " +
      "`message.reasoning_content` (ô chỉ MỌC khi thật sự có nội tâm ⇒ hình dạng đáp ứng hiện tại giữ nguyên).",
  },
  {
    tep: "server/routes/openaiGateway.ts", ham: "post /completions", goi: "generateFim",
    hienThi: true, noi: "tai_cho",
    ghiChu:
      "FIM qua /v1/completions (cả stream lẫn không): cắt rồi **BỎ HẲN** nội tâm — `text_completion` " +
      "không có ô hợp lệ nào mang nó, và chữ này chèn THẲNG vào tệp mã nguồn. `catGiuNguyenBien` " +
      "bắt buộc ở đây: trim một completion FIM là làm hỏng thụt đầu dòng của người dùng.",
  },
  {
    tep: "server/services/aiInspectionAnalytics.ts", ham: "narrateAnalysis", goi: "generateText",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Diễn giải trên bảng phân tích. `stripThinking(...).answer.trim()` — `.trim()` vốn là hành vi cũ.",
  },
  {
    tep: "server/services/aiInspectionAnalytics.ts", ham: "interpretSPCViolations", goi: "generateText",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Diễn giải vi phạm SPC — cùng khuôn cắt như `narrateAnalysis` trong chính file này.",
  },
  {
    tep: "server/services/aiProviderRouter.ts", ham: "runText", goi: "generateText",
    hienThi: true, noi: "tai_cho",
    ghiChu:
      "Nhánh KHÔNG streaming của provider router — khác `generateNarrativeStream` ở chỗ nó KHÔNG có " +
      "bề mặt SSE nào cắt hộ. Cắt TRƯỚC `plan.sanitizeOutput`; giữ nguyên khoảng trắng biên vì hàm " +
      "này xưa nay KHÔNG trim (bên gọi là báo cáo điều hành / RCA).",
  },
  {
    tep: "server/services/dataComparisonService.ts", ham: "narrateComparison", goi: "generateText",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Diễn giải so sánh kỳ hiển thị cho người dùng — cắt trước `.trim()` cũ.",
  },
  {
    tep: "server/services/notificationService.ts", ham: "generateNotificationSummary", goi: "generateText",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Thân THÔNG BÁO đẩy tới điện thoại/Andon — bề mặt dễ quên nhất, nay cắt tại chỗ.",
  },
  {
    tep: "server/services/orchestration/aiWatcher.ts", ham: "generateAdvisory", goi: "chatCompletion",
    hienThi: true, noi: "tai_cho",
    ghiChu:
      "Lời khuyên RCA của watcher — chữ này vào **BẢN GHI VĨNH VIỄN** `ai_insights.body` rồi mới " +
      "hiển thị. Cắt TRƯỚC khi rời hàm: xoá nội tâm sau khi đã lưu là việc không ai làm.",
  },
  {
    tep: "server/services/productionSchedulingService.ts", ham: "explainScheduleWithAIUnbounded", goi: "generateText",
    hienThi: true, noi: "tai_cho",
    ghiChu: "Diễn giải lịch sản xuất hiển thị cho kế hoạch — cắt trước `.trim()` cũ.",
  },

  // ═══ KHÔNG HIỂN THỊ (10) — đầu ra được PARSE, `<think>` làm hỏng parse ⇒ lỗi CÓ TIẾNG ═══
  {
    tep: "server/services/aiSmartAlertRouter.ts", ham: "enrichRoutingWithAI", goi: "generateText",
    hienThi: false, noi: "chua",
    ghiChu: "`jsonMode:true` + `JSON.parse(jsonMatch[0])` — quyết định định tuyến, không phải chữ hiển thị.",
  },
  {
    tep: "server/services/downtimeDetectionService.ts", ham: "analyzeDowntimeRootCause", goi: "generateText",
    hienThi: false, noi: "chua",
    ghiChu: "`jsonMode:true`, schema likelyCause/confidence — được parse thành trường có cấu trúc.",
  },
  {
    tep: "server/services/ngRateAlertService.ts", ham: "enrichAlertWithAI", goi: "generateText",
    hienThi: false, noi: "chua",
    ghiChu: "`jsonMode:true` + `JSON.parse` — làm giàu cảnh báo theo trường, không phun chữ thô.",
  },
  {
    tep: "server/services/notificationService.ts", ham: "personalizeNotificationForRole", goi: "generateText",
    hienThi: false, noi: "chua",
    ghiChu: "`jsonMode:true`, schema {title,message} — parse trước khi hiển thị nên rò là hỏng-CÓ-TIẾNG.",
  },
  {
    tep: "server/services/paretoAnalysisService.ts", ham: "generateParetoRecommendations", goi: "generateText",
    hienThi: false, noi: "chua",
    ghiChu: "`jsonMode:true` + `JSON.parse(response.text)` — danh sách khuyến nghị có cấu trúc.",
  },
  {
    tep: "server/services/aiVisionLanguage.ts", ham: "ggufFallbackDescription", goi: "chatCompletion",
    hienThi: false, noi: "chua",
    ghiChu: "System prompt 'Output ONLY valid JSON' + regex bóc `{...}` — mô tả khuyết tật có schema.",
  },
  {
    tep: "server/services/aiVisionLanguage.ts", ham: "ggufFallbackReport", goi: "chatCompletion",
    hienThi: false, noi: "chua",
    ghiChu: "Cùng khuôn JSON-only như trên, cho báo cáo nhiều ảnh.",
  },
  {
    tep: "server/services/aiSpecialistAgentService.ts", ham: "runSpecialistAgent", goi: "generateText",
    hienThi: false, noi: "chua",
    ghiChu: "`jsonMode:true` — agent chuyên gia trả JSON có schema, được parse.",
  },
  {
    tep: "server/services/aiReranker.ts", ham: "rankWithLlm", goi: "generateText",
    hienThi: false, noi: "chua",
    ghiChu: "`jsonMode:true`, đầu ra là mảng {i,s} điểm liên quan — không có chữ nào tới người dùng.",
  },
  {
    tep: "server/services/aiLlmFinetuneSidecar.ts", ham: "defaultLoraGenerate", goi: "generateText",
    hienThi: false, noi: "chua",
    ghiChu: "Hook sinh chữ cho eval LoRA — chữ vào bộ chấm điểm MLOps, không vào giao diện vận hành.",
  },
];

/**
 * ⚠ TRẦN NỢ GHIM CỨNG — số bề mặt HIỂN THỊ chưa nối.
 *
 * Đây là **cưỡng chế theo SỐ** (khuôn đã dùng ở các pha VRAM): "liệt kê đầy đủ" không bao giờ đạt
 * được, nhưng một CON SỐ thì không trốn được. Nối thêm một bề mặt ⇒ HẠ số. Nợ mọc thêm ⇒ ĐỎ.
 *
 * LỊCH SỬ: G5-C nối 7 → trần 12. **G5-E nối nốt 12 → trần 0.** Số này chỉ được HẠ, không được nới;
 * muốn nới thì phải khai thêm một dòng `hienThi:true, noi:"chua"` kèm lý do, và lý do ấy đứng tên
 * người viết nó.
 */
const TRAN_NO_HIEN_THI = 0;

/**
 * ⚠ TRẦN NỢ **KHÔNG HIỂN THỊ** — mới thêm ở G5-E.
 *
 * Trước G5-E nhóm này chỉ có một câu văn xuôi ("`<think>` làm hỏng parse ⇒ lỗi CÓ TIẾNG"). Một lời
 * khai không kèm SỐ là một tấm vé trắng cho mọi tuyến sau: ai thêm một điểm gọi `jsonMode` mới rồi
 * dán cùng câu ấy vào là xong, không ai đếm. Nay nó có số riêng.
 *
 * ⚠ ĐÂY LÀ NỢ CÓ THẬT, KHÔNG PHẢI "ĐÃ AN TOÀN": lập luận bảo vệ nó là *thẻ suy luận làm hỏng phép
 * parse nên hỏng sẽ CÓ TIẾNG*, chứ không phải *thẻ không tới nơi*. Lập luận ấy YẾU NHẤT ở
 * `aiVisionLanguage` (bóc JSON bằng regex `{...}` thay vì `JSON.parse` thẳng): một khối `<think>`
 * có chứa dấu ngoặc nhọn có thể làm regex bắt SAI đối tượng — hỏng ÂM THẦM, không phải có tiếng.
 * Chưa vá trong lượt này vì đó là lớp lỗi PARSE (khác lớp lỗi HIỂN THỊ mà G5-E được giao) và vì
 * "vá bừa" một bề mặt chưa đo là đúng cái khuôn trả-nợ-đẻ-nợ đã dính nhiều lần. Nó nằm đây, có số.
 */
const TRAN_NO_KHONG_HIEN_THI = 10;

function khoa(x: { tep: string; ham: string; goi: string }): string {
  return `${x.tep}::${x.ham}::${x.goi}`;
}

const PHAT_HIEN = quetToanBo();

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — ∀ điểm tiêu thụ văn xuôi model đều ĐÃ ĐƯỢC PHÂN LOẠI (chặn N+1)", () => {
  it("tập PHÁT HIỆN bằng AST == tập KHAI BÁO trong sổ (đối xứng hai chiều)", () => {
    const daPhat = new Set(PHAT_HIEN.map(khoa));
    const daKhai = new Set(SO_KHAI.map(khoa));

    const chuaKhai = [...daPhat].filter((k) => !daKhai.has(k)).sort();
    const khaiThua = [...daKhai].filter((k) => !daPhat.has(k)).sort();

    expect(
      chuaKhai,
      "★ ĐIỂM GỌI MỚI CHƯA ĐƯỢC PHÂN LOẠI — chữ model có thể tới người dùng kèm chuỗi suy luận.\n" +
        "Thêm một dòng vào SO_KHAI và QUYẾT: hiển thị hay nội bộ, đã nối hay còn nợ.\n" +
        chuaKhai.map((k) => `  + ${k}`).join("\n"),
    ).toEqual([]);

    expect(
      khaiThua,
      "Sổ khai còn dòng CHẾT (mã đã đổi/xoá) — sổ phải mô tả mã đang có, không mô tả quá khứ:\n" +
        khaiThua.map((k) => `  - ${k}`).join("\n"),
    ).toEqual([]);

    // Chống lưới rỗng: phép quét phải thật sự tìm ra thứ gì đó.
    expect(PHAT_HIEN.length).toBeGreaterThanOrEqual(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ GIỚI HẠN ĐÃ ĐO CỦA §2 — KHAI RA THAY VÌ ĐỂ NGƯỜI SAU TƯỞNG NÓ MẠNH HƠN THỰC TẾ.
 *
 * Với dòng sổ có `ham: "<module>"` (hai thủ tục tRPC trong `aiGgufRouter.ts` — `hamBao` không tìm
 * được tên nói được cho arrow nằm trong `.mutation(...)`), "hàm bao" chính là CẢ TỆP. Đột biến M1
 * của G5-E (gỡ `catSuyLuanGiuBien` khỏi đúng thủ tục `generate`, giữ nguyên ở `chat`) vì thế **vẫn
 * qua được §2** — và bị giết bởi lưới HÀNH VI `server/routers/aiGgufRouter.thinkingLeak.test.ts`.
 *
 * Nói cho đúng: với hai dòng ấy §2 chỉ khẳng định *"tệp này có hàng rào thật, nhập từ module lá"*,
 * KHÔNG khẳng định *"đúng điểm gọi ấy đi qua hàng rào"*. Cái sau do lưới hành vi gánh. Đừng bỏ lưới
 * hành vi rồi tưởng §2 đủ.
 */
describe("§2 — ∀ bề mặt khai `tai_cho` PHẢI thật sự chạm bộ cắt (đọc AST, không đọc lời khai)", () => {
  it("mọi dòng `noi:tai_cho` đều có `stripThinking`/`StreamingThinkingStripper` trong tầm với", () => {
    const noiDoi: string[] = [];
    for (const b of SO_KHAI.filter((x) => x.noi === "tai_cho")) {
      const d = PHAT_HIEN.find((p) => khoa(p) === khoa(b));
      if (!d) continue; // §1 đã bắt
      if (!hamCoBoCat(d.sf, d.nut)) noiDoi.push(`${khoa(b)} (dòng ${d.dong})`);
    }
    expect(
      noiDoi,
      "★ LỜI KHAI KHÔNG KHỚP MÃ: dòng sổ nói đã cắt, AST không thấy bộ cắt nào:\n" +
        noiDoi.map((k) => `  ✗ ${k}`).join("\n"),
    ).toEqual([]);
    expect(SO_KHAI.filter((x) => x.noi === "tai_cho").length).toBeGreaterThanOrEqual(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — `xuoi_dong` phải chỉ đích danh một bề mặt CÓ THẬT và đã cắt tại chỗ", () => {
  it("không được viện dẫn một cái bóng", () => {
    for (const b of SO_KHAI.filter((x) => x.noi === "xuoi_dong")) {
      expect(b.xuoiDongToi, `${khoa(b)} khai xuoi_dong mà không chỉ đích danh bề mặt hạ nguồn`).toBeTruthy();
      const ha = SO_KHAI.find((x) => khoa(x) === b.xuoiDongToi);
      expect(ha, `${khoa(b)} → "${b.xuoiDongToi}" KHÔNG có trong sổ khai`).toBeTruthy();
      expect(ha!.noi, `bề mặt hạ nguồn của ${khoa(b)} phải là tai_cho`).toBe("tai_cho");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — NỢ đếm được, có trần, và mọi dòng đều phải nêu lý do", () => {
  it(`số bề mặt HIỂN THỊ chưa nối đúng bằng trần ghim cứng (${TRAN_NO_HIEN_THI})`, () => {
    const no = SO_KHAI.filter((x) => x.hienThi && x.noi === "chua");
    expect(
      no.length,
      "Nợ THAY ĐỔI. Mọc thêm ⇒ có bề mặt hiển thị mới chưa nối. Trả bớt ⇒ HẠ TRAN_NO_HIEN_THI.\n" +
        no.map((x) => `  • ${khoa(x)} — ${x.ghiChu}`).join("\n"),
    ).toBe(TRAN_NO_HIEN_THI);
  });

  it(`số bề mặt KHÔNG-hiển-thị chưa nối đúng bằng trần ghim cứng (${TRAN_NO_KHONG_HIEN_THI})`, () => {
    const no = SO_KHAI.filter((x) => !x.hienThi && x.noi === "chua");
    expect(
      no.length,
      "Nhóm 'hỏng-CÓ-TIẾNG' cũng phải ĐẾM ĐƯỢC — một lời khai không kèm SỐ là vé trắng cho mọi\n" +
        "tuyến sau. Mọc thêm ⇒ có điểm gọi JSON mới chưa ai soi; trả bớt ⇒ HẠ TRAN_NO_KHONG_HIEN_THI.\n" +
        no.map((x) => `  • ${khoa(x)} — ${x.ghiChu}`).join("\n"),
    ).toBe(TRAN_NO_KHONG_HIEN_THI);
  });

  it("★ nợ HIỂN THỊ đã về 0 ⇒ mọi dòng `hienThi:true` phải đã nối (tai_cho hoặc xuoi_dong)", () => {
    const conNo = SO_KHAI.filter((x) => x.hienThi && x.noi === "chua").map(khoa);
    expect(
      conNo,
      "G5-E khai TRẦN 0. Một dòng hiển thị còn `chua` nghĩa là lời khai và trần đang mâu thuẫn —\n" +
        "sửa MÃ, đừng nới trần:\n" + conNo.map((k) => `  ✗ ${k}`).join("\n"),
    ).toEqual([]);
    // Chống "0 vì sổ rỗng": phải có ÍT NHẤT 19 bề mặt hiển thị đã nối thật (7 của G5-C + 12 của G5-E).
    expect(SO_KHAI.filter((x) => x.hienThi && x.noi !== "chua").length).toBeGreaterThanOrEqual(19);
  });

  it("mọi dòng sổ đều có ghi chú không rỗng (một phân loại không lý do là một lời khai trống)", () => {
    const trong = SO_KHAI.filter((x) => x.ghiChu.trim().length < 20).map(khoa);
    expect(trong, `Thiếu lý do:\n${trong.map((k) => `  ? ${k}`).join("\n")}`).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — CẦU CHÌ: lưới này ĐỎ ĐƯỢC", () => {
  const NGUON_BE_MAT_MOI = `
import { generateTextStream } from "../services/aiGgufEngine";
export function dangKy(app: any) {
  app.post("/api/ai/stream/tuyen-moi", async (req: any, res: any) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for await (const chunk of generateTextStream({ prompt: req.body.prompt })) {
      res.write(\`data: \${JSON.stringify(chunk)}\\n\\n\`);
    }
    res.end();
  });
}
`;

  it("bề mặt THỨ N+1 viết đúng kiểu bề mặt cũ — phép quét TÌM RA (⇒ §1 sẽ đỏ)", () => {
    const d = quetMotFile("server/routes/tuyen-moi.ts", NGUON_BE_MAT_MOI);
    expect(d.length).toBe(1);
    expect(d[0].goi).toBe("generateTextStream");
    expect(khoa(d[0])).not.toBe("");
    expect(new Set(SO_KHAI.map(khoa)).has(khoa(d[0]))).toBe(false); // ⇒ §1 báo "chưa khai"
  });

  it("BÍ DANH qua import động cũng bị bắt (`generateTextStream: ggufStream`)", () => {
    const nguon = `
export async function* chay() {
  const { generateTextStream: ggufStream } = await import("./aiGgufEngine");
  for await (const c of ggufStream({ prompt: "x" })) yield c;
}
`;
    const d = quetMotFile("server/services/biDanh.ts", nguon);
    expect(d.map((x) => x.goi)).toEqual(["generateTextStream"]);
    expect(d[0].ham).toBe("chay");
  });

  it("CHÚ THÍCH KHÔNG PHẢI BẰNG CHỨNG: hàm chỉ 'nói' đã cắt vẫn trượt §2", () => {
    const nguon = `
import { generateText } from "./aiGgufEngine";
export async function traLoi(p: string) {
  // đã cắt <think> bằng stripThinking rồi nhé
  const r = await generateText({ prompt: p });
  return r.text;
}
`;
    const sf = cay("server/services/gia.ts", nguon);
    const d = quetMotFile("server/services/gia.ts", nguon)[0];
    let nut: ts.Node = sf;
    diKhap(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "generateText") {
        nut = hamBao(sf, n).nut;
      }
    });
    expect(d.ham).toBe("traLoi");
    expect(hamCoBoCat(sf, nut)).toBe(false);
  });

  it("★ M18 — BỘ CẮT GIẢ CÙNG TÊN khai tại chỗ KHÔNG được công nhận (đột biến từng SỐNG SÓT)", () => {
    const nguon = `
const stripThinking = (t: string) => ({ answer: t, thinking: "", truncated: false });
import { generateText } from "./aiGgufEngine";
export async function traLoi(p: string) {
  const r = await generateText({ prompt: p });
  return stripThinking(r.text).answer;
}
`;
    const sf = cay("server/services/gia18.ts", nguon);
    let nut: ts.Node = sf;
    diKhap(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "generateText") {
        nut = hamBao(sf, n).nut;
      }
    });
    expect(tenTroToiBoCat(sf).size).toBe(0);
    expect(hamCoBoCat(sf, nut)).toBe(false);
  });

  it("nhập ĐỘNG qua `aiGgufEngine` (đường của copilot lập trình) VẪN được công nhận", () => {
    const nguon = `
export async function hoanTat(p: string) {
  const { generateFim, stripThinking } = await import("../aiGgufEngine");
  const r = await generateFim({ prefix: p });
  return stripThinking(r.text).answer;
}
`;
    const sf = cay("server/services/programming/gia19.ts", nguon);
    let nut: ts.Node = sf;
    diKhap(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "generateFim") {
        nut = hamBao(sf, n).nut;
      }
    });
    expect([...tenTroToiBoCat(sf)]).toEqual(["stripThinking"]);
    expect(hamCoBoCat(sf, nut)).toBe(true);
  });

  it("bí danh khi nhập (`stripThinking as cat`) được theo dõi theo TÊN CỤC BỘ", () => {
    const nguon = `
import { stripThinking as cat } from "./ai/thinkingStrip";
import { generateText } from "./aiGgufEngine";
export async function traLoi(p: string) {
  const r = await generateText({ prompt: p });
  return cat(r.text).answer;
}
`;
    const sf = cay("server/services/gia20.ts", nguon);
    let nut: ts.Node = sf;
    diKhap(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "generateText") {
        nut = hamBao(sf, n).nut;
      }
    });
    expect(hamCoBoCat(sf, nut)).toBe(true);
  });

  it("vị từ §2 CÔNG NHẬN một hop (handler → lớp chủ phát giữ bộ cắt)", () => {
    const nguon = `
import { StreamingThinkingStripper } from "../services/ai/thinkingStrip";
import { generateTextStream } from "../services/aiGgufEngine";
class OngPhat {
  private readonly cat = new StreamingThinkingStripper();
  phat(t: string) { return this.cat.push(t); }
}
export function dangKy(app: any) {
  app.post("/api/x", async (req: any, res: any) => {
    const p = new OngPhat();
    for await (const c of generateTextStream({ prompt: "x" })) res.write(p.phat(String(c)));
  });
}
`;
    const sf = cay("server/routes/motHop.ts", nguon);
    let nut: ts.Node = sf;
    diKhap(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "generateTextStream") {
        nut = hamBao(sf, n).nut;
      }
    });
    expect(hamCoBoCat(sf, nut)).toBe(true);
    // …và ĐỎ khi lớp chủ phát KHÔNG giữ bộ cắt (đột biến: gỡ bộ cắt khỏi lớp).
    const nguonGo = nguon.replace("private readonly cat = new StreamingThinkingStripper();", "private readonly cat = { push: (t: string) => t };");
    const sf2 = cay("server/routes/motHop2.ts", nguonGo);
    let nut2: ts.Node = sf2;
    diKhap(sf2, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "generateTextStream") {
        nut2 = hamBao(sf2, n).nut;
      }
    });
    expect(hamCoBoCat(sf2, nut2)).toBe(false);
  });
});
