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
export function dungHtmlBang(dv: { nonce: string; daDangNhap?: boolean }): string {
  const n = dv.nonce;
  const daDangNhap = dv.daDangNhap === true;
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';" />
<style nonce="${n}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         margin: 0; padding: 8px; display: flex; flex-direction: column; height: 100vh; }
  /* ĐỢT G / TASK G1 / B2 — góc khung, không còn chiếm nguyên một hàng như nút to cũ.
     ĐỢT G / TASK G3 / B4 — nay CHIA HAI ĐẦU: ô chọn mức quyền bên TRÁI, icon tài khoản bên PHẢI. */
  #vung-tai-khoan { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  /* ĐỢT G / TASK G3 / B4 — ô chọn mức quyền (chế độ tự trị). Chữ NHỎ, giống thanh trạng thái ngữ
     cảnh — đây là một cấu hình PHỤ, không phải hành động chính của khung. */
  #vung-muc-quyen { display: flex; align-items: center; gap: 4px; font-size: 11px; opacity: .9; }
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
  #o-du-an { width: 100%; margin-bottom: 8px; background: var(--vscode-dropdown-background);
             color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);
             padding: 4px; }
  #hoi-thoai { flex: 1; overflow-y: auto; white-space: pre-wrap; font-size: 13px; }
  .luot { margin-bottom: 10px; }
  .nhan { opacity: .7; font-size: 11px; text-transform: uppercase; }
  #the-duyet { border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
               background: var(--vscode-editorWidget-background); padding: 8px; margin-top: 8px;
               font-size: 12px; }
  #the-duyet #duyet-duong { font-weight: 600; margin: 2px 0; }
  .the-duyet-nut { display: flex; gap: 6px; margin-top: 8px; }
  #hang-nhap { display: flex; gap: 6px; margin-top: 8px; position: relative; }
  #o-nhap { flex: 1; background: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            padding: 6px; font-family: inherit; }
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
  .dinh-kem-muc { display: inline-flex; align-items: center; gap: 4px;
                  background: var(--vscode-badge-background, rgba(128,128,128,.15));
                  color: var(--vscode-badge-foreground, var(--vscode-foreground));
                  border-radius: 4px; padding: 2px 6px; font-size: 12px; }
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
  <div id="vung-muc-quyen" title="Mức quyền ghi tệp của AI — quyết định AI được tự ý sửa đĩa của bạn tới đâu">
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
<select id="o-du-an" title="Chọn dự án" hidden></select>
<div id="hoi-thoai"></div>
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
<div id="hang-nhap">
  <!-- TASK 5 — dropdown gợi ý @-mention. MẶC ĐỊNH ẨN: chỉ hiện khi đang gõ "@..." VÀ extension đã
       trả về ít nhất một gợi ý. Nội dung (danh sách tệp) do EXTENSION dựng — webview chỉ hiển thị
       và chuyển tiếp lựa chọn, đúng nguyên tắc đã áp cho thẻ duyệt. -->
  <div id="mention-ds" hidden></div>
  <!-- ĐỢT G / TASK G2 / B1 — nút "đính kèm tệp". Webview chỉ BÁO Ý ĐỊNH (\`xin_dinh_kem\`) — bộ chọn
       THẬT (danh sách + hàng rào rời máy) nằm ở phía extension (\`bangChat.moBoChonDinhKem\`), đúng
       nguyên tắc "hiển thị + chuyển tiếp" đã áp cho thẻ duyệt/nút Dừng/@-mention. SVG nội tuyến,
       cùng cách G1 đã chọn cho icon tài khoản — CSP webview không có font-src. -->
  <button id="nut-dinh-kem" class="nut-icon" title="Đính kèm tệp" aria-label="Đính kèm tệp trong workspace để gửi kèm câu hỏi">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true" focusable="false">
      <path d="M11.3 4.6 6.4 9.5a1.9 1.9 0 1 0 2.7 2.7l4.6-4.6a3.4 3.4 0 1 0-4.8-4.8L3.8 7.9" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
  <textarea id="o-nhap" rows="2" placeholder="Hỏi AI Local… (Ctrl+Enter để gửi, @ để chèn tệp)"></textarea>
  <!-- ĐỢT G / TASK G1 / B4 — icon nhỏ gọn thay chữ "Gửi"; aria-label GIỮ nhãn cho trình đọc màn
       hình (nhỏ gọn không đồng nghĩa vô danh) — hành vi bấm/Ctrl+Enter không đổi (vẫn gọi gui()). -->
  <button id="nut-gui" class="nut-icon" title="Gửi (Ctrl+Enter)" aria-label="Gửi (Ctrl+Enter)">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M1.2 1.4 14.8 8 1.2 14.6l2.6-6.1H9.5V7.5H3.8Z" />
    </svg>
  </button>
  <!-- TASK 4 — nút DỪNG. MẶC ĐỊNH ẨN: chỉ có ý nghĩa khi một lượt hỏi đang chạy (đang chờ SSE
       hoặc đang giữa vòng lặp tác nhân), không phải lúc rảnh. Hàm gui() hiện nó khi bắn câu hỏi;
       nơi DUY NHẤT ẩn lại là lúc nhận được tín hiệu 'lượt này đã xong' (hoan_tat/loi) — xem dưới. -->
  <button id="nut-dung" hidden>Dừng</button>
</div>
<!-- ĐỢT G / TASK G2 / B2 — danh sách tệp ĐANG ĐÍNH KÈM, DƯỚI ô nhập. MẶC ĐỊNH ẨN — script chỉ bật
     lại khi có ít nhất một tệp (xem hàm \`veLaiDsDinhKem\`); gỡ hết ⇒ tự ẩn lại, không để lại khung
     rỗng lơ lửng. -->
<div id="ds-dinh-kem" hidden></div>
<!-- ĐỢT G / TASK G2 / B3 — THANH TRẠNG THÁI NGỮ CẢNH. ★★★ KHÔNG BỊA SỐ TOKEN: ba đơn vị ĐO ĐƯỢC
     THẬT (số lượt hội thoại, tổng ký tự lịch sử — chính phần sẽ được gửi lại làm "history" cho câu
     hỏi kế tiếp, số tệp đính kèm) — mỗi nhãn nói ĐÚNG TÊN thứ nó đếm, không đoán ra một con số
     token không đo được ở tầng extension. \`title\` nhắc lại đây KHÔNG phải kế toán token, phòng khi
     ai đó lướt qua tưởng đây là % ngữ cảnh model. -->
<div id="thanh-ngu-canh"
     title="Đơn vị ĐO ĐƯỢC THẬT — ký tự, tệp, lượt — KHÔNG PHẢI số token (chưa đo được token thật ở tầng extension)">
  <span id="tk-luot">Lượt hội thoại: 0</span> ·
  <span id="tk-ky-tu">Ký tự lịch sử: 0</span> ·
  <span id="tk-dinh-kem">Tệp đính kèm: 0</span>
</div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const hoiThoai = document.getElementById("hoi-thoai");
  const oNhap = document.getElementById("o-nhap");
  let khoiTraLoi = null;
  // ★★★ H3(b) (review toàn nhánh 2026-08-30) — cờ báo lượt "hoi" SẮP GỬI đến từ Cmd+K
  // ("dat_cau_hoi_tu_lenh") chứ không phải người dùng tự gõ. gui() đọc cờ này rồi ĐÍNH KÈM vào
  // postMessage({loai:"hoi"}) — đây là cách DUY NHẤT phía extension (bangChat.ts) biết một lượt hỏi
  // có mang giao thức Cmd+K hay không, vì nội dung cauHoi lúc đó trông giống hệt một câu gõ tay.
  let laCauHoiTuLenh = false;

  function themLuot(nhan, chu) {
    const d = document.createElement("div");
    d.className = "luot";
    const t = document.createElement("div");
    t.className = "nhan";
    t.textContent = nhan;
    const c = document.createElement("div");
    c.textContent = chu;
    d.appendChild(t); d.appendChild(c);
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

  function veLaiDsDinhKem() {
    dsDinhKem.innerHTML = "";
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
    dsDinhKem.hidden = tepDinhKemHienTai.length === 0;
    capNhatThanhNguCanh();
  }

  document.getElementById("nut-dinh-kem").addEventListener("click", () =>
    vscode.postMessage({ loai: "xin_dinh_kem" }));

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
    tkDinhKem.textContent = "Tệp đính kèm: " + tepDinhKemHienTai.length;
  }

  function gui() {
    const cauHoi = oNhap.value.trim();
    if (!cauHoi) return;
    themLuot("Bạn", cauHoi);
    oNhap.value = "";
    khoiTraLoi = themLuot("AI Local", "");
    nutDung.hidden = false;
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
    vscode.postMessage({ loai: "hoi", cauHoi, duAnId: document.getElementById("o-du-an").value, tepMention, tuLenh });
  }

  document.getElementById("nut-gui").addEventListener("click", gui);
  oNhap.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); gui(); }
  });
  // TASK 5 — Tab CHỌN gợi ý ĐẦU TIÊN đang hiện (bàn phím-trước, không bắt buộc dùng chuột); Escape
  // đóng dropdown mà KHÔNG chèn gì. Đặt ở listener RIÊNG, tách khỏi listener Ctrl+Enter phía trên
  // để mỗi khối chỉ lo một việc.
  oNhap.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && goiYHienTai.length > 0) { e.preventDefault(); chonGoiY(goiYHienTai[0]); return; }
    if (e.key === "Escape" && !mentionDs.hidden) { anMenuMention(); }
  });

  // Thẻ duyệt (chế độ SERVER): webview chỉ HIỂN THỊ chữ do extension đã dựng sẵn và CHUYỂN TIẾP
  // cú bấm nút — mọi quyết định (gọi confirmAction/cancelAction, xoá đề xuất khỏi bộ nhớ) nằm ở
  // phía extension. Webview không bao giờ tự quyết ghi hay không.
  const theDuyet = document.getElementById("the-duyet");
  // ĐỔI DỰ ÁN phải báo NGAY, không đợi tới câu hỏi kế tiếp: một đề xuất ghi đang chờ thuộc về dự án
  // nó sinh ra, nên phía extension cần biết lúc ô chọn đổi để vứt thẻ duyệt đi (xem bangChat.ts).
  document.getElementById("o-du-an").addEventListener("change", (e) =>
    vscode.postMessage({ loai: "doi_du_an", duAnId: e.target.value }));
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
    khoiTraLoi = null;
    theDuyet.hidden = true;
    moKhoaNutDuyet();
    nutDung.hidden = true;
    anMenuMention();
    if (xoaCauDangGo) oNhap.value = "";
    // ★★★ ĐỢT G / TASK G2 / B1 — tệp đính kèm thuộc về PHIÊN đang xem: rời sang "Chat mới" hay mở
    // một hội thoại KHÁC ở "Lịch sử" đều phải xoá danh sách của phiên VỪA RỜI, cùng lý lẽ với thẻ
    // duyệt/nút Dừng ở trên — một tệp đính kèm của hội thoại A tự động đi theo sang hội thoại B là
    // một rò rỉ ngữ cảnh giữa hai cuộc trò chuyện không liên quan.
    tepDinhKemHienTai = [];
    veLaiDsDinhKem();
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.loai === "token" && khoiTraLoi) khoiTraLoi.textContent += m.chu;
    else if (m.loai === "loi") { themLuot("Lỗi", m.thongDiep); nutDung.hidden = true; }
    else if (m.loai === "hoan_tat") {
      // vanBanCuoi chỉ có khi server bảo THAY chữ đã stream (degraded) — không phải mọi lượt.
      if (m.vanBanCuoi != null && khoiTraLoi) khoiTraLoi.textContent = m.vanBanCuoi;
      // Cắt ngang hoặc khung hỏng: KHÔNG được im lặng — phải hiện, kể cả khi câu trả lời trông
      // như đã xong.
      if (m.canhBao) themLuot("Lưu ý", m.canhBao);
      // ★★★ TASK 4 — \`hoan_tat\` là tín hiệu DUY NHẤT "cả lượt hỏi (mọi vòng) đã xong", kể cả khi nó
      // xong VÌ bị dừng (extension vẫn gửi \`hoan_tat\` sau khi báo "đã dừng" — xem \`bangChat.ts\`).
      // Ẩn nút Dừng Ở ĐÂY, không đoán qua bất kỳ tín hiệu nào khác (token/thong_bao vẫn có thể bắn
      // giữa các vòng của MỘT lượt hỏi đang chạy — ẩn theo chúng sẽ ẩn nhầm lúc còn đang chạy).
      nutDung.hidden = true;
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
    } else if (m.loai === "duAn") {
      const o = document.getElementById("o-du-an");
      o.innerHTML = "";
      let coDuAnServer = false;
      let soGocLocal = 0;
      for (const d of m.ds) {
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
        themLuot("Lỗi", "Thẻ duyệt thiếu nhãn nguồn hoặc chữ trên nút ghi — đã KHÔNG hiện thẻ.");
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
    } else if (m.loai === "thong_bao") {
      // ⚠⚠ MỞ KHOÁ Ở ĐÂY LÀ BẮT BUỘC, không phải cho gọn. Đường SERVER có một ca CỐ Ý **giữ thẻ
      // lại**: "KHÔNG RÕ KẾT CỤC" (mất mạng giữa chừng) chỉ gửi \`thong_bao\` và KHÔNG gửi
      // \`an_the_duyet\`, vì bấm Duyệt lần nữa là cách DUY NHẤT để biết lượt trước ra sao
      // (\`confirmAction\` idempotent — xem \`bangChat.duyetDeXuat\`). Khoá vĩnh viễn ở đó là lấy mất
      // đúng đường thoát mà bản vá kia dựng ra.
      moKhoaNutDuyet();
      themLuot("Thông báo", m.thongDiep);
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
      const daDangNhap = m.daDangNhap === true;
      daDangNhapHienTai = daDangNhap;
      nutTaiKhoan.classList.toggle("da-dang-nhap", daDangNhap);
      const nhanTaiKhoan = daDangNhap ? (m.tenTaiKhoan || "Đã đăng nhập") + " — bấm để đăng xuất" : "Đăng nhập";
      nutTaiKhoan.title = nhanTaiKhoan;
      nutTaiKhoan.setAttribute("aria-label", nhanTaiKhoan);
    } else if (m.loai === "muc_quyen") {
      // ★★★ ĐỢT G / TASK G3 / B4 — extension gửi tin này NGAY sau "san_sang" (mức đã lưu, hoặc
      // mặc định AN TOÀN nếu kho rỗng/hỏng) và SAU MỖI lần "dat_muc_quyen" (xác nhận giá trị THẬT
      // đã áp — không phải giá trị vừa gửi lên, phòng khi hai bên lệch nhau). Chỉ gán khi hợp lệ:
      // một chuỗi lạ ở đây (webview lỗi khác đang chạy?) không được phép làm ô chọn hiện một mức
      // KHÔNG có trong ba \`<option>\` tĩnh.
      if (m.mucQuyen === "chi_doc" || m.mucQuyen === "hoi_truoc_khi_ghi" || m.mucQuyen === "tu_ghi") {
        oMucQuyen.value = m.mucQuyen;
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
      for (const l of m.luot || []) themLuot(l.vaiTro === "user" ? "Bạn" : "AI Local", l.noiDung);
      // ★★★ ĐỢT G / TASK G2 / B3 — thống kê của ĐÚNG hội thoại vừa vẽ lại (extension gửi kèm
      // \`soLuot\`/\`soKyTu\` của bản ghi vừa khôi phục — xem \`khoiPhucHoiThoaiGanNhat\`/\`moLichSu\`).
      thongKeHoiThoai = { soLuot: m.soLuot ?? 0, soKyTu: m.soKyTu ?? 0 };
      capNhatThanhNguCanh();
    }
    hoiThoai.scrollTop = hoiThoai.scrollHeight;
  });
  // Bắt tay chống ĐUA: extension có thể gửi danh sách dự án TRƯỚC khi script này kịp đăng ký
  // listener ở trên ⇒ danh sách rơi mất mà không có lỗi nào. Báo "san_sang" NGAY SAU khi đã lắng
  // nghe để extension biết lúc nào an toàn để gửi.
  vscode.postMessage({ loai: "san_sang" });
</script>
</body>
</html>`;
}
