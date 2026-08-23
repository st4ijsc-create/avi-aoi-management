/**
 * G2-D — APPLY-DIFF THEO TỪNG KHỐI (hunk). Logic THUẦN, không React, không CodeMirror.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ FILE NÀY
 * ══════════════════════════════════════════════════════════════════════════════════
 * Trước bản vá, áp một gợi ý của Copilot là chuyện ĂN CẢ HOẶC BỎ CẢ: `onApply(resultCode)`
 * ghi trọn kết quả vào buffer. Người dùng nhận 200 dòng chỉ để sửa 3 dòng. File này tách
 * diff SẴN CÓ (`computeLineDiff` trong components/diff/LineDiff.tsx — KHÔNG viết thuật
 * toán diff thứ hai) thành các KHỐI độc lập, nhận/bỏ được từng khối.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * HAI QUYẾT ĐỊNH THIẾT KẾ QUAN TRỌNG — ĐỌC TRƯỚC KHI SỬA
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * (1) `split("\n")` / `join("\n")` là SONG ÁNH TUYỆT ĐỐI.
 *     `t.split("\n").join("\n") === t` với MỌI chuỗi t. Nó giữ nguyên:
 *       · ký tự `\r` của CRLF (nằm ở CUỐI mỗi phần tử dòng),
 *       · dòng rỗng cuối cùng do newline cuối file sinh ra,
 *       · mọi khoảng trắng đầu/cuối dòng.
 *     Vì thế mô hình "mảng dòng" ở đây KHÔNG mất một byte nào, và không có bước
 *     chuẩn hoá ngầm nào được phép chen vào. Đó là điều làm cho bất biến
 *     `projectHunks(plan, MỌI id).text === plan.modified` đúng TỪNG KÝ TỰ.
 *     ⚠ Đừng "dọn dẹp" bằng `.trim()`, `.trimEnd()` hay `split(/\r?\n/)` ở bất kỳ đâu
 *       trong file này — mỗi cái đều là một lượt nuốt mã của người dùng.
 *
 * (2) Áp khối là PHÉP CHIẾU TỪ BẢN GỐC, không phải phép sửa tại chỗ.
 *     `projectHunks(plan, tậpChọn)` luôn dựng lại chuỗi bằng MỘT lượt duyệt bản gốc:
 *       [dòng chưa đụng] + [dòng thêm của khối] + [dòng chưa đụng] + …
 *     Nhờ vậy "dịch chuyển offset" — chỗ dễ sai nhất của apply-diff — bị TRIỆT TIÊU
 *     theo cấu tạo chứ không phải được tính đúng: không có toạ độ nào bị viết lại sau
 *     mỗi lần áp, nên không có gì để lệch. Hệ quả kèm theo, đều là thật:
 *       · thứ tự chọn khối KHÔNG ảnh hưởng kết quả (#2 rồi #5 ≡ #5 rồi #2),
 *       · HOÀN TÁC = bỏ id khỏi tập rồi chiếu lại — không tích luỹ sai số,
 *       · áp mọi khối cho ra ĐÚNG bản `modified`, đó là ca chống hồi quy với đường cũ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * AN TOÀN DỮ LIỆU — buffer đổi giữa chừng
 * ══════════════════════════════════════════════════════════════════════════════════
 * Một `HunkPlan` gắn chặt với chuỗi `original` mà nó được tính ra. Nếu người dùng gõ
 * thêm vào editor sau khi gợi ý hiện lên, mọi khối đều nói về một văn bản KHÔNG CÒN
 * TỒN TẠI. `applyHunkSelection` vì thế đòi cả buffer sống lẫn tập khối "đang được coi
 * là đã áp", và TỪ CHỐI (`reason: "buffer-changed"`) nếu hai thứ không khớp từng ký tự.
 * Kết quả từ chối KHÔNG mang trường `text` — không có gì để lỡ tay ghi ra.
 */
import { computeLineDiff } from "@/components/diff/LineDiff";

export type Eol = "\r\n" | "\n";

