/**
 * Diễn giải một đáp ứng HTTP không-ok từ máy chủ AI Local. THUẦN: nhận (status, thân đã thử phân
 * giải JSON hoặc `null`) — không đụng mạng, đo được không cần server thật.
 *
 * ⚠ 401 và 403 KHÔNG PHẢI CÙNG MỘT CHUYỆN, dù cả hai đều "không cho vào". Máy chủ phân biệt rành
 * mạch (`server/routes/_xacThucRest.ts`): 401 nghĩa là *"đăng nhập lại thì vào được"*; 403 có thể
 * là `MUST_CHANGE_PASSWORD` hay `ACCOUNT_DISABLED` — đăng nhập lại KHÔNG CỨU ĐƯỢC những người đó:
 * họ đăng nhập thành công, lượt kế lại 403 y hệt — MỘT VÒNG LẶP KHÔNG LỐI RA. Vì thế câu "hãy đăng
 * nhập lại" chỉ được nói cho ĐÚNG 401; các mã khác báo NGUYÊN VĂN câu của máy chủ, không bịa cách
 * khắc phục.
 */

/** Lỗi mang theo mã trạng thái HTTP — để lớp trên (bảng chat) quyết định được theo TỪNG MÃ, không
 *  chỉ theo chuỗi thông điệp. */
export class LoiHttp extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LoiHttp";
  }
}

/**
 * @param than Thân đáp ứng đã thử `JSON.parse` — `null` khi vắng thân hoặc không phải JSON. Hình
 *   dạng thật của máy chủ là `{success:false, error, code}` (`aiLocalKnowledgeApi.ts:443`,
 *   `thanTuChoiRest()` ở `_xacThucRest.ts`), nhưng hàm này KHÔNG đòi hỏi đúng hình dạng đó — đọc
 *   được `error`/`code` thì dùng, không thì rơi về câu chung theo MÃ TRẠNG THÁI, không ném.
 */
export function moTaLoiHttp(status: number, than: unknown): string {
  const o = than && typeof than === "object" ? (than as Record<string, unknown>) : null;
  const loi = o && typeof o.error === "string" ? o.error : null;
  const ma = o && typeof o.code === "string" ? o.code : null;
  const chiTiet = loi ? (ma ? `${loi} (${ma})` : loi) : null;

  if (status === 401) {
    // CHỈ lớp này được khuyên "đăng nhập lại" — đúng chuyện, đúng thuốc.
    return chiTiet
      ? `Phiên đăng nhập không còn hiệu lực: ${chiTiet}. Hãy đăng nhập lại.`
      : "Phiên đăng nhập không còn hiệu lực — hãy đăng nhập lại.";
  }
  // Mọi mã khác: báo ĐÚNG mã + câu của máy chủ, KHÔNG bịa cách khắc phục — "đăng nhập lại" là vòng
  // lặp không lối ra cho MUST_CHANGE_PASSWORD/ACCOUNT_DISABLED (403), và vô nghĩa cho một sự cố
  // của máy chủ (500).
  return chiTiet ? `Máy chủ trả ${status}: ${chiTiet}` : `Máy chủ trả ${status}.`;
}

/**
 * true khi lỗi này là 401 — CHỈ khi đó mới nên xoá cookie phiên đang cất (spec §5.1: "401 giữa
 * chừng ⇒ xoá cookie, mời đăng nhập lại"). Tách thành vị từ THUẦN để đo được mà không cần dựng
 * `vscode.ExtensionContext` giả.
 */
export function laLoi401(err: unknown): err is LoiHttp {
  return err instanceof LoiHttp && err.status === 401;
}
