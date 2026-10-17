/**
 * ★★★ ĐỢT 4C — LOGIC THUẦN của ghost-text (gợi ý chữ mờ kiểu Copilot, `InlineCompletionItemProvider`).
 *
 * Không `vscode`, không mạng — để đo thẳng bốn bất biến:
 *   1. ngữ cảnh rời máy có TRẦN thật (tiền tố/hậu tố quanh con trỏ), cắt theo NGUYÊN DÒNG;
 *   2. tệp cấm (`.env`, khoá riêng, `.git`, ngoài workspace, quá lớn, không phải tệp đĩa) KHÔNG gửi byte nào —
 *      dùng ĐÚNG vị từ `duocPhepRoiMay` của mọi đường rời máy khác (không danh sách thứ hai);
 *   3. bí mật bị che bằng ĐÚNG bộ che `cheBiMat` trước khi rời máy;
 *   4. gợi ý được cắt tại ranh giới hợp lý: hết dòng (giữa dòng) / hết khối (cuối dòng), không chép lại hậu tố,
 *      không mang dấu che vào tệp (model chỉ thấy bản đã che — chèn nó vào là ghi rác lên mã thật).
 *
 * Bộ đo FIM (`scripts/ai-eval/fim/`) nhập CHÍNH các hàm này để con số đo là con số người dùng thấy.
 */
import { cheBiMat, duocPhepRoiMay } from "./nguCanh";
import { dauCheMoi } from "./chanDaChe";

/** Trần ký tự tiền tố (trước con trỏ) gửi đi. ~600 token — đủ ngữ cảnh cục bộ, vẫn nhanh trên model 1,5B. */
export const TRAN_TIEN_TO = 2_000;
/** Trần ký tự hậu tố (sau con trỏ) gửi đi. */
export const TRAN_HAU_TO = 800;
/** Tệp dài hơn số ký tự này ⇒ không gợi ý (tệp sinh ra / dữ liệu, không phải mã người viết). */
export const TRAN_KY_TU_TEP = 1_000_000;
/** Trần số dòng của MỘT gợi ý nhiều dòng. */
export const TRAN_DONG_GOI_Y = 8;
/** Trần token sinh: giữa dòng chỉ cần hết dòng; cuối dòng có thể là một khối. */
export const TRAN_TOKEN_MOT_DONG = 48;
export const TRAN_TOKEN_NHIEU_DONG = 128;

export interface TranNguCanh {
  tienTo: number;
  hauTo: number;
}

/**
 * Tiền tố/hậu tố quanh vị trí `viTri` (offset ký tự). Bị cắt ⇒ tiền tố bắt đầu ĐẦU DÒNG, hậu tố kết thúc sau một
 * `\n` (nửa dòng ở mép làm model đoán sai cú pháp). Không có `\n` nào trong lát cắt ⇒ giữ nguyên lát (vẫn ≤ trần).
 */
export function catNguCanh(
  vanBan: string,
  viTri: number,
  tran: TranNguCanh = { tienTo: TRAN_TIEN_TO, hauTo: TRAN_HAU_TO },
): { tienTo: string; hauTo: string } {
  const p = Math.max(0, Math.min(viTri, vanBan.length));
  const dau = Math.max(0, p - tran.tienTo);
  let tienTo = vanBan.slice(dau, p);
  if (dau > 0 && vanBan[dau - 1] !== "\n") {
    const nl = tienTo.indexOf("\n");
    if (nl >= 0) tienTo = tienTo.slice(nl + 1);
  }
  const cuoi = Math.min(vanBan.length, p + tran.hauTo);
  let hauTo = vanBan.slice(p, cuoi);
  if (cuoi < vanBan.length && !hauTo.endsWith("\n")) {
    const nl = hauTo.lastIndexOf("\n");
    if (nl >= 0) hauTo = hauTo.slice(0, nl + 1);
  }
  return { tienTo, hauTo };
}

export interface DauVaoBoQua {
  /** Đường tuyệt đối trên đĩa. */
  duong: string;
  /** `uri.scheme` của tài liệu. */
  scheme: string;
  /** Tệp có nằm trong một thư mục workspace đang mở không. */
  trongWorkspace: boolean;
  /** Độ dài tài liệu (ký tự). */
  soKyTu: number;
  tranKyTu?: number;
}

/** Lý do KHÔNG gợi ý (và KHÔNG gửi byte nào) cho tài liệu này; `undefined` ⇒ được gợi ý. */
export function lyDoBoQua(dv: DauVaoBoQua): string | undefined {
  if (dv.scheme !== "file") return `không phải tệp trên đĩa (scheme "${dv.scheme}")`;
  if (!dv.trongWorkspace) return "tệp ngoài workspace";
  if (!duocPhepRoiMay(dv.duong)) return "tệp nhạy cảm (.env / khoá riêng / .git)";
  if (dv.soKyTu > (dv.tranKyTu ?? TRAN_KY_TU_TEP)) return "tệp quá lớn";
  return undefined;
}

/**
 * Chỉ gợi ý tới HẾT DÒNG khi dòng con trỏ đã có chữ — trước con trỏ (đang gõ dở) hoặc sau con trỏ (giữa dòng).
 * Chỉ dòng TRỐNG (thụt lề thuần) mới được gợi ý cả khối — luật "nhiều dòng chỉ trên dòng trống" quen thuộc của
 * Copilot/Continue. Đo trên bộ FIM 2026-10-17: thiếu luật này, mẫu gõ-dở-cuối-dòng có dòng đầu ĐÚNG nhưng bị kéo
 * thêm dòng sau ⇒ chèn mã thừa.
 */