/** Một khối thay đổi liền mạch: xoá `removed`, chèn `added` tại `[origStart, origEnd)`. */
export interface DiffHunk {
  /** Định danh ỔN ĐỊNH: cùng (original, modified) ⇒ cùng id. Dùng làm khoá React + khoá chọn. */
  id: string;
  /** Thứ tự trong plan, 0-based (khối #0 là khối trên cùng). */
  index: number;
  /** Chỉ số dòng 0-based trong `original.split("\n")`, bao gồm. */
  origStart: number;
  /** Chỉ số dòng 0-based trong `original.split("\n")`, KHÔNG bao gồm. Bằng origStart ⇒ khối chỉ-thêm. */
  origEnd: number;
  /** Chỉ số dòng 0-based trong `modified.split("\n")`, bao gồm. */
  modStart: number;
  /** Chỉ số dòng 0-based trong `modified.split("\n")`, KHÔNG bao gồm. */
  modEnd: number;
  /** Các dòng bị xoá (nguyên văn, còn cả `\r` nếu file dùng CRLF). */
  removed: string[];
  /** Các dòng được chèn vào (nguyên văn). */
  added: string[];
}

export interface HunkPlan {
  /** Bản gốc mà mọi toạ độ khối nói về. Đây LÀ hợp đồng an toàn — đừng thay nó. */
  original: string;
  /** Bản đích HIỆU LỰC (sau khi khớp EOL nếu có yêu cầu). `projectHunks(mọi id)` bằng đúng chuỗi này. */
  modified: string;
  hunks: DiffHunk[];
  /** Chữ ký ngắn của `original` — để hiển thị/nhật ký, KHÔNG phải phép kiểm an toàn. */
  baseSignature: string;
  /** `modified` đã bị đổi kiểu xuống dòng cho khớp `original` hay chưa. */
  eolMatched: boolean;
  /** File vượt ngưỡng LCS ⇒ chỉ có MỘT khối cả-file (cầu chì chống treo trình duyệt). */
  oversize: boolean;
}

export interface ComputeHunkOptions {
  /**
   * Kéo `modified` về đúng kiểu xuống dòng của `original` TRƯỚC khi so.
   * Không bật: model trả LF cho một buffer CRLF ⇒ mọi dòng đều "khác" ⇒ một khối nuốt cả file.
   * Đó là kết quả TRUNG THỰC nhưng vô dụng — nên UI bật cờ này khi phát hiện lệch EOL,
   * và khi đó `plan.modified` (chứ không phải chuỗi model trả) mới là cái sẽ được ghi.
   */
  matchEol?: boolean;
  /** Ngưỡng số dòng cho phép chạy LCS O(n·m). Vượt ⇒ một khối cả-file. */
  maxLines?: number;
}

export type ProjectResult =
  | { ok: true; text: string; appliedIds: string[] }
  | { ok: false; reason: "unknown-hunk"; id: string };

export type HunkApplyResult =
  | { ok: true; text: string; appliedIds: string[] }
  | { ok: false; reason: "unknown-hunk"; id: string }
  | { ok: false; reason: "buffer-changed"; expected: string; actual: string };

/**
 * Ngưỡng mặc định. `computeLineDiff` dựng bảng LCS (n+1)×(m+1) — 1500×1500 ≈ 2,25 triệu ô
 * là mức còn chạy tức thì trên luồng UI; gấp đôi con số này bắt đầu thấy giật.
 */
export const DEFAULT_MAX_DIFF_LINES = 1500;

/** djb2 → base36. Chỉ dùng cho ĐỊNH DANH và CHỮ KÝ HIỂN THỊ, không dùng để so an toàn. */
function hash32(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Chữ ký ngắn của một văn bản: `<độ dài>.<hash>`. Dùng để BÁO CÁO lệch (nhật ký, thông
 * báo) mà không rò nội dung mã ra ngoài. Phép kiểm an toàn thật vẫn là so chuỗi đầy đủ.
 */
export function textSignature(text: string): string {
  return `${text.length}.${hash32(text)}`;
}

/** Kiểu xuống dòng ÁP ĐẢO của một văn bản. Không có newline nào ⇒ "\n". */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lf++;
      if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    }
  }
  if (crlf === 0) return "\n";
  return crlf * 2 >= lf ? "\r\n" : "\n";
}

/** Đổi mọi xuống dòng về `eol`. Đi qua LF trước nên KHÔNG nhân đôi `\r`. */
export function normalizeEol(text: string, eol: Eol): string {
  const lf = text.replace(/\r\n/g, "\n");
  return eol === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf;
}

