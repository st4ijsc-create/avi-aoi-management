/**
 * ★★★ G6 (audit 2026-09-21) — SUY **THƯ MỤC** ỨNG VIÊN TỪ ĐẦU RA LỖI TEST.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐO ĐƯỢC — VÒNG TỰ TRỊ CHẾT VÌ TỆP CẦN SỬA KHÔNG CÓ TRONG CÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bộ đo agentic (`scripts/ai-eval/codegen-chay-duoc/agentic.mjs`) cho **0/3**, và nhật ký chẩn đoán
 * chỉ đúng chỗ chết: *"bước 1: model không chọn được tệp trong cây · cây 4.246 ký tự"*.
 *
 * `cayTepNguon` gọi `list_files {depth: 3}` rồi `.slice(0, 200)`. Repo này có ~7.616 tệp, và tệp
 * cần sửa (`sandbox-projects/agentic-demo/src/kho.mjs`) nằm ở **TẦNG 4** ⇒ **không hề có mặt** trong
 * cây đưa cho model. Model không chọn được là ĐÚNG; lỗi nằm ở cái cây, không ở model.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHÔNG LÀM LẠI `trichTepTuLoi` (đã bị GỠ 2026-08-24, có ghi lý do)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản cũ nhặt **ĐƯỜNG TỆP ĐẦU TIÊN** trong đầu ra test rồi đưa thẳng đi sửa. Live bắt hai lỗ:
 *   (1) `dotnet test` in đường TUYỆT ĐỐI tới tệp test ⇒ hộp cát từ chối ⇒ vòng dừng SAI lý do;
 *   (2) kể cả nới, nó trỏ **tệp TEST** chứ không phải tệp NGUỒN ⇒ model sửa TEST để gaming.
 *
 * File này KHÁC ở đúng hai điểm, và đó là điều kiện để nó không lặp lại lỗ cũ:
 *   • Nó suy ra **THƯ MỤC**, KHÔNG suy ra tệp. Thư mục chỉ để **thu hẹp phạm vi liệt kê**.
 *   • **MODEL VẪN TỰ CHỌN TỆP** trong cây, và **server vẫn xác thực** đường ấy. Hai hàng rào cũ
 *     (`chonTepTuTri` + `phanQuyetDuongDan` + cờ audit `laTepTest`) KHÔNG bị đụng tới.
 * ⇒ Biết "lỗi ở đâu đó trong `sandbox-projects/agentic-demo/`" là một sự thật RẺ và AN TOÀN;
 *   biết "hãy sửa `test/kho.test.mjs`" mới là thứ nguy hiểm, và file này không nói điều đó.
 *
 * ⚠ Đường TUYỆT ĐỐI bị LOẠI ngay tại đây (hộp cát đằng nào cũng từ chối) — loại sớm để vòng dừng
 *   vì lý do THẬT, không vì một đường Windows lọt vào rồi bị từ chối ở tầng dưới.
 */

/** Tối đa số thư mục trả về — cây phải NHỎ mới giúp model chọn đúng. */
const TRAN_THU_MUC = 4;

/**
 * Hình dạng một đường TƯƠNG ĐỐI trong repo: có ít nhất một `/`, không bắt đầu bằng `/`, không có
 * `..`, không có ổ đĩa `X:`. Bắt cả `\` của Windows để `node --test` trên Win cũng dùng được.
 */
const RE_DUONG = /(?:^|[\s("'[])((?:[A-Za-z0-9._-]+[/\\]){1,6}[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,6})/g;

/** Đoạn đường có ổ đĩa hoặc leo cấp ⇒ vứt (hộp cát từ chối, và đó không phải lỗi cần chẩn đoán). */
function hopLe(d: string): boolean {
  if (/^[A-Za-z]:/.test(d)) return false;
  if (d.startsWith("/") || d.startsWith("\\")) return false;
  return !d.split(/[/\\]/).includes("..");
}

/**
 * Trả danh sách **THƯ MỤC** (đường tương đối, không có dấu `/` cuối) suy từ đầu ra lỗi.
 * Sắp theo **số lần xuất hiện giảm dần** rồi theo độ dài tăng dần (thư mục NÔNG hơn bao được nhiều
 * hơn, nên khi hoà thì ưu tiên nó). Hàm THUẦN.
 *
 * ⚠ Trả `[]` khi không suy được gì — người gọi PHẢI lùi về hành vi cũ, không được coi `[]` là
 *   "không có tệp nào".
 */
export function thuMucTuLoi(loi: string | null | undefined): string[] {
  const s = typeof loi === "string" ? loi : "";
  const dem = new Map<string, number>();
  for (const m of s.matchAll(RE_DUONG)) {
    const duong = m[1]!;
    if (!hopLe(duong)) continue;
    const doan = duong.split(/[/\\]/);
    doan.pop(); // bỏ tên tệp — file này CỐ Ý chỉ nói về thư mục
    if (doan.length === 0) continue;
    const thuMuc = doan.join("/");
    dem.set(thuMuc, (dem.get(thuMuc) ?? 0) + 1);
    // Thêm cả thư mục CHA một cấp: lỗi thường in đường tới `test/`, mà tệp NGUỒN nằm ở `src/`
    // bên cạnh — cha chung là nơi duy nhất bao được cả hai.
    if (doan.length > 1) {
      const cha = doan.slice(0, -1).join("/");
      dem.set(cha, (dem.get(cha) ?? 0) + 0.5);
    }
  }
  return [...dem.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .slice(0, TRAN_THU_MUC)
    .map(([d]) => d);
}
