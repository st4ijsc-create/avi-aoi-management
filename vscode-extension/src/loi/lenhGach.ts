/**
 * ★★★ ĐỢT 4B — LỆNH GẠCH (slash) của khung chat agent (THUẦN): `/fix` · `/test` · `/explain` · `/commit`.
 * Mỗi lệnh chỉ DỰNG CÂU HỎI (tiếng Anh cho model, kèm dữ liệu ngữ cảnh đã che bí mật ở tầng I/O) + chọn chế độ.
 * Không lệnh nào tự ghi hay tự chạy gì: mọi hành động vẫn đi qua cửa duyệt của bộ thực thi.
 * ⚠ `/commit` CHỈ sinh thông điệp commit từ `git diff --staged` — extension KHÔNG BAO GIỜ tự commit.
 *
 * ★★★ RÀ BẢO MẬT 9d26ad568 (sensitive-data-exposure): bản đầu nối THẲNG vùng chọn, chẩn đoán, phần thêm của người dùng
 * vào câu hỏi (đường câu hỏi thường `dungCauHoiAgent` thì có che — hai đường lệch nhau), và TIN `diffStaged` "đã che ở
 * tầng I/O" — tầng I/O chỉ `cheBiMat`, không loại khối của tệp cấm (`.env` lỡ stage ⇒ `GITHUB_PAT=ghp_…` rời máy
 * nguyên văn), không trần cho vùng chọn, và không ai được báo. Từ bản vá, HÀM NÀY là CỬA CHÓT của mọi byte lệnh gạch
 * gửi đi: nhận dữ liệu THÔ, tự (1) loại khối tệp cấm khỏi diff (`locDiffTepCam`), (2) `cheBiMat` MỌI phần, (3) cắt
 * theo trần và khai rõ, (4) trả `canhBao` để nơi gọi báo người dùng khi diff có tệp cấm.
 */
import type { CheDoAgent } from "../../../shared/agentCore/index";
import { cheBiMat } from "./nguCanh";
import { locDiffTepCam } from "./locDiffTepCam";

/** Trần ký tự của diff đã stage gửi cho model (sau lọc + che). */
export const TRAN_KY_TU_DIFF_LENH_GACH = 40_000;
/** Trần ký tự của vùng chọn — cùng bậc `TRAN_KY_TU_TEP_DINH_KEM` của đường câu hỏi thường. */
export const TRAN_KY_TU_VUNG_CHON_LENH_GACH = 24_000;
const TRAN_KY_TU_CHAN_DOAN = 12_000;
const TRAN_KY_TU_THEM = 4_000;

function catKhai(s: string, tran: number, nhan: string): string {
  return s.length > tran ? `${s.slice(0, tran)}\n…[${nhan} cut at ${tran} characters]` : s;
}

export const TEN_LENH_GACH = ["fix", "test", "explain", "commit"] as const;
export type TenLenhGach = (typeof TEN_LENH_GACH)[number];

export type KetQuaDocLenhGach = { ten: TenLenhGach; them: string } | { loi: string } | null;

/** `null` = không phải lệnh gạch (câu hỏi thường). Chỉ nhận ở ĐẦU câu. */
export function docLenhGach(cauHoi: string): KetQuaDocLenhGach {
  const m = /^\s*\/([a-zA-Z]+)\b\s*([\s\S]*)$/.exec(cauHoi);
  if (!m) return null;
  const ten = m[1].toLowerCase();
  if ((TEN_LENH_GACH as readonly string[]).includes(ten)) return { ten: ten as TenLenhGach, them: m[2].trim() };
  return { loi: `Lệnh "/${m[1]}" không có. Dùng: /fix · /test · /explain · /commit.` };
}

export interface NguCanhLenhGach {
  cheDoChon: CheDoAgent;
  tepDangMo?: string;
  vungChon?: { dongDau: number; dongCuoi: number; noiDung: string };
  /** Chẩn đoán của tệp đang mở, đã định dạng (`dinhDangChanDoan`) — hàm này vẫn che + cắt LẠI. */
  chanDoan?: string;
  soLoi?: number;
  /** `git diff --staged` THÔ — hàm này tự loại khối tệp cấm, che, cắt (cửa chót). */
  diffStaged?: string;
}

export type CauHoiLenhGach =
  | { ok: true; cauHoi: string; cheDo: CheDoAgent; /** Có ⇒ nơi gọi PHẢI hiện cho người dùng. */ canhBao?: string }
  | { ok: false; loi: string };

const nangLenSua = (c: CheDoAgent): CheDoAgent => (c === "hoi" ? "sua" : c);
const kem = (them: string) =>
  them ? `\n\nAdditional instructions from the user: ${catKhai(cheBiMat(them), TRAN_KY_TU_THEM, "instructions")}` : "";