function makeHunk(
  index: number,
  origStart: number,
  origEnd: number,
  modStart: number,
  modEnd: number,
  removed: string[],
  added: string[],
): DiffHunk {
  // Băm gồm CẢ hai độ dài: không có dấu ngăn nào thì {removed:["ab"],added:[]} và
  // {removed:[],added:["ab"]} sẽ băm ra cùng một id. File nguồn giữ thuần ASCII.
  const sig = hash32(
    [origStart, removed.length, added.length, ...removed, ...added].join("|"),
  );
  return {
    id: `h${origStart}_${origEnd}_${modStart}.${sig}`,
    index,
    origStart,
    origEnd,
    modStart,
    modEnd,
    removed,
    added,
  };
}

/**
 * Tách diff giữa `original` và `modified` thành các khối độc lập.
 * KHÔNG tự viết diff — dùng `computeLineDiff` (LCS) đã có, chỉ GOM các hàng
 * del/add liền nhau thành khối và quy đổi sang toạ độ dòng hai phía.
 */
export function computeHunkPlan(
  original: string,
  modified: string,
  opts: ComputeHunkOptions = {},
): HunkPlan {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_DIFF_LINES;
  const target = opts.matchEol ? normalizeEol(modified, detectEol(original)) : modified;
  const base = {
    original,
    modified: target,
    baseSignature: textSignature(original),
    eolMatched: target !== modified,
  };

  if (original === target) return { ...base, hunks: [], oversize: false };

  const aLines = original.split("\n");
  const bLines = target.split("\n");

  /**
   * ══════════════════════════════════════════════════════════════════════════════════
   * ★★★ doc 79 (2026-08-21) — CẮT ĐẦU/ĐUÔI GIỐNG NHAU **TRƯỚC** KHI ĐỤNG TỚI LCS
   * ══════════════════════════════════════════════════════════════════════════════════
   * Lý do là một PHÉP ĐO, không phải tối ưu vu vơ. Với `DEFAULT_MAX_DIFF_LINES = 1500`,
   * một tệp **1.602 dòng** (≈28 KB — nhỏ hơn cả trần cũ của tác nhân sửa tệp) đổi ĐÚNG
   * MỘT DÒNG cho ra `oversize:true` và thẻ duyệt hiện **+1602 / −1602**. Tức người duyệt
   * được mời bấm "Duyệt & ghi" trên một diff nói rằng CẢ TỆP vừa bị thay — đúng thứ hàng
   * rào "người duyệt" sinh ra để chặn, bị vô hiệu hoá bằng nhiễu.
   *
   * Dòng giống nhau ở ĐẦU và ở ĐUÔI **không thể** thuộc bất kỳ khối diff nào, nên cắt
   * chúng đi là một phép biến đổi BẢO TOÀN kết quả, không phải một phép xấp xỉ. Sau khi
   * cắt, một lượt sửa có đích trên tệp 2.800 dòng còn lại vài dòng để chạy LCS ⇒ cầu chì
   * kích thước không còn bị chạm, và thẻ duyệt hiện đúng "+1 −0".
   *
   * ⚠ Bất biến B1 (`projectHunks(mọi id) === modified`, TỪNG KÝ TỰ) giữ nguyên theo cấu
   *   tạo: toạ độ khối được dời lại đúng bằng `dau`, và phần bị cắt là phần GIỐNG HỆT ở
   *   cả hai bên nên nó không đổi một byte dù có được chiếu hay không.
   * ⚠ Cầu chì KHÔNG bị bỏ — nó chỉ được đo trên PHẦN LÕI, tức đúng phần LCS phải chạy.
   */
  let dau = 0;
  const chung = Math.min(aLines.length, bLines.length);
  while (dau < chung && aLines[dau] === bLines[dau]) dau++;
  let duoi = 0;
  while (
    duoi < chung - dau &&
    aLines[aLines.length - 1 - duoi] === bLines[bLines.length - 1 - duoi]
  ) {
    duoi++;
  }
  const aLoi = aLines.slice(dau, aLines.length - duoi);
  const bLoi = bLines.slice(dau, bLines.length - duoi);
  const loiOrigEnd = aLines.length - duoi;
  const loiModEnd = bLines.length - duoi;

  if (aLoi.length > maxLines || bLoi.length > maxLines) {
    // Cầu chì: một khối duy nhất phủ PHẦN LÕI. Bất biến B1 vẫn giữ (áp khối đó ⇒ modified),
    // chỉ mất khả năng chọn lẻ — và nói thẳng điều đó qua cờ `oversize`.
    return {
      ...base,
      oversize: true,
      hunks: [makeHunk(0, dau, loiOrigEnd, dau, loiModEnd, aLoi, bLoi)],
    };
  }

  /**
   * Lõi rỗng một bên ⇒ thuần CHÈN hoặc thuần XOÁ; LCS không có gì để tìm.
   * ⚠ Và phải chặn ở đây chứ không để rơi xuống: `[].join("\n")` cho `""`, mà `""` split ra
   *   **một dòng rỗng** — tức một mảng 0 dòng sẽ hoá thành 1 dòng và diff lệch đi một dòng ma.
   */
  if (aLoi.length === 0 || bLoi.length === 0) {
    return { ...base, oversize: false, hunks: [makeHunk(0, dau, loiOrigEnd, dau, loiModEnd, aLoi, bLoi)] };
  }

  const rows = computeLineDiff(aLoi.join("\n"), bLoi.join("\n"));
  const hunks: DiffHunk[] = [];
  let ai = dau;
  let bi = dau;
  let cur: { origStart: number; modStart: number; removed: string[]; added: string[] } | null = null;

  const flush = () => {
    if (!cur) return;
    hunks.push(makeHunk(hunks.length, cur.origStart, ai, cur.modStart, bi, cur.removed, cur.added));
    cur = null;
  };

  for (const r of rows) {
    if (r.kind === "same") {
      flush();
      ai++;
      bi++;
      continue;
    }
    if (!cur) cur = { origStart: ai, modStart: bi, removed: [], added: [] };
    if (r.kind === "del") {
      cur.removed.push(r.text);
      ai++;
    } else {
      cur.added.push(r.text);
      bi++;
    }
  }
  flush();

  return { ...base, hunks, oversize: false };
}

