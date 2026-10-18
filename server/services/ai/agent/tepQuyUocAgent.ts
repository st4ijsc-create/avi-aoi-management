/**
 * ★★ Đợt 2 (2026-10-17) — TỆP QUY ƯỚC của dự án cho system prompt của vòng agent (spec Đợt 2 §4).
 *
 * Đọc đúng BỐN đường CỐ ĐỊNH ở gốc dự án — `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursorrules`
 * (quy ước chung của Codex/Claude Code/Copilot/Cursor) — qua CÙNG các tầng hộp cát của `moTepTrongHopCat`:
 *   1. CHÍNH SÁCH (`phanQuyetDuongDan`: thư mục cấm, tên bí mật) — trước mọi `stat`;
 *   2. HỘP CÁT (`confineTargetUnder`: realpath/junction/nlink — junction trỏ ra ngoài gốc bị chặn);
 *   3. fd (`readConfined`, trần byte) ;
 *   4. CHE BÍ MẬT (`redactSecretsOnly`).
 * ⚠ Bỏ DUY NHẤT tầng "đuôi trong danh sách trắng": `.cursorrules` không có đuôi và KHÔNG có trong `TEN_TEP_CHO_PHEP`.
 *   Thêm nó vào danh sách trắng sẽ mở cả `read_file`/GHI cho model và đổi prompt của tác nhân lập trình cũ (nó in danh
 *   sách ấy) — rộng hơn hẳn việc cần. Ở đây đường là HẰNG do hệ thống chọn, không bao giờ do model/người gửi, nên
 *   bỏ tầng đuôi không mở thêm mặt nào.
 * ⚠ Không trừ ngân sách byte của phiên (việc nội bộ dựng ngữ cảnh; trần riêng `TRAN_BYTE_MOI_TEP_QUY_UOC`).
 *
 * Nội dung là DỮ LIỆU của dự án (lõi ghi rõ "follow them unless they conflict with the user"). Tệp mang mẫu tiêm mức
 * `high` (vd "ignore previous instructions") bị BỎ khỏi prompt — thay bằng một dòng nói thật vì sao — chứ không cắt
 * vá: tệp quy ước là chỉ dẫn THEO BẢN CHẤT, một tệp cố giả lời hệ thống thì không có phần nào đáng tin để giữ.
 */
import { confineTargetUnder, readConfined } from "../../aiLocalTools/readToolsProgramming";
import { phanQuyetDuongDan } from "../../aiLocalTools/repoSandbox";
import { redactSecretsOnly, scanUntrustedContent } from "../aiSafety";

export const DUONG_TEP_QUY_UOC = ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md", ".cursorrules"] as const;

/** Trần byte đọc mỗi tệp (lõi còn cắt TỔNG 8 KB — `TRAN_KY_TU_QUY_UOC`). */
export const TRAN_BYTE_MOI_TEP_QUY_UOC = 8_192;

export interface TepQuyUoc {
  duong: string;
  noiDung: string;
}

/** Đọc tệp quy ước có mặt ở gốc dự án (theo thứ tự cố định). Không ném; tệp hỏng/vắng/bị từ chối ⇒ bỏ qua. */
export function docTepQuyUoc(gocDuAn: string): TepQuyUoc[] {
  const ra: TepQuyUoc[] = [];
  for (const duong of DUONG_TEP_QUY_UOC) {
    try {
      if (phanQuyetDuongDan(duong) !== null) continue;
      const c = confineTargetUnder(gocDuAn, duong);
      if (!c.ok || !c.target.exists) continue;
      const rd = readConfined(c.target, TRAN_BYTE_MOI_TEP_QUY_UOC);
      if (!rd.ok) continue;
      const tho = rd.content.replace(/^﻿/, "");
      if (tho.trim() === "") continue;
      const quet = scanUntrustedContent(tho);
      if (quet.risk === "high") {
        ra.push({
          duong,
          noiDung: `[omitted: this file contains text that looks like instructions aimed at the assistant (${quet.matched.join(", ")}); it was not loaded]`,
        });
        continue;
      }
      const che = redactSecretsOnly(tho).text;
      ra.push({ duong, noiDung: rd.truncated ? `${che}\n[… file truncated at ${TRAN_BYTE_MOI_TEP_QUY_UOC} bytes]` : che });
    } catch {
      /* một tệp hỏng không được làm hỏng việc dựng ngữ cảnh */
    }
  }
  return ra;
}
