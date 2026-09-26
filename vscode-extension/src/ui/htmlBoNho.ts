/**
 * ★★★ ĐỢT H / TASK H3 / B2 — khung HTML của bảng "Bộ nhớ dài hạn" (xem/xoá từng mục/xoá tất cả).
 * THUẦN (không import `vscode`) để lưới đo được CSP trực tiếp — CÙNG KHUÔN `ui/htmlBang.ts`.
 *
 * ★★★ "NHÌN THẤY và SỬA ĐƯỢC" — một bộ nhớ ẨN là một nguồn LỖI ẨN: khi AI trả lời sai vì nhớ sai,
 * người dùng phải mở ra XEM và SỬA (ở đây: xoá) được. Toàn bộ nội dung mỗi mục hiện NGUYÊN VĂN
 * (`thoatHtml`, không cắt ngắn) — giấu bớt chữ để "gọn" sẽ đúng lúc che mất phần khiến AI trả lời
 * sai.
 *
 * SVG NỘI TUYẾN, không phải codicon font — CSP `default-src 'none'` và KHÔNG có `font-src`, cùng lý
 * do G1/B2 đã chọn cho icon tài khoản ở `htmlBang.ts`.
 */
import { thoatHtml } from "../loi/thoatHtml";
import type { MucBoNho } from "../loi/khoBoNho";

const NHAN_NGUON: Record<MucBoNho["nguon"], string> = {
  nguoi_dung_bao_nho: "Người dùng yêu cầu nhớ",
  ai_de_xuat_duyet: "AI đề xuất, đã duyệt",
};

/** SVG thùng rác — dùng LẠI nguyên vẹn cho cả nút xoá TỪNG mục lẫn nút xoá TẤT CẢ (một hình dạng,
 *  hai chỗ dùng, không phải hai icon trôi khỏi nhau theo thời gian). */
const SVG_THUNG_RAC =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M6 1.6h4l.6 1.2H13v1.2H3V2.8h2.4L6 1.6ZM4.2 5h7.6l-.66 8.3a1.2 1.2 0 0 1-1.2 1.1H6.06a1.2 1.2 0 0 1-1.2-1.1L4.2 5Zm2.3 1.8v6h1.1v-6H6.5Zm3 0v6h1.1v-6H9.5Z" />' +
  "</svg>";

function dongMuc(m: MucBoNho): string {
  const thoiDiem = new Date(m.thoiDiem).toLocaleString();
  return `<li class="muc-bo-nho">
  <div class="muc-noi-dung">${thoatHtml(m.noiDung)}</div>
  <div class="muc-meta">
    <span class="muc-nguon">${thoatHtml(NHAN_NGUON[m.nguon])}</span>
    <span class="muc-thoi-diem">${thoatHtml(thoiDiem)}</span>
  </div>
  <button class="nut-icon nut-xoa-muc" data-ma="${thoatHtml(m.ma)}" title="Xoá mục này" aria-label="Xoá mục nhớ này">
    ${SVG_THUNG_RAC}
  </button>
</li>`;
}

export function dungHtmlBoNho(dv: { nonce: string; ds: readonly MucBoNho[] }): string {
  const n = dv.nonce;
  const soMuc = dv.ds.length;
  const noiDungDanhSach =
    soMuc === 0
      ? '<p id="rong">Chưa có mục nhớ nào. Dùng lệnh "AI Local: Nhớ điều này", hoặc duyệt một đề xuất nhớ của AI trong bảng chat.</p>'
      : `<ul id="danh-sach">\n${dv.ds.map(dongMuc).join("\n")}\n</ul>`;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';" />
<style nonce="${n}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         margin: 0; padding: 12px 16px; }
  h1 { font-size: 13px; font-weight: 600; margin: 0; }
  p#mo-ta { font-size: 11px; opacity: .8; margin: 4px 0 12px; }
  #vung-tren { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .nut-icon { background: transparent; border: none; color: var(--vscode-foreground); cursor: pointer;
              padding: 4px 6px; display: inline-flex; align-items: center; gap: 4px; border-radius: 4px; }
  .nut-icon:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }
  #xac-nhan-xoa-tat-ca { display: none; align-items: center; gap: 6px; font-size: 11px; }
  #xac-nhan-xoa-tat-ca.hien { display: flex; }
  ul#danh-sach { list-style: none; margin: 0; padding: 0; }
  li.muc-bo-nho { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); border-radius: 4px;
                  padding: 8px 10px; margin-bottom: 8px; display: flex; gap: 10px; align-items: flex-start; }
  .muc-noi-dung { flex: 1; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
  .muc-meta { display: flex; flex-direction: column; gap: 2px; font-size: 10.5px; opacity: .75; min-width: 150px; text-align: right; }
  #rong { font-size: 12px; opacity: .8; }
</style>
</head>
<body>
<div id="vung-tren">
  <div>
    <h1>Bộ nhớ dài hạn của AI Local</h1>
    <p id="mo-ta">${soMuc} mục — dữ liệu tham khảo cho AI ở những lần hỏi sau, KHÔNG phải chỉ dẫn thực thi.</p>
  </div>
  <div>
    <button id="nut-xoa-tat-ca" class="nut-icon" title="Xoá tất cả" aria-label="Xoá tất cả mục nhớ"${soMuc === 0 ? " disabled" : ""}>
      ${SVG_THUNG_RAC}
      <span>Xoá tất cả</span>
    </button>
    <span id="xac-nhan-xoa-tat-ca">
      <span>Xoá HẾT ${soMuc} mục?</span>
      <button id="nut-xac-nhan-xoa-tat-ca" class="nut-icon">Xác nhận</button>
      <button id="nut-huy-xoa-tat-ca" class="nut-icon">Huỷ</button>
    </span>
  </div>
</div>
${noiDungDanhSach}
<script nonce="${n}">
  const vscode = acquireVsCodeApi();

  document.getElementById("danh-sach")?.addEventListener("click", (e) => {
    const nut = e.target.closest(".nut-xoa-muc");
    if (!nut) return;
    vscode.postMessage({ loai: "xoa_muc", ma: nut.getAttribute("data-ma") });
  });

  document.getElementById("nut-xoa-tat-ca")?.addEventListener("click", () => {
    document.getElementById("xac-nhan-xoa-tat-ca")?.classList.add("hien");
  });
  document.getElementById("nut-huy-xoa-tat-ca")?.addEventListener("click", () => {
    document.getElementById("xac-nhan-xoa-tat-ca")?.classList.remove("hien");
  });
  document.getElementById("nut-xac-nhan-xoa-tat-ca")?.addEventListener("click", () => {
    vscode.postMessage({ loai: "xoa_tat_ca" });
  });
</script>
</body>
</html>`;
}
