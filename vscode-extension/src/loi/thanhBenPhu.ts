/**
 * ★★★ ĐỢT F / TASK 4 — logic THUẦN (không import `vscode`) quyết định AI Local đặt được ở THANH
 * BÊN PHỤ (`secondarySidebar`, chỗ người dùng để Claude Code) hay phải LÙI về thanh hoạt động
 * (`activitybar`, khuôn cũ). `extension.ts` gọi `hoTroThanhBenPhu(vscode.version)` trong
 * `activate()` rồi `setContext(KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU, !ket_qua)` — hai
 * `viewsContainers`/`views` trong `package.json` đọc context key đó qua `when` (xem
 * `thanhBen.unit.test.ts`, MỐI NỐI 6/7).
 *
 * ĐO ĐƯỢC (B1, 2026-09-03) — KHÔNG đoán: Claude Code (bản `anthropic.claude-code-2.1.259-win32-x64`
 * đang cài trên máy đo) tự đặt context tương đương bằng CHÍNH phép so sánh dưới đây — grep thẳng
 * `doesNotSupportSecondarySidebar` trong `extension.js` đã build của nó ra ĐÚNG dòng:
 *
 *   let V=g$.version.split(".").map(Number), H=V[0]??0, B=V[1]??0, q=H>1||H===1&&B>=106;
 *   if(!q) g$.commands.executeCommand("setContext","claude-code:doesNotSupportSecondarySidebar",!0)
 *
 * (`g$` là alias cho module `vscode` trong bundle của nó.) Tức: hỗ trợ khi major>1 HOẶC (major===1
 * VÀ minor>=106). VSCode cài trên máy đo (`code --version`, đọc từ
 * `C:\Users\Admin\AppData\Local\Programs\Microsoft VS Code\bin\code`) là **1.135.0** ⇒ hỗ trợ theo
 * đúng ngưỡng này. `engines.vscode` Claude Code khai trong `package.json` của nó là `^1.94.0` —
 * ĐÓ CHỈ LÀ TRẦN TỐI THIỂU để extension còn ACTIVATE được (VSCode dưới mức đó sẽ không cài/chạy
 * extension), KHÔNG PHẢI ngưỡng bật `secondarySidebar` cho một webview view — ngưỡng thật (1.106)
 * chỉ lộ ra ở logic runtime bên trên. Ta mirror ĐÚNG con số 1.106 vì đó là bằng chứng ĐO ĐƯỢC duy
 * nhất hiện có (không có tài liệu VSCode chính thức công bố ngưỡng "secondarySidebar cho webview
 * view ổn định từ bản nào" — Claude Code là nguồn đo trực tiếp duy nhất trên máy này).
 */
export function hoTroThanhBenPhu(phienBanVscode: string): boolean {
  const p = phienBanVscode.split(".").map((x) => Number.parseInt(x, 10));
  const major = p[0] ?? 0;
  const minor = p[1] ?? 0;
  // NaN (chuỗi phiên bản dị dạng) so sánh với số luôn ra `false` ⇒ rơi về nhánh AN TOÀN (không hỗ
  // trợ ⇒ lùi về activitybar) thay vì ném lỗi hoặc mặc định bật một contribution point có thể
  // không tồn tại trên VSCode đang chạy.
  return major > 1 || (major === 1 && minor >= 106);
}

/**
 * ★★★ context key TA đặt bằng `setContext` (xem `extension.ts`, `activate()`) — khớp NGUYÊN VĂN
 * với `package.json` khi bỏ dấu "!" ở đầu chuỗi `when` của `viewsContainers.activitybar[0].when`
 * (giữ nguyên, không "!") và `viewsContainers.secondarySidebar[0].when` (có "!" ở đầu — hai biểu
 * thức PHỦ ĐỊNH của nhau, xem `thanhBen.unit.test.ts`).
 */
export const KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU = "aviAiLocal:khongHoTroThanhBenPhu";
