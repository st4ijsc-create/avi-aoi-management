/**
 * SCADA R0.1 (D11) / R1b-1 Task 9 — LUẬT DUY NHẤT "luật nguồn tag thiết bị (`telemetry_tag`) chỉ có nghĩa theo MỘT máy".
 *
 * Cổng đọc giá trị sống theo (máy, tag): một luật `telemetry_tag` ở phạm vi dây chuyền / trạm không bao giờ đánh giá được. Hai nơi ghi
 * luật dùng CHÍNH hàm này: `interlockRouter` (create / update gộp patch / approve / enable) và tool AI `propose_interlock_rule` (trước khi
 * chèn). Posture (`oversightRouter.fetchInterlockCauHinhHong`) đếm hàng đang bật vi phạm bằng điều kiện SQL tương đương
 * (`"sourceType" = 'telemetry_tag' AND scope <> 'machine'`).
 *
 * Thuần, không import gì (tool AI có test mock `drizzle/schema` — tệp này không được kéo schema vào).
 */
export function telemetryTagDungPhamVi(v: { sourceType: string; scope: string }): boolean {
  return v.sourceType !== "telemetry_tag" || v.scope === "machine";
}