/**
 * Chiếu một TẬP khối đã chọn lên bản gốc → văn bản kết quả.
 *
 * Một lượt duyệt duy nhất, không sửa tại chỗ ⇒ không có phép dịch offset nào để làm sai,
 * và thứ tự các id trong `selectedIds` KHÔNG ảnh hưởng kết quả.
 * `selectedIds` rỗng ⇒ trả về đúng bản gốc.
 */
export function projectHunks(plan: HunkPlan, selectedIds: Iterable<string>): ProjectResult {
  const wanted = new Set(selectedIds);
  const byId = new Map(plan.hunks.map((h) => [h.id, h]));
  for (const id of wanted) {
    if (!byId.has(id)) return { ok: false, reason: "unknown-hunk", id };
  }

  // plan.hunks đã tăng dần theo origStart — lọc giữ nguyên thứ tự đó.
  const chosen = plan.hunks.filter((h) => wanted.has(h.id));
  const lines = plan.original.split("\n");
  const out: string[] = [];
  let cursor = 0;
  for (const h of chosen) {
    for (let i = cursor; i < h.origStart; i++) out.push(lines[i]);
    for (const l of h.added) out.push(l);
    cursor = h.origEnd; // ⚠ toạ độ GỐC, không phải toạ độ đã dịch — xem chú thích đầu file.
  }
  for (let i = cursor; i < lines.length; i++) out.push(lines[i]);

  return { ok: true, text: out.join("\n"), appliedIds: chosen.map((h) => h.id) };
}

/** Áp mọi khối — bằng đúng `plan.modified`, từng ký tự. Là "áp tất cả" của đường cũ. */
export function applyAllHunks(plan: HunkPlan): string {
  const r = projectHunks(plan, plan.hunks.map((h) => h.id));
  /* c8 ignore next */
  return r.ok ? r.text : plan.modified;
}

export interface ApplyHunkSelectionArgs {
  plan: HunkPlan;
  /** Tập khối mà phía gọi TIN rằng đang được phản ánh trong `currentText`. */
  applied: Iterable<string>;
  /** Tập khối muốn có sau lượt này (bật thêm = nhận, bỏ bớt = hoàn tác). */
  next: Iterable<string>;
  /** Buffer SỐNG ngay lúc này. */
  currentText: string;
}

