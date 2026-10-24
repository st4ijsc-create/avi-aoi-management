/**
 * Khung HTML của bảng trò chuyện. THUẦN (không import `vscode`) để lưới đo được CSP.
 * Script chỉ chạy bằng `nonce` — không `unsafe-inline`, không nguồn ngoài (nhà máy offline).
 *
 * ★★★ ĐỢT F / TASK 1 — `daDangNhap` quyết định markup BAN ĐẦU của vùng đăng nhập (nút "Đăng nhập"
 * hiện hay ẩn ngay từ HTML tĩnh — xem `htmlBang.unit.test.ts`). Đây CHỈ là trạng thái LÚC DỰNG
 * TRANG; `bangChat.ts` tự sửa lại NGAY qua tin `trang_thai_dang_nhap` sau khi webview báo
 * "san_sang" (đúng chỗ nó cũng nạp danh sách dự án) — vì `context.secrets.get` (đọc cookie) là
 * BẤT ĐỒNG BỘ, constructor của `BangChat` không thể biết trạng thái thật TRƯỚC khi gán
 * `webview.html`. Rơi về `false` (chưa đăng nhập) là lựa chọn AN TOÀN: nút "Đăng nhập" hiện ra
 * ngay, không bao giờ dựng một khung trông như "đã đăng nhập" khi chưa chắc chắn.
 *
 * ★★★ ĐỢT G / TASK G1 / B2 (2026-09-03) — vùng tài khoản đổi từ BA phần tử (nút to + tên + nút
 * đăng xuất, chiếm nguyên một hàng — đúng ảnh người dùng gửi kèm lời phàn nàn "mất thẩm mỹ") sang
 * MỘT icon nhỏ `#nut-tai-khoan` ở góc khung, hai vai trò tuỳ trạng thái (chưa đăng nhập ⇒ bấm để
 * đăng nhập; đã đăng nhập ⇒ bấm để đăng xuất, tên tài khoản nằm ở TOOLTIP `title`/`aria-label`).
 * SVG NỘI TUYẾN, không phải codicon font: CSP của webview này là `default-src 'none'` và KHÔNG có
 * `font-src` — nạp font codicon cần thêm `<link>` trỏ `asWebviewUri` (đòi `vscode`), mà tệp này
 * THUẦN theo đúng kỷ luật ở trên. Một ô vuông trống vì font lỡ không nạp còn xấu hơn nút to cũ; SVG
 * là markup tĩnh, chạy được dưới CSP hiện có mà không phải nới thêm directive nào.
 *
 * ⚠⚠⚠ TÊN TÀI KHOẢN KHÔNG BAO GIỜ được đưa vào `dv` để chép thẳng vào chuỗi HTML này — mọi tệp khác
 * trong `dungHtmlBang` chỉ nhận dữ liệu ĐỘNG qua `postMessage` rồi gán `textContent`/`title` (an
 * toàn khỏi chèn HTML); một tham số chuỗi ghép trực tiếp vào template này phá vỡ kỷ luật đó và mở
 * một đường tiêm HTML mới. Tên tài khoản luôn tới qua tin `trang_thai_dang_nhap`, kể cả khi nó chỉ
 * đi vào `title`/`aria-label` của `#nut-tai-khoan` thay vì `textContent` của một `<span>` riêng.
 */
import { thoatHtml } from "../loi/thoatHtml";