export function laCheDoMotDong(tienTo: string, hauTo: string): boolean {
  const nl = hauTo.indexOf("\n");
  const sau = nl >= 0 ? hauTo.slice(0, nl) : hauTo;
  const truoc = tienTo.slice(tienTo.lastIndexOf("\n") + 1);
  return sau.trim() !== "" || truoc.trim() !== "";
}

export interface ThanYeuCauFim {
  model: string;
  prompt: string;
  suffix: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  stream: false;
  /** Cổng 4C-server chuyển `stop` (≤ 4 × ≤ 64 ký tự) xuống `generateFim`; máy chủ cũ bỏ qua ⇒ extension vẫn tự cắt
   *  bằng `catGoiY`. */
  stop: string[];
}

/**
 * Thân `POST /v1/completions`. ⚠ `model: "fim"` LUÔN tường minh: cổng chọn `fim` chỉ khi `suffix` khác rỗng — ở
 * CUỐI tệp hậu tố rỗng sẽ rơi sang model `code` (model lớn trên llama-server một slot) nếu không khai.
 */
export function dungThanYeuCauFim(dv: { tienTo: string; hauTo: string; motDong: boolean; model?: string }): ThanYeuCauFim {
  return {
    model: dv.model ?? "fim",
    prompt: cheBiMat(dv.tienTo),
    suffix: cheBiMat(dv.hauTo),
    max_tokens: dv.motDong ? TRAN_TOKEN_MOT_DONG : TRAN_TOKEN_NHIEU_DONG,
    temperature: 0,
    top_p: 1,
    stream: false,
    stop: dv.motDong ? ["\n"] : ["\n\n"],
  };
}

const SENTINEL = /<\|(?:endoftext|fim_prefix|fim_suffix|fim_middle|fim_pad|file_sep|repo_name|im_end|im_start)\|>/;
/** Ký tự "đóng" mà trình soạn thảo thường đã tự chèn sau con trỏ. */
const KY_TU_DONG = /^[)\]}>"'`;,]+$/;

function thutLe(dong: string): number {
  return dong.length - dong.trimStart().length;
}

export interface DauVaoCatGoiY {
  tienTo: string;
  hauTo: string;
  motDong: boolean;
  tranDong?: number;
}

/**
 * Cắt chữ thô của model thành gợi ý hiển thị. Trả `""` ⇒ không gợi ý.
 *
 * Luật (theo thứ tự): dấu che ⇒ bỏ hẳn · sentinel FIM ⇒ cắt · CRLF ⇒ `\n` · một dòng ⇒ dòng đầu, gọt phần đóng đã
 * có sau con trỏ · nhiều dòng ⇒ dừng ở dòng trống, ở dòng chép lại dòng đầu của hậu tố, ở dòng thụt lề LÙI quá dòng
 * con trỏ (hết khối), ở trần số dòng · gợi ý chỉ chép lại đầu hậu tố ⇒ rỗng.
 */
export function catGoiY(tho: string, dv: DauVaoCatGoiY): string {
  if (!tho) return "";
  if (dauCheMoi("", tho).length > 0) return "";
  let s = tho.replace(/\r\n?/g, "\n");
  const m = SENTINEL.exec(s);
  if (m) s = s.slice(0, m.index);
  const hauTo = dv.hauTo.replace(/\r\n?/g, "\n");
  const nlHau = hauTo.indexOf("\n");
  const conLaiDong = (nlHau >= 0 ? hauTo.slice(0, nlHau) : hauTo).trim();

  let ra: string;
  if (dv.motDong) {
    let dong = s.split("\n")[0].trimEnd();
    if (conLaiDong) {
      if (dong.endsWith(conLaiDong)) dong = dong.slice(0, dong.length - conLaiDong.length);
      else {
        for (let k = Math.min(conLaiDong.length, dong.length); k >= 1; k--) {
          const dauHau = conLaiDong.slice(0, k);
          if (KY_TU_DONG.test(dauHau) && dong.endsWith(dauHau)) {
            dong = dong.slice(0, dong.length - k);
            break;
          }
        }
      }
    }
    ra = dong.trimEnd();
  } else {
    const dongTienTo = dv.tienTo.replace(/\r\n?/g, "\n").split("\n").pop() ?? "";
    const thutLeGoc = thutLe(dongTienTo);
    const dongHauDau = hauTo
      .split("\n")
      .map((x) => x.trim())
      .find((x) => x !== "");
    const tran = dv.tranDong ?? TRAN_DONG_GOI_Y;
    const giu: string[] = [];
    for (const [i, dong] of s.split("\n").entries()) {
      if (i > 0) {
        if (dong.trim() === "") break;
        if (dongHauDau && dong.trim() === dongHauDau) break;
        if (thutLe(dong) < thutLeGoc) break;
      }
      giu.push(dong.trimEnd());
      if (giu.length >= tran) break;
    }
    while (giu.length > 0 && giu[giu.length - 1].trim() === "") giu.pop();
    ra = giu.join("\n");
  }
  if (ra.trim() === "") return "";
  const dauHau = hauTo.trimStart();
  if (dauHau && dauHau.startsWith(ra.trim())) return "";
  return ra;
}