/** Diff đã stage ⇒ loại khối tệp cấm ⇒ che ⇒ cắt; kèm cảnh báo tiếng Việt cho người dùng nếu có tệp bị loại. */
export function lamSachDiffLenhGach(tho: string): { diff: string; canhBao?: string } {
  const loc = locDiffTepCam(tho);
  const diff = catKhai(cheBiMat(loc.diff), TRAN_KY_TU_DIFF_LENH_GACH, "diff");
  if (loc.tepBiLoai.length === 0) return { diff };
  const ds = loc.tepBiLoai.slice(0, 10).map((p) => `"${cheBiMat(p)}"`).join(", ");
  return {
    diff,
    canhBao:
      `⚠ Phần đã stage có ${loc.tepBiLoai.length} tệp nhạy cảm (${ds}${loc.tepBiLoai.length > 10 ? ", …" : ""}) — nội dung của ` +
      `chúng KHÔNG được gửi cho model. Kiểm tra lại: bạn có thật muốn commit tệp bí mật? (git restore --staged <tệp>)`,
  };
}

export function dungCauHoiLenhGach(l: { ten: TenLenhGach; them: string }, n: NguCanhLenhGach): CauHoiLenhGach {
  const vung = n.vungChon
    ? `\n\nSelected code (${n.tepDangMo}, lines ${n.vungChon.dongDau}-${n.vungChon.dongCuoi}):\n\`\`\`\n${catKhai(
        cheBiMat(n.vungChon.noiDung),
        TRAN_KY_TU_VUNG_CHON_LENH_GACH,
        "selection",
      )}\n\`\`\``
    : "";
  const chanDoan = catKhai(cheBiMat(n.chanDoan ?? ""), TRAN_KY_TU_CHAN_DOAN, "problems");
  switch (l.ten) {
    case "fix":
      if (!n.tepDangMo) return { ok: false, loi: "/fix cần một tệp đang mở trong editor." };
      if (!n.soLoi) return { ok: false, loi: `VSCode không báo lỗi/cảnh báo nào cho "${n.tepDangMo}" — /fix không có gì để sửa.` };
      return {
        ok: true,
        cheDo: nangLenSua(n.cheDoChon),
        cauHoi:
          `Fix the problems VSCode reports in ${n.tepDangMo}. Read the file first, make the smallest correct change, then call ` +
          `get_diagnostics on the file to verify the problems are gone (and that you introduced no new ones).\n\nProblems:\n${chanDoan}` +
          vung +
          kem(l.them),
      };
    case "test":
      if (!n.tepDangMo) return { ok: false, loi: "/test cần một tệp đang mở (bôi đen đoạn mã cần viết test nếu muốn khoanh vùng)." };
      return {
        ok: true,
        cheDo: nangLenSua(n.cheDoChon),
        cauHoi:
          `Write unit tests for ${n.vungChon ? "the selected code" : "the main exported behaviour"} in ${n.tepDangMo}. First find the ` +
          `project's existing tests (find_files) and follow their framework, location and naming conventions. Then run the new tests ` +
          `with an allowed command; if they fail because of the TEST, fix the test; if they reveal a real bug, report it instead of ` +
          `changing the code under test.` +
          vung +
          kem(l.them),
      };
    case "explain":
      if (!n.tepDangMo) return { ok: false, loi: "/explain cần một tệp đang mở (bôi đen đoạn cần giải thích)." };
      return {
        ok: true,
        cheDo: "hoi",
        cauHoi:
          `Explain ${n.vungChon ? "the selected code" : `the file ${n.tepDangMo}`}: what it does, how it fits into the project (look up ` +
          `the callers/definitions you need with find_symbol or grep), and any pitfalls. Do not change anything.` +
          vung +
          kem(l.them),
      };
    case "commit": {
      if (!n.diffStaged || !n.diffStaged.trim())
        return { ok: false, loi: "Chưa có thay đổi nào được stage (git diff --staged rỗng) — hãy `git add` trước rồi chạy /commit." };
      const sach = lamSachDiffLenhGach(n.diffStaged);
      return {
        ok: true,
        cheDo: "hoi",
        ...(sach.canhBao ? { canhBao: sach.canhBao } : {}),
        cauHoi:
          `Write a git commit message for the staged changes below. Output ONLY the message inside one \`\`\`text code block: a ` +
          `subject line of at most 72 characters in the imperative mood, a blank line, then a short body explaining what and why. ` +
          `Match the language and style the user writes in. Do not run commands and do not commit — the user commits themselves.` +
          kem(l.them) +
          `\n\nStaged diff:\n\`\`\`diff\n${sach.diff}\n\`\`\``,
      };
    }
  }
}