export function dungHtmlBang(dv: { nonce: string; daDangNhap?: boolean; maBuild?: string }): string {
  const n = dv.nonce;
  const maBuild = typeof dv.maBuild === "string" && dv.maBuild.trim() !== "" ? thoatHtml(dv.maBuild.trim().slice(0, 60)) : "";
  const daDangNhap = dv.daDangNhap === true;
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'nonce-${n}'; script-src 'nonce-${n}';" />
<style nonce="${n}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         margin: 0; padding: 8px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
  /* ĐỢT G / TASK G1 / B2 — góc khung, không còn chiếm nguyên một hàng như nút to cũ.
     ĐỢT G / TASK G3 / B4 — nay CHIA HAI ĐẦU: ô chọn mức quyền bên TRÁI, icon tài khoản bên PHẢI. */
  #vung-tai-khoan { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  /* ĐỢT G / TASK G3 / B4 — ô chọn mức quyền (chế độ tự trị). Chữ NHỎ, giống thanh trạng thái ngữ
     cảnh — đây là một cấu hình PHỤ, không phải hành động chính của khung. */
  #vung-muc-quyen { display: flex; align-items: center; gap: 4px; font-size: 11px; opacity: .9; }
  #vung-muc-quyen[hidden] { display: none; }
  #ma-build { font-size: 10px; opacity: .55; font-family: var(--vscode-editor-font-family, monospace); user-select: all; }
  #ma-build[hidden] { display: none; }
  #o-muc-quyen { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
                 border: 1px solid var(--vscode-dropdown-border); font-size: 11px; padding: 2px 4px; }
  /* B2+B4 — nút ICON dùng chung: nền trong suốt, chỉ nổi lên khi hover/focus, giống nút icon gốc
     của VSCode (không phải nút hành động to như trước). #nut-gui ghi đè nền ở dưới vì nó vẫn là
     hành động CHÍNH của hàng nhập — icon nhỏ nhưng không "vô hình" như nút tài khoản (phụ). */
  .nut-icon { display: inline-flex; align-items: center; justify-content: center;
              padding: 4px; border-radius: 4px; background: transparent;
              color: var(--vscode-foreground); border: none; cursor: pointer; }
  .nut-icon:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2)); }
  /* B2 — trạng thái ĐÃ đăng nhập tô icon một màu khác biệt (không chỉ dựa vào tooltip) — "hiện
     trạng thái bằng màu" như kế hoạch đòi, không riêng chữ ẩn trong title. */
  #nut-tai-khoan.da-dang-nhap { color: var(--vscode-charts-green, var(--vscode-foreground)); }
  #nut-gui { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #nut-gui:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
  /* B3 — ẨN ở chế độ LOCAL (script bật lại hidden=false NGAY khi danh sách dự án có ít nhất một
     mục SERVER — xem xử lý tin "duAn"). Mặc định ẨN ở markup tĩnh để tránh một cú chớp ô-chọn-rỗng
     trước khi tin đầu tiên tới. */
  #ghi-chu-quyen { font-size: 11px; opacity: .85; margin: 0 0 6px; padding: 3px 6px; border-left: 2px solid var(--vscode-editorWarning-foreground, var(--vscode-focusBorder)); }
  #o-du-an { width: 100%; margin-bottom: 8px; background: var(--vscode-dropdown-background);
             color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);
             padding: 4px; }
  #hoi-thoai { flex: 1; overflow-y: auto; white-space: pre-wrap; font-size: 13px; }
  /* ★★★ PHÂN BIỆT câu hỏi/trả lời/hệ thống — viền trái + nền nhạt, KHÔNG avatar/khung to (B3: panel
     thanh bên HẸP ~290px, đầu khung đã bị phàn nàn "mất thẩm mỹ" ở Đợt G, không lặp lại). Lớp
     "luot-*" được SCRIPT nối thẳng từ tham số \`vai\` của \`themLuot\` (xem NHAN_THEO_VAI bên dưới) —
     không phải một danh sách rời rạc đi kèm nhãn, nên nhãn và màu KHÔNG THỂ trôi khỏi nhau.
     ★★★ CHỈ dùng biến \`--vscode-*\` có sẵn (kiểm tồn tại trước khi dùng, không bịa tên) — đọc đúng ở
     CẢ theme sáng lẫn tối, không hardcode mã màu nào trong khối này. */
  .luot { margin-bottom: 10px; padding: 4px 8px; border-left: 3px solid transparent; }
  /* Câu hỏi người dùng — nền khối trích dẫn của theme + viền trái màu NHẤN (focusBorder): "đây là
     tôi vừa nói", giống cách trình soạn thảo VSCode tô một khối được trích dẫn. */
  .luot-nguoi-dung { background: var(--vscode-textBlockQuote-background);
                      border-left-color: var(--vscode-focusBorder); }
  /* Trả lời AI — KHÔNG nền (khác hẳn ô người dùng), chỉ viền trái màu trung tính của theme. */
  .luot-ai { border-left-color: var(--vscode-textBlockQuote-border); }
  /* Thông báo hệ thống (lỗi/thông báo/lưu ý) — vai THỨ BA rõ ràng, không ép vào "ai": viền trái lấy
     màu chữ-mô-tả của theme, khác cả hai màu trên để không bị nhầm là một câu trả lời của AI. */
  .luot-he-thong { border-left-color: var(--vscode-descriptionForeground); }
  .nhan { opacity: .7; font-size: 11px; text-transform: uppercase; }
  /* 2026-10-24 — NHÃN VAI của một lượt hội thoại (khác .nhan dùng cho nhãn thẻ): 12 px ĐẬM, không in hoa, không mờ, kèm chữ cái đầu trong vòng tròn — "Bạn" / "AI Local" không còn là thứ
     nhỏ và xám nhất trên màn hình. Chữ cái là CSS thuần (::before) nên cấu trúc DOM của lượt (nhãn + nội dung) không đổi. */
  .luot > .nhan { display: flex; align-items: center; gap: 6px; opacity: 1; font-size: 12px; font-weight: 600; text-transform: none; margin-bottom: 2px; }
  .luot > .nhan::before { content: "•"; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; font-weight: 700;
                          background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .luot-nguoi-dung > .nhan::before { content: "B"; }
  .luot-ai > .nhan::before { content: "AI"; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .luot-he-thong > .nhan::before { content: "!"; background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-descriptionForeground); }
  /* ★★★ ĐỢT I / TASK I-1a — CHỈ BÁO ĐANG CHẠY. Bong bóng AI KHÔNG được rỗng-im-lìm trong lúc model
     nghĩ (3-58s đo được) — người dùng phải THẤY nó còn sống. Thuần CSS @keyframes (không JS
     timer): trình duyệt tự chạy animation, không tốn một setInterval nào để dọn khi lượt kết
     thúc. Ba chấm nhấp nháy LỆCH PHA nhau (delay khác nhau) — đúng hình ảnh "đang gõ" quen thuộc,
     không phải một khối chớp tắt đồng loạt trông giống lỗi hiển thị hơn là đang hoạt động. */
  @keyframes cho-ai-nhap-nhay { 0%, 80%, 100% { opacity: .2; } 40% { opacity: 1; } }
  .cho-ai { display: inline-flex; gap: 3px; vertical-align: middle; }
  .cho-ai span { width: 5px; height: 5px; border-radius: 50%;
                 background: var(--vscode-descriptionForeground, currentColor);
                 animation: cho-ai-nhap-nhay 1.2s infinite ease-in-out both; }
  .cho-ai span:nth-child(2) { animation-delay: .2s; }
  .cho-ai span:nth-child(3) { animation-delay: .4s; }
  /* Trạng thái CÓ NGHĨA (đến từ tin "thong_bao" khi model đang đọc tool/gọi vòng tiếp — xem xử lý
     tin bên dưới): chữ mờ, không giật — thay THẾ ba chấm chung chung khi có tin thật để báo, không
     hiện CẢ HAI cùng lúc (rối mắt, và cũng không đúng — ba chấm nghĩa là "chưa biết đang làm gì"). */
  .cho-ai-chu { font-style: italic; opacity: .75; }
  /* ★★★ ĐỢT I / TASK I-5a — KHUNG RỖNG CÓ HƯỚNG DẪN. GỌN theo yêu cầu (panel hẹp ~290px, đầu khung
     đã bị phàn nàn "mất thẩm mỹ" ở Đợt G) — ba dòng ngắn, chữ mờ như một placeholder, KHÔNG khung
     viền/nền riêng (không thêm một khối thị giác mới cạnh tranh với hội thoại thật). Ẩn hẳn (không
     chỉ mờ) ngay khi bong bóng ĐẦU TIÊN xuất hiện — script gỡ nó, xem hàm themLuot/anRongLanDau. */
  #rong-lan-dau { opacity: .7; font-size: 12px; line-height: 1.6; }
  #rong-lan-dau p { margin: 4px 0; }
  #the-duyet { border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
               background: var(--vscode-editorWidget-background); padding: 8px; margin-top: 8px;
               font-size: 12px; }
  #the-duyet #duyet-duong { font-weight: 600; margin: 2px 0; }
  .the-duyet-nut { display: flex; gap: 6px; margin-top: 8px; }
  #hang-nhap { display: flex; gap: 6px; margin-top: 8px; position: relative; }
  #o-nhap { flex: 1; background: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            padding: 6px; font-family: inherit; line-height: 1.4; resize: none; overflow-y: auto;
            min-height: 34px; max-height: 160px; box-sizing: border-box; }
  /* 2026-10-24 — menu Đính kèm (một nút, ba đường) neo lên TRÊN hàng nhập. */
  #nut-dinh-kem { padding: 6px; }
  #menu-dinh-kem { position: absolute; left: 0; bottom: 100%; margin-bottom: 4px; min-width: 220px;
                   background: var(--vscode-menu-background, var(--vscode-dropdown-background));
                   color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground));
                   border: 1px solid var(--vscode-dropdown-border); border-radius: 4px; padding: 4px; z-index: 20;
                   font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
  #menu-dinh-kem[hidden] { display: none; }
  #menu-dinh-kem { left: 6px; right: 6px; min-width: 0; padding: 4px; border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.35); background: var(--vscode-editorWidget-background); border-color: var(--vscode-input-border); }
  #menu-dinh-kem .ti-de { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-descriptionForeground); padding: 6px 8px 2px; }
  #menu-dinh-kem button { display: flex; flex-direction: column; gap: 1px; padding: 7px 8px; border-radius: 6px; }
  #menu-dinh-kem button b { font-weight: 600; font-size: 12.5px; }
  #menu-dinh-kem button span { color: var(--vscode-descriptionForeground); font-size: 11.5px; line-height: 1.4; }
  #menu-dinh-kem button { background: transparent; color: inherit; border: 0; text-align: left; padding: 6px 8px; cursor: pointer; font: inherit; border-radius: 3px; }
  #menu-dinh-kem button:hover, #menu-dinh-kem button:focus-visible { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.2)); }
  #menu-dinh-kem .mn-goi-y { opacity: .7; padding: 4px 8px 2px; font-size: 11px; }
  #mo-ta-che-do { font-size: 11px; opacity: .8; margin: 2px 0 0; flex-basis: 100%; }
  /* TASK 5 — dropdown gợi ý @-mention. Neo lên TRÊN ô nhập (ô nhập nằm ở đáy khung chat) qua
     #hang-nhap position:relative ở trên — relative không phá layout flex hiện có. */
  #mention-ds { position: absolute; left: 0; right: 88px; bottom: 100%; margin-bottom: 4px;
                max-height: 160px; overflow-y: auto; background: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border); font-size: 12px; z-index: 10; }
  .mention-muc { padding: 4px 8px; cursor: pointer; }
  .mention-muc:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,.2)); }
  /* ĐỢT G / TASK G2 / B2 — danh sách tệp ĐANG ĐÍNH KÈM, dưới hàng nhập. MẶC ĐỊNH ẨN trong markup
     tĩnh (script tự bật lại khi có ít nhất một tệp — xem B2 "nhánh kia": gỡ hết ⇒ tự ẩn lại, không
     để lại khung rỗng lơ lửng). */
  #ds-dinh-kem { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  #ds-dinh-kem[hidden] { display: none; }
  .dinh-kem-muc { display: inline-flex; align-items: center; gap: 4px;
                  background: var(--vscode-badge-background, rgba(128,128,128,.15));
                  color: var(--vscode-badge-foreground, var(--vscode-foreground));
                  border-radius: 4px; padding: 2px 6px; font-size: 12px; }
  /* 2026-10-24 — đính kèm NGOÀI workspace (dán/kéo/chọn từ máy): chip có ảnh thu nhỏ + kích thước; vùng thả viền nét đứt khi đang kéo tệp vào. */
  .dinh-kem-muc img, .dinh-kem-trong-luot img { width: 28px; height: 28px; object-fit: cover; border-radius: 3px; }
  .dinh-kem-muc .kt { opacity: .7; font-size: 11px; }
  .dinh-kem-trong-luot { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .dinh-kem-trong-luot .dk { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; opacity: .85;
                              background: var(--vscode-badge-background, rgba(128,128,128,.15)); color: var(--vscode-badge-foreground, var(--vscode-foreground)); border-radius: 4px; padding: 2px 6px; }
  body.keo-tha { outline: 2px dashed var(--vscode-focusBorder); outline-offset: -4px; }
  .dinh-kem-muc button { background: transparent; border: none; color: inherit; cursor: pointer;
                          padding: 0 2px; font-size: 13px; line-height: 1; }
  /* ĐỢT G / TASK G2 / B3 — thanh trạng thái NGỮ CẢNH: chữ NHỎ, mờ (phụ, không phải hành động) —
     ba đơn vị ĐO ĐƯỢC THẬT, KHÔNG phải số token (xem \`title\` ở markup: nói rõ đơn vị đang đếm). */
  #thanh-ngu-canh { font-size: 11px; opacity: .7; margin-top: 4px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 6px 12px; cursor: pointer; }
  /* Nút ghi đang chờ kết quả: phải THẤY ĐƯỢC là đang khoá, nếu không người dùng bấm tiếp vì nghĩ
     cú bấm đầu rơi mất — đúng cái phản xạ sinh ra hàng kiểm toán thừa. */
  button:disabled { opacity: .5; cursor: default; }
  /* ĐỢT G / TASK G4 / B3 — nút "Mở Settings" trong bong bóng lỗi KHÔNG-NỐI-ĐƯỢC-MÁY-CHỦ. Chỉ tách
     bằng khoảng cách với đoạn văn phía trên (\`display:block\`) — không cần màu riêng, đây vẫn là
     một hành động PHỤ (mở cấu hình), không phải hành động chính của lượt hỏi. */
  .nut-mo-settings { display: block; margin-top: 6px; font-size: 12px; }
  /* ★★★ ĐỢT 4B — AGENT: hàng điều khiển (chế độ · đăng nhập token · đồng hồ ngữ cảnh · hoàn tác), dòng thời gian tool,
     kế hoạch, thẻ duyệt TỪNG TỆP, markdown (dựng bằng createElement/textContent — xem veMd). Chỉ biến --vscode-*. */
  #vung-agent { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; font-size: 11px; }
  #o-che-do { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
              border: 1px solid var(--vscode-dropdown-border); font-size: 11px; padding: 2px 4px; }
  #dong-ho-token { opacity: .75; }
  .nut-phu { font-size: 11px; padding: 2px 8px; }
  /* ★ 2026-10-24 — TYPOGRAPHY của markdown (đường Agent VÀ đường Chat/SERVER): thứ bậc tiêu đề rõ (h3 16 > h4 14,5 > h5 13,5 > h6 13 > chữ 13 — trước đây ### = 10,8 px NHỎ HƠN chữ thường),
     khoảng thở giữa đoạn/danh sách/bảng, trích dẫn có viền+nền, bảng cuộn ngang trong khung riêng. */
  .ag-md { white-space: normal; line-height: 1.55; overflow-wrap: anywhere; }
  .ag-md > :first-child { margin-top: 0; }
  .ag-md > :last-child { margin-bottom: 0; }
  .ag-md p { margin: 0 0 .7em; }
  .ag-md h3, .ag-md h4, .ag-md h5, .ag-md h6 { line-height: 1.3; margin: 1.1em 0 .45em; font-weight: 600; }
  .ag-md h3 { font-size: 16px; } .ag-md h4 { font-size: 14.5px; } .ag-md h5 { font-size: 13.5px; } .ag-md h6 { font-size: 13px; }
  .ag-md ul, .ag-md ol { margin: 0 0 .7em; padding-left: 20px; }
  .ag-md li { margin: .2em 0; }
  .ag-md blockquote { margin: 0 0 .7em; padding: 6px 10px; border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-textBlockQuote-background); border-radius: 0 6px 6px 0; }
  .ag-md blockquote p { margin: 0; }
  .ag-md pre { white-space: pre; overflow-x: auto; margin: 0; padding: 8px 10px;
               background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.5; }
  .ag-md code { font-family: var(--vscode-editor-font-family); font-size: 12px; background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 4px; }
  .ag-md pre code { padding: 0; background: transparent; }
  .bang-cuon { overflow-x: auto; margin: 0 0 .8em; border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
  .ag-md table { border-collapse: collapse; width: 100%; font-size: 12px; }
  .ag-md th, .ag-md td { padding: 5px 9px; text-align: left; white-space: nowrap; }
  .ag-md th { background: var(--vscode-textBlockQuote-background); font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border); }
  .ag-md tr:nth-child(even) td { background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); }
  /* ↓ Tin mới: hiện khi có nội dung mới mà người dùng đang cuộn lên đọc (không giật về đáy) */
  #pill-moi { position: fixed; left: 50%; transform: translateX(-50%); bottom: 96px; z-index: 20; padding: 3px 12px; border-radius: 999px; font-size: 11.5px;
              box-shadow: 0 2px 10px rgba(0,0,0,.35); }
  .khoi-ma { border: 1px solid var(--vscode-panel-border); margin: 6px 0; }
  .khoi-ma-dau { display: flex; gap: 4px; align-items: center; padding: 2px 4px; font-size: 11px;
                 background: var(--vscode-editorWidget-background); }
  .khoi-ma-dau span { flex: 1; opacity: .7; }
  .khoi-ma-dau button { font-size: 11px; padding: 1px 6px; }
  .ag-tool { font-size: 12px; opacity: .85; cursor: pointer; margin: 2px 0; font-family: var(--vscode-editor-font-family); }
  .ag-tool-ct { font-size: 11px; opacity: .75; margin-left: 14px; white-space: pre-wrap; }
  .ag-nghi { font-size: 11px; opacity: .7; margin: 2px 0; white-space: pre-wrap; }
  .ag-ke-hoach { border-left: 2px solid var(--vscode-charts-blue, var(--vscode-focusBorder)); padding-left: 6px; margin: 4px 0; font-size: 12px; }
  .ag-the { border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
            background: var(--vscode-editorWidget-background); padding: 6px; margin: 6px 0; font-size: 12px; }
  .ag-the input { width: 100%; box-sizing: border-box; margin-top: 4px; background: var(--vscode-input-background);
                  color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
  .ag-the .nut-chinh { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 4px 12px; font-weight: 600; cursor: pointer; }
  .ag-the .nut-phu { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, inherit); border: 0; padding: 4px 10px; cursor: pointer; }
  .ag-the .nut-nhe { background: transparent; color: var(--vscode-descriptionForeground, inherit); border: 0; padding: 4px 6px; cursor: pointer; text-decoration: underline; }
  .ag-the .nut-nguy { background: var(--vscode-errorForeground, #c33); color: var(--vscode-editor-background, #fff); border: 0; padding: 4px 12px; font-weight: 600; cursor: pointer; }
  .ag-the .canh-bao-xoa { margin-top: 4px; padding: 4px 6px; border-left: 3px solid var(--vscode-errorForeground, #c33); font-size: 12px; }
  .ag-the .the-duyet-nut { flex-wrap: wrap; align-items: center; }
  .ag-the .nut-nhe, .ag-the .nut-phu, .ag-the .nut-chinh, .ag-the .nut-nguy { white-space: nowrap; }
  .ag-the .nut-het { flex-basis: 100%; order: 9; white-space: normal; text-align: left; border: 1px solid var(--vscode-focusBorder, currentColor); background: transparent; }
  .ag-the .tieu-de { font-weight: 600; margin-bottom: 2px; }
  .ag-the button:disabled { opacity: .5; cursor: default; }
  .ag-tu-duyet { font-size: 11px; opacity: .75; margin: 2px 0; }
  .luot[data-loi] { border-left: 3px solid var(--vscode-errorForeground, #c33); padding-left: 8px; }
  .loi-goi-y { font-size: 11px; opacity: .8; margin-top: 4px; }
  .hang-hanh-dong { display: flex; gap: 4px; margin: 4px 0 8px; }
  .hang-hanh-dong button { background: transparent; color: var(--vscode-descriptionForeground, inherit); border: 0; padding: 2px 6px; cursor: pointer; font-size: 11px; text-decoration: underline; }
  .ag-phan-hoi { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 4px 0; font-size: 11px; }
  .ag-phan-hoi button { font-size: 12px; padding: 0 6px; opacity: .7; }
  .ag-phan-hoi button.chon { opacity: 1; outline: 1px solid var(--vscode-focusBorder); }
  .ag-phan-hoi input { flex: 1; min-width: 120px; background: var(--vscode-input-background);
                       color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
  .ag-phan-hoi .nhan { opacity: .7; }
  /* ══ 0.3.1 — khớp mockup đã duyệt: thanh trên · trạng thái rỗng có thẻ gợi ý · hộp soạn một khối · hàng dưới ô nhập ══ */
  #vung-tai-khoan { justify-content: flex-start; gap: 8px; padding: 2px 0 6px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 6px; }
  #vung-tai-khoan .ten { font-weight: 600; font-size: 12px; letter-spacing: .02em; }
  #vung-tai-khoan #nut-tai-khoan { margin-left: auto; }
  #rong-lan-dau { opacity: 1; font-size: 13px; line-height: 1.5; padding: 18px 4px 8px; display: flex; flex-direction: column; gap: 12px; }
  #rong-lan-dau[hidden] { display: none; }
  #rong-lan-dau h3 { margin: 0; font-size: 15px; font-weight: 600; }
  #rong-lan-dau p { margin: 0; color: var(--vscode-descriptionForeground); font-size: 12px; }
  #rong-lan-dau p[hidden] { display: none; }
  .goi-y { display: grid; gap: 6px; }
  .goi-y button { text-align: left; display: grid; grid-template-columns: 34px 1fr; gap: 8px; align-items: start; padding: 8px 10px; border: 1px solid var(--vscode-panel-border);
                  border-radius: 8px; background: var(--vscode-editorWidget-background); color: var(--vscode-foreground); cursor: pointer; font-size: 12.5px; }
  .goi-y button:hover, .goi-y button:focus-visible { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
  .goi-y .bieu-tuong { font-size: 9.5px; font-weight: 700; text-align: center; padding: 3px 0; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .goi-y small { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; }
  #vung-agent { margin-top: 4px; gap: 6px; }
  #vung-agent button[hidden] { display: none; }
  #hang-nhap { display: block; margin-top: 6px; border: 1px solid var(--vscode-input-border); border-radius: 8px; background: var(--vscode-input-background); position: relative; }
  #hang-nhap:focus-within { border-color: var(--vscode-focusBorder); }
  #hang-nhap #o-nhap { display: block; width: 100%; border: 0; outline: none; background: transparent; padding: 8px 10px 4px; border-radius: 8px 8px 0 0; }
  #hang-nhap #ds-dinh-kem { padding: 8px 8px 0; margin-top: 0; }
  .soan-thanh { display: flex; align-items: center; gap: 4px; padding: 4px 6px 6px; }
  .soan-thanh #nut-dinh-kem { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; font-size: 12px; border-radius: 6px; }
  .soan-thanh #o-che-do { -webkit-appearance: none; appearance: none; background: transparent url('data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%2710%27 viewBox=%270 0 10 10%27><path d=%27M2 3.5l3 3 3-3%27 fill=%27none%27 stroke=%27%23999%27 stroke-width=%271.4%27/></svg>') no-repeat right 4px center;
                          color: var(--vscode-foreground); border: 1px solid transparent; border-radius: 6px; padding: 3px 18px 3px 8px; font-size: 12px; cursor: pointer; max-width: 55%; }
  .soan-thanh #o-che-do { field-sizing: content; }
  .soan-thanh #o-che-do:hover { background-color: var(--vscode-list-hoverBackground); }
  .soan-thanh #nut-gui { margin-left: auto; width: 28px; height: 28px; padding: 0; border-radius: 6px; }
  .soan-thanh #nut-dung { margin-left: auto; padding: 3px 10px; font-size: 12px; border-radius: 6px; background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-input-border); }
  .soan-thanh #nut-dung:not([hidden]) + #nut-gui, .soan-thanh #nut-gui + #nut-dung { margin-left: 4px; }
  .mo-ta-nho { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 3px 2px 0; }
  #mo-ta-che-do { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; flex-basis: auto; }
  .dong-ho { display: inline-flex; align-items: center; gap: 6px; flex: none; }
  #dong-ho-thanh { width: 56px; height: 4px; border-radius: 2px; background: var(--vscode-panel-border); overflow: hidden; display: inline-block; }
  #dong-ho-thanh i { display: block; height: 100%; width: 0; background: var(--vscode-charts-blue); }
  #dong-ho-thanh.cao i { background: var(--vscode-charts-yellow); }
  #thanh-ngu-canh[hidden] { display: none; }
</style>
</head>
<body>
<!-- ★★★ ĐỢT F / TASK 1 — đăng nhập NGAY TRONG KHUNG. Trước đợt này, "chưa đăng nhập" chỉ hiện một
     dòng lỗi rồi BỎ MẶC (không nút, không ô) — người dùng không biết bảng lệnh ở đâu.
     ★★★ ĐỢT G / TASK G1 / B2 — nay MỘT nút icon (#nut-tai-khoan) LUÔN có mặt trong DOM (đúng
     khuôn #nut-dung / #the-duyet đã dùng cho mọi trạng thái "đổi tại chỗ" khác trong tệp này) —
     chỉ title/aria-label/lớp CSS đổi, KHÔNG BAO GIỜ dựng lại HTML, để một câu hỏi đang gõ dở
     trong #o-nhap không bị mất khi trạng thái đăng nhập đổi (B4, xem xử lý tin trang_thai_dang_nhap). -->
<div id="vung-tai-khoan">
  <span class="ten">AI LOCAL</span>
  <span id="ma-build" title="Bản AI Local đang chạy (phiên bản+commit). Báo mã này khi báo lỗi; -dirty = build từ cây chưa commit."${maBuild ? "" : " hidden"}>${maBuild}</span>
  <!-- ★★★ ĐỢT G / TASK G3 / B4 — Ô CHỌN MỨC QUYỀN (chế độ tự trị). ⚠⚠⚠ ĐÂY LÀ MỘT CỔNG THÊM,
       KHÔNG PHẢI HÀNG RÀO: webview CHỈ báo Ý ĐỊNH đổi mức (\`dat_muc_quyen\`) và HIỂN THỊ mức đang áp
       (\`muc_quyen\`, do extension gửi lại sau khi tự kiểm bằng \`laMucQuyenHopLe\`) — đúng nguyên tắc
       "hiển thị + chuyển tiếp" đã áp cho thẻ duyệt/nút Dừng/@-mention. HÀNG RÀO THẬT của mức
       "Chỉ đọc" nằm ở BƯỚC 0 của \`ui/apBanVa.ts\` (điểm ghi DUY NHẤT) — một webview lỗi vẽ SAI mức
       đang chọn ở đây KHÔNG mở được đường ghi nào, vì \`apBanVa\` không tin bất kỳ ai đã kiểm hộ.
       Mặc định TĨNH của \`<select>\` là "Hỏi trước khi ghi" (option có \`selected\`) — AN TOÀN LÀ MẶC
       ĐỊNH cho tới khi tin \`muc_quyen\` đầu tiên (đọc từ \`workspaceState\`, hoặc mặc định an toàn nếu
       kho rỗng/hỏng — xem \`bangChat.ts#napMucQuyen\`) tới ghi đè \`.value\`. SVG nội tuyến, CÙNG CÁCH
       G1/G2 đã chọn cho các icon khác — CSP webview không có \`font-src\`. -->
  <div id="vung-muc-quyen" hidden title="Mức quyền ghi tệp của AI. Tự ghi: sửa/tạo/đổi tên tệp trong workspace KHÔNG hỏi (xoá tệp và chạy lệnh vẫn hỏi). Chỉ áp dụng cho dự án LOCAL — dự án SERVER luôn cần duyệt trên máy chủ.">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 1 2.3 3.2v3.9c0 3.9 2.5 7.3 5.7 8.4 3.2-1.1 5.7-4.5 5.7-8.4V3.2L8 1Zm0 1.6 4.2 1.6v3.9c0 3.2-1.9 5.9-4.2 6.8-2.3-.9-4.2-3.6-4.2-6.8V4.2L8 2.6Z" />
    </svg>
    <select id="o-muc-quyen" aria-label="Mức quyền ghi tệp của AI">
      <option value="chi_doc">Chỉ đọc</option>
      <option value="hoi_truoc_khi_ghi" selected>Hỏi trước khi ghi</option>
      <option value="tu_ghi">Tự ghi trong workspace</option>
    </select>
  </div>
  <button id="nut-tai-khoan" class="nut-icon"${daDangNhap ? " data-da-dang-nhap=\"true\"" : ""}
          title="${daDangNhap ? "Đăng xuất" : "Đăng nhập"}"
          aria-label="${daDangNhap ? "Đăng xuất" : "Đăng nhập"}">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.2c-2.73 0-6.2 1.37-6.2 4.1v.7h12.4v-.7c0-2.73-3.47-4.1-6.2-4.1Z" />
    </svg>
  </button>
</div>
<!-- 2026-10-24 — ghi chú NÓI THẬT khi dự án đang chọn là SERVER: server không có khái niệm tự-duyệt (confirmAction bắt buộc), nên mức "Tự ghi" ở đó KHÔNG có tác dụng; trước đây UI im lặng. -->
<div id="ghi-chu-quyen" hidden>Dự án SERVER: mọi lần ghi luôn cần duyệt trên máy chủ — mức quyền chỉ áp dụng cho dự án LOCAL.</div>
<select id="o-du-an" title="Chọn dự án" hidden></select>
<!-- ★★★ ĐỢT I / TASK I-5a — HƯỚNG DẪN lần đầu mở, CHƯA từng có lượt nào (markup TĨNH, giống khuôn
     #rong của htmlBoNho.ts). NHÁNH KIA: có lượt rồi ⇒ script ẩn nó NGAY khi bong bóng đầu tiên
     được thêm (xem themLuot); khôi phục lịch sử cũng ẩn nó TRƯỚC khi vẽ (xem xoaKhungChoPhienKhac
     gọi anRongLanDau()) — không hiện lại giữa các lượt của một hội thoại đã có nội dung. -->
<div id="hoi-thoai">
  <div id="rong-lan-dau"></div>
</div>
<div id="the-duyet" hidden>
  <div class="nhan">Đề xuất ghi tệp</div>
  <div id="duyet-nguon"></div>
  <div id="duyet-duong"></div>
  <div id="duyet-tom-tat"></div>
  <div id="duyet-han"></div>
  <div class="the-duyet-nut">
    <button id="nut-xem-diff">Xem diff</button>
    <!-- ⚠⚠⚠ KHÔNG đặt chữ mặc định cho nút này. Chữ trên nút nói byte sẽ rơi Ở ĐÂU ("Duyệt & ghi
         trên SERVER" = hộp cát máy chủ · "Ghi vào workspace" = đĩa máy lập trình viên) — một chữ
         mặc định là một câu khai về nơi ghi khi CHƯA AI nói nơi ghi là đâu, và nếu extension quên
         gửi nhanNut thì nó sẽ khai nhầm chế độ. Extension đặt chữ ở mỗi lần hiện thẻ; thiếu chữ
         thì thẻ KHÔNG hiện (xem xử lý the_duyet bên dưới). -->
    <button id="nut-duyet"></button>
    <button id="nut-huy">Huỷ</button>
  </div>
</div>
<!-- ★★★ ĐỢT M — THẺ DUYỆT CHẠY LỆNH, RIÊNG khỏi #the-duyet (đề xuất GHI TỆP). Hai loại hành động
     khác hẳn nhau (chạy tiến trình trên máy vs. đổi byte một tệp) — trộn chung một thẻ dễ khiến
     người bấm tưởng nhầm loại hành động đang duyệt. ⚠ #duyet-lenh-cau-lenh hiện NGUYÊN VĂN lệnh SẼ
     CHẠY (nhãn từ M1, không phải chuỗi model gõ thô) — đây là hàng rào ĐẦU TIÊN của M3 ("hiện nguyên
     văn lệnh sắp chạy"), không phải trang trí. -->
<div id="the-duyet-lenh" hidden>
  <div class="nhan">AI muốn CHẠY LỆNH trên máy này</div>
  <div id="duyet-lenh-cau-lenh"></div>
  <div id="duyet-lenh-thu-muc"></div>
  <div class="the-duyet-nut">
    <button id="nut-duyet-lenh">Chạy lệnh</button>
    <button id="nut-huy-lenh">Huỷ</button>
  </div>
</div>
<!-- ★★★ ĐỢT 4B — điều khiển AGENT. Chế độ mặc định TĨNH = "Agent — duyệt từng bước" (option ĐẦU TIÊN — không dùng
     thuộc tính selected: lưới G3/B4 đòi đúng MỘT thuộc tính chọn sẵn trong cả markup, dành cho mức quyền an toàn). "Chat cũ" giữ
     đường hỏi-đáp cũ qua máy chủ. Tự động chỉ bỏ bước duyệt khi mức quyền là "Tự ghi" (extension kiểm, không phải ô này). -->
<div id="vung-agent">
  <button id="nut-token" class="nut-phu" hidden title="Lấy token cổng /v1 bằng trình duyệt (device flow)">Đăng nhập AI Local</button>
  <button id="nut-hoan-tac" class="nut-phu" hidden>Hoàn tác lượt chạy</button>
</div>
<button id="pill-moi" type="button" hidden>↓ Tin mới</button>
<div id="hang-nhap">
  <!-- Gợi ý @-mention (host dựng danh sách; webview chỉ hiển thị + chuyển tiếp lựa chọn). -->
  <div id="mention-ds" hidden></div>
  <!-- Menu Đính kèm: webview chỉ BÁO Ý ĐỊNH; bộ chọn thật và mọi hàng rào (trần, chữ ký, tên nhạy cảm) nằm ở host. -->
  <div id="menu-dinh-kem" role="menu" hidden>
    <div class="ti-de">Đính kèm từ</div>
    <button id="mn-dinh-kem-ws" type="button" role="menuitem"><b>Tệp trong dự án…</b><span>Chọn trong dự án đang mở (đã lọc tệp nhạy cảm)</span></button>
    <button id="nut-dinh-kem-may" type="button" role="menuitem" title="Tệp hoặc ảnh từ máy (ngoài workspace)"><b>Tệp hoặc ảnh từ máy…</b><span>Ngoài workspace — chỉ tệp bạn chọn mới được gửi</span></button>
    <div class="mn-goi-y">Hoặc dán ảnh bằng Ctrl+V · kéo tệp vào khung</div>
  </div>
  <!-- Chip đính kèm (tên · kích thước · ảnh thu nhỏ) nằm TRONG hộp soạn, phía trên ô nhập. -->
  <div id="ds-dinh-kem" hidden></div>
  <textarea id="o-nhap" rows="1" placeholder="Hỏi AI Local… (Enter gửi, @ chèn tệp)"></textarea>
  <div class="soan-thanh">
    <button id="nut-dinh-kem" class="nut-icon" aria-haspopup="menu" aria-expanded="false" title="Đính kèm: tệp trong dự án, tệp hoặc ảnh từ máy. Cũng có thể dán ảnh (Ctrl+V) hoặc kéo tệp vào khung." aria-label="Đính kèm tệp hoặc ảnh để gửi kèm câu hỏi">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true" focusable="false">
        <path d="M11.3 4.6 6.4 9.5a1.9 1.9 0 1 0 2.7 2.7l4.6-4.6a3.4 3.4 0 1 0-4.8-4.8L3.8 7.9" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span id="dinh-kem-chu">Đính kèm</span>
    </button>
    <!-- Chế độ + mức quyền GỘP một điều khiển (mặc định TĨNH = Agent duyệt, option ĐẦU — lưới G3/B4 đòi đúng MỘT mặc định an toàn). -->
    <select id="o-che-do" aria-label="Chế độ làm việc và mức quyền của AI" title="Một điều khiển duy nhất cho chế độ và mức quyền ghi. Được lưu theo workspace.">
      <option value="sua">Agent · duyệt</option>
      <option value="hoi">Hỏi · chỉ đọc</option>
      <option value="tu-dong">Agent · tự ghi</option>
      <option value="chat-cu">Chat cũ (máy chủ)</option>
    </select>
    <button id="nut-gui" class="nut-icon" title="Gửi (Enter)" aria-label="Gửi (Enter)">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M1.2 1.4 14.8 8 1.2 14.6l2.6-6.1H9.5V7.5H3.8Z" />
      </svg>
    </button>
    <!-- Nút DỪNG: chỉ hiện khi một lượt đang chạy; nơi DUY NHẤT ẩn lại là tín hiệu "lượt đã xong". -->
    <button id="nut-dung" hidden>Dừng</button>
  </div>
</div>
<div class="mo-ta-nho">
  <div id="mo-ta-che-do"></div>
  <span class="dong-ho"><span id="dong-ho-token" title="Token ngữ cảnh gửi model ở lượt gần nhất (~ = ước lượng 2,8 ký tự/token khi cổng /v1 không trả usage lúc stream)">Ngữ cảnh: —</span><span id="dong-ho-thanh"><i></i></span></span>
</div>
<!-- Thống kê DEV (lượt · ký tự lịch sử · tệp đính kèm): KHÔNG hiện trên giao diện nữa, giữ trong DOM + tooltip đồng hồ ngữ cảnh. Đơn vị ĐO ĐƯỢC THẬT, không phải token. -->
<div id="thanh-ngu-canh"
     title="Đơn vị ĐO ĐƯỢC THẬT — ký tự, tệp, lượt — KHÔNG PHẢI số token (chưa đo được token thật ở tầng extension)" hidden>
  <span id="tk-luot">Lượt hội thoại: 0</span> ·
  <span id="tk-ky-tu">Ký tự lịch sử: 0</span> ·
  <span id="tk-dinh-kem">Tệp đính kèm: 0</span>
</div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const hoiThoai = document.getElementById("hoi-thoai");
  const oNhap = document.getElementById("o-nhap");
  let khoiTraLoi = null;
  let coMdDang = false;
  // ★★★ H3(b) (review toàn nhánh 2026-08-30) — cờ báo lượt "hoi" SẮP GỬI đến từ Cmd+K
  // ("dat_cau_hoi_tu_lenh") chứ không phải người dùng tự gõ. gui() đọc cờ này rồi ĐÍNH KÈM vào
  // postMessage({loai:"hoi"}) — đây là cách DUY NHẤT phía extension (bangChat.ts) biết một lượt hỏi
  // có mang giao thức Cmd+K hay không, vì nội dung cauHoi lúc đó trông giống hệt một câu gõ tay.
  let laCauHoiTuLenh = false;

  /**
   * ★★★ B1 (phân biệt câu hỏi/trả lời) — tham số ĐẦU nay là VAI ("nguoi_dung" | "ai" | "he_thong"),
   * KHÔNG còn là chữ nhãn tự do. \`NHAN_THEO_VAI\` là nơi DUY NHẤT ánh xạ vai → nhãn hiển thị; lớp
   * CSS tô màu ("luot-" + vai, xem CSS \`.luot-*\` phía trên) đọc THẲNG từ CÙNG tham số \`vai\` này —
   * không có hai bản sao (nhãn tự do + lớp tự do) để rồi trôi khỏi nhau, đúng bài học đã trả giá
   * nhiều lần trong dự án (hai câu gọi khác nhau âm thầm không còn khớp). Vai "nguoi_dung"/"ai" có
   * nhãn CỐ ĐỊNH — KHÔNG nơi gọi nào được ghi đè. \`nhanTuyChon\` CHỈ dành cho vai "he_thong": lỗi/
   * thông báo/lưu ý là BA nội dung khác nhau THẬT SỰ (không phải một sự thật bị chép tay hai lần)
   * nên không có một nhãn mặc định duy nhất — người gọi phải tự nói rõ đang báo cái gì.
   *
   * ★★★ ĐỢT G / TASK G4 / B3 — tham số THỨ BA \`moSettings\` (mặc định falsy, MỌI lời gọi cũ giữ
   * NGUYÊN hành vi). Khi true, bong bóng này có thêm một nút thật "Mở Settings" — dành riêng cho
   * lỗi KHÔNG-NỐI-ĐƯỢC-MÁY-CHỦ (xem \`bangChat.ts\`, \`laLoiKhongNoiDuocMayChu\`). Đặt Ở ĐÂY (trong
   * CHÍNH bong bóng lỗi), KHÔNG PHẢI một phần tử cố định ở đầu khung — lý do CÙNG với quyết định ở
   * B1 (không phình đầu khung): nút chỉ xuất hiện ĐÚNG lúc cần (đang có lỗi mạng), biến mất theo
   * đúng vòng đời của bong bóng đó, không chiếm chỗ vĩnh viễn.
   */
  const NHAN_THEO_VAI = { nguoi_dung: "Bạn", ai: "AI Local", he_thong: "Hệ thống" };
  // ★★★ ĐỢT I / TASK I-5a — hướng dẫn lần đầu mở chỉ có Ý NGHĨA khi khung THẬT SỰ chưa có lượt nào.
  // Ẩn Ở ĐÂY (điểm DUY NHẤT mọi bong bóng thật đi qua — kể cả lượt đầu do người dùng gõ VÀ lượt đầu
  // của một hội thoại vừa khôi phục) thay vì rải rác nhiều nơi tự đoán "đây có phải lần đầu không".
  // ⚠ \`xoaKhungChoPhienKhac\` (Chat mới/Lịch sử) xoá SẠCH \`#hoi-thoai\` bằng \`innerHTML = ""\` — phần
  // tử \`#rong-lan-dau\` TĨNH ban đầu bị phá huỷ CÙNG LÚC, nên biến này chỉ còn dùng được cho LẦN ĐẦU
  // (trước khi \`xoaKhungChoPhienKhac\` từng chạy); \`xoaKhungChoPhienKhac\` tự dựng lại một bản MỚI khi
  // cần hiện lại (xem hàm đó bên dưới) thay vì trông cậy vào biến này đã bị "mồ côi" khỏi DOM.
  let rongLanDau = document.getElementById("rong-lan-dau");
  function anRongLanDau() {
    if (rongLanDau) rongLanDau.hidden = true;
  }
  /** Dựng lại hướng dẫn lần-đầu bằng ĐÚNG nội dung tĩnh ban đầu — dùng khi \`#hoi-thoai\` vừa bị dọn
   *  sạch (\`innerHTML = ""\`) và cần hiện lại vì khung THẬT SỰ trống (không có lượt nào để vẽ). */
  // 0.3.1 — nội dung trạng thái rỗng dựng từ MỘT nơi (lần đầu + dựng lại khi dọn khung). Thẻ gợi ý theo nghề PLC/AOI; bấm = điền vào ô nhập (KHÔNG tự gửi).
  let anChoTroLyBat = false;
  const GOI_Y_RONG = [
    { bieu: "ST", tieu: "Giải thích tệp đang mở", phu: "Đọc tệp hiện tại + chẩn đoán", cau: "Giải thích tệp đang mở trong editor." },
    { bieu: "FB", tieu: "Viết FB điều khiển van 2 vị trí", phu: "Sinh mã IEC 61131-3 và biên dịch thử", cau: "Viết function block IEC 61131-3 (ST) điều khiển van 2 vị trí, có cờ lỗi và timeout." },
    { bieu: "HMI", tieu: "Đọc ảnh màn hình HMI báo lỗi", phu: "Dán ảnh (Ctrl+V) hoặc kéo vào khung", cau: "Đọc ảnh màn hình HMI đính kèm và cho biết mã lỗi nghĩa là gì.", anh: true },
    { bieu: "Test", tieu: "Tìm nguyên nhân test đỏ", phu: "Chạy test, đọc log, đề xuất bản sửa", cau: "Chạy test của dự án, đọc log lỗi và đề xuất bản sửa." },
  ];
  function tenDuAnDangChon() {
    const o = document.getElementById("o-du-an");
    const opt = o && o.options && o.selectedIndex >= 0 ? o.options[o.selectedIndex] : null;
    return opt && opt.textContent ? String(opt.textContent) : "";
  }
  let dongDuAnEl = null;
  function capNhatDongDuAn() {
    const e = dongDuAnEl;
    if (!e) return;
    const ten = tenDuAnDangChon();
    e.textContent = ten ? "Đang làm việc trên: " + ten : "";
    e.hidden = !ten;
  }
  function dungNoiDungRong(d) {
    d.textContent = "";
    d.innerHTML = "";
    const h = document.createElement("h3");
    h.textContent = "Hỏi về mã, tài liệu máy, hoặc nhờ AI sửa trong workspace";
    const p = document.createElement("p");
    p.id = "rong-du-an";
    dongDuAnEl = p;
    const luoi = document.createElement("div");
    luoi.className = "goi-y";
    for (const g of GOI_Y_RONG) {
      if (g.anh && !anChoTroLyBat) continue;
      const b = document.createElement("button");
      b.setAttribute("type", "button");
      const bt = document.createElement("span");
      bt.className = "bieu-tuong";
      bt.textContent = g.bieu;
      const nd = document.createElement("span");
      nd.textContent = g.tieu;
      const nho = document.createElement("small");
      nho.textContent = g.phu;
      nd.appendChild(nho);
      b.appendChild(bt);
      b.appendChild(nd);
      b.addEventListener("click", () => {
        oNhap.value = g.cau;
        canChinhODoCao();
        if (oNhap.focus) oNhap.focus();
      });
      luoi.appendChild(b);
    }
    const goiY = document.createElement("p");
    goiY.textContent = "Gõ @ để chèn tệp · Enter gửi, Shift+Enter xuống dòng.";
    d.appendChild(h);
    d.appendChild(p);
    d.appendChild(luoi);
    d.appendChild(goiY);
    capNhatDongDuAn();
  }
  function hienLaiRongLanDau() {
    const d = document.createElement("div");
    d.id = "rong-lan-dau";
    dungNoiDungRong(d);
    hoiThoai.appendChild(d);
    rongLanDau = d;
  }
  if (rongLanDau) dungNoiDungRong(rongLanDau);
  function themLuot(vai, chu, moSettings, nhanTuyChon) {
    anRongLanDau();
    const d = document.createElement("div");
    // "luot-nguoi_dung" → "luot-nguoi-dung": tên lớp CSS kebab-case, tên vai trong script snake_case
    // — chỉ đổi ký hiệu nối chữ, KHÔNG đổi sự thật (vẫn CÙNG một chuỗi \`vai\` truyền vào).
    d.className = "luot luot-" + vai.replace(/_/g, "-");
    if (nhanTuyChon === "Lỗi") d.setAttribute("data-loi", "1");
    const t = document.createElement("div");
    t.className = "nhan";
    t.textContent = nhanTuyChon || NHAN_THEO_VAI[vai];
    const c = document.createElement("div");
    c.textContent = chu;
    d.appendChild(t); d.appendChild(c);
    if (moSettings) {
      const b = document.createElement("button");
      b.className = "nut-mo-settings";
      b.textContent = "Mở Settings — đổi địa chỉ máy chủ";
      // Webview chỉ báo Ý ĐỊNH — extension mở đúng ô cấu hình qua lệnh có sẵn của VSCode
      // (\`workbench.action.openSettings\`), đúng nguyên tắc "hiển thị + chuyển tiếp" của cả tệp này.
      b.addEventListener("click", () => vscode.postMessage({ loai: "mo_settings_may_chu" }));
      d.appendChild(b);
    }
    hoiThoai.appendChild(d);
    hoiThoai.scrollTop = hoiThoai.scrollHeight;
    return c;
  }

  // ★★★ TASK 4 — nút Dừng: hiện khi một lượt hỏi ĐANG chạy, ẩn lúc rảnh. Webview không tự quyết
  // "dừng nghĩa là gì" (cắt SSE? đặt cờ vòng lặp?) — nó chỉ báo Ý ĐỊNH của người dùng qua
  // \`postMessage\`, đúng nguyên tắc "webview chỉ hiển thị + chuyển tiếp" đã áp cho thẻ duyệt.
  const nutDung = document.getElementById("nut-dung");
  nutDung.addEventListener("click", () => vscode.postMessage({ loai: "dung_hoi" }));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ ĐỢT F / TASK 1 — ĐĂNG NHẬP NGAY TRONG KHUNG. Webview chỉ CHUYỂN TIẾP ý định bấm nút —
  // đúng nguyên tắc "hiển thị + chuyển tiếp" đã áp cho thẻ duyệt và nút Dừng. Nó KHÔNG BAO GIỜ tự
  // hỏi tài khoản/mật khẩu: phía extension gọi ĐÚNG lệnh \`aviAiLocal.dangNhap\` đã đăng ký (dùng
  // \`showInputBox({password:true})\` sẵn có) — mật khẩu không bao giờ chạm tới webview này.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const nutTaiKhoan = document.getElementById("nut-tai-khoan");
  // ★★★ ĐỢT G / TASK G1 / B2 — MỘT nút hai vai trò: bấm nghĩa là đăng nhập hay đăng xuất tuỳ
  // TRẠNG THÁI HIỆN TẠI (tin \`trang_thai_dang_nhap\` GẦN NHẤT quyết định, xem xử lý bên dưới).
  // Khởi từ ĐÚNG markup TĨNH ban đầu (\`data-da-dang-nhap\` do \`dungHtmlBang\` dựng theo \`dv\`) —
  // không đoán \`false\` cứng ở đây, để hàm vẫn ĐÚNG cho đầu vào \`daDangNhap:true\` dù constructor
  // của BangChat hiếm khi truyền nó (luôn rơi về an toàn — xem docblock đầu tệp).
  let daDangNhapHienTai = nutTaiKhoan.dataset.daDangNhap === "true";
  nutTaiKhoan.addEventListener("click", () =>
    vscode.postMessage({ loai: daDangNhapHienTai ? "dangXuat" : "dangNhap" }));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ ĐỢT G / TASK G3 / B4 — Ô CHỌN MỨC QUYỀN. Webview chỉ báo Ý ĐỊNH (\`dat_muc_quyen\`) và hiển
  // thị mức đang áp (\`muc_quyen\`, xử lý bên dưới) — KHÔNG tự quyết mức nào là hợp lệ; đó là việc
  // của \`laMucQuyenHopLe\` phía extension. HÀNG RÀO THẬT của "Chỉ đọc" nằm ở \`apBanVa.ts\`, KHÔNG
  // phải ở đây — xem ghi chú tại markup \`#o-muc-quyen\`.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const oMucQuyen = document.getElementById("o-muc-quyen");
  // loại (local|server) của từng mục ô dự án — để ghi chú SERVER hiện đúng lúc (extension vẫn là bên quyết định chế độ).
  let loaiDuAnTheoId = {};
  const ghiChuQuyen = document.getElementById("ghi-chu-quyen");
  function capNhatGhiChuQuyen() {
    const o = document.getElementById("o-du-an");
    ghiChuQuyen.hidden = loaiDuAnTheoId[o.value] !== "server";
  }
  oMucQuyen.addEventListener("change", (e) =>
    vscode.postMessage({ loai: "dat_muc_quyen", mucQuyen: e.target.value }));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 5 — @-MENTION. Webview chỉ (1) phát hiện vị trí "@..." đang gõ, (2) hỏi extension
  // gợi ý (nội dung dropdown do EXTENSION dựng — cùng nguyên tắc thẻ duyệt), (3) chèn lựa chọn
  // của người dùng. KHÔNG quyết định tệp nào được phép mention (đó là hàng rào gửi ở phía
  // extension) và KHÔNG bao giờ gửi đi ký tự "@" kèm đường dẫn đã chọn.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const mentionDs = document.getElementById("mention-ds");
  /** Gợi ý ĐANG HIỂN THỊ (rỗng khi dropdown ẩn) — dùng để Tab chọn mục ĐẦU mà không cần chuột. */
  let goiYHienTai = [];
  /** Đường dẫn SẠCH đã chèn cho LƯỢT HỎI CHƯA GỬI hiện tại — đi kèm "hoi" rồi bị xoá sau khi gửi. */
  let mentionsHienTai = [];

  /**
   * Tìm khối "@đang-gõ" NGAY TRƯỚC con trỏ, nếu có. "@" phải đứng ĐẦU DÒNG hoặc ngay sau khoảng
   * trắng (tránh bắt nhầm "@" giữa một địa chỉ email như "ten@mien.com" làm trigger mention).
   * \`selectionStart\` rơi về CUỐI chuỗi khi chưa từng được đặt (gõ xong luôn ở cuối trong đa số
   * lượt gõ thật).
   */
  function viTriMention() {
    const text = oNhap.value;
    const caret = typeof oNhap.selectionStart === "number" ? oNhap.selectionStart : text.length;
    let i = caret - 1;
    while (i >= 0 && !/\\s/.test(text[i]) && text[i] !== "@") i--;
    if (i < 0 || text[i] !== "@") return null;
    if (i > 0 && !/\\s/.test(text[i - 1])) return null;
    return { batDau: i, truy: text.slice(i + 1, caret) };
  }

  function anMenuMention() {
    mentionDs.hidden = true;
    goiYHienTai = [];
  }

  function hienMenuMention(ds) {
    mentionDs.innerHTML = "";
    for (const duong of ds) {
      const dong = document.createElement("div");
      dong.className = "mention-muc";
      dong.textContent = duong;
      dong.addEventListener("click", () => chonGoiY(duong));
      mentionDs.appendChild(dong);
    }
    goiYHienTai = ds;
    mentionDs.hidden = ds.length === 0;
  }

  /**
   * ★★★ CHÈN ĐƯỜNG DẪN SẠCH — KHÔNG kèm "@". Bài học đã trả giá ở \`/ai-coding-workspace\`: chèn
   * "@src/…" khiến model đọc chính ký tự "@" đó theo nghĩa đen và hỏng MỌI lượt hỏi sau. \`duongSach\`
   * tới đây đã là đường TRẦN (không "@") — extension gửi nguyên đường tương đối, webview không tự
   * thêm hay bớt ký tự nào ở đầu.
   */
  function chonGoiY(duongSach) {
    const vt = viTriMention();
    if (!vt) return;
    const truoc = oNhap.value.slice(0, vt.batDau);
    const sau = oNhap.value.slice(vt.batDau + 1 + vt.truy.length);
    const chen = duongSach + " ";
    oNhap.value = truoc + chen + sau;
    const viTriMoi = (truoc + chen).length;
    oNhap.selectionStart = oNhap.selectionEnd = viTriMoi;
    mentionsHienTai.push(duongSach);
    anMenuMention();
  }

  oNhap.addEventListener("input", () => {
    const vt = viTriMention();
    if (!vt) { anMenuMention(); return; }
    vscode.postMessage({ loai: "xin_goi_y_mention", truy: vt.truy });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ ĐỢT G / TASK G2 / B1+B2 — NÚT ĐÍNH KÈM TỆP. Webview chỉ (1) báo Ý ĐỊNH bấm nút
  // (\`xin_dinh_kem\`) và (2) giữ DANH SÁCH ĐƯỜNG DẪN SẠCH đã được extension xác nhận cho phép
  // (\`them_dinh_kem\`) để hiển thị/gỡ — KHÔNG BAO GIỜ tự quyết tệp nào được phép rời máy, đúng
  // nguyên tắc "hiển thị + chuyển tiếp" đã áp cho thẻ duyệt/@-mention. Bộ chọn THẬT (danh sách đã
  // qua hàng rào + hộp thoại) nằm ở phía extension (\`bangChat.moBoChonDinhKem\`).
  //
  // ★ SỐNG QUA NHIỀU LƯỢT HỎI — khác \`mentionsHienTai\` (bị xoá NGAY sau mỗi lần gửi, vì nó gắn với
  // CHÍNH văn bản câu hỏi vừa gõ): một tệp đã ĐÍNH KÈM chủ ý qua nút vẫn còn đó cho câu hỏi TIẾP
  // THEO, tới khi người dùng tự gỡ hoặc mở một phiên khác ("Chat mới"/"Lịch sử" — xem
  // \`xoaKhungChoPhienKhac\`, nơi mảng này bị xoá cùng lúc với bong bóng của phiên cũ).
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const dsDinhKem = document.getElementById("ds-dinh-kem");
  let tepDinhKemHienTai = [];
  // ★★★ 2026-10-24 — đính kèm NGOÀI workspace (người dùng CHỦ ĐỘNG dán ảnh / kéo tệp / chọn "Tệp từ máy…"): {loai, ten, kieu, kichThuoc, noiDung}.
  // MỘT LẦN (khác tệp workspace sống qua nhiều lượt): gửi kèm câu hỏi kế tiếp rồi xoá — ảnh nặng không được gửi lại mỗi lượt. Webview chỉ GOM + HIỂN THỊ; host kiểm lại
  // mọi thứ (trần, chữ ký ảnh, tên nhạy cảm) ở loi/dinhKemNgoai.ts.
  let dinhKemNgoaiHienTai = [];
  const TRAN_ANH = 6 * 1024 * 1024;
  const TRAN_TEP = 200 * 1024;
  const TOI_DA_ANH = 4;
  const TOI_DA_TEP = 5;
  const KIEU_ANH = ["image/png", "image/jpeg", "image/webp"];
  const DUOI_VAN_BAN = ["txt","md","log","csv","tsv","json","xml","yaml","yml","ini","cfg","conf","toml","st","scl","awl","sql","py","js","ts","tsx","jsx","cs","c","h","cpp","hpp","java","go","rs","sh","ps1","bat","html","css","gcode","nc"];
  function dinhDangByte(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B"; }
  function baoLoiDinhKem(chu) { themLuot("he_thong", chu, false, "Đính kèm"); }
  function docFileDinhKem(file) {
    return new Promise((resolve) => {
      const kieu = String(file.type || "").toLowerCase();
      const ten = file.name || (kieu.indexOf("image/") === 0 ? "anh-dan." + kieu.slice(6) : "tep");
      if (kieu.indexOf("image/") === 0) {
        if (KIEU_ANH.indexOf(kieu) < 0) { baoLoiDinhKem("Ảnh " + ten + " (" + kieu + ") chưa hỗ trợ — dùng PNG, JPEG hoặc WEBP."); resolve(null); return; }
        if (file.size > TRAN_ANH) { baoLoiDinhKem("Ảnh " + ten + " quá lớn (" + dinhDangByte(file.size) + ", tối đa " + dinhDangByte(TRAN_ANH) + ")."); resolve(null); return; }
        const fr = new FileReader();
        fr.onload = () => { const s = String(fr.result); resolve({ loai: "anh", ten, kieu, kichThuoc: file.size, noiDung: s.slice(s.indexOf(",") + 1) }); };
        fr.onerror = () => { baoLoiDinhKem("Không đọc được ảnh " + ten + "."); resolve(null); };
        fr.readAsDataURL(file);
        return;
      }
      const duoi = ten.indexOf(".") >= 0 ? ten.split(".").pop().toLowerCase() : "";
      const laVanBan = kieu.indexOf("text/") === 0 || kieu === "application/json" || kieu === "application/xml" || DUOI_VAN_BAN.indexOf(duoi) >= 0;
      if (!laVanBan) { baoLoiDinhKem("Tệp " + ten + " không phải ảnh hay văn bản — chưa hỗ trợ."); resolve(null); return; }
      if (file.size > TRAN_TEP) { baoLoiDinhKem("Tệp " + ten + " quá lớn (" + dinhDangByte(file.size) + ", tối đa " + dinhDangByte(TRAN_TEP) + ")."); resolve(null); return; }
      const fr = new FileReader();
      fr.onload = () => resolve({ loai: "tep", ten, kieu: "text/plain", kichThuoc: file.size, noiDung: String(fr.result) });
      fr.onerror = () => { baoLoiDinhKem("Không đọc được tệp " + ten + "."); resolve(null); };
      fr.readAsText(file);
    });
  }
  async function themFileDinhKem(files) {
    for (const f of files) {
      const soAnh = dinhKemNgoaiHienTai.filter((d) => d.loai === "anh").length;
      const soTep = dinhKemNgoaiHienTai.filter((d) => d.loai === "tep").length;
      const laAnh = String(f.type || "").toLowerCase().indexOf("image/") === 0;
      if (laAnh && soAnh >= TOI_DA_ANH) { baoLoiDinhKem("Tối đa " + TOI_DA_ANH + " ảnh mỗi lượt — bỏ " + (f.name || "ảnh") + "."); continue; }
      if (!laAnh && soTep >= TOI_DA_TEP) { baoLoiDinhKem("Tối đa " + TOI_DA_TEP + " tệp từ máy mỗi lượt — bỏ " + (f.name || "tệp") + "."); continue; }
      const m = await docFileDinhKem(f);
      if (m) dinhKemNgoaiHienTai.push(m);
    }
    veLaiDsDinhKem();
  }
  /** Một chip (cả trong danh sách chờ lẫn trong bong bóng người dùng): thumbnail nếu là ảnh + tên + kích thước. */
  function dungChipNgoai(m, lop) {
    const dong = document.createElement("span");
    dong.className = lop;
    if (m.loai === "anh") {
      const im = document.createElement("img");
      im.setAttribute("src", "data:" + m.kieu + ";base64," + m.noiDung);
      im.setAttribute("alt", m.ten);
      dong.appendChild(im);
    }
    const nhan = document.createElement("span");
    nhan.textContent = m.ten;
    const kt = document.createElement("span");
    kt.className = "kt";
    kt.textContent = dinhDangByte(m.kichThuoc);
    dong.appendChild(nhan);
    dong.appendChild(kt);
    return dong;
  }

  function veLaiDsDinhKem() {
    dsDinhKem.innerHTML = "";
    for (const m of dinhKemNgoaiHienTai) {
      const dong = dungChipNgoai(m, "dinh-kem-muc");
      const nutGo = document.createElement("button");
      nutGo.textContent = "×";
      nutGo.title = "Gỡ tệp đính kèm này";
      nutGo.setAttribute("aria-label", "Gỡ " + m.ten + " khỏi danh sách đính kèm");
      nutGo.addEventListener("click", () => {
        dinhKemNgoaiHienTai = dinhKemNgoaiHienTai.filter((d) => d !== m);
        veLaiDsDinhKem();
      });
      dong.appendChild(nutGo);
      dsDinhKem.appendChild(dong);
    }
    for (const duong of tepDinhKemHienTai) {
      const dong = document.createElement("div");
      dong.className = "dinh-kem-muc";
      const nhan = document.createElement("span");
      nhan.textContent = duong;
      const nutGo = document.createElement("button");
      nutGo.textContent = "×";
      nutGo.title = "Gỡ tệp đính kèm này";
      nutGo.setAttribute("aria-label", "Gỡ " + duong + " khỏi danh sách đính kèm");
      nutGo.addEventListener("click", () => {
        tepDinhKemHienTai = tepDinhKemHienTai.filter((d) => d !== duong);
        veLaiDsDinhKem();
      });
      dong.appendChild(nhan);
      dong.appendChild(nutGo);
      dsDinhKem.appendChild(dong);
    }
    // ★ NHÁNH KIA (B2) — gỡ tệp CUỐI CÙNG ⇒ danh sách BIẾN MẤT GỌN, không để lại khung rỗng lơ lửng.
    dsDinhKem.hidden = tepDinhKemHienTai.length === 0 && dinhKemNgoaiHienTai.length === 0;
    capNhatThanhNguCanh();
  }

  const nutDinhKem = document.getElementById("nut-dinh-kem");
  const menuDinhKem = document.getElementById("menu-dinh-kem");
  function datMenuDinhKem(mo) {
    menuDinhKem.hidden = !mo;
    nutDinhKem.setAttribute("aria-expanded", mo ? "true" : "false");
  }
  nutDinhKem.addEventListener("click", (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    datMenuDinhKem(menuDinhKem.hidden !== false);
  });
  document.getElementById("mn-dinh-kem-ws").addEventListener("click", () => {
    datMenuDinhKem(false);
    vscode.postMessage({ loai: "xin_dinh_kem" });
  });
  document.getElementById("nut-dinh-kem-may").addEventListener("click", () => {
    datMenuDinhKem(false);
    vscode.postMessage({ loai: "xin_dinh_kem_ngoai" });
  });
  document.addEventListener("click", (e) => {
    if (menuDinhKem.hidden) return;
    const dich = e && e.target;
    if (dich && menuDinhKem.contains && menuDinhKem.contains(dich)) return;
    datMenuDinhKem(false);
  });
  // ★★★ 2026-10-24 — DÁN ẢNH (Ctrl+V) và KÉO-THẢ TỆP. Trước đây webview không có trình nghe nào: ảnh chụp màn hình trong clipboard bị bỏ, tệp kéo vào bị trình duyệt xử lý mặc định.
  // Dán CHỮ vẫn như cũ (không có tệp trong clipboard ⇒ không chặn).
  oNhap.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
    const files = items.filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
    if (files.length === 0) return;
    e.preventDefault();
    themFileDinhKem(files);
  });
  function coTepKeoVao(e) {
    const t = e.dataTransfer;
    if (!t) return false;
    if (t.types && Array.from(t.types).some((k) => k === "Files" || k === "text/uri-list" || k === "resourceurls")) return true;
    return false;
  }
  document.addEventListener("dragover", (e) => {
    if (!coTepKeoVao(e)) return;
    e.preventDefault();
    document.body.classList.add("keo-tha");
  });
  document.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null) document.body.classList.remove("keo-tha");
  });
  document.addEventListener("drop", (e) => {
    document.body.classList.remove("keo-tha");
    if (!coTepKeoVao(e)) return;
    e.preventDefault();
    const t = e.dataTransfer;
    const files = t.files ? Array.from(t.files) : [];
    if (files.length > 0) { themFileDinhKem(files); return; }
    // kéo từ Explorer của VSCode: chỉ có đường dẫn (không có nội dung) ⇒ host đọc (người dùng CHỦ ĐỘNG kéo), cùng trần/hàng rào.
    const uris = String(t.getData("text/uri-list") || "").split("\\n").map((x) => x.trim()).filter((x) => x && x.charAt(0) !== "#");
    if (uris.length > 0) vscode.postMessage({ loai: "dan_uri", uris });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ ĐỢT G / TASK G2 / B3 — THANH TRẠNG THÁI NGỮ CẢNH. \`thongKeHoiThoai\` (số lượt + tổng ký tự
  // của LỊCH SỬ hội thoại) tới từ EXTENSION (đọc \`this.lichSu\` — nguồn sự thật, xem \`bangChat.ts\`);
  // \`tepDinhKemHienTai.length\` là dữ liệu SỐNG ngay trong webview. ★★★ KHÔNG BỊA SỐ TOKEN — ba
  // nhãn dưới đây phải khớp ĐÚNG thứ đang đếm, không đoán ra một con số token.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const tkLuot = document.getElementById("tk-luot");
  const tkKyTu = document.getElementById("tk-ky-tu");
  const tkDinhKem = document.getElementById("tk-dinh-kem");
  let thongKeHoiThoai = { soLuot: 0, soKyTu: 0 };
  function capNhatThanhNguCanh() {
    tkLuot.textContent = "Lượt hội thoại: " + thongKeHoiThoai.soLuot;
    tkKyTu.textContent = "Ký tự lịch sử: " + thongKeHoiThoai.soKyTu;
    const soDinhKem = tepDinhKemHienTai.length + dinhKemNgoaiHienTai.length;
    tkDinhKem.textContent = "Tệp đính kèm: " + soDinhKem;
    const chuDinhKem = document.getElementById("dinh-kem-chu");
    if (chuDinhKem) chuDinhKem.textContent = soDinhKem > 0 ? "Đính kèm (" + soDinhKem + ")" : "Đính kèm";
    const dh = document.getElementById("dong-ho-token");
    if (dh) dh.title = "Token ngữ cảnh gửi model ở lượt gần nhất. Hội thoại: " + thongKeHoiThoai.soLuot + " lượt · " + thongKeHoiThoai.soKyTu + " ký tự lịch sử · " + soDinhKem + " tệp đính kèm (đơn vị đo được, không phải token).";
  }

  /**
   * ★★★ ĐỢT I / TASK I-1a — CHỈ BÁO ĐANG CHẠY. Bong bóng AI vừa tạo (chưa có token nào tới) nay
   * mang một PHẦN TỬ RIÊNG \`choAiHienTai\`, con của CHÍNH \`khoiTraLoi\` (ba chấm CSS \`@keyframes\`,
   * không JS timer). \`khoiTraLoi.textContent += m.chu\` (token đầu tiên) tự XOÁ nó khỏi DOM THẬT
   * (gán \`textContent\` xoá MỌI con cũ) — nhưng DOM giả của lưới không mô phỏng hiệu ứng đó (xem
   * \`PhanTuGia\`, \`textContent\` chỉ là một thuộc tính chuỗi rời khỏi \`.con\`), nên KHÔNG được trông
   * cậy vào hiệu ứng ngầm ấy để lưới đo đúng: mọi nơi set \`khoiTraLoi.textContent\` PHẢI tự gọi
   * \`xoaChiBaoChoAi()\` NGAY TRƯỚC — đúng thứ tự đó mới đúng ở CẢ browser thật lẫn DOM giả.
   * Xoá bằng CÁCH LỌC \`.con\` của \`khoiTraLoi\` (không cần \`parentNode\`, phần tử này CHỈ BAO GIỜ có
   * đúng một cha — \`khoiTraLoi\` — nên không cần một API DOM tổng quát hơn mức lưới mô phỏng được).
   */
  let choAiHienTai = null;
  function xoaChiBaoChoAi() {
    if (choAiHienTai) {
      // DOM THẬT: gỡ khỏi cha. (Bản cũ chỉ splice trường con của DOM GIẢ trong test nên ba chấm KHÔNG BAO GIỜ biến mất ở trình duyệt thật khi khung được dựng bằng appendChild.)
      if (choAiHienTai.parentNode && choAiHienTai.parentNode.removeChild) choAiHienTai.parentNode.removeChild(choAiHienTai);
      else if (khoiTraLoi && khoiTraLoi.con) {
        const i = khoiTraLoi.con.indexOf(choAiHienTai);
        if (i >= 0) khoiTraLoi.con.splice(i, 1);
      }
    }
    choAiHienTai = null;
  }
  /** Đổi NỘI DUNG chỉ báo sang một dòng CÓ NGHĨA (từ \`thong_bao\` — "vòng N/3: đang đọc…") thay vì ba
   *  chấm chung chung — CHỈ áp dụng khi CHƯA có token nào tới (còn \`choAiHienTai\`); token đầu tiên
   *  tự xoá chỉ báo này (xem xử lý tin "token" bên dưới), nên không có chuyện chữ tiến độ cũ đứng lỳ
   *  cạnh câu trả lời đã bắt đầu stream. */
  function capNhatChiBaoChoAi(chu) {
    if (!choAiHienTai) return;
    choAiHienTai.className = "cho-ai-chu";
    choAiHienTai.textContent = chu;
  }

  // ★ 2026-10-24 — khung trả lời mới của một lượt (dùng cho gửi mới VÀ thử lại/tạo lại, không thêm bong bóng người dùng thứ hai).
  function batDauLuotAi() {
    xoaChiBaoChoAi(); // lượt TRƯỚC (nếu còn sót chỉ báo vì lý do bất thường) không được dính sang lượt này.
    xoaHangHanhDong();
    khoiTraLoi = themLuot("ai", "");
    // Ba chấm nhấp nháy CHUNG CHUNG mặc định — thay bằng dòng CÓ NGHĨA ngay khi thong_bao đầu tiên
    // của lượt này tới (xem xử lý tin "thong_bao" bên dưới).
    choAiHienTai = document.createElement("span");
    choAiHienTai.className = "cho-ai";
    choAiHienTai.appendChild(document.createElement("span"));
    choAiHienTai.appendChild(document.createElement("span"));
    choAiHienTai.appendChild(document.createElement("span"));
    khoiTraLoi.appendChild(choAiHienTai);
    nutDung.hidden = false;
  }
  let tinHoiCuoi = null;
  /** Gửi LẠI đúng câu hỏi (kèm đính kèm/@tệp) của lượt gần nhất — chỉ khi không có lượt nào đang chạy. */
  function guiLaiTinCuoi() {
    if (!tinHoiCuoi || nutDung.hidden === false) return;
    batDauLuotAi();
    anMenuMention();
    agBatDauLuot();
    vscode.postMessage(tinHoiCuoi);
  }
  function xoaHangHanhDong() {
    if (hangHanhDongHienTai && hangHanhDongHienTai.parentNode && hangHanhDongHienTai.parentNode.removeChild) hangHanhDongHienTai.parentNode.removeChild(hangHanhDongHienTai);
    hangHanhDongHienTai = null;
  }
  let hangHanhDongHienTai = null;
  /** Hàng "Chép câu trả lời · Tạo lại" dưới câu trả lời VỪA XONG (một hàng duy nhất, hàng cũ bị gỡ). */
  function themHangHanhDong() {
    xoaHangHanhDong();
    if (!khoiTraLoi || !khoiTraLoi.parentNode) return;
    const hang = taoPhan("div", "hang-hanh-dong");
    const nutChep = taoPhan("button", "", "Chép câu trả lời");
    nutChep.addEventListener("click", () => vscode.postMessage({ loai: "chep_tra_loi" }));
    const nutLai = taoPhan("button", "", "Tạo lại");
    nutLai.setAttribute("title", "Hỏi lại đúng câu vừa rồi");
    nutLai.addEventListener("click", guiLaiTinCuoi);
    hang.appendChild(nutChep);
    hang.appendChild(nutLai);
    khoiTraLoi.parentNode.appendChild(hang);
    hangHanhDongHienTai = hang;
  }
  /** Nút "Thử lại" trên thẻ lỗi (gửi lại câu hỏi cuối, đúng một lần cho mỗi thẻ). */
  function themNutThuLai(c) {
    if (!tinHoiCuoi || !c) return;
    const b = taoPhan("button", "nut-mo-settings", "Thử lại");
    b.addEventListener("click", () => { if (b.disabled) return; b.disabled = true; guiLaiTinCuoi(); });
    c.appendChild(b);
  }

  function gui() {
    const ngoai = dinhKemNgoaiHienTai.slice();
    const cauHoi = oNhap.value.trim() || (ngoai.length > 0 ? "Hãy xem nội dung đính kèm và cho biết bạn thấy gì." : "");
    if (!cauHoi) return;
    const khungNguoi = themLuot("nguoi_dung", cauHoi);
    if (ngoai.length > 0) {
      // người dùng thấy RÕ đã đính kèm gì (tên · kích thước · ảnh thu nhỏ) ngay trong câu hỏi của mình
      const hang = document.createElement("div");
      hang.className = "dinh-kem-trong-luot";
      for (const m of ngoai) hang.appendChild(dungChipNgoai(m, "dk"));
      khungNguoi.appendChild(hang);
    }
    dinhKemNgoaiHienTai = [];
    veLaiDsDinhKem();
    oNhap.value = "";
    canChinhODoCao();
    batDauLuotAi();
    anMenuMention();
    // ★★★ ĐỢT G / TASK G2 / B1+B2 — HỢP NHẤT hai nguồn tệp: @-mention gõ TRONG câu hỏi này
    // (\`mentionsHienTai\`, dùng MỘT LẦN rồi xoá) và tệp đính kèm CHỦ Ý qua nút (\`tepDinhKemHienTai\`,
    // SỐNG QUA nhiều lượt). Cả hai đi chung MỘT mảng \`tepMention\` — phía extension (\`hoi()\`,
    // \`bangChat.ts\`) đọc CẢ HAI bằng đúng MỘT vòng lặp \`chayToolCucBo({loai:"doc_tep"...})\`, không
    // có đường đọc thứ hai. \`Set\` khử trùng lặp — chọn CÙNG tệp qua cả hai đường không đọc nó hai lần.
    const tepMention = [...new Set([...mentionsHienTai, ...tepDinhKemHienTai])];
    mentionsHienTai = [];
    // ★★★ H3(b) — đọc rồi RESET NGAY (không phải cờ dính): chỉ LƯỢT "hoi" NÀY được đánh dấu Cmd+K,
    // câu gõ tay kế tiếp (kể cả khi người dùng gõ ngay sau khi ô nhập vừa được Cmd+K đổ chữ vào,
    // trước khi gui() kịp chạy) không được ăn theo cờ của lượt trước.
    const tuLenh = laCauHoiTuLenh;
    laCauHoiTuLenh = false;
    // ★★★ ĐỢT 4B — chế độ agent đi kèm lượt hỏi (Cmd+K và "Chat cũ" KHÔNG kèm ⇒ đường cũ). Ô rỗng ⇒ mặc định "sua".
    const cheDo = oCheDo.value || "sua";
    const tin = { loai: "hoi", cauHoi, duAnId: document.getElementById("o-du-an").value, tepMention, tuLenh };
    if (ngoai.length > 0) tin.dinhKemNgoai = ngoai;
    if (!tuLenh && cheDo !== "chat-cu") tin.cheDoAgent = cheDo;
    agBatDauLuot();
    tinHoiCuoi = tin;
    vscode.postMessage(tin);
  }

  // ════ ★★★ ĐỢT 4B — AGENT: trạng thái + dựng DOM. KHÔNG innerHTML với nội dung — chỉ createElement/textContent/
  //      setAttribute; innerHTML chỉ được gán chuỗi RỖNG để dọn. Cây markdown đến từ host đã qua danh sách trắng
  //      (loi/markdownAnToan.ts) và được lọc LẦN HAI ở veNutMd (loại lạ ⇒ bỏ). ════
  const oCheDo = document.getElementById("o-che-do");
  // ★ 2026-10-24 — chế độ được LƯU theo workspace: đổi ở đây ⇒ báo host lưu; host gửi lại tin che_do lúc san_sang (và sau mỗi lần đổi) để ô vẽ ĐÚNG chế độ đã lưu.
  // ★ 2026-10-24 — MỘT ô cho chế độ + mức quyền ghi: giá trị hiển thị suy ra từ CẢ HAI giá trị host đã lưu (nên không bao giờ nói dối),
  // và chọn ở đây báo host lưu CẢ HAI (host mới là nơi quyết định, ô này chỉ hiển thị + chuyển tiếp).
  const MO_TA_CHE_DO = {
    "hoi": "Chỉ đọc và trả lời — không sửa tệp, không chạy lệnh.",
    "sua": "AI đề xuất, bạn duyệt từng thay đổi. Lệnh shell luôn hỏi.",
    "tu-dong": "Tự sửa/tạo/đổi tên tệp trong workspace, không hỏi. Xoá tệp và chạy lệnh vẫn hỏi.",
    "chat-cu": "Hỏi–đáp qua máy chủ AOI. Dự án SERVER luôn cần duyệt trên máy chủ."
  };
  let cheDoLuu = "sua";
  let mucQuyenLuu = "hoi_truoc_khi_ghi";
  function cheDoHienThi(cheDo, mucQuyen) {
    if (cheDo === "hoi" || cheDo === "chat-cu") return cheDo;
    if (mucQuyen === "chi_doc") return "hoi";
    return mucQuyen === "tu_ghi" ? "tu-dong" : "sua";
  }
  const moTaCheDo = document.getElementById("mo-ta-che-do");
  function veOCheDo() {
    oCheDo.value = cheDoHienThi(cheDoLuu, mucQuyenLuu);
    moTaCheDo.textContent = MO_TA_CHE_DO[oCheDo.value] || "";
  }
  oCheDo.addEventListener("change", () => {
    const v = oCheDo.value;
    vscode.postMessage({ loai: "dat_che_do", cheDo: v });
    if (v === "tu-dong") vscode.postMessage({ loai: "dat_muc_quyen", mucQuyen: "tu_ghi" });
    else if (v === "sua") vscode.postMessage({ loai: "dat_muc_quyen", mucQuyen: "hoi_truoc_khi_ghi" });
    moTaCheDo.textContent = MO_TA_CHE_DO[v] || "";
  });
  moTaCheDo.textContent = MO_TA_CHE_DO.sua;
  const nutToken = document.getElementById("nut-token");
  const dongHoToken = document.getElementById("dong-ho-token");
  const nutHoanTac = document.getElementById("nut-hoan-tac");
  nutToken.addEventListener("click", () => vscode.postMessage({ loai: "ag_dang_nhap_thiet_bi" }));
  nutHoanTac.addEventListener("click", () => { nutHoanTac.disabled = true; vscode.postMessage({ loai: "ag_hoan_tac" }); });
  let agDoan = null;
  let agNghi = null;
  let agKeHoach = null;
  let agTool = {};
  const agThe = {};
  function agBatDauLuot() { agDoan = null; agNghi = null; agKeHoach = null; agTool = {}; coMdDang = false; }
  /** Thay TOÀN BỘ nội dung một khối bằng cây markdown (đường Chat/SERVER + lịch sử). Chỉ createElement/textContent — innerHTML chỉ nhận chuỗi rỗng để dọn. */
  function veLaiKhoiMd(el, cay, chiSoMaDau, dangStream) {
    el.textContent = "";
    el.innerHTML = "";
    if (typeof el.className === "string" && el.className.indexOf("ag-md") < 0) el.className = (el.className + " ag-md").trim();
    veMd(cay, chiSoMaDau, el, dangStream);
  }
  function agKhung() { if (!khoiTraLoi) khoiTraLoi = themLuot("ai", ""); return khoiTraLoi; }
  function taoPhan(the, lop, chu) {
    const e = document.createElement(the);
    if (lop) e.className = lop;
    if (chu != null) e.textContent = chu;
    return e;
  }
  const THE_KHOI = { p: "p", blockquote: "blockquote", li: "li", strong: "strong", em: "em", del: "del", ul: "ul", ol: "ol" };
  const HANH_DONG_MA = [
    ["chep", "Chép", "Chép vào clipboard"],
    ["chen", "Chèn", "Chèn vào vị trí con trỏ trong editor (qua điểm ghi có kiểm toán)"],
    ["ap-dung", "Áp dụng", "Đề xuất thay vùng chọn (hoặc cả tệp đang mở) — hiện thẻ duyệt + diff trước khi ghi"],
  ];
  /** Dựng MỘT nút của cây markdown an toàn. Loại lạ ⇒ bỏ qua (danh sách trắng lần 2). */
  function veNutMd(n, cha, demMa) {
    if (!n || typeof n.t !== "string") return;
    if (n.t === "text") { cha.appendChild(taoPhan("span", "", String(n.chu ?? ""))); return; }
    if (n.t === "br") { cha.appendChild(document.createElement("br")); return; }
    if (n.t === "hr") { cha.appendChild(document.createElement("hr")); return; }
    if (n.t === "codespan") { cha.appendChild(taoPhan("code", "", String(n.chu ?? ""))); return; }
    if (n.t === "h") {
      const h = document.createElement("h" + Math.min(6, Math.max(3, (n.cap | 0) + 2)));
      (n.con || []).forEach((c) => veNutMd(c, h, demMa));
      cha.appendChild(h);
      return;
    }
    if (n.t === "a") {
      const a = document.createElement("a");
      if (typeof n.href === "string" && /^(https?:\\/\\/|mailto:)/i.test(n.href)) { a.setAttribute("href", n.href); a.title = n.href; }
      (n.con || []).forEach((c) => veNutMd(c, a, demMa));
      cha.appendChild(a);
      return;
    }
    if (n.t === "code") {
      const chiSo = demMa.tiep++;
      const k = taoPhan("div", "khoi-ma");
      const dau = taoPhan("div", "khoi-ma-dau");
      dau.appendChild(taoPhan("span", "", String(n.ngonNgu || "mã")));
      // đang stream: khối chưa ĐĂNG KÝ chỉ số ở host (chỉ bản cuối mới đăng ký) ⇒ chưa hiện Chép/Chèn/Áp dụng, tránh nút chết
      for (const [hanhDong, nhan, goiY] of demMa.dangStream ? [] : HANH_DONG_MA) {
        const b = taoPhan("button", "nut-khoi-ma", nhan);
        b.title = goiY;
        b.addEventListener("click", () => vscode.postMessage({ loai: "ag_khoi_ma", chiSo, hanhDong }));
        dau.appendChild(b);
      }
      const pre = document.createElement("pre");
      pre.appendChild(taoPhan("code", "", String(n.ma ?? "")));
      k.appendChild(dau);
      k.appendChild(pre);
      cha.appendChild(k);
      return;
    }
    if (n.t === "table") {
      const b = document.createElement("table");
      const hd = document.createElement("tr");
      (n.dau || []).forEach((o) => { const th = document.createElement("th"); (o || []).forEach((c) => veNutMd(c, th, demMa)); hd.appendChild(th); });
      b.appendChild(hd);
      (n.hang || []).forEach((h) => {
        const tr = document.createElement("tr");
        (h || []).forEach((o) => { const td = document.createElement("td"); (o || []).forEach((c) => veNutMd(c, td, demMa)); tr.appendChild(td); });
        b.appendChild(tr);
      });
      const cuon = taoPhan("div", "bang-cuon"); // bảng rộng cuộn ngang TRONG khung riêng, không đẩy rộng cả khung chat
      cuon.appendChild(b);
      cha.appendChild(cuon);
      return;
    }
    const the = THE_KHOI[n.t];
    if (!the) return;
    const e = document.createElement(the);
    if (n.t === "ol" && n.batDau) e.setAttribute("start", String(n.batDau | 0));
    (n.con || []).forEach((c) => veNutMd(c, e, demMa));
    cha.appendChild(e);
  }
  function veMd(cay, chiSoMaDau, cha, dangStream) {
    const demMa = { tiep: chiSoMaDau | 0, dangStream: dangStream === true };
    (Array.isArray(cay) ? cay : []).forEach((n) => veNutMd(n, cha, demMa));
  }
  const NHAN_LY_DO = {
    "het-luot": "Đã dừng: hết số lượt cho phép.",
    "het-gio": "Đã dừng: hết thời gian cho phép.",
    "het-token": "Đã dừng: hết ngân sách token.",
    huy: "Đã dừng theo yêu cầu.",
    "lap-lai": "Đã dừng: model lặp lại cùng một lời gọi tool.",
    // Không còn phát (2026-10-17: nội dung đáng ngờ ⇒ cảnh báo/hạ tự trị, không dừng) — giữ cho bản ghi cũ.
    "menh-lenh-trong-du-lieu": "Đã dừng: dữ liệu chứa mệnh lệnh đáng ngờ.",
    "loi-model": "Đã dừng vì lỗi model.",
  };
  const MA_CAN_TOKEN = { CHUA_CO_TOKEN: 1, TOKEN_401: 1 };
  // ★ Đợt 5.1 VSCode — 👍/👎 (+ lý do 👎 tuỳ chọn) dưới câu trả lời CUỐI của lượt agent đã xong. Webview chỉ gửi ĐỊNH
  //   DANH (luotId, chiSoKhoi) + phiếu + lý do; văn bản câu hỏi/câu trả lời do HOST giữ (không tin chữ từ webview).
  //   Kết quả gửi chỉ hiện ở dòng trạng thái nhỏ — lỗi mạng KHÔNG thành lượt "Lỗi" hay hộp thoại (chi tiết: kênh Output).
  const agPhanHoi = {};
  function agNutPhanHoi(ph) {
    if (!ph || typeof ph.luotId !== "string" || typeof ph.chiSoKhoi !== "number") return;
    const vung = taoPhan("div", "ag-phan-hoi");
    const nutLen = taoPhan("button", "", "👍");
    const nutXuong = taoPhan("button", "", "👎");
    nutLen.title = "Câu trả lời hữu ích";
    nutXuong.title = "Câu trả lời chưa tốt";
    const oLyDo = document.createElement("input");
    oLyDo.setAttribute("placeholder", "Lý do (tuỳ chọn)");
    oLyDo.hidden = true;
    const nutLyDo = taoPhan("button", "", "Gửi lý do");
    nutLyDo.hidden = true;
    const trangThai = taoPhan("span", "nhan", "");
    const gui = (danhGia, lyDo) => {
      const tin = { loai: "ag_phan_hoi", luotId: ph.luotId, chiSoKhoi: ph.chiSoKhoi, danhGia };
      if (lyDo) tin.lyDo = lyDo;
      nutLen.className = danhGia === 1 ? "chon" : "";
      nutXuong.className = danhGia === -1 ? "chon" : "";
      trangThai.textContent = "Đang gửi…";
      vscode.postMessage(tin);
    };
    nutLen.addEventListener("click", () => { oLyDo.hidden = true; nutLyDo.hidden = true; gui(1, ""); });
    nutXuong.addEventListener("click", () => { oLyDo.hidden = false; nutLyDo.hidden = false; gui(-1, ""); });
    nutLyDo.addEventListener("click", () => { const l = String(oLyDo.value || "").trim(); if (l) gui(-1, l); });
    vung.appendChild(nutLen);
    vung.appendChild(nutXuong);
    vung.appendChild(oLyDo);
    vung.appendChild(nutLyDo);
    vung.appendChild(trangThai);
    agPhanHoi[ph.luotId] = { trangThai };
    agKhung().appendChild(vung);
  }
  function agTheDuyet(m) {
    const laLenh = m.loaiDuyet === "lenh";
    const laXoa = !laLenh && m.thaoTac === "xoa";
    const the = taoPhan("div", "ag-the");
    the.appendChild(taoPhan("div", "nhan tieu-de", laLenh ? "AI muốn CHẠY LỆNH" : laXoa ? "AI muốn XOÁ tệp" : "Đề xuất thay đổi tệp"));
    if (!(m.lenh && String(m.tomTat || "") === String(m.lenh))) the.appendChild(taoPhan("div", "", String(m.tomTat || "")));
    if (m.lenh) the.appendChild(taoPhan("code", "", String(m.lenh)));
    if (laXoa) the.appendChild(taoPhan("div", "canh-bao-xoa", "Tệp sẽ bị xoá khỏi workspace. Việc này không nằm trong nút Duyệt thông thường — cần xác nhận riêng."));
    const lyDo = document.createElement("input");
    lyDo.setAttribute("placeholder", "Lý do bác (tuỳ chọn)");
    lyDo.hidden = true;
    const hang = taoPhan("div", "the-duyet-nut");
    const nutDiff = taoPhan("button", "nut-phu", "Xem diff");
    const nutOk = taoPhan("button", laXoa ? "nut-nguy" : "nut-chinh", laLenh ? "Chạy" : laXoa ? "Xác nhận xoá…" : "Duyệt");
    const nutHet = taoPhan("button", "nut-phu nut-het", "Duyệt, tự duyệt các lần sửa tiếp trong lượt này");
    const nutBac = taoPhan("button", "nut-nhe", "Bác");
    const nutLyDo = taoPhan("button", "nut-nhe", "Thêm lý do");
    nutDiff.hidden = !m.coDiff;
    nutHet.hidden = m.coTheDuyetHet !== true;
    nutHet.setAttribute("title", "Chỉ cho SỬA/TẠO/ĐỔI TÊN tệp trong lượt này. Xoá tệp, chạy lệnh và nội dung đáng ngờ vẫn hỏi. Hết hiệu lực khi lượt kết thúc.");
    nutDiff.addEventListener("click", () => vscode.postMessage({ loai: "ag_xem_diff", id: m.id }));
    let daGui = false;
    let daHoiXoa = false;
    const khoaTatCa = () => { daGui = true; nutOk.disabled = true; nutBac.disabled = true; nutHet.disabled = true; };
    nutOk.addEventListener("click", () => {
      if (daGui) return;
      // XOÁ: hai bước — lần bấm đầu chỉ ĐỔI NHÃN nút (không gửi gì); lần hai mới gửi duyệt.
      if (laXoa && !daHoiXoa) { daHoiXoa = true; nutOk.textContent = "Xoá tệp này"; return; }
      khoaTatCa();
      vscode.postMessage({ loai: "ag_duyet", id: m.id });
    });
    nutHet.addEventListener("click", () => {
      if (daGui) return;
      khoaTatCa();
      vscode.postMessage({ loai: "ag_duyet_het", id: m.id });
    });
    nutBac.addEventListener("click", () => {
      if (daGui) return;
      khoaTatCa();
      vscode.postMessage({ loai: "ag_bac", id: m.id, lyDo: lyDo.value || "" });
    });
    nutLyDo.addEventListener("click", () => { lyDo.hidden = false; nutLyDo.hidden = true; });
    hang.appendChild(nutDiff); hang.appendChild(nutOk); hang.appendChild(nutHet); hang.appendChild(nutBac); hang.appendChild(nutLyDo);
    the.appendChild(hang);
    the.appendChild(lyDo);
    const trangThai = taoPhan("div", "nhan", "");
    the.appendChild(trangThai);
    agThe[m.id] = { the, nutOk, nutBac, nutDiff, nutHet, lyDo, trangThai };
    agKhung().appendChild(the);
    agDoan = null;
  }
  function xuLyTinAgent(m) {
    if (m.loai === "ag_bat_dau") { agBatDauLuot(); nutHoanTac.hidden = true; return; }
    if (m.loai === "ag_chu") {
      xoaChiBaoChoAi();
      if (!agDoan) { agDoan = taoPhan("div", "ag-doan ag-md"); agKhung().appendChild(agDoan); }
      agDoan.textContent += m.chu;
      return;
    }
    if (m.loai === "ag_md_dang") {
      // ★ 2026-10-24 — cây markdown TĂNG DẦN (host dựng lại văn bản đã nhận, tiết lưu): thay nội dung khối đang stream, KHÔNG nối chữ thô.
      xoaChiBaoChoAi();
      if (!agDoan) { agDoan = taoPhan("div", "ag-doan ag-md"); agKhung().appendChild(agDoan); }
      agDoan.textContent = "";
      agDoan.innerHTML = "";
      veMd(m.cay, 0, agDoan, true);
      return;
    }
    if (m.loai === "ag_md") {
      xoaChiBaoChoAi();
      if (!agDoan) { agDoan = taoPhan("div", "ag-doan ag-md"); agKhung().appendChild(agDoan); }
      agDoan.textContent = "";
      agDoan.innerHTML = "";
      veMd(m.cay, m.chiSoMaDau, agDoan);
      agDoan = null;
      return;
    }
    if (m.loai === "ag_nghi") {
      xoaChiBaoChoAi();
      if (!agNghi) {
        const d = taoPhan("details", "ag-nghi");
        d.appendChild(taoPhan("summary", "", "Suy luận của model"));
        agNghi = taoPhan("div", "", "");
        d.appendChild(agNghi);
        agKhung().appendChild(d);
      }
      agNghi.textContent += m.chu;
      return;
    }
    if (m.loai === "ag_goi_tool") {
      xoaChiBaoChoAi();
      const dong = taoPhan("div", "ag-tool", "⋯ " + String(m.moTa || m.ten));
      const ct = taoPhan("div", "ag-tool-ct", "");
      ct.hidden = true;
      dong.addEventListener("click", () => { ct.hidden = !ct.hidden; });
      const khung = agKhung();
      khung.appendChild(dong);
      khung.appendChild(ct);
      agTool[m.id] = { dong, ct, moTa: String(m.moTa || m.ten) };
      agDoan = null;
      return;
    }
    if (m.loai === "ag_ket_qua_tool") {
      const t = agTool[m.id];
      if (t) { t.dong.textContent = (m.ok ? "✓ " : "✗ ") + t.moTa; t.ct.textContent = String(m.tomTat || ""); t.dong.title = String(m.tomTat || ""); }
      return;
    }
    if (m.loai === "ag_ke_hoach") {
      if (!agKeHoach) { agKeHoach = taoPhan("div", "ag-ke-hoach"); agKhung().appendChild(agKeHoach); }
      agKeHoach.textContent = "";
      agKeHoach.innerHTML = "";
      agKeHoach.appendChild(taoPhan("div", "nhan", "Kế hoạch"));
      for (const v of m.viec || []) {
        const dau = v.trangThai === "xong" ? "☑ " : v.trangThai === "dang-lam" ? "◐ " : "☐ ";
        agKeHoach.appendChild(taoPhan("div", "", dau + String(v.noiDung || "")));
      }
      return;
    }
    if (m.loai === "ag_the_duyet") { xoaChiBaoChoAi(); agTheDuyet(m); return; }
    if (m.loai === "ag_tu_duyet") { xoaChiBaoChoAi(); agKhung().appendChild(taoPhan("div", "ag-tu-duyet", "✓ Đã tự duyệt (theo lựa chọn của bạn trong lượt này): " + String(m.tomTat || m.duong || ""))); agDoan = null; return; }
    if (m.loai === "ag_an_the_duyet") {
      const t = agThe[m.id];
      if (t) { t.nutOk.disabled = true; t.nutBac.disabled = true; if (t.nutHet) t.nutHet.disabled = true; t.trangThai.textContent = m.ketQua === "duyet" ? "Đã duyệt" : "Đã bác / huỷ"; }
      return;
    }
    if (m.loai === "ag_de_xuat_nho") {
      const the = taoPhan("div", "ag-the");
      the.appendChild(taoPhan("div", "nhan", "AI đề xuất ghi nhớ (" + (m.scope === "user" ? "người dùng" : "dự án") + ")"));
      the.appendChild(taoPhan("div", "", String(m.note || "")));
      const hang = taoPhan("div", "the-duyet-nut");
      const nutNho = taoPhan("button", "", "Nhớ");
      const nutBo = taoPhan("button", "", "Bỏ");
      nutNho.addEventListener("click", () => { nutNho.disabled = true; nutBo.disabled = true; vscode.postMessage({ loai: "ag_nho", id: m.id }); });
      nutBo.addEventListener("click", () => { nutNho.disabled = true; nutBo.disabled = true; vscode.postMessage({ loai: "ag_bo_nho", id: m.id }); });
      hang.appendChild(nutNho);
      hang.appendChild(nutBo);
      the.appendChild(hang);
      agThe["nho:" + m.id] = { the, nutNho, nutBo };
      agKhung().appendChild(the);
      agDoan = null;
      return;
    }
    if (m.loai === "ag_an_de_xuat_nho") { const t = agThe["nho:" + m.id]; if (t) t.the.hidden = true; return; }
    if (m.loai === "ag_usage") {
      const k = Number(m.vao) || 0;
      dongHoToken.textContent = "Ngữ cảnh: " + (m.uocLuong ? "~" : "") + (k >= 1000 ? (k / 1000).toFixed(1) + "k" : String(k)) +
        " token (" + (Number(m.ctxPhanTram) || 0) + "%)" + (m.ra ? " · ra " + m.ra : "");
      const pt = Math.max(0, Math.min(100, Number(m.ctxPhanTram) || 0));
      const thanh = document.getElementById("dong-ho-thanh");
      if (thanh) {
        const i = thanh.con && thanh.con[0] ? thanh.con[0] : thanh.firstChild;
        if (i && i.style) i.style.width = pt + "%";
        thanh.className = pt >= 75 ? "cao" : "";
      }
      return;
    }
    if (m.loai === "ag_checkpoint") { nutHoanTac.textContent = "Hoàn tác lượt chạy (" + (m.soTep | 0) + " tệp)"; return; }
    if (m.loai === "ag_xong") {
      xoaChiBaoChoAi();
      nutDung.hidden = true;
      if (m.lyDo && m.lyDo !== "hoan-thanh" && m.lyDo !== "khong-chay") themLuot("he_thong", NHAN_LY_DO[m.lyDo] || ("Đã dừng: " + m.lyDo), false, "Lưu ý");
      nutHoanTac.hidden = !m.coHoanTac;
      nutHoanTac.disabled = false;
      if (m.phanHoi) agNutPhanHoi(m.phanHoi);
      if (m.lyDo === "hoan-thanh") themHangHanhDong();
      khoiTraLoi = null;
      return;
    }
    if (m.loai === "ag_phan_hoi_kq") {
      const p = agPhanHoi[m.luotId];
      if (p) p.trangThai.textContent = m.ok ? "Đã ghi phản hồi." : "Chưa gửi được phản hồi (chi tiết ở Output › AI Local — Phản hồi).";
      return;
    }
    if (m.loai === "ag_loi") {
      xoaChiBaoChoAi();
      const c = themLuot("he_thong", String(m.thongDiep || ""), false, "Lỗi");
      if (m.ma !== "DANG_CHAY" && m.ma !== "KHONG_WORKSPACE") themNutThuLai(c);
      if (MA_CAN_TOKEN[m.ma]) {
        const b = taoPhan("button", "nut-mo-settings", "Đăng nhập AI Local (device flow)");
        b.addEventListener("click", () => vscode.postMessage({ loai: "ag_dang_nhap_thiet_bi" }));
        c.appendChild(b);
        nutToken.hidden = false;
      }
      return;
    }
    if (m.loai === "ag_canh_bao") {
      // Nội dung đáng ngờ / đã hạ tự trị — CẢNH BÁO, lượt KHÔNG dừng. textContent (không HTML).
      themLuot("he_thong", String(m.thongDiep || ""), false, m.haTuTri ? "Đã hạ tự trị" : "Cảnh báo");
      return;
    }
    if (m.loai === "ag_thong_bao") {
      capNhatChiBaoChoAi(String(m.thongDiep || ""));
      themLuot("he_thong", String(m.thongDiep || ""), false, "Thông báo");
      return;
    }
    if (m.loai === "ag_hoan_tac") {
      themLuot("he_thong", String(m.thongDiep || "") + ((m.chiTiet || []).length ? "\\n" + m.chiTiet.join("\\n") : ""), false, m.ok ? "Hoàn tác" : "Lỗi");
      nutHoanTac.hidden = !m.conHoanTac;
      nutHoanTac.disabled = false;
      return;
    }
    if (m.loai === "ag_token") { nutToken.hidden = m.coToken === true; return; }
    if (m.loai === "ag_thong_ke") { thongKeHoiThoai = { soLuot: m.soLuot ?? 0, soKyTu: m.soKyTu ?? 0 }; capNhatThanhNguCanh(); return; }
  }

  document.getElementById("nut-gui").addEventListener("click", gui);
  // ★ 2026-10-24 — Enter = GỬI, Shift+Enter = xuống dòng (Ctrl/Cmd+Enter vẫn gửi). BẮT BUỘC kiểm IME: gõ tiếng Việt
  // (Telex/VNI) dùng Enter để CHỐT từ đang soạn — lúc đó isComposing = true hoặc keyCode = 229 và TUYỆT ĐỐI không được gửi.
  function laPhimGui(e) {
    if (!e || e.key !== "Enter") return false;
    if (e.isComposing === true || e.keyCode === 229) return false;
    if (e.shiftKey || e.altKey) return false;
    return true;
  }
  oNhap.addEventListener("keydown", (e) => {
    if (!laPhimGui(e)) return;
    // gợi ý @-mention đang mở: Enter CHỌN gợi ý đầu (như Tab), không gửi dở câu
    if (goiYHienTai.length > 0 && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); chonGoiY(goiYHienTai[0]); return; }
    e.preventDefault();
    gui();
  });
  /** Ô nhập tự giãn theo nội dung (tối đa 160px — quá thì cuộn trong ô). */
  function canChinhODoCao() {
    if (!oNhap.style) return;
    oNhap.style.height = "auto";
    const cao = Number(oNhap.scrollHeight);
    if (cao > 0) oNhap.style.height = Math.min(cao + 2, 160) + "px";
  }
  oNhap.addEventListener("input", canChinhODoCao);
  // TASK 5 — Tab CHỌN gợi ý ĐẦU TIÊN đang hiện (bàn phím-trước, không bắt buộc dùng chuột); Escape
  // đóng dropdown mà KHÔNG chèn gì. Đặt ở listener RIÊNG, tách khỏi listener Ctrl+Enter phía trên
  // để mỗi khối chỉ lo một việc.
  oNhap.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && goiYHienTai.length > 0) { e.preventDefault(); chonGoiY(goiYHienTai[0]); return; }
    if (e.key === "Escape" && !mentionDs.hidden) { anMenuMention(); if (e.stopPropagation) e.stopPropagation(); }
  });
  // ★ 2026-10-24 — Esc = DỪNG lượt đang chạy (như nút Dừng). Không cướp Esc của: IME đang soạn, menu Đính kèm, gợi ý @-mention.
  document.addEventListener("keydown", (e) => {
    if (!e || e.key !== "Escape" || e.isComposing === true || e.keyCode === 229) return;
    if (menuDinhKem.hidden === false) { datMenuDinhKem(false); return; }
    if (!mentionDs.hidden) return;
    if (nutDung.hidden === false) vscode.postMessage({ loai: "dung_hoi" });
  });

  // Thẻ duyệt (chế độ SERVER): webview chỉ HIỂN THỊ chữ do extension đã dựng sẵn và CHUYỂN TIẾP
  // cú bấm nút — mọi quyết định (gọi confirmAction/cancelAction, xoá đề xuất khỏi bộ nhớ) nằm ở
  // phía extension. Webview không bao giờ tự quyết ghi hay không.
  const theDuyet = document.getElementById("the-duyet");
  // ĐỔI DỰ ÁN phải báo NGAY, không đợi tới câu hỏi kế tiếp: một đề xuất ghi đang chờ thuộc về dự án
  // nó sinh ra, nên phía extension cần biết lúc ô chọn đổi để vứt thẻ duyệt đi (xem bangChat.ts).
  document.getElementById("o-du-an").addEventListener("change", (e) => {
    capNhatGhiChuQuyen();
    capNhatDongDuAn();
    vscode.postMessage({ loai: "doi_du_an", duAnId: e.target.value });
  });
  document.getElementById("nut-xem-diff").addEventListener("click", () => vscode.postMessage({ loai: "xem_diff" }));

  // ★★★ CHỐNG BẤM HAI LẦN (Minor, 2026-08-30) — CHỈ nút GHI, và chỉ nó.
  //
  // Phía extension xoá trạng thái đề xuất SAU \`await\` (đọc secret · gọi mạng · ghi đĩa), nên giữa
  // hai cú bấm liền nhau trạng thái vẫn còn nguyên: cú thứ hai chạy trọn \`apBanVa\` lần nữa và
  // MỞ MỘT HÀNG KIỂM TOÁN THỨ HAI trên máy chủ. Lượt ghi thứ hai gần như chắc chắn bị chặn ở phép
  // so băm (đĩa đã đổi vì lượt đầu) — nhưng nó vẫn để lại một hàng \`ap_client_that_bai\` cho một
  // lượt người dùng KHÔNG hề định làm. Sổ kiểm toán khi ấy kể một câu chuyện sai về hành vi người
  // dùng, và đó là thứ duy nhất máy chủ có để kể lại.
  // ⚠ KHÔNG đụng \`textContent\` của nút: chữ trên nút là HÀNG RÀO (nó nói byte rơi Ở ĐÂU). Chỉ khoá.
  const nutDuyet = document.getElementById("nut-duyet");
  let dangGuiDuyet = false;
  function moKhoaNutDuyet() { dangGuiDuyet = false; nutDuyet.disabled = false; }
  nutDuyet.addEventListener("click", () => {
    if (dangGuiDuyet) return;
    dangGuiDuyet = true;
    nutDuyet.disabled = true;
    vscode.postMessage({ loai: "duyet" });
  });

  document.getElementById("nut-huy").addEventListener("click", () => vscode.postMessage({ loai: "huy" }));

  // ★★★ ĐỢT M — thẻ duyệt CHẠY LỆNH, RIÊNG khỏi thẻ ghi tệp ở trên. Webview chỉ hiển thị NGUYÊN VĂN
  // lệnh + thư mục do extension đã dựng sẵn và chuyển tiếp cú bấm — không tự quyết chạy hay không.
  // CÙNG khuôn chống-bấm-hai-lần (nut-duyet ở trên): một cú bấm thứ hai trong lúc lệnh đang chạy sẽ
  // spawn tiến trình THỨ HAI, không phải "gửi lại" — khoá nút ngay khi bấm.
  const theDuyetLenh = document.getElementById("the-duyet-lenh");
  const nutDuyetLenh = document.getElementById("nut-duyet-lenh");
  let dangGuiDuyetLenh = false;
  function moKhoaNutDuyetLenh() { dangGuiDuyetLenh = false; nutDuyetLenh.disabled = false; }
  nutDuyetLenh.addEventListener("click", () => {
    if (dangGuiDuyetLenh) return;
    dangGuiDuyetLenh = true;
    nutDuyetLenh.disabled = true;
    vscode.postMessage({ loai: "duyet_lenh" });
  });
  document.getElementById("nut-huy-lenh").addEventListener("click", () => vscode.postMessage({ loai: "huy_lenh" }));

  /**
   * ★★★ ĐỢT F / TASK 3 — dọn khung cho MỘT PHIÊN KHÁC: dùng CHUNG cho "Chat mới" (B3 — khung THỰC
   * SỰ trắng) VÀ "Lịch sử" (B4 — khung sắp vẽ lại nội dung của MỘT HỘI THOẠI KHÁC). Xoá bong bóng
   * của phiên VỪA RỜI trước khi (có thể) vẽ bong bóng mới — không thì hai cuộc hội thoại chồng lên
   * nhau trên cùng một khung. Đóng luôn thẻ duyệt/nút Dừng còn treo của phiên CŨ: cả hai đều thuộc
   * về phiên vừa rời, không thuộc phiên mới/phiên vừa chọn.
   *
   * ★★★ BẢN VÁ (2026-09-03, phán quyết cùng Đợt F / Task 4) — \`xoaCauDangGo\` tách RIÊNG hành vi
   * với ô nhập giữa hai nơi gọi hàm này: "Chat mới" (\`chat_moi\`) truyền \`true\` — bắt đầu phiên MỚI
   * hợp lý đi kèm khung TRẮNG THẬT, kể cả câu đang gõ dở. "Lịch sử" (\`khoi_phuc_hoi_thoai\`) truyền
   * \`false\` — Task 1 đã đặt nguyên tắc "câu hỏi đang gõ dở KHÔNG được mất" (xem hàng rào B4 ở nhánh
   * \`trang_thai_dang_nhap\` bên dưới); xem lại một hội thoại cũ rồi quay ra mà nháp đang gõ đã biến
   * mất là phá đúng nguyên tắc đó — người dùng chỉ đang XEM, không hề chủ động "rời phiên" như
   * "Chat mới".
   */
  function xoaKhungChoPhienKhac(xoaCauDangGo) {
    hoiThoai.innerHTML = "";
    // ★★★ ĐỢT I / TASK I-5a — \`innerHTML = ""\` vừa phá huỷ \`#rong-lan-dau\` TĨNH cùng lúc với bong
    // bóng cũ. Dựng lại NGAY (hiện sẵn) — nếu ngay sau đây có lượt được vẽ lại (\`khoi_phuc_hoi_thoai\`
    // có nội dung), \`themLuot\` bên dưới tự ẩn nó qua \`anRongLanDau()\`; nếu KHÔNG (khung THẬT SỰ
    // trống — "Chat mới", hoặc khôi phục một hội thoại 0 lượt), nó ĐỨNG YÊN hiện ra — đúng NHÁNH KIA
    // yêu cầu: có lượt rồi thì không hiện, chưa có lượt nào thì phải hiện.
    hienLaiRongLanDau();
    // ★★★ QA "kết cục thứ NĂM" (2026-09-06) — \`innerHTML = ""\` Ở TRÊN vừa xoá bong bóng AI cũ khỏi
    // DOM THẬT, nhưng biến \`choAiHienTai\` (đóng gói riêng trong closure, KHÔNG phải một node con mà
    // \`innerHTML\` biết dọn) vẫn còn trỏ vào phần tử chỉ báo mồ côi đó nếu phiên cũ bị đổi GIỮA LÚC
    // đang chạy (chưa có token nào tới để tự xoá nó qua nhánh "token" bên dưới). Không gọi
    // \`xoaChiBaoChoAi()\` ở đây thì một tin \`thong_bao\` TỚI MUỘN của luồng SSE cũ (dù đã được chặn ở
    // nguồn — xem hàng rào \`aborted\` mới thêm ở \`bangChat.ts\`) vẫn có một biến sống sẵn sàng nhận
    // \`capNhatChiBaoChoAi()\` mà không ai kiểm tra "chỉ báo này có còn thuộc phiên đang hiện không".
    // Gọi ở đây đóng cả hai lớp bằng CẤU TRÚC: dọn tham chiếu NGAY KHI phiên đổi, không dựa vào việc
    // luồng cũ có kịp tới hay không.
    xoaChiBaoChoAi();
    khoiTraLoi = null;
    theDuyet.hidden = true;
    moKhoaNutDuyet();
    // ★★★ ĐỢT M — cùng lý lẽ với thẻ ghi tệp ở trên: một yêu cầu chạy lệnh của phiên VỪA RỜI không
    // được sống sót sang phiên MỚI/phiên vừa chọn.
    theDuyetLenh.hidden = true;
    moKhoaNutDuyetLenh();
    nutDung.hidden = true;
    anMenuMention();
    if (xoaCauDangGo) oNhap.value = "";
    // ★★★ ĐỢT G / TASK G2 / B1 — tệp đính kèm thuộc về PHIÊN đang xem: rời sang "Chat mới" hay mở
    // một hội thoại KHÁC ở "Lịch sử" đều phải xoá danh sách của phiên VỪA RỜI, cùng lý lẽ với thẻ
    // duyệt/nút Dừng ở trên — một tệp đính kèm của hội thoại A tự động đi theo sang hội thoại B là
    // một rò rỉ ngữ cảnh giữa hai cuộc trò chuyện không liên quan.
    tepDinhKemHienTai = [];
    dinhKemNgoaiHienTai = [];
    veLaiDsDinhKem();
  }

  // ★ 2026-10-24 — CUỘN THÔNG MINH: chỉ tự cuộn xuống khi người dùng ĐANG Ở ĐÁY; đang cuộn lên đọc thì giữ nguyên chỗ và hiện "↓ Tin mới" (trước đây mỗi mảnh stream ép về đáy).
  const pillMoi = document.getElementById("pill-moi");
  function dangODay() {
    const kc = hoiThoai.scrollHeight - hoiThoai.scrollTop - (hoiThoai.clientHeight || 0);
    return !(kc >= 48); // NaN (DOM giả) ⇒ coi là đang ở đáy
  }
  function cuonNeuODay(odDay) {
    if (odDay) { hoiThoai.scrollTop = hoiThoai.scrollHeight; pillMoi.hidden = true; }
    else pillMoi.hidden = false;
  }
  hoiThoai.addEventListener("scroll", () => { if (dangODay()) pillMoi.hidden = true; });
  pillMoi.addEventListener("click", () => { hoiThoai.scrollTop = hoiThoai.scrollHeight; pillMoi.hidden = true; });

  window.addEventListener("message", (e) => {
    const m = e.data;
    const odDay = dangODay() || m.loai === "khoi_phuc_hoi_thoai" || m.loai === "chat_moi";
    if (typeof m.loai === "string" && m.loai.indexOf("ag_") === 0) { xuLyTinAgent(m); cuonNeuODay(odDay); return; }
    // ★★★ ĐỢT I / TASK I-1a — token ĐẦU TIÊN của lượt là tín hiệu "model đã bắt đầu trả lời thật":
    // xoá chỉ báo đang-chờ NGAY TRƯỚC khi ghi chữ, không sau — DOM giả của lưới không tự dọn hộ
    // (xem docblock \`xoaChiBaoChoAi\`), và kể cả trên browser thật thì cũng phải TỰ xoá thay vì trông
    // cậy \`textContent +=\` (đây là PHÉP CỘNG chuỗi, không phải phép GÁN — nó không xoá con cũ, một
    // \`<span>\` ba-chấm vẫn nằm nguyên trong DOM cạnh chữ vừa ghi nếu không dọn tay).
    if (m.loai === "token" && khoiTraLoi) {
      xoaChiBaoChoAi();
      // chữ thô CHỈ tới khi md_dang đầu tiên tới (≤ 1 nhịp tiết lưu); từ đó cây markdown của host là nguồn hiển thị duy nhất
      if (!coMdDang) khoiTraLoi.textContent += m.chu;
    }
    else if (m.loai === "md_dang" && khoiTraLoi) {
      coMdDang = true;
      xoaChiBaoChoAi();
      veLaiKhoiMd(khoiTraLoi, m.cay, 0, true);
    }
    // ★★★ ĐỢT I / TASK I-1b — NHÁNH KIA của I-1a: LỖI (bao gồm mất-kết-nối, cùng gói tin \`loi\` với
    // \`moSettings:true\` — xem \`bangChat.ts#laLoiKhongNoiDuocMayChu\`) phải XOÁ chỉ báo, không được
    // để nó quay mãi trong một bong bóng AI rỗng đứng lại vĩnh viễn cạnh bong bóng lỗi mới.
    else if (m.loai === "loi") {
      xoaChiBaoChoAi();
      const c = themLuot("he_thong", m.thongDiep, m.moSettings === true, "Lỗi");
      if (m.moSettings === true) c.appendChild(taoPhan("div", "loi-goi-y", "Kiểm tra máy chủ AI Local đang chạy, rồi bấm Thử lại."));
      themNutThuLai(c);
      nutDung.hidden = true;
    }
    else if (m.loai === "hoan_tat") {
      // ★★★ ĐỢT I / TASK I-1b — NHÁNH KIA: XONG lẫn DỪNG đều đi qua \`hoan_tat\` (xem docblock
      // \`bangChat.ts\`) — chỉ báo phải biến mất ở CẢ HAI, không chỉ đường "xong bình thường". Xoá
      // TRƯỚC khi (có thể) ghi \`vanBanCuoi\` — cùng lý do với nhánh "token" ở trên.
      xoaChiBaoChoAi();
      // vanBanCuoi chỉ có khi server bảo THAY chữ đã stream (degraded) — không phải mọi lượt.
      // ★ 2026-10-24 — cây markdown CUỐI của chính văn bản được hiển thị (host dựng, đã đăng ký khối mã); không có cây (host cũ) ⇒ hành vi cũ.
      if (Array.isArray(m.cay) && khoiTraLoi) veLaiKhoiMd(khoiTraLoi, m.cay, m.chiSoMaDau | 0, false);
      else if (m.vanBanCuoi != null && khoiTraLoi) khoiTraLoi.textContent = m.vanBanCuoi;
      coMdDang = false;
      // Cắt ngang hoặc khung hỏng: KHÔNG được im lặng — phải hiện, kể cả khi câu trả lời trông
      // như đã xong.
      if (m.canhBao) themLuot("he_thong", m.canhBao, false, "Lưu ý");
      // ★★★ TASK 4 — \`hoan_tat\` là tín hiệu DUY NHẤT "cả lượt hỏi (mọi vòng) đã xong", kể cả khi nó
      // xong VÌ bị dừng (extension vẫn gửi \`hoan_tat\` sau khi báo "đã dừng" — xem \`bangChat.ts\`).
      // Ẩn nút Dừng Ở ĐÂY, không đoán qua bất kỳ tín hiệu nào khác (token/thong_bao vẫn có thể bắn
      // giữa các vòng của MỘT lượt hỏi đang chạy — ẩn theo chúng sẽ ẩn nhầm lúc còn đang chạy).
      nutDung.hidden = true;
      if (khoiTraLoi && !m.canhBao) themHangHanhDong();
      // ★★★ ĐỢT G / TASK G2 / B3 — thống kê ngữ cảnh của lượt VỪA XONG (extension đã tính trên
      // \`this.lichSu\` THẬT — xem \`thongKeHoiThoaiHienTai\` ở \`bangChat.ts\`).
      thongKeHoiThoai = { soLuot: m.soLuot ?? 0, soKyTu: m.soKyTu ?? 0 };
      capNhatThanhNguCanh();
    } else if (m.loai === "them_dinh_kem") {
      // ★★★ ĐỢT G / TASK G2 / B1 — extension vừa xác nhận MỘT đường dẫn được phép đính kèm (đã qua
      // ĐÚNG hàng rào @-mention dùng — xem \`bangChat.moBoChonDinhKem\`). Khử trùng lặp: chọn lại
      // đúng tệp đã đính kèm không đẻ thêm một chip thứ hai.
      if (!tepDinhKemHienTai.includes(m.duong)) {
        tepDinhKemHienTai.push(m.duong);
        veLaiDsDinhKem();
      }
    } else if (m.loai === "them_dinh_kem_ngoai") {
      // host đã đọc + kiểm (trần, chữ ký ảnh, tên nhạy cảm) một tệp người dùng chọn/kéo từ máy — webview chỉ hiển thị + giữ để gửi kèm.
      if (m.muc && typeof m.muc.ten === "string" && (m.muc.loai === "anh" || m.muc.loai === "tep")) {
        dinhKemNgoaiHienTai.push(m.muc);
        veLaiDsDinhKem();
      }
    } else if (m.loai === "cau_hinh_anh") {
      anChoTroLyBat = m.bat === true;
      if (rongLanDau && rongLanDau.hidden !== true) dungNoiDungRong(rongLanDau);
    } else if (m.loai === "duAn") {
      const o = document.getElementById("o-du-an");
      o.innerHTML = "";
      let coDuAnServer = false;
      let soGocLocal = 0;
      loaiDuAnTheoId = {};
      for (const d of m.ds) {
        loaiDuAnTheoId[d.id] = d.loai;
        const opt = document.createElement("option");
        opt.value = d.id; opt.textContent = d.nhan;
        o.appendChild(opt);
        if (d.loai === "server") coDuAnServer = true;
        else soGocLocal++;
      }
      // ★★★ ĐỢT G / TASK G1 / B3 (bản vá NHÁNH KIA, 2026-09-03) — ẨN ô chọn CHỈ khi vừa (a) danh
      // sách toàn LOCAL VÀ (b) ĐÚNG MỘT gốc local. GIỮ hiện ngay khi có ÍT NHẤT một dự án SERVER
      // (lựa chọn THẬT, không suy ra được từ workspace) HOẶC khi có TỪ HAI gốc LOCAL trở lên.
      //
      // Lý do "một gốc thì ẩn, nhiều gốc thì hiện" KHÔNG PHẢI thẩm mỹ — nó bám theo đúng cách
      // \`bangChat.ts\` DÙNG mục đang chọn: \`thuMucLocalDangChon()\` tôn trọng \`duAnChon\` khi nó bắt
      // đầu bằng "local:" (chỉ rơi về \`workspaceFolders[0]\` lúc CHƯA chọn gì), và \`dsGocDoc()\` đặt
      // gốc đang chọn lên ĐẦU làm GỐC ƯU TIÊN cho cả ba tool đọc lẫn \`giaiDuongDeXuat\` ở đường ghi
      // (xem docblock hai hàm đó). Với ĐÚNG MỘT gốc local, "gốc ưu tiên" luôn là gốc duy nhất — ô
      // chọn không đổi được gì, ẩn là đúng (VSCode đã trỏ workspace rồi). Với TỪ HAI gốc local trở
      // lên (workspace đa thư mục), ô chọn quyết định GỐC NÀO được ưu tiên khi một đường model khai
      // khớp nhiều gốc — một chức năng THẬT, ẩn đi là lấy mất nó (các gốc còn lại vẫn là dự phòng
      // nên không thảm hoạ, nhưng vẫn là mất chức năng — đúng điều Đợt G ban đầu bỏ sót).
      o.hidden = !coDuAnServer && soGocLocal <= 1;
      capNhatGhiChuQuyen();
    } else if (m.loai === "the_duyet") {
      // Chữ hiển thị (nhãn nguồn, chữ trên nút ghi, tóm tắt +N/-M hay "Tạo tệp mới") do EXTENSION
      // dựng sẵn — webview chỉ đặt textContent, không tự suy luận gì thêm.
      // ★★★ FAIL-CLOSED: thiếu nhãn nguồn hoặc chữ nút ⇒ KHÔNG hiện thẻ. Hiện một nút ghi mà không
      // nói rõ ghi ở đâu (hoặc còn đeo chữ của lượt trước, có thể là chế độ KIA) đúng là "tai nạn
      // không cứu được" mà spec §7 mô tả.
      // Thẻ MỚI ⇒ một quyết định mới: mở khoá dù lượt trước kết thúc thế nào.
      moKhoaNutDuyet();
      if (!m.nhanNguon || !m.nhanNut) {
        theDuyet.hidden = true;
        themLuot("he_thong", "Thẻ duyệt thiếu nhãn nguồn hoặc chữ trên nút ghi — đã KHÔNG hiện thẻ.", false, "Lỗi");
      } else {
        document.getElementById("duyet-nguon").textContent = m.nhanNguon;
        document.getElementById("duyet-duong").textContent = m.duong;
        document.getElementById("duyet-tom-tat").textContent = m.tomTat;
        document.getElementById("nut-duyet").textContent = m.nhanNut;
        // Đề xuất CỤC BỘ không có TTL máy chủ ⇒ extension gửi chuỗi rỗng; nói đúng điều đó thay vì
        // in "Hạn duyệt: " cụt đuôi.
        document.getElementById("duyet-han").textContent =
          m.han ? "Hạn duyệt: " + m.han : "Không có hạn — đề xuất sống trong phiên làm việc này.";
        theDuyet.hidden = false;
      }
    } else if (m.loai === "an_the_duyet") {
      theDuyet.hidden = true;
      moKhoaNutDuyet();
    } else if (m.loai === "the_duyet_lenh") {
      // ★★★ ĐỢT M — CÙNG KỶ LUẬT FAIL-CLOSED với "the_duyet": thiếu \`lenh\` (nguyên văn lệnh sắp
      // chạy) ⇒ KHÔNG hiện thẻ. Đây là hàng rào ĐẦU TIÊN của M3 ("hỏi trước khi chạy, hiện nguyên
      // văn lệnh") — một thẻ hiện ra mà không nói RÕ lệnh gì là đúng loại "tai nạn không cứu được".
      moKhoaNutDuyetLenh();
      if (!m.lenh) {
        theDuyetLenh.hidden = true;
        themLuot("he_thong", "Thẻ duyệt chạy lệnh thiếu nội dung lệnh — đã KHÔNG hiện thẻ.", false, "Lỗi");
      } else {
        document.getElementById("duyet-lenh-cau-lenh").textContent = m.lenh;
        document.getElementById("duyet-lenh-thu-muc").textContent = m.thuMuc ? "Thư mục: " + m.thuMuc : "";
        theDuyetLenh.hidden = false;
      }
    } else if (m.loai === "an_the_duyet_lenh") {
      theDuyetLenh.hidden = true;
      moKhoaNutDuyetLenh();
    } else if (m.loai === "thong_bao") {
      // ⚠⚠ MỞ KHOÁ Ở ĐÂY LÀ BẮT BUỘC, không phải cho gọn. Đường SERVER có một ca CỐ Ý **giữ thẻ
      // lại**: "KHÔNG RÕ KẾT CỤC" (mất mạng giữa chừng) chỉ gửi \`thong_bao\` và KHÔNG gửi
      // \`an_the_duyet\`, vì bấm Duyệt lần nữa là cách DUY NHẤT để biết lượt trước ra sao
      // (\`confirmAction\` idempotent — xem \`bangChat.duyetDeXuat\`). Khoá vĩnh viễn ở đó là lấy mất
      // đúng đường thoát mà bản vá kia dựng ra.
      moKhoaNutDuyet();
      // ★★★ ĐỢT M — CỐ Ý KHÔNG \`moKhoaNutDuyetLenh()\` ở đây (khác nút ghi tệp ở trên): giữa lúc
      // lệnh đang chạy, \`bangChat.ts#duyetLenhCucBo\` gửi MỘT \`thong_bao\` tiến độ ("Đang chạy…")
      // TRƯỚC khi tiến trình kết thúc — mở khoá ngay lúc đó cho phép bấm "Chạy lệnh" LẦN HAI trong
      // khi lệnh thứ nhất còn sống, spawn tiến trình THỨ HAI ngoài ý muốn. Nút chỉ mở khoá lại khi
      // thẻ ẩn hẳn (\`an_the_duyet_lenh\`, gửi kèm kết quả cuối) hoặc khi một thẻ MỚI hiện ra
      // (\`the_duyet_lenh\`, gọi \`moKhoaNutDuyetLenh()\` riêng — xem nhánh đó ở trên).
      // ★★★ ĐỢT I / TASK I-1a — TIN CÓ NGHĨA: khi lượt còn đang chờ (chỉ báo ba-chấm vẫn còn, tức
      // CHƯA có token thật nào tới), đổi chỉ báo sang ĐÚNG chữ tiến độ này ("vòng N/3 — đang đọc…")
      // thay vì ba chấm chung chung — KHÔNG THAY THẾ bong bóng hệ thống bên dưới (giữ NGUYÊN, đây là
      // sổ tiến trình đầy đủ đã có từ trước); chỉ báo trong bong bóng AI là một bản tóm tắt SỐNG
      // ngay chỗ mắt người dùng đang nhìn (cạnh nút Dừng), không buộc phải cuộn lên đọc sổ.
      capNhatChiBaoChoAi(m.thongDiep);
      themLuot("he_thong", m.thongDiep, m.moSettings === true, "Thông báo");
    } else if (m.loai === "dat_cau_hoi_tu_lenh") {
      // ★★★ CMD+K (Task 7) — extension đổ câu hỏi ĐÃ DỰNG SẴN (đường dẫn + dòng + đoạn mã + yêu
      // cầu, xem loi/cauHoiSuaChon.ts) vào Ô NHẬP rồi gọi ĐÚNG hàm gửi mà nút "Gửi" dùng. KHÔNG có
      // đường tắt nào ở đây: gui() vẫn tạo bong bóng "Bạn: …", vẫn postMessage({loai:"hoi"}),
      // vẫn đi qua toàn bộ chuỗi đề-xuất → diff → duyệt → apBanVa y hệt một câu gõ tay.
      // ★★★ H3(b) — đặt cờ TRƯỚC khi gọi gui(): đây là lượt DUY NHẤT được đánh dấu "đến từ Cmd+K"
      // để phía extension biết KHÔNG chèn giao thức dạy-đọc (giao thức đó cạnh tranh với chỉ dẫn
      // \`de_xuat_sua_doan\` mà chính câu hỏi này đã mang sẵn).
      laCauHoiTuLenh = true;
      oNhap.value = m.cauHoi;
      gui();
    } else if (m.loai === "goi_y_mention") {
      // TASK 5 — nội dung dropdown (danh sách tệp) do EXTENSION lọc/gạn sẵn (hàng rào gửi + vị từ
      // lọc theo chữ đang gõ); webview chỉ hiển thị. Bỏ qua nếu người dùng đã rời khỏi ngữ cảnh
      // "@..." trong lúc chờ trả lời (gõ tiếp qua khoảng trắng, xoá "@", đổi vị trí con trỏ…) —
      // một dropdown xuất hiện SAU KHI ý định gõ mention đã qua là một cú giật giao diện vô nghĩa.
      const vt = viTriMention();
      if (!vt) { anMenuMention(); }
      else hienMenuMention(m.ds || []);
    } else if (m.loai === "trang_thai_dang_nhap") {
      // ★★★ ĐỢT F / TASK 1 / B3 — KẾT CỤC người dùng thấy: khung TỰ đổi sang trạng thái đã đăng
      // nhập ngay khi tin này tới, KHÔNG cần đóng/mở lại view. Extension gửi tin này (1) ngay sau
      // "san_sang" (phản ánh trạng thái THẬT — có thể đã đăng nhập từ phiên VSCode trước) và (2)
      // sau khi lệnh đăng nhập/đăng xuất chạy XONG (không phải "đã gọi lệnh").
      // ★★★ B4 — CHỈ đổi thuộc tính của \`#nut-tai-khoan\`, TUYỆT ĐỐI KHÔNG chạm \`oNhap.value\`: đây
      // là lý do câu hỏi đang gõ dở không bao giờ mất khi trạng thái đăng nhập đổi (không có bản
      // dựng lại HTML nào ở đây, chỉ đổi \`title\`/\`aria-label\`/lớp CSS của DOM đang sống).
      // ★★★ ĐỢT G / TASK G1 / B2 — tên tài khoản CHỈ đi vào \`title\`/\`aria-label\` (tooltip qua
      // thuộc tính, không phải \`textContent\` của một phần tử hiện ra) — vẫn tới qua ĐÚNG tin này,
      // không tiêm vào HTML tĩnh (giữ nguyên kỷ luật đã ghi ở docblock đầu tệp).
      // ★★★ ĐỢT G / TASK G4 / B1 — CÙNG tooltip đó nay MANG THÊM địa chỉ máy chủ hiện tại
      // (\`m.serverUrl\`, cũng qua thuộc tính \`title\`/\`aria-label\`, KHÔNG \`textContent\`/\`innerHTML\`
      // — cùng kỷ luật chống tiêm HTML đã ghi ở trên cho tên tài khoản). Lựa chọn "tooltip, không
      // phải dòng riêng" là CÓ CHỦ Ý: xem lý do đầy đủ ở docblock \`guiTrangThaiDangNhap\`
      // (\`bangChat.ts\`) — G1 vừa dọn đúng vùng này từ ba phần tử xuống một icon.
      const daDangNhap = m.daDangNhap === true;
      daDangNhapHienTai = daDangNhap;
      nutTaiKhoan.classList.toggle("da-dang-nhap", daDangNhap);
      const dongMayChu = m.serverUrl ? " · Máy chủ: " + m.serverUrl : "";
      const nhanTaiKhoan = (daDangNhap ? (m.tenTaiKhoan || "Đã đăng nhập") + " — bấm để đăng xuất" : "Đăng nhập") + dongMayChu;
      nutTaiKhoan.title = nhanTaiKhoan;
      nutTaiKhoan.setAttribute("aria-label", nhanTaiKhoan);
    } else if (m.loai === "che_do") {
      if (m.cheDo === "hoi" || m.cheDo === "sua" || m.cheDo === "tu-dong" || m.cheDo === "chat-cu") { cheDoLuu = m.cheDo; veOCheDo(); }
    } else if (m.loai === "muc_quyen") {
      // ★★★ ĐỢT G / TASK G3 / B4 — extension gửi tin này NGAY sau "san_sang" (mức đã lưu, hoặc
      // mặc định AN TOÀN nếu kho rỗng/hỏng) và SAU MỖI lần "dat_muc_quyen" (xác nhận giá trị THẬT
      // đã áp — không phải giá trị vừa gửi lên, phòng khi hai bên lệch nhau). Chỉ gán khi hợp lệ:
      // một chuỗi lạ ở đây (webview lỗi khác đang chạy?) không được phép làm ô chọn hiện một mức
      // KHÔNG có trong ba \`<option>\` tĩnh.
      if (m.mucQuyen === "chi_doc" || m.mucQuyen === "hoi_truoc_khi_ghi" || m.mucQuyen === "tu_ghi") {
        oMucQuyen.value = m.mucQuyen;
        mucQuyenLuu = m.mucQuyen;
        veOCheDo();
      }
    } else if (m.loai === "chat_moi") {
      // ★★★ ĐỢT F / TASK 3 / B3 — "Chat mới": khung TRẮNG, không còn dấu vết gì của phiên cũ, KỂ CẢ
      // câu đang gõ dở (\`true\` — xem docblock \`xoaKhungChoPhienKhac\`, bản vá 2026-09-03).
      xoaKhungChoPhienKhac(true);
      // ★★★ ĐỢT G / TASK G2 / B3 — khung TRẮNG THẬT ⇒ thống kê cũng về ĐÚNG 0/0 (extension đã gửi
      // \`soLuot:0, soKyTu:0\` kèm tin này — xem \`chatMoi()\` ở \`bangChat.ts\`).
      thongKeHoiThoai = { soLuot: m.soLuot ?? 0, soKyTu: m.soKyTu ?? 0 };
      capNhatThanhNguCanh();
    } else if (m.loai === "khoi_phuc_hoi_thoai") {
      // ★★★ ĐỢT F / TASK 2 / B5 (khởi động) + TASK 3 / B4 ("Lịch sử") — DÙNG CHUNG một tin: khởi
      // động khi khung vừa mở (đọc hội thoại GẦN NHẤT từ \`workspaceState\`) VÀ khi người dùng chọn
      // một hội thoại cũ ở "Lịch sử". Xoá TRƯỚC khi vẽ: vô hại lúc khởi động (#hoi-thoai đã trắng
      // sẵn) và BẮT BUỘC lúc "Lịch sử" (khung có thể đang hiện nội dung của phiên VỪA RỜI — không xoá
      // trước thì bong bóng của hai hội thoại chồng lên nhau). Vẽ lại từng lượt bằng ĐÚNG \`themLuot\`
      // mà \`gui()\`/luồng token dùng, để người dùng thấy đúng những gì đã có, không chỉ khôi phục
      // NGẦM trong bộ nhớ của extension.
      // ★★★ BẢN VÁ (2026-09-03) — \`false\`: KHÔNG xoá câu đang gõ dở. Người dùng chỉ đang XEM một
      // hội thoại cũ (hay khung vừa khởi động, lúc \`o-nhap\` chắc chắn còn rỗng) — không phải chủ
      // động "rời phiên" như "Chat mới", nên nháp đang gõ (nếu có) phải CÒN NGUYÊN sau khi xem xong.
      xoaKhungChoPhienKhac(false);
      for (const l of m.luot || []) {
        const khung = themLuot(l.vaiTro === "user" ? "nguoi_dung" : "ai", l.noiDung);
        // trả lời của AI trong lịch sử cũng dựng markdown (host gửi kèm cây); khối mã chưa đăng ký chỉ số ⇒ không hiện nút hành động
        if (l.vaiTro !== "user" && Array.isArray(l.cay)) veLaiKhoiMd(khung, l.cay, 0, true);
      }
      // ★★★ ĐỢT G / TASK G2 / B3 — thống kê của ĐÚNG hội thoại vừa vẽ lại (extension gửi kèm
      // \`soLuot\`/\`soKyTu\` của bản ghi vừa khôi phục — xem \`khoiPhucHoiThoaiGanNhat\`/\`moLichSu\`).
      thongKeHoiThoai = { soLuot: m.soLuot ?? 0, soKyTu: m.soKyTu ?? 0 };
      capNhatThanhNguCanh();
    }
    cuonNeuODay(odDay);
  });
  // Bắt tay chống ĐUA: extension có thể gửi danh sách dự án TRƯỚC khi script này kịp đăng ký
  // listener ở trên ⇒ danh sách rơi mất mà không có lỗi nào. Báo "san_sang" NGAY SAU khi đã lắng
  // nghe để extension biết lúc nào an toàn để gửi.
  vscode.postMessage({ loai: "san_sang" });
</script>
</body>
</html>`;
}
