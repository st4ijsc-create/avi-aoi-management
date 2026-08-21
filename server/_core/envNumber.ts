/**
 * E4 — ĐỌC SỐ TỪ BIẾN MÔI TRƯỜNG MÀ KHÔNG NUỐT LỖI GÕ NHẦM.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO "RƠI VỀ MẶC ĐỊNH" LÀ MỘT HÀNH VI NGUY HIỂM, KHÔNG PHẢI AN TOÀN
 * ══════════════════════════════════════════════════════════════════════════════════
 * Khuôn đang dùng ở bốn nơi trong đường cảnh báo:
 *     const raw = Number(process.env.X);
 *     const v = Number.isFinite(raw) && raw > 0 ? raw : MAC_DINH;
 *
 * `Number("abc")` → `NaN` ⇒ mặc định. `Number("-1")` → `-1` ⇒ mặc định. `"0"` ⇒ mặc định.
 * Không một dòng log nào. Nghĩa là **người vận hành gõ nhầm khi định TẮT một tính năng
 * sẽ nhận đúng hành vi BẬT** — và với `ALERT_TTL_HOURS`/cooldown, "bật" nghĩa là bốn giờ
 * im lặng về một cái máy sắp hỏng. Họ tin mình đã đổi cấu hình; hệ thống tin là chưa.
 *
 * Rơi về mặc định vẫn ĐÚNG (không sập vì một ký tự thừa). Cái sai là **im lặng**:
 * người đặt sai không bao giờ biết mình đặt sai.
 *
 * ── VÌ SAO CẢNH BÁO CHỈ KHI BIẾN ĐƯỢC ĐẶT ────────────────────────────────────────
 * Không đặt gì = chấp nhận mặc định, hoàn toàn bình thường, không đáng một dòng log.
 * ĐÃ ĐẶT mà giá trị vô nghĩa = có ai đó đã ĐỊNH nói gì đó và hệ thống không hiểu. Chỉ
 * trường hợp sau mới là sự kiện.
 *
 * ── VÌ SAO CHỈ MỘT LẦN MỖI BIẾN ──────────────────────────────────────────────────
 * Các hàm này được gọi TRÊN MỖI CẢNH BÁO. Cảnh báo mỗi giây × một dòng warn = đúng lớp
 * lỗi mà E5 vừa phải sửa (van an toàn kêu mỗi lượt, log dùng để bắt lỗi tự thành nguồn
 * nhiễu). Cấu hình không đổi giữa chừng, nên một lần là đủ.
 */

/** Biến đã cảnh báo — không lặp lại trên mỗi lời gọi. */
const daCanhBao = new Set<string>();

/** Giá trị đang CÓ HIỆU LỰC, để in một lượt lúc khởi động. */
const dangHieuLuc = new Map<string, { dat: string | undefined; dung: number }>();

/**
 * Đọc một số dương từ biến môi trường.
 *
 * @param ten     tên biến (dùng luôn làm khoá chống lặp log)
 * @param macDinh giá trị dùng khi không đặt / đặt sai
 * @returns số dương hợp lệ, hoặc `macDinh`
 */
export function soDuongTuEnv(ten: string, macDinh: number): number {
  const dat = process.env[ten];
  const raw = Number(dat);
  const hopLe = dat !== undefined && dat !== "" && Number.isFinite(raw) && raw > 0;
  const dung = hopLe ? raw : macDinh;
  dangHieuLuc.set(ten, { dat, dung });

  if (dat !== undefined && dat !== "" && !hopLe && !daCanhBao.has(ten)) {
    daCanhBao.add(ten);
    console.warn(
      `[env] ${ten}="${dat}" KHÔNG hợp lệ (cần số > 0) — đang dùng mặc định ${macDinh}. ` +
        `⚠ Nếu bạn định TẮT hoặc đổi hành vi bằng giá trị này thì nó KHÔNG có tác dụng.`,
    );
  }
  return dung;
}

/**
 * Như `soDuongTuEnv` nhưng chấp nhận **0**.
 *
 * ⚠ TỒN TẠI VÌ MỘT SUÝT-HỎNG CÓ THẬT. `ALERT_RENOTIFY_COOLDOWN_CRITICAL_MINUTES=0` nghĩa
 * là *"CRITICAL luôn báo ngay, không bao giờ gộp"* — một giá trị CÓ NGHĨA, không phải
 * "chưa đặt". Nếu gom cả hai loại vào một hàm `> 0` thì `0` bị coi là sai và rơi về mặc
 * định **240 phút** ⇒ bốn giờ im lặng cho đúng loại cảnh báo không được phép im.
 *
 * ⇒ Cùng luật đã rút ở `masterDataIO.col.header` và `FORBIDDEN_GENERIC`: **trước khi gom
 *   hai chỗ trông giống nhau vào một khuôn, hỏi xem chúng có nghĩa giống nhau không.**
 */
export function soKhongAmTuEnv(ten: string, macDinh: number): number {
  const dat = process.env[ten];
  const raw = Number(dat);
  const hopLe = dat !== undefined && dat !== "" && Number.isFinite(raw) && raw >= 0;
  const dung = hopLe ? raw : macDinh;
  dangHieuLuc.set(ten, { dat, dung });

  if (dat !== undefined && dat !== "" && !hopLe && !daCanhBao.has(ten)) {
    daCanhBao.add(ten);
    console.warn(
      `[env] ${ten}="${dat}" KHÔNG hợp lệ (cần số ≥ 0) — đang dùng mặc định ${macDinh}. ` +
        `⚠ Nếu bạn định TẮT hoặc đổi hành vi bằng giá trị này thì nó KHÔNG có tác dụng.`,
    );
  }
  return dung;
}

/**
 * In một lượt các giá trị ĐANG CÓ HIỆU LỰC (không phải giá trị được đặt).
 *
 * ⚠ Gọi SAU khi các hàm đọc đã chạy ít nhất một lần, nếu không bảng sẽ rỗng — đó là lý
 * do nó nhận danh sách `ten` kèm `macDinh` và tự đọc, thay vì chỉ in cái đã có sẵn.
 * Một bảng cấu hình rỗng trông y hệt "không có cấu hình nào", và người đọc log sẽ tin.
 */
export function inCauHinhHieuLuc(
  nhan: string,
  bien: Array<[string, number] | [string, number, "khongAm"]>,
): void {
  const dong = bien.map((b) => {
    const [ten, macDinh] = b;
    const v = b[2] === "khongAm" ? soKhongAmTuEnv(ten, macDinh) : soDuongTuEnv(ten, macDinh);
    const g = dangHieuLuc.get(ten);
    const nguon =
      g?.dat === undefined || g.dat === "" ? "mặc định" : v === Number(g.dat) ? "đặt" : "ĐẶT SAI→mặc định";
    return `${ten}=${v} (${nguon})`;
  });
  console.log(`[cấu hình] ${nhan}: ${dong.join(" · ")}`);
}

/** Chỉ dùng trong test — xoá trạng thái nhớ giữa các ca. */
export function _resetEnvNumberState(): void {
  daCanhBao.clear();
  dangHieuLuc.clear();
}