/**
 * Cổng an toàn của toàn bộ tính năng.
 *
 * Cho phép ghi CHỈ KHI buffer sống bằng ĐÚNG cái mà `applied` chiếu ra — tức là
 * "buffer đang chứa đúng thứ lượt trước ta ghi (hoặc bản gốc nếu chưa ghi gì)".
 * Người dùng gõ thêm một ký tự, đổi một khoảng trắng, hay đổi kiểu xuống dòng ⇒ LỆCH ⇒
 * TỪ CHỐI. Nhánh từ chối không mang `text`: không có đường nào để ghi đè nhầm.
 */
export function applyHunkSelection({
  plan,
  applied,
  next,
  currentText,
}: ApplyHunkSelectionArgs): HunkApplyResult {
  const expected = projectHunks(plan, applied);
  if (!expected.ok) return expected;

  const wanted = projectHunks(plan, next);
  if (!wanted.ok) return wanted;

  if (currentText !== expected.text) {
    return {
      ok: false,
      reason: "buffer-changed",
      expected: textSignature(expected.text),
      actual: textSignature(currentText),
    };
  }
  return wanted;
}

// ══════════════════════════════════════════════════════════════════════════════════
// ★★★ ĐỢT 3 (2026-08-23) — DUYỆT THEO KHỐI **THẬT**: bộ vị từ dùng CHUNG client ↔ server
// ══════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ KẾ HOẠCH KHỐI **CHUẨN** cho cửa duyệt HITL (`apply_diff`) — client VÀ server cùng gọi.
 *
 * Vì sao phải có MỘT hàm đứng tên: lựa chọn khối đi qua dây mạng **CHỈ BẰNG SỐ THỨ TỰ**
 * (`selectedHunkIds: number[]`) — client KHÔNG BAO GIỜ gửi byte nội dung (nguyên tắc gốc của HITL:
 * *"execute() args come from ai_pending_actions.argsJson, not the request"*). Muốn số thứ tự có
 * nghĩa thì hai đầu dây phải dựng **CÙNG MỘT** kế hoạch khối từ cùng (original, modified) — tức là
 * mọi tuỳ chọn của `computeHunkPlan` phải là **HÀM TẤT ĐỊNH của chính hai chuỗi ấy**, không phải
 * một cái checkbox ai đó bấm ở một phía.
 *
 * Luật EOL vì thế bị GHIM: `matchEol` ⇔ hai chuỗi có kiểu xuống dòng ÁP ĐẢO khác nhau — đúng giá
 * trị mặc định mà `HunkDiffView` tự bật khi phát hiện lệch. Hệ quả nói thẳng:
 *   • không lệch EOL ⇒ `plan.modified === modified` nguyên văn ⇒ chọn đủ khối ≡ đường cũ, từng byte;
 *   • lệch EOL ⇒ `plan.modified` là bản đã khớp EOL theo `original` — đó CHÍNH là cái người duyệt
 *     nhìn thấy trong thẻ (thẻ cũng chiếu từ kế hoạch này), nên byte được ghi = byte được duyệt.
 * ⚠ Đổi luật này ở MỘT phía (hay thêm tham số tuỳ chọn cho nó) là tách đôi kế hoạch giữa hai đầu
 *   dây — số thứ tự khối khi ấy trỏ vào khối SAI mà không ai báo lỗi.
 */
export function keHoachKhoiDuyet(original: string, modified: string): HunkPlan {
  return computeHunkPlan(original, modified, { matchEol: detectEol(original) !== detectEol(modified) });
}

export type KetQuaChieuChiSo =
  | { ok: true; text: string; chiSo: number[]; tong: number }
  | { ok: false; ma: "HUNK_IDS_INVALID" | "NO_HUNKS_SELECTED"; chiTiet: string };

