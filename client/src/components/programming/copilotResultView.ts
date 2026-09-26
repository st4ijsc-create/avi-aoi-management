/**
 * Doc 80 · Task 10 · AI-09 / D4 — cách panel copilot hiển thị một lượt HỎNG hoặc bị CỔNG AN TOÀN chặn.
 * Thuần (không React) để test được: panel chỉ gọi `t(view.i18nKey, view.fallback)`.
 *
 *  • lỗi hệ thống: câu ngắn theo `errorCode` (khoá i18n), fallback = `note` ngắn của server;
 *    `devDetail` (chuỗi chẩn đoán kỹ thuật, trích suy luận) CHỈ khi người xem là admin — server đã
 *    gỡ nó với vai khác, đây là lớp thứ hai.
 *  • bị cổng chặn: khoá `progCopilot.refusal.<reasonCode>`, fallback = `userMessage` (theo ngôn ngữ
 *    yêu cầu); server/client cũ không có `reasonCode` ⇒ hiện nguyên `reason`.
 */
export interface CopilotErrorLike {
  errorCode?: string;
  note?: string;
  devDetail?: string;
}

export interface CopilotRefusalLike {
  reasonCode?: string;
  userMessage?: string;
  reason?: string;
}

export interface CopilotErrorView {
  i18nKey: string;
  fallback: string;
  devDetail?: string;
}

export function copilotErrorView(r: CopilotErrorLike | null | undefined, isAdmin: boolean): CopilotErrorView | null {
  if (!r?.errorCode) return null;
  return {
    i18nKey: `progCopilot.error.${r.errorCode}`,
    fallback: r.note ?? "",
    ...(isAdmin && r.devDetail ? { devDetail: r.devDetail } : {}),
  };
}

export function copilotRefusalView(r: CopilotRefusalLike): { i18nKey: string | null; fallback: string } {
  if (r.reasonCode) return { i18nKey: `progCopilot.refusal.${r.reasonCode}`, fallback: r.userMessage ?? r.reason ?? "" };
  return { i18nKey: null, fallback: r.reason ?? "" };
}
