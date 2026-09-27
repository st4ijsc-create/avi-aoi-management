/**
 * doc 80 Đợt 1 Task 7 (AI-02) — hiển thị chẩn đoán của adapter lập trình theo ngôn ngữ UI.
 *
 * Parser ST thật (server `iec61131/stParser.ts`) gắn `code` + `params` cho từng chẩn đoán; câu
 * `message` tiếng Anh vẫn đi kèm (lượt tự sửa của model + nhật ký dùng nó). UI dịch theo khoá
 * `engineering.stDiag.<code>`; chẩn đoán KHÔNG có mã (adapter khác, safety linter) giữ `message`
 * như trước. Vị trí: `L<dòng>:<cột>: `.
 */
import type { TFunction } from "i18next";

export interface ProgDiagView {
  severity: string;
  message: string;
  line?: number;
  col?: number;
  code?: string;
  params?: Record<string, string | number>;
}

export function progDiagText(t: TFunction, d: ProgDiagView): string {
  const pos = d.line ? `L${d.line}${d.col ? `:${d.col}` : ""}: ` : "";
  const body = d.code
    ? String(t(`engineering.stDiag.${d.code}`, { ...(d.params ?? {}), defaultValue: d.message }))
    : d.message;
  return pos + body;
}