/**
 * ★★★ XÁC THỰC + CHIẾU một tập **CHỈ SỐ khối** (0-based, theo `plan.hunks`) — vị từ mà server dùng
 * để biến `selectedHunkIds` của request thành byte sẽ ghi. MỘT bản duy nhất, thuần, không I/O.
 *
 * Luật từ chối — **có mã, không âm thầm lọc** (một client độc hại gửi id lạ phải bị NÓI THẲNG là
 * độc hại, không phải được "sửa hộ" thành một lượt ghi khác ý người duyệt):
 *   • rỗng               ⇒ `NO_HUNKS_SELECTED` — "ghi 0 khối" không phải một lượt ghi; ghi một tệp
 *     y nguyên vẫn đổi mtime, đánh thức watcher, đẻ một dòng audit "đã ghi" — ba lời nói dối nhỏ.
 *   • không phải số nguyên / âm / ≥ tổng số khối ⇒ `HUNK_IDS_INVALID`.
 *   • trùng nhau         ⇒ `HUNK_IDS_INVALID` — trùng là dấu client hỏng, không phải "chọn hai lần".
 *
 * Nhánh xanh: chiếu qua `projectHunks` (phép chiếu từ bản gốc — không dịch offset, không phụ thuộc
 * thứ tự), trả `text` đúng TỪNG KÝ TỰ và `chiSo` đã sắp tăng dần để audit đọc được.
 */
export function chieuTheoChiSoKhoi(plan: HunkPlan, chiSoTho: readonly unknown[]): KetQuaChieuChiSo {
  if (!Array.isArray(chiSoTho)) {
    return { ok: false, ma: "HUNK_IDS_INVALID", chiTiet: "selectedHunkIds không phải mảng" };
  }
  if (chiSoTho.length === 0) {
    return { ok: false, ma: "NO_HUNKS_SELECTED", chiTiet: "0 khối được chọn" };
  }
  const tong = plan.hunks.length;
  const thay = new Set<number>();
  for (const raw of chiSoTho) {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw >= tong) {
      return { ok: false, ma: "HUNK_IDS_INVALID", chiTiet: `chỉ số ${String(raw)} ∉ [0, ${tong})` };
    }
    if (thay.has(raw)) {
      return { ok: false, ma: "HUNK_IDS_INVALID", chiTiet: `chỉ số ${raw} bị lặp` };
    }
    thay.add(raw);
  }
  const chiSo = [...thay].sort((a, b) => a - b);
  const r = projectHunks(plan, chiSo.map((i) => plan.hunks[i].id));
  /* c8 ignore next — id lấy từ CHÍNH plan.hunks nên không thể "unknown-hunk" */
  if (!r.ok) return { ok: false, ma: "HUNK_IDS_INVALID", chiTiet: r.id };
  return { ok: true, text: r.text, chiSo, tong };
}

/**
 * ★ Phía CLIENT: từ tập id đã chọn trong thẻ duyệt → mảng chỉ số gửi lên server.
 *
 * `null` ⇔ **chọn ĐỦ mọi khối** ⇒ client KHÔNG gửi trường `selectedHunkIds` ⇒ server đi nguyên
 * đường cũ (ghi `argsJson.modified` nguyên văn) — tương thích ngược **từng byte** cho ca thường
 * gặp nhất. Chỉ khi người duyệt BỎ bớt khối thì trường mới xuất hiện trên dây.
 * ⚠ Tập rỗng trả `[]` (không phải null): nút Duyệt phải tự khoá ở 0 khối, nhưng hàm này không được
 *   "lịch sự hộ" — nếu một đường gọi vẫn gửi `[]`, server từ chối `NO_HUNKS_SELECTED` đúng thiết kế.
 */
export function chiSoGuiLenServer(plan: HunkPlan, daChon: Iterable<string>): number[] | null {
  const chon = new Set(daChon);
  const chiSo: number[] = [];
  for (let i = 0; i < plan.hunks.length; i++) if (chon.has(plan.hunks[i].id)) chiSo.push(i);
  return chiSo.length === plan.hunks.length ? null : chiSo;
}

/** Đếm dòng thêm/xoá của một khối (nhãn "+n −m"). */
export function hunkStats(h: DiffHunk): { added: number; removed: number } {
  return { added: h.added.length, removed: h.removed.length };
}

/** Tổng dòng thêm/xoá của cả plan. */
export function planStats(plan: HunkPlan): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of plan.hunks) {
    added += h.added.length;
    removed += h.removed.length;
  }
  return { added, removed };
}
