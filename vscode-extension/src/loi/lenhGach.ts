/**
 * ★★★ ĐỢT 4B — LỆNH GẠCH (slash) của khung chat agent (THUẦN): `/fix` · `/test` · `/explain` · `/commit`.
 * Mỗi lệnh chỉ DỰNG CÂU HỎI (tiếng Anh cho model, kèm dữ liệu ngữ cảnh đã che bí mật ở tầng I/O) + chọn chế độ.
 * Không lệnh nào tự ghi hay tự chạy gì: mọi hành động vẫn đi qua cửa duyệt của bộ thực thi.
 * ⚠ `/commit` CHỈ sinh thông điệp commit từ `git diff --staged` — extension KHÔNG BAO GIỜ tự commit.
 */
import type { CheDoAgent } from "../../../shared/agentCore/index";

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
  /** Chẩn đoán của tệp đang mở, đã định dạng (`dinhDangChanDoan`). */
  chanDoan?: string;
  soLoi?: number;
  /** `git diff --staged` đã che bí mật + cắt. */
  diffStaged?: string;
}

export type CauHoiLenhGach = { ok: true; cauHoi: string; cheDo: CheDoAgent } | { ok: false; loi: string };

const nangLenSua = (c: CheDoAgent): CheDoAgent => (c === "hoi" ? "sua" : c);
const kem = (them: string) => (them ? `\n\nAdditional instructions from the user: ${them}` : "");

export function dungCauHoiLenhGach(l: { ten: TenLenhGach; them: string }, n: NguCanhLenhGach): CauHoiLenhGach {
  const vung = n.vungChon
    ? `\n\nSelected code (${n.tepDangMo}, lines ${n.vungChon.dongDau}-${n.vungChon.dongCuoi}):\n\`\`\`\n${n.vungChon.noiDung}\n\`\`\``
    : "";
  switch (l.ten) {
    case "fix":
      if (!n.tepDangMo) return { ok: false, loi: "/fix cần một tệp đang mở trong editor." };
      if (!n.soLoi) return { ok: false, loi: `VSCode không báo lỗi/cảnh báo nào cho "${n.tepDangMo}" — /fix không có gì để sửa.` };
      return {
        ok: true,
        cheDo: nangLenSua(n.cheDoChon),
        cauHoi:
          `Fix the problems VSCode reports in ${n.tepDangMo}. Read the file first, make the smallest correct change, then call ` +
          `get_diagnostics on the file to verify the problems are gone (and that you introduced no new ones).\n\nProblems:\n${n.chanDoan}` +
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
    case "commit":
      if (!n.diffStaged || !n.diffStaged.trim())
        return { ok: false, loi: "Chưa có thay đổi nào được stage (git diff --staged rỗng) — hãy `git add` trước rồi chạy /commit." };
      return {
        ok: true,
        cheDo: "hoi",
        cauHoi:
          `Write a git commit message for the staged changes below. Output ONLY the message inside one \`\`\`text code block: a ` +
          `subject line of at most 72 characters in the imperative mood, a blank line, then a short body explaining what and why. ` +
          `Match the language and style the user writes in. Do not run commands and do not commit — the user commits themselves.` +
          kem(l.them) +
          `\n\nStaged diff:\n\`\`\`diff\n${n.diffStaged}\n\`\`\``,
      };
  }
}
